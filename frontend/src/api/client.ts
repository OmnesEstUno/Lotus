import { IncomeEntry, Transaction, UserCategories } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

function getToken(): string | null {
  return localStorage.getItem('ft_token');
}

function setToken(token: string): void {
  localStorage.setItem('ft_token', token);
}

function clearToken(): void {
  localStorage.removeItem('ft_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
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

export async function getSetupStatus(): Promise<{ initialized: boolean }> {
  return request('/api/setup/status');
}

export async function initSetup(password: string): Promise<{ totpSecret: string }> {
  return request('/api/setup/init', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function confirmSetup(totpCode: string): Promise<void> {
  return request('/api/setup/confirm', {
    method: 'POST',
    body: JSON.stringify({ totpCode }),
  });
}

export async function login(password: string): Promise<{ preAuthToken: string }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function verify2FA(preAuthToken: string, totpCode: string): Promise<{ token: string }> {
  const result: { token: string } = await request('/api/auth/verify-2fa', {
    method: 'POST',
    body: JSON.stringify({ preAuthToken, totpCode }),
  });
  setToken(result.token);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// ─── Transactions ────────────────────────────────────────────────────────────

export async function getTransactions(): Promise<Transaction[]> {
  return request('/api/transactions');
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

export type TransactionUpdate = Partial<Pick<Transaction, 'date' | 'description' | 'category' | 'amount'>>;

export async function updateTransaction(id: string, updates: TransactionUpdate): Promise<Transaction> {
  return request(`/api/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

// ─── Income ──────────────────────────────────────────────────────────────────

export async function getIncome(): Promise<IncomeEntry[]> {
  return request('/api/income');
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
