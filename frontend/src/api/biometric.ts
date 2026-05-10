import { request } from './core';
import { storage } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';

export interface CredentialSummary {
  credentialId: string;
  label: string;
  deviceType: 'singleDevice' | 'multiDevice';
  createdAt: number;
  lastUsedAt: number | null;
}

export type RegisterBeginResult =
  | { options: PublicKeyCredentialCreationOptionsJSON }
  | { requiresReauth: true };

export async function registerBegin(totpCode?: string): Promise<RegisterBeginResult> {
  return request<RegisterBeginResult>('/api/auth/biometric-register-begin', {
    method: 'POST',
    body: JSON.stringify(totpCode ? { totpCode } : {}),
  });
}

export async function registerFinish(
  registrationResponse: unknown,
  label: string,
): Promise<{ credential: CredentialSummary }> {
  return request<{ credential: CredentialSummary }>('/api/auth/biometric-register-finish', {
    method: 'POST',
    body: JSON.stringify({ registrationResponse, label }),
  });
}

export async function listCredentials(): Promise<{ credentials: CredentialSummary[] }> {
  return request<{ credentials: CredentialSummary[] }>('/api/auth/biometric-credentials', { method: 'GET' });
}

export async function renameCredential(credentialId: string, label: string): Promise<{ credential: CredentialSummary }> {
  return request<{ credential: CredentialSummary }>(
    `/api/auth/biometric-credentials/${encodeURIComponent(credentialId)}`,
    { method: 'PATCH', body: JSON.stringify({ label }) },
  );
}

export async function deleteCredential(credentialId: string): Promise<void> {
  await request<void>(`/api/auth/biometric-credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
}

export async function authenticateBegin(preAuthToken: string): Promise<{ options: PublicKeyCredentialRequestOptionsJSON }> {
  return request<{ options: PublicKeyCredentialRequestOptionsJSON }>(
    '/api/auth/biometric-authenticate-begin',
    { method: 'POST', body: JSON.stringify({ preAuthToken }) },
  );
}

export interface VerifyBiometricResult {
  token: string;
  trustedDeviceJwt: string;
  username: string;
  displayName?: string;
}

export async function verifyBiometric(
  preAuthToken: string,
  authenticationResponse: unknown,
  oldTrustedDeviceTokenId: string | null,
): Promise<VerifyBiometricResult> {
  const result = await request<VerifyBiometricResult>('/api/auth/verify-biometric', {
    method: 'POST',
    body: JSON.stringify({ preAuthToken, authenticationResponse, oldTrustedDeviceTokenId }),
  });
  // Self-heal: any successful WebAuthn login proves a credential exists for
  // this user on this device/browser, so record the local-enrolled flag. This
  // covers credentials enrolled before the local-flag mechanism was deployed
  // and roaming/synced passkeys (1Password, iCloud Keychain) showing up on a
  // new device for the first time.
  markBiometricEnrolledLocally(result.username);
  return result;
}

export interface TrustedSecondFactorResult {
  preAuthToken: string;
  username: string;
  hasBiometricCreds: boolean;
  oldTokenId: string;
  displayName?: string;
}

export async function trustedSecondFactor(trustedDeviceToken: string): Promise<TrustedSecondFactorResult> {
  return request<TrustedSecondFactorResult>('/api/auth/trusted-second-factor', {
    method: 'POST',
    body: JSON.stringify({ trustedDeviceToken }),
  });
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try { return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

function readLocalEnrolledUsers(): string[] {
  const raw = storage.get(STORAGE_KEYS.BIOMETRIC_LOCAL_USERS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

export function markBiometricEnrolledLocally(username: string): void {
  if (!username) return;
  const users = readLocalEnrolledUsers();
  if (!users.includes(username)) {
    users.push(username);
    storage.set(STORAGE_KEYS.BIOMETRIC_LOCAL_USERS, JSON.stringify(users));
  }
}

export function isBiometricEnrolledLocally(username: string): boolean {
  if (!username) return false;
  return readLocalEnrolledUsers().includes(username);
}
