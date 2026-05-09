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

export async function login(username: string, password: string): Promise<{ preAuthToken: string; hasBiometricCreds: boolean }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export interface Verify2FAResult {
  token: string;
  trustedDeviceJwt: string;
  username: string;
}

export async function verify2FA(
  preAuthToken: string,
  totpCode: string,
  oldTrustedDeviceTokenId: string | null = null,
): Promise<Verify2FAResult> {
  const result = await request<Verify2FAResult>('/api/auth/verify-2fa', {
    method: 'POST',
    body: JSON.stringify({ preAuthToken, totpCode, oldTrustedDeviceTokenId }),
  });
  setToken(result.token);
  storage.set(STORAGE_KEYS.TRUSTED_DEVICE, result.trustedDeviceJwt);
  storage.set(STORAGE_KEYS.USERNAME, result.username);
  notifyUsernameChange(result.username);
  return result;
}

export function getTrustedDeviceToken(): string | null {
  return storage.get(STORAGE_KEYS.TRUSTED_DEVICE);
}

export function clearTrustedDeviceToken(): void {
  storage.remove(STORAGE_KEYS.TRUSTED_DEVICE);
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    clearToken();
    // Intentionally NOT removing STORAGE_KEYS.TRUSTED_DEVICE — logout ends the
    // session but keeps the device "trusted" so the next login can skip the
    // password step and land at the second-factor screen with username
    // pre-filled. The trusted-device token is only cleared via the explicit
    // "Sign in as a different account" escape hatch on the login page, or by
    // server-side rotation on the next successful second-factor verification.
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

// ─── Forgot password (self-service) ──────────────────────────────────────────

export interface ForgotBeginResult {
  pwresetToken: string;
  needsWebauthn: boolean;
}

export async function forgotBegin(username: string, totpCode: string): Promise<ForgotBeginResult> {
  return request('/api/auth/forgot-begin', {
    method: 'POST',
    body: JSON.stringify({ username, totpCode }),
  });
}

export async function forgotWebauthnBegin(pwresetToken: string): Promise<{ options: unknown }> {
  return request('/api/auth/forgot-webauthn-begin', {
    method: 'POST',
    body: JSON.stringify({ pwresetToken }),
  });
}

export async function forgotWebauthnFinish(pwresetToken: string, authenticationResponse: unknown): Promise<{ pwresetToken: string }> {
  return request('/api/auth/forgot-webauthn-finish', {
    method: 'POST',
    body: JSON.stringify({ pwresetToken, authenticationResponse }),
  });
}

export async function forgotConfirm(pwresetToken: string, newPassword: string): Promise<{ ok: true }> {
  return request('/api/auth/forgot-confirm', {
    method: 'POST',
    body: JSON.stringify({ pwresetToken, newPassword }),
  });
}

// ─── Admin-issued reset (redeem) ─────────────────────────────────────────────

export async function adminResetMeta(token: string): Promise<{ username: string; expiresAt: number }> {
  return request(`/api/auth/admin-reset-meta?token=${encodeURIComponent(token)}`);
}

export async function adminResetRedeem(token: string, newPassword: string): Promise<{ ok: true }> {
  return request('/api/auth/admin-reset-redeem', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

// ─── Admin: password-reset-token CRUD ────────────────────────────────────────

export interface AdminResetTokenSummary {
  id: string;
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
}

export async function createAdminResetToken(username: string): Promise<{ id: string; token: string; username: string; expiresAt: number }> {
  return request('/api/admin/password-reset-tokens', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}

export async function listAdminResetTokens(): Promise<{ tokens: AdminResetTokenSummary[] }> {
  return request('/api/admin/password-reset-tokens');
}

export async function deleteAdminResetToken(id: string): Promise<void> {
  return request(`/api/admin/password-reset-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
