import type { KVNamespace } from '@cloudflare/workers-types';

export interface InviteRecord {
  expiresAt: number;   // unix seconds
  createdAt: number;   // unix seconds
  usedBy: string | null;
}

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

function b64urlEncode(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}
function b64urlDecodeStr(s: string): string {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return raw;
}

export async function createInvite(kv: KVNamespace, jwtSecret: string): Promise<{ id: string; token: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + INVITE_TTL_SECONDS;
  const record: InviteRecord = { expiresAt, createdAt: now, usedBy: null };
  await kv.put(`invites:${id}`, JSON.stringify(record), { expirationTtl: INVITE_TTL_SECONDS });
  const sig = await hmacSign(id, jwtSecret);
  const token = b64urlEncodeStr(`${id}:${sig}`);
  return { id, token, expiresAt };
}

export async function verifyInvite(kv: KVNamespace, token: string, jwtSecret: string): Promise<{ ok: true; id: string; record: InviteRecord } | { ok: false; reason: string }> {
  let decoded: string;
  try { decoded = b64urlDecodeStr(token); } catch { return { ok: false, reason: 'malformed token' }; }
  const colon = decoded.indexOf(':');
  if (colon < 1) return { ok: false, reason: 'malformed token' };
  const id = decoded.slice(0, colon);
  const sig = decoded.slice(colon + 1);
  const expected = await hmacSign(id, jwtSecret);
  if (sig !== expected) return { ok: false, reason: 'invalid signature' };
  const raw = await kv.get(`invites:${id}`);
  if (!raw) return { ok: false, reason: 'invite not found or expired' };
  const record = JSON.parse(raw) as InviteRecord;
  if (record.usedBy) return { ok: false, reason: 'invite already used' };
  if (record.expiresAt < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'invite expired' };
  return { ok: true, id, record };
}

export async function markInviteUsed(kv: KVNamespace, id: string, username: string): Promise<void> {
  const raw = await kv.get(`invites:${id}`);
  if (!raw) return; // expired or revoked between verify and confirm — let the confirm proceed; invite is one-shot anyway
  const record = JSON.parse(raw) as InviteRecord;
  record.usedBy = username;
  const ttl = Math.max(60, record.expiresAt - Math.floor(Date.now() / 1000));
  await kv.put(`invites:${id}`, JSON.stringify(record), { expirationTtl: ttl });
}

export async function listInvites(kv: KVNamespace): Promise<Array<{ id: string; expiresAt: number; createdAt: number; usedBy: string | null; token?: never }>> {
  const list = await kv.list({ prefix: 'invites:' });
  const out: Array<{ id: string; expiresAt: number; createdAt: number; usedBy: string | null }> = [];
  for (const k of list.keys) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    const r = JSON.parse(raw) as InviteRecord;
    out.push({ id: k.name.slice('invites:'.length), ...r });
  }
  return out;
}

export async function deleteInvite(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(`invites:${id}`);
}
