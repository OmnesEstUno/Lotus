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

export async function initSetup(
  username: string,
  password: string,
  turnstileToken: string,
  displayName?: string,
  honeypot?: string,
): Promise<{ ok: true; username: string }> {
  return request('/api/setup/init', {
    method: 'POST',
    body: JSON.stringify({ username, password, turnstileToken, displayName, website: honeypot }),
  });
}

export function getCurrentDisplayName(): string | null {
  return storage.get(STORAGE_KEYS.DISPLAY_NAME);
}

export async function login(
  username: string,
  password: string,
): Promise<{ preAuthToken: string; hasBiometricCreds: boolean; hasTotp: boolean; displayName?: string }> {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export interface Verify2FAResult {
  token: string;
  trustedDeviceJwt: string;
  username: string;
  displayName?: string;
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
  if (result.displayName) storage.set(STORAGE_KEYS.DISPLAY_NAME, result.displayName);
  else storage.remove(STORAGE_KEYS.DISPLAY_NAME);
  notifyUsernameChange(result.username);
  return result;
}

export async function completeLogin(
  preAuthToken: string,
  oldTrustedDeviceTokenId: string | null = null,
): Promise<Verify2FAResult> {
  const result = await request<Verify2FAResult>('/api/auth/complete-login', {
    method: 'POST',
    body: JSON.stringify({ preAuthToken, oldTrustedDeviceTokenId }),
  });
  setToken(result.token);
  storage.set(STORAGE_KEYS.TRUSTED_DEVICE, result.trustedDeviceJwt);
  storage.set(STORAGE_KEYS.USERNAME, result.username);
  if (result.displayName) storage.set(STORAGE_KEYS.DISPLAY_NAME, result.displayName);
  else storage.remove(STORAGE_KEYS.DISPLAY_NAME);
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

// ─── Account: change password / display name ────────────────────────────────

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  totpCode: string,
): Promise<{ ok: true }> {
  return request('/api/account/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword, totpCode }),
  });
}

export async function deleteAccount(currentPassword: string, totpCode: string): Promise<{ ok: true }> {
  const result = await request<{ ok: true }>('/api/account/delete', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, totpCode }),
  });
  // Server has revoked everything; wipe local state too.
  clearToken();
  storage.remove(STORAGE_KEYS.USERNAME);
  storage.remove(STORAGE_KEYS.DISPLAY_NAME);
  storage.remove(STORAGE_KEYS.TRUSTED_DEVICE);
  storage.remove(STORAGE_KEYS.ACTIVE_INSTANCE);
  storage.remove(STORAGE_KEYS.BIOMETRIC_LOCAL_USERS);
  notifyUsernameChange(null);
  notifyActiveInstanceChange(null);
  return result;
}

export async function updateDisplayName(displayName: string): Promise<{ ok: true; displayName: string | null }> {
  const result = await request<{ ok: true; displayName: string | null }>('/api/account/display-name', {
    method: 'PUT',
    body: JSON.stringify({ displayName }),
  });
  if (result.displayName) storage.set(STORAGE_KEYS.DISPLAY_NAME, result.displayName);
  else storage.remove(STORAGE_KEYS.DISPLAY_NAME);
  // Tell same-tab subscribers (e.g. layout greeting) so the new name renders
  // without a reload. Subscribing keys off username; refire the current value.
  const u = getCurrentUsername();
  if (u) notifyUsernameChange(u);
  return result;
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

// ─── Account: TOTP self-enrollment ────────────────────────────────────────────

export async function getAccountTotpStatus(): Promise<{ enrolled: boolean }> {
  return request('/api/account/totp/status');
}

export async function accountTotpInit(): Promise<{ totpSecret: string; otpauthUrl: string; setupToken: string }> {
  return request('/api/account/totp/init', { method: 'POST', body: JSON.stringify({}) });
}

export async function accountTotpConfirm(setupToken: string, totpCode: string): Promise<{ ok: true }> {
  return request('/api/account/totp/confirm', {
    method: 'POST',
    body: JSON.stringify({ setupToken, totpCode }),
  });
}

export async function accountTotpDelete(totpCode: string): Promise<{ ok: true }> {
  return request('/api/account/totp', {
    method: 'DELETE',
    body: JSON.stringify({ totpCode }),
  });
}
