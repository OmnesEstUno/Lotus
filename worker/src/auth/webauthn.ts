import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type GenerateRegistrationOptionsOpts,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { KV_PREFIXES, WEBAUTHN_CHALLENGE_TTL_SECONDS } from '../constants';

// ─── base64url helpers (no Buffer / Node dependency) ───────────────────────

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ───────────────────────────────────────────────────────────────────────────

export interface StoredCredential {
  credentialId: string;          // base64url
  publicKey: string;             // base64url
  signCount: number;
  transports: string[];
  deviceType: 'singleDevice' | 'multiDevice';
  label: string;
  createdAt: number;             // ms epoch
  lastUsedAt: number | null;
}

export interface CredentialSummary {
  credentialId: string;
  label: string;
  deviceType: 'singleDevice' | 'multiDevice';
  createdAt: number;
  lastUsedAt: number | null;
}

function summarize(c: StoredCredential): CredentialSummary {
  return {
    credentialId: c.credentialId,
    label: c.label,
    deviceType: c.deviceType,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
  };
}

/** List all credentials enrolled by a user, without their public keys. */
export async function listCredentials(kv: KVNamespace, username: string): Promise<CredentialSummary[]> {
  const list = await kv.list({ prefix: KV_PREFIXES.WEBAUTHN_CREDENTIALS_PREFIX(username) });
  const out: CredentialSummary[] = [];
  for (const k of list.keys) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    try {
      out.push(summarize(JSON.parse(raw) as StoredCredential));
    } catch { /* corrupt entry; skip */ }
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export async function getCredential(
  kv: KVNamespace,
  username: string,
  credentialId: string,
): Promise<StoredCredential | null> {
  const raw = await kv.get(KV_PREFIXES.WEBAUTHN_CREDENTIAL(username, credentialId));
  if (!raw) return null;
  try { return JSON.parse(raw) as StoredCredential; } catch { return null; }
}

export async function putCredential(kv: KVNamespace, username: string, c: StoredCredential): Promise<void> {
  await kv.put(KV_PREFIXES.WEBAUTHN_CREDENTIAL(username, c.credentialId), JSON.stringify(c));
}

export async function deleteCredential(
  kv: KVNamespace,
  username: string,
  credentialId: string,
): Promise<boolean> {
  const key = KV_PREFIXES.WEBAUTHN_CREDENTIAL(username, credentialId);
  const existing = await kv.get(key);
  if (!existing) return false;
  await kv.delete(key);
  return true;
}

export async function userHasCredentials(kv: KVNamespace, username: string): Promise<boolean> {
  const list = await kv.list({ prefix: KV_PREFIXES.WEBAUTHN_CREDENTIALS_PREFIX(username), limit: 1 });
  return list.keys.length > 0;
}

// ─── Registration ───────────────────────────────────────────────────────────

export async function beginRegistration(
  kv: KVNamespace,
  username: string,
  rpID: string,
  rpName: string,
): Promise<{ options: Awaited<ReturnType<typeof generateRegistrationOptions>> }> {
  const existing = await listCredentials(kv, username);
  const opts: GenerateRegistrationOptionsOpts = {
    rpName,
    rpID,
    userName: username,
    userID: new TextEncoder().encode(username),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60_000,
  };
  const options = await generateRegistrationOptions(opts);
  await kv.put(
    KV_PREFIXES.WEBAUTHN_CHALLENGE(username),
    options.challenge,
    { expirationTtl: WEBAUTHN_CHALLENGE_TTL_SECONDS },
  );
  return { options };
}

export async function finishRegistration(
  kv: KVNamespace,
  username: string,
  rpID: string,
  origin: string,
  response: RegistrationResponseJSON,
  label: string,
): Promise<{ credential: CredentialSummary } | { error: string }> {
  const expectedChallenge = await kv.get(KV_PREFIXES.WEBAUTHN_CHALLENGE(username));
  if (!expectedChallenge) return { error: 'Challenge expired. Please try again.' };

  let verified: VerifiedRegistrationResponse;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    return { error: (e as Error).message || 'Registration verification failed.' };
  }

  if (!verified.verified || !verified.registrationInfo) {
    return { error: 'Registration could not be verified.' };
  }

  const info = verified.registrationInfo;
  const stored: StoredCredential = {
    credentialId: info.credential.id,
    publicKey: uint8ToBase64Url(info.credential.publicKey),
    signCount: info.credential.counter,
    transports: response.response.transports ?? [],
    deviceType: info.credentialDeviceType,
    label: label.trim().slice(0, 64) || 'Unnamed device',
    createdAt: Date.now(),
    lastUsedAt: null,
  };
  await putCredential(kv, username, stored);
  await kv.delete(KV_PREFIXES.WEBAUTHN_CHALLENGE(username));
  return { credential: summarize(stored) };
}

// ─── Authentication ─────────────────────────────────────────────────────────

export async function beginAuthentication(
  kv: KVNamespace,
  username: string,
  rpID: string,
): Promise<{ options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }> {
  const credentials = await listCredentials(kv, username);
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((c) => ({ id: c.credentialId })),
    userVerification: 'preferred',
    timeout: 60_000,
  });
  await kv.put(
    KV_PREFIXES.WEBAUTHN_CHALLENGE(username),
    options.challenge,
    { expirationTtl: WEBAUTHN_CHALLENGE_TTL_SECONDS },
  );
  return { options };
}

export async function finishAuthentication(
  kv: KVNamespace,
  username: string,
  rpID: string,
  origin: string,
  response: AuthenticationResponseJSON,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expectedChallenge = await kv.get(KV_PREFIXES.WEBAUTHN_CHALLENGE(username));
  if (!expectedChallenge) return { ok: false, error: 'Challenge expired.' };

  const credential = await getCredential(kv, username, response.id);
  if (!credential) return { ok: false, error: 'Credential not recognized.' };

  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: base64UrlToUint8(credential.publicKey),
        counter: credential.signCount,
        transports: credential.transports as never,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Verification failed.' };
  }

  if (!verified.verified) return { ok: false, error: 'Verification failed.' };

  // Update sign count + last-used
  credential.signCount = verified.authenticationInfo.newCounter;
  credential.lastUsedAt = Date.now();
  await putCredential(kv, username, credential);
  await kv.delete(KV_PREFIXES.WEBAUTHN_CHALLENGE(username));
  return { ok: true };
}
