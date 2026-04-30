import { STORAGE_KEYS } from '../utils/constants';
import { storage } from '../utils/storage';
import {
  request,
  setToken,
  clearToken,
  notifyUsernameChange,
  notifyActiveInstanceChange,
  subscribeUsername,
  subscribeActiveInstance,
  getActiveInstanceId,
  setActiveInstanceIdLocal,
  getCurrentUsername,
  isAuthenticated,
} from './core';

export {
  subscribeUsername,
  subscribeActiveInstance,
  getActiveInstanceId,
  setActiveInstanceIdLocal,
  getCurrentUsername,
  isAuthenticated,
};

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
