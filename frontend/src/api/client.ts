import { IncomeEntry, Transaction } from '../types';

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

export async function addTransactions(transactions: Omit<Transaction, 'id'>[]): Promise<{ added: number }> {
  return request('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ transactions }),
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  return request(`/api/transactions/${id}`, { method: 'DELETE' });
}

// ─── Income ──────────────────────────────────────────────────────────────────

export async function getIncome(): Promise<IncomeEntry[]> {
  return request('/api/income');
}

export async function addIncome(entry: Omit<IncomeEntry, 'id'>): Promise<IncomeEntry> {
  return request('/api/income', {
    method: 'POST',
    body: JSON.stringify({ entry }),
  });
}

export async function deleteIncome(id: string): Promise<void> {
  return request(`/api/income/${id}`, { method: 'DELETE' });
}
