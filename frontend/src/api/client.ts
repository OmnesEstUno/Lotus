import { IncomeEntry, Instance, Transaction, UserCategories } from '../types';
import { STORAGE_KEYS } from '../utils/constants';
import { storage } from '../utils/storage';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

// ─── Optimistic-concurrency version tracking ──────────────────────────────────

/**
 * Thrown when the server returns 409 (stale write).  Callers can check
 * `instanceof ConflictError` to surface a "please retry" message.
 */
export class ConflictError extends Error {
  public readonly currentVersion: number | undefined;
  constructor(message: string, currentVersion?: number) {
    super(message);
    this.name = 'ConflictError';
    this.currentVersion = currentVersion;
  }
}

/**
 * Module-level store for the last known version of each versioned resource.
 * Keyed by resource name: 'transactions', 'income', 'userCategories'.
 * Read functions populate this automatically; mutation functions read from it.
 */
const resourceVersions = new Map<string, number>();

function rememberVersion(resource: string, version: number): void {
  resourceVersions.set(resource, version);
}

export function lastKnownVersion(resource: string): number | undefined {
  return resourceVersions.get(resource);
}

const activeInstanceListeners = new Set<(id: string | null) => void>();

function notifyActiveInstanceChange(id: string | null): void {
  activeInstanceListeners.forEach((fn) => fn(id));
}

export function subscribeActiveInstance(fn: (id: string | null) => void): () => void {
  activeInstanceListeners.add(fn);
  return () => activeInstanceListeners.delete(fn);
}

export function getActiveInstanceId(): string | null {
  return storage.get(STORAGE_KEYS.ACTIVE_INSTANCE);
}

export function setActiveInstanceIdLocal(id: string | null): void {
  if (id) storage.set(STORAGE_KEYS.ACTIVE_INSTANCE, id);
  else storage.remove(STORAGE_KEYS.ACTIVE_INSTANCE);
  notifyActiveInstanceChange(id);
}

// ─── Same-tab username change listeners ──────────────────────────────────────

const usernameListeners = new Set<(u: string | null) => void>();

function notifyUsernameChange(u: string | null): void {
  usernameListeners.forEach((fn) => fn(u));
}

export function subscribeUsername(fn: (u: string | null) => void): () => void {
  usernameListeners.add(fn);
  return () => usernameListeners.delete(fn);
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function getToken(): string | null {
  return storage.get(STORAGE_KEYS.TOKEN);
}

function setToken(token: string): void {
  storage.set(STORAGE_KEYS.TOKEN, token);
}

function clearToken(): void {
  storage.remove(STORAGE_KEYS.TOKEN);
}

export function getCurrentUsername(): string | null {
  return storage.get(STORAGE_KEYS.USERNAME);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const activeInstanceId = getActiveInstanceId();
  if (activeInstanceId) {
    headers['X-Instance-Id'] = activeInstanceId;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    storage.remove(STORAGE_KEYS.USERNAME);
    notifyUsernameChange(null);
    storage.remove(STORAGE_KEYS.ACTIVE_INSTANCE);
    notifyActiveInstanceChange(null);
    window.location.hash = '#/login';
    throw new Error('Session expired. Please log in again.');
  }

  if (res.status === 409) {
    const body = await res.json().catch(() => null) as { currentVersion?: number } | null;
    throw new ConflictError(
      'Data was changed by another tab or device. Please retry.',
      body?.currentVersion,
    );
  }

  const data = await res.json().catch(() => ({ error: 'Unexpected server response.' }));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed with status ${res.status}`);
  }
  return data as T;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function getSetupStatus(): Promise<{ initialized: boolean; migrationPending: boolean }> {
  return request('/api/setup/status');
}

export async function initSetup(username: string, password: string, inviteToken: string): Promise<{ totpSecret: string; username: string; setupToken: string }> {
  return request('/api/setup/init', {
    method: 'POST',
    body: JSON.stringify({ username, password, inviteToken }),
  });
}

export async function confirmSetup(username: string, totpCode: string, setupToken: string): Promise<void> {
  return request('/api/setup/confirm', {
    method: 'POST',
    body: JSON.stringify({ username, totpCode, setupToken }),
  });
}

export async function login(username: string, password: string): Promise<{ preAuthToken: string }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function verify2FA(preAuthToken: string, totpCode: string): Promise<{ token: string; username: string }> {
  const result = await request<{ token: string; username: string }>('/api/auth/verify-2fa', {
    method: 'POST',
    body: JSON.stringify({ preAuthToken, totpCode }),
  });
  setToken(result.token);
  storage.set(STORAGE_KEYS.USERNAME, result.username);
  notifyUsernameChange(result.username);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
    storage.remove(STORAGE_KEYS.USERNAME);
    notifyUsernameChange(null);
    storage.remove(STORAGE_KEYS.ACTIVE_INSTANCE);
    notifyActiveInstanceChange(null);
  }
}

export async function migrateLegacy(username: string, password: string): Promise<{ ok: boolean; moved: number }> {
  return request('/api/setup/migrate', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// ─── Instances ───────────────────────────────────────────────────────────────

/**
 * Fetch all instances the user belongs to.  Stashes each instance's version
 * so subsequent writes can supply the correct expectedVersion.
 */
export async function getInstances(): Promise<{ instances: Instance[]; activeInstanceId: string | null }> {
  const result = await request<{ instances: Instance[]; activeInstanceId: string | null }>('/api/instances');
  for (const inst of result.instances) {
    rememberVersion(`instance:${inst.id}`, inst.version ?? 0);
  }
  return result;
}

export async function createInstance(name: string): Promise<Instance> {
  const inst = await request<Instance>('/api/instances', { method: 'POST', body: JSON.stringify({ name }) });
  rememberVersion(`instance:${inst.id}`, inst.version ?? 1);
  return inst;
}

/**
 * Rename a workspace.  Requires a fresh version from a prior getInstances()
 * call.  Throws ConflictError on 409.
 */
export async function renameInstance(id: string, name: string): Promise<Instance> {
  const expectedVersion = lastKnownVersion(`instance:${id}`) ?? 0;
  const inst = await request<Instance>(`/api/instances/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, expectedVersion }),
  });
  rememberVersion(`instance:${inst.id}`, inst.version ?? 0);
  return inst;
}

export async function deleteInstance(id: string): Promise<void> {
  await request(`/api/instances/${id}`, { method: 'DELETE' });
}

/**
 * Remove a member from a workspace (owner removing someone, or self-removal).
 * Requires a fresh version from a prior getInstances() call.  Throws
 * ConflictError on 409.
 */
export async function removeInstanceMember(id: string, username: string): Promise<Instance> {
  const expectedVersion = lastKnownVersion(`instance:${id}`) ?? 0;
  const inst = await request<Instance>(
    `/api/instances/${id}/members/${encodeURIComponent(username)}?expectedVersion=${expectedVersion}`,
    { method: 'DELETE' },
  );
  rememberVersion(`instance:${inst.id}`, inst.version ?? 0);
  return inst;
}

export async function setActiveInstance(instanceId: string): Promise<void> {
  await request('/api/instances/active', { method: 'PUT', body: JSON.stringify({ instanceId }) });
}

// ─── Versioned-list helper ───────────────────────────────────────────────────

/**
 * Fetch a versioned list resource.  Stashes the returned `version` under
 * `versionKey` and returns the array stored at `payloadKey`.
 *
 * Pass `year` to append `?year=<n>` to the request path.
 */
async function getVersionedList<T, K extends string>(
  path: string,
  payloadKey: K,
  versionKey: string,
  year?: number,
): Promise<T[]> {
  const qs = year !== undefined ? `?year=${year}` : '';
  const r = await request<{ [k in K]: T[] } & { version: number }>(`${path}${qs}`);
  rememberVersion(versionKey, r.version);
  return r[payloadKey];
}

// ─── Transactions ────────────────────────────────────────────────────────────

/**
 * Fetch all transactions. Pass `year` to scope the request to a single
 * calendar year (Task 9's YearSelector can opt into this for large datasets).
 * Always remembers the returned version for use by subsequent write calls.
 */
export async function getTransactions(year?: number): Promise<Transaction[]> {
  return getVersionedList<Transaction, 'transactions'>('/api/transactions', 'transactions', 'transactions', year);
}

/** Payload for addTransactions — each row may carry `allowDuplicate` to
 *  explicitly bypass the server's dedup check (used when the user has
 *  approved a row that was flagged as a duplicate). */
export type AddTransactionInput = Omit<Transaction, 'id'> & { allowDuplicate?: boolean };

export async function addTransactions(
  transactions: AddTransactionInput[],
): Promise<{ added: number; skipped: number }> {
  const expectedVersion = lastKnownVersion('transactions');
  if (expectedVersion === undefined) {
    throw new Error('Cannot add transactions without first fetching them.');
  }
  return request('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ transactions, expectedVersion }),
  });
}

export type TransactionUpdate = Partial<Pick<Transaction, 'date' | 'description' | 'category' | 'amount' | 'notes' | 'archived'>>;

export async function updateTransaction(id: string, updates: TransactionUpdate): Promise<Transaction> {
  const expectedVersion = lastKnownVersion('transactions');
  if (expectedVersion === undefined) {
    throw new Error('Cannot update transaction without first fetching transactions.');
  }
  return request(`/api/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...updates, expectedVersion }),
  });
}

export async function bulkUpdateCategory(
  pattern: string,
  newCategory: string,
  previousCategory?: string,
): Promise<{ updated: number }> {
  const expectedVersion = lastKnownVersion('transactions');
  if (expectedVersion === undefined) {
    throw new Error('Cannot bulk-update categories without first fetching transactions.');
  }
  return request('/api/transactions/bulk-update-category', {
    method: 'POST',
    body: JSON.stringify({ pattern, newCategory, previousCategory, expectedVersion }),
  });
}

// ─── Income ──────────────────────────────────────────────────────────────────

/**
 * Fetch all income entries. Pass `year` to scope the request to a single
 * calendar year (Task 9's YearSelector can opt into this for large datasets).
 * Always remembers the returned version for use by subsequent write calls.
 */
export async function getIncome(year?: number): Promise<IncomeEntry[]> {
  return getVersionedList<IncomeEntry, 'income'>('/api/income', 'income', 'income', year);
}

export type AddIncomeInput = Omit<IncomeEntry, 'id'> & { allowDuplicate?: boolean };

export async function addIncome(
  entry: AddIncomeInput,
): Promise<{ skipped: boolean; entry: IncomeEntry | null }> {
  const expectedVersion = lastKnownVersion('income');
  if (expectedVersion === undefined) {
    throw new Error('Cannot add income without first fetching income entries.');
  }
  return request('/api/income', {
    method: 'POST',
    body: JSON.stringify({ entry, expectedVersion }),
  });
}

export type IncomeUpdate = Partial<Pick<IncomeEntry, 'date' | 'description' | 'grossAmount' | 'netAmount'>>;

export async function updateIncome(id: string, updates: IncomeUpdate): Promise<IncomeEntry> {
  const expectedVersion = lastKnownVersion('income');
  if (expectedVersion === undefined) {
    throw new Error('Cannot update income entry without first fetching income entries.');
  }
  return request(`/api/income/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...updates, expectedVersion }),
  });
}

// ─── Bulk operations ─────────────────────────────────────────────────────────

/** Delete a mixed set of transactions and income entries in a single call. */
export async function bulkDelete(
  transactionIds: string[],
  incomeIds: string[],
): Promise<{ deletedTransactions: number; deletedIncome: number }> {
  const body: Record<string, unknown> = { transactionIds, incomeIds };
  if (transactionIds.length > 0) {
    const v = lastKnownVersion('transactions');
    if (v === undefined) throw new Error('Cannot delete transactions without first fetching them.');
    body.expectedTransactionsVersion = v;
  }
  if (incomeIds.length > 0) {
    const v = lastKnownVersion('income');
    if (v === undefined) throw new Error('Cannot delete income entries without first fetching them.');
    body.expectedIncomeVersion = v;
  }
  return request('/api/bulk-delete', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Irreversibly wipes all transactions and income entries. Keeps user
 *  categories and mappings. Caller must have already obtained explicit
 *  confirmation from the user before invoking this. */
export async function purgeAllData(): Promise<void> {
  await request('/api/purge-all', {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });
}

/** Rename a category everywhere it appears: transactions that use it, user
 *  mappings that point at it, and the customCategories list (if applicable).
 *  Returns the number of transactions and mappings that were updated. */
export async function renameCategory(
  from: string,
  to: string,
): Promise<{ updated: number; mappingsUpdated: number }> {
  const expectedTransactionsVersion = lastKnownVersion('transactions');
  const expectedUserCategoriesVersion = lastKnownVersion('userCategories');
  if (expectedTransactionsVersion === undefined) {
    throw new Error('Cannot rename category without first fetching transactions.');
  }
  if (expectedUserCategoriesVersion === undefined) {
    throw new Error('Cannot rename category without first fetching user categories.');
  }
  return request('/api/rename-category', {
    method: 'POST',
    body: JSON.stringify({ from, to, expectedTransactionsVersion, expectedUserCategoriesVersion }),
  });
}

/** Delete a category. Transactions using it get reassigned to `reassignTo`
 *  (default "Other"). Mappings pointing at it are removed. The category is
 *  removed from the user's customCategories list. */
export async function deleteCategory(
  name: string,
  reassignTo = 'Other',
): Promise<{ reassigned: number; mappingsRemoved: number }> {
  const expectedTransactionsVersion = lastKnownVersion('transactions');
  const expectedUserCategoriesVersion = lastKnownVersion('userCategories');
  if (expectedTransactionsVersion === undefined) {
    throw new Error('Cannot delete category without first fetching transactions.');
  }
  if (expectedUserCategoriesVersion === undefined) {
    throw new Error('Cannot delete category without first fetching user categories.');
  }
  return request('/api/delete-category', {
    method: 'POST',
    body: JSON.stringify({ name, reassignTo, expectedTransactionsVersion, expectedUserCategoriesVersion }),
  });
}

// ─── User Categories ─────────────────────────────────────────────────────────

export async function getUserCategories(): Promise<UserCategories> {
  const r = await request<UserCategories & { version: number }>('/api/user-categories');
  rememberVersion('userCategories', r.version);
  // Return only the fields the rest of the frontend expects (strip version)
  return { customCategories: r.customCategories, mappings: r.mappings };
}

export async function saveUserCategories(data: UserCategories): Promise<void> {
  const expectedVersion = lastKnownVersion('userCategories');
  if (expectedVersion === undefined) {
    throw new Error('Cannot save user categories without first fetching them.');
  }
  await request('/api/user-categories', {
    method: 'PUT',
    body: JSON.stringify({ ...data, expectedVersion }),
  });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function adminInit(adminSecret: string, password: string): Promise<{ totpSecret: string; otpauthUrl: string }> {
  const res = await fetch(`${API_URL}/api/admin/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({ error: 'Unexpected server response.' }));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed with status ${res.status}`);
  }
  return data as { totpSecret: string; otpauthUrl: string };
}

export interface InviteSummary {
  id: string;
  expiresAt: number;
  createdAt: number;
  usedBy: string | null;
  token: string;
}

export async function createInvite(): Promise<{ id: string; token: string; expiresAt: number }> {
  return request('/api/admin/invites', { method: 'POST' });
}
export async function listInvites(): Promise<{ invites: InviteSummary[] }> {
  return request('/api/admin/invites');
}
export async function deleteInvite(id: string): Promise<{ ok: true }> {
  return request(`/api/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ─── Workspace Invites ────────────────────────────────────────────────────────

export interface WorkspaceInviteSummary {
  id: string;
  expiresAt: number;
  createdAt: number;
  usedBy: string | null;
  token: string;
}

export async function createWorkspaceInvite(instanceId: string): Promise<{ id: string; token: string; expiresAt: number }> {
  return request(`/api/instances/${instanceId}/invites`, { method: 'POST' });
}
export async function listWorkspaceInvites(instanceId: string): Promise<{ invites: WorkspaceInviteSummary[] }> {
  return request(`/api/instances/${instanceId}/invites`);
}
export async function deleteWorkspaceInvite(instanceId: string, inviteId: string): Promise<{ ok: true }> {
  return request(`/api/instances/${instanceId}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
}
export async function acceptWorkspaceInvite(token: string): Promise<{ id: string; name: string; owner: string; members: string[]; createdAt: string }> {
  return request('/api/instances/invites/accept', { method: 'POST', body: JSON.stringify({ token }) });
}
export async function getWorkspaceInviteMeta(token: string): Promise<{ instanceName: string; ownerUsername: string; expiresAt: number; usedBy: string | null; alreadyMember: boolean }> {
  return request(`/api/instances/invites/meta?token=${encodeURIComponent(token)}`);
}

// ─── Feature Requests ────────────────────────────────────────────────────────

export interface FeatureRequest {
  id: string;
  username: string;
  text: string;
  createdAt: string;
  status: 'new' | 'reviewed' | 'planned' | 'done';
}

export async function submitFeatureRequest(text: string): Promise<{ id: string }> {
  return request('/api/feature-requests', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function listFeatureRequests(): Promise<FeatureRequest[]> {
  const res = await request<{ items: FeatureRequest[] }>('/api/feature-requests');
  return res.items;
}
