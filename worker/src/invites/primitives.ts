import type { KVNamespace } from '@cloudflare/workers-types';

export async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

export function b64urlEncode(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}

export function b64urlDecodeStr(s: string): string {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
}

export async function deriveDomainKey(jwtSecret: string, purpose: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(jwtSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(purpose));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Per-process cache keyed by purpose so each derivation runs at most once.
const keyCache = new Map<string, Promise<string>>();
export function getDomainKeyCached(jwtSecret: string, purpose: string): Promise<string> {
  let p = keyCache.get(purpose);
  if (!p) {
    p = deriveDomainKey(jwtSecret, purpose);
    keyCache.set(purpose, p);
  }
  return p;
}

export interface InviteCommon {
  expiresAt: number;
  createdAt: number;
  usedBy: string | null;
}

export async function encodeToken(id: string, jwtSecret: string, purpose: string): Promise<string> {
  const key = await getDomainKeyCached(jwtSecret, purpose);
  const sig = await hmacSign(id, key);
  return b64urlEncodeStr(`${id}:${sig}`);
}

export async function decodeAndVerifyToken(
  token: string,
  jwtSecret: string,
  purpose: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  let decoded: string;
  try { decoded = b64urlDecodeStr(token); } catch { return { ok: false, reason: 'malformed token' }; }
  const colon = decoded.indexOf(':');
  if (colon < 1) return { ok: false, reason: 'malformed token' };
  const id = decoded.slice(0, colon);
  const sig = decoded.slice(colon + 1);
  const key = await getDomainKeyCached(jwtSecret, purpose);
  const expected = await hmacSign(id, key);
  // Constant-time compare
  if (sig.length !== expected.length) return { ok: false, reason: 'invalid signature' };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: 'invalid signature' };
  return { ok: true, id };
}

export async function readInviteRecord<T extends InviteCommon>(
  kv: KVNamespace,
  kvKey: string,
): Promise<{ ok: true; record: T } | { ok: false; reason: string }> {
  const raw = await kv.get(kvKey);
  if (!raw) return { ok: false, reason: 'invite not found or expired' };
  const record = JSON.parse(raw) as T;
  if (record.usedBy) return { ok: false, reason: 'invite already used' };
  if (record.expiresAt < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'invite expired' };
  return { ok: true, record };
}

export async function markUsed<T extends InviteCommon>(
  kv: KVNamespace,
  kvKey: string,
  username: string,
): Promise<boolean> {
  const raw = await kv.get(kvKey);
  if (!raw) return false;
  const record = JSON.parse(raw) as T;
  record.usedBy = username;
  const ttl = Math.max(60, record.expiresAt - Math.floor(Date.now() / 1000));
  await kv.put(kvKey, JSON.stringify(record), { expirationTtl: ttl });
  return true;
}
