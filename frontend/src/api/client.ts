import { IncomeEntry, Instance, Transaction, UserCategories } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

// ─── Same-tab active-instance listeners ──────────────────────────────────────

const ACTIVE_INSTANCE_STORAGE_KEY = 'ft_active_instance';
const activeInstanceListeners = new Set<(id: string | null) => void>();

function notifyActiveInstanceChange(id: string | null): void {
  activeInstanceListeners.forEach((fn) => fn(id));
}

export function subscribeActiveInstance(fn: (id: string | null) => void): () => void {
  activeInstanceListeners.add(fn);
  return () => activeInstanceListeners.delete(fn);
}

export function getActiveInstanceId(): string | null {
  return localStorage.getItem(ACTIVE_INSTANCE_STORAGE_KEY);
}

export function setActiveInstanceIdLocal(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_INSTANCE_STORAGE_KEY, id);
  else localStorage.removeItem(ACTIVE_INSTANCE_STORAGE_KEY);
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
  return localStorage.getItem('ft_token');
}

function setToken(token: string): void {
  localStorage.setItem('ft_token', token);
}

function clearToken(): void {
  localStorage.removeItem('ft_token');
}

export function getCurrentUsername(): string | null {
  return localStorage.getItem('ft_username');
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
    localStorage.removeItem('ft_username');
    notifyUsernameChange(null);
    localStorage.removeItem(ACTIVE_INSTANCE_STORAGE_KEY);
    notifyActiveInstanceChange(null);
    window.location.hash = '#/login';
    throw new Error('Session expired. Please log in again.');
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

export async function initSetup(username: string, password: string, inviteToken: string): Promise<{ totpSecret: string; username: string }> {
  return request('/api/setup/init', {
    method: 'POST',
    body: JSON.stringify({ username, password, inviteToken }),
  });
}

export async function confirmSetup(username: string, totpCode: string): Promise<void> {
  return request('/api/setup/confirm', {
    method: 'POST',
    body: JSON.stringify({ username, totpCode }),
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
  localStorage.setItem('ft_username', result.username);
  notifyUsernameChange(result.username);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
    localStorage.removeItem('ft_username');
    notifyUsernameChange(null);
    localStorage.removeItem(ACTIVE_INSTANCE_STORAGE_KEY);
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

export async function getInstances(): Promise<{ instances: Instance[]; activeInstanceId: string | null }> {
  return request('/api/instances');
}

export async function createInstance(name: string): Promise<Instance> {
  return request('/api/instances', { method: 'POST', body: JSON.stringify({ name }) });
}

export async function renameInstance(id: string, name: string): Promise<Instance> {
  return request(`/api/instances/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
}

export async function deleteInstance(id: string): Promise<void> {
  await request(`/api/instances/${id}`, { method: 'DELETE' });
}

export async function removeInstanceMember(id: string, username: string): Promise<Instance> {
  return request(`/api/instances/${id}/members/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

export async function setActiveInstance(instanceId: string): Promise<void> {
  await request('/api/instances/active', { method: 'PUT', body: JSON.stringify({ instanceId }) });
}

// ─── Transactions ────────────────────────────────────────────────────────────

/**
 * Fetch all transactions. Pass `year` to scope the request to a single
 * calendar year (Task 9's YearSelector can opt into this for large datasets).
 */
export async function getTransactions(year?: number): Promise<Transaction[]> {
  const qs = year ? `?year=${year}` : '';
  const r = await request<{ transactions: Transaction[] }>(`/api/transactions${qs}`);
  return r.transactions;
}

/** Payload for addTransactions — each row may carry `allowDuplicate` to
 *  explicitly bypass the server's dedup check (used when the user has
 *  approved a row that was flagged as a duplicate). */
export type AddTransactionInput = Omit<Transaction, 'id'> & { allowDuplicate?: boolean };

export async function addTransactions(
  transactions: AddTransactionInput[],
): Promise<{ added: number; skipped: number }> {
  return request('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ transactions }),
  });
}

export type TransactionUpdate = Partial<Pick<Transaction, 'date' | 'description' | 'category' | 'amount' | 'notes' | 'archived'>>;

export async function updateTransaction(id: string, updates: TransactionUpdate): Promise<Transaction> {
  return request(`/api/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function bulkUpdateCategory(
  pattern: string,
  newCategory: string,
  previousCategory?: string,
): Promise<{ updated: number }> {
  return request('/api/transactions/bulk-update-category', {
    method: 'POST',
    body: JSON.stringify({ pattern, newCategory, previousCategory }),
  });
}

// ─── Income ──────────────────────────────────────────────────────────────────

/**
 * Fetch all income entries. Pass `year` to scope the request to a single
 * calendar year (Task 9's YearSelector can opt into this for large datasets).
 */
export async function getIncome(year?: number): Promise<IncomeEntry[]> {
  const qs = year ? `?year=${year}` : '';
  const r = await request<{ income: IncomeEntry[] }>(`/api/income${qs}`);
  return r.income;
}

export type AddIncomeInput = Omit<IncomeEntry, 'id'> & { allowDuplicate?: boolean };

export async function addIncome(
  entry: AddIncomeInput,
): Promise<{ skipped: boolean; entry: IncomeEntry | null }> {
  return request('/api/income', {
    method: 'POST',
    body: JSON.stringify({ entry }),
  });
}

export type IncomeUpdate = Partial<Pick<IncomeEntry, 'date' | 'description' | 'grossAmount' | 'netAmount'>>;

export async function updateIncome(id: string, updates: IncomeUpdate): Promise<IncomeEntry> {
  return request(`/api/income/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

// ─── Bulk operations ─────────────────────────────────────────────────────────

/** Delete a mixed set of transactions and income entries in a single call. */
export async function bulkDelete(
  transactionIds: string[],
  incomeIds: string[],
): Promise<{ deletedTransactions: number; deletedIncome: number }> {
  return request('/api/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ transactionIds, incomeIds }),
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
  return request('/api/rename-category', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });
}

/** Delete a category. Transactions using it get reassigned to `reassignTo`
 *  (default "Other"). Mappings pointing at it are removed. The category is
 *  removed from the user's customCategories list. */
export async function deleteCategory(
  name: string,
  reassignTo = 'Other',
): Promise<{ reassigned: number; mappingsRemoved: number }> {
  return request('/api/delete-category', {
    method: 'POST',
    body: JSON.stringify({ name, reassignTo }),
  });
}

// ─── User Categories ─────────────────────────────────────────────────────────

export async function getUserCategories(): Promise<UserCategories> {
  return request('/api/user-categories');
}

export async function saveUserCategories(data: UserCategories): Promise<void> {
  await request('/api/user-categories', {
    method: 'PUT',
    body: JSON.stringify(data),
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
