import { STORAGE_KEYS } from '../utils/constants';
import { storage } from '../utils/storage';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

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

export function rememberVersion(resource: string, version: number): void {
  resourceVersions.set(resource, version);
}

export function lastKnownVersion(resource: string): number | undefined {
  return resourceVersions.get(resource);
}

// ─── Active-instance local state ─────────────────────────────────────────────

const activeInstanceListeners = new Set<(id: string | null) => void>();

export function notifyActiveInstanceChange(id: string | null): void {
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

export function notifyUsernameChange(u: string | null): void {
  usernameListeners.forEach((fn) => fn(u));
}

export function subscribeUsername(fn: (u: string | null) => void): () => void {
  usernameListeners.add(fn);
  return () => usernameListeners.delete(fn);
}

// ─── Token helpers ────────────────────────────────────────────────────────────

export function getToken(): string | null {
  return storage.get(STORAGE_KEYS.TOKEN);
}

export function setToken(token: string): void {
  storage.set(STORAGE_KEYS.TOKEN, token);
}

export function clearToken(): void {
  storage.remove(STORAGE_KEYS.TOKEN);
}

export function getCurrentUsername(): string | null {
  return storage.get(STORAGE_KEYS.USERNAME);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// ─── Core request helper ─────────────────────────────────────────────────────

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

// ─── Versioned-list helper ───────────────────────────────────────────────────

/**
 * Fetch a versioned list resource.  Stashes the returned `version` under
 * `versionKey` and returns the array stored at `payloadKey`.
 *
 * Pass `year` to append `?year=<n>` to the request path.
 */
export async function getVersionedList<T, K extends string>(
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
