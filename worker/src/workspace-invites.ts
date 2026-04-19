import type { KVNamespace } from '@cloudflare/workers-types';

export interface WorkspaceInviteRecord {
  instanceId: string;
  createdBy: string;    // owner username who issued it
  expiresAt: number;
  createdAt: number;
  usedBy: string | null;
}

const WORKSPACE_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

async function getWorkspaceInviteSigningKey(jwtSecret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(jwtSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('workspace-invite-v1'));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let cachedWorkspaceInviteKey: Promise<string> | null = null;
async function getKey(jwtSecret: string): Promise<string> {
  return (cachedWorkspaceInviteKey ??= getWorkspaceInviteSigningKey(jwtSecret));
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

export async function createWorkspaceInvite(
  kv: KVNamespace,
  instanceId: string,
  createdBy: string,
  jwtSecret: string,
): Promise<{ id: string; token: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + WORKSPACE_INVITE_TTL_SECONDS;
  const record: WorkspaceInviteRecord = { instanceId, createdBy, expiresAt, createdAt: now, usedBy: null };
  await kv.put(`workspace-invites:${id}`, JSON.stringify(record), { expirationTtl: WORKSPACE_INVITE_TTL_SECONDS });
  const inviteKey = await getKey(jwtSecret);
  const sig = await hmacSign(id, inviteKey);
  const token = b64urlEncodeStr(`${id}:${sig}`);
  return { id, token, expiresAt };
}

export async function verifyWorkspaceInvite(
  kv: KVNamespace,
  token: string,
  jwtSecret: string,
): Promise<{ ok: true; id: string; record: WorkspaceInviteRecord } | { ok: false; reason: string }> {
  let decoded: string;
  try { decoded = b64urlDecodeStr(token); } catch { return { ok: false, reason: 'malformed token' }; }
  const colon = decoded.indexOf(':');
  if (colon < 1) return { ok: false, reason: 'malformed token' };
  const id = decoded.slice(0, colon);
  const sig = decoded.slice(colon + 1);
  const inviteKey = await getKey(jwtSecret);
  const expected = await hmacSign(id, inviteKey);
  if (sig !== expected) return { ok: false, reason: 'invalid signature' };
  const raw = await kv.get(`workspace-invites:${id}`);
  if (!raw) return { ok: false, reason: 'invite not found or expired' };
  const record = JSON.parse(raw) as WorkspaceInviteRecord;
  if (record.usedBy) return { ok: false, reason: 'invite already used' };
  if (record.expiresAt < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'invite expired' };
  return { ok: true, id, record };
}

export async function markWorkspaceInviteUsed(kv: KVNamespace, id: string, username: string): Promise<boolean> {
  const raw = await kv.get(`workspace-invites:${id}`);
  if (!raw) return false;
  const record = JSON.parse(raw) as WorkspaceInviteRecord;
  record.usedBy = username;
  const ttl = Math.max(60, record.expiresAt - Math.floor(Date.now() / 1000));
  await kv.put(`workspace-invites:${id}`, JSON.stringify(record), { expirationTtl: ttl });
  return true;
}

export async function listWorkspaceInvites(
  kv: KVNamespace,
  instanceId: string,
  jwtSecret: string,
): Promise<Array<{ id: string; expiresAt: number; createdAt: number; usedBy: string | null; token: string }>> {
  const list = await kv.list({ prefix: 'workspace-invites:' });
  const inviteKey = await getKey(jwtSecret);
  const reads = await Promise.all(list.keys.map(async (k) => {
    const raw = await kv.get(k.name);
    if (!raw) return null;
    const r = JSON.parse(raw) as WorkspaceInviteRecord;
    if (r.instanceId !== instanceId) return null;
    const id = k.name.slice('workspace-invites:'.length);
    const sig = await hmacSign(id, inviteKey);
    const token = b64urlEncodeStr(`${id}:${sig}`);
    return { id, expiresAt: r.expiresAt, createdAt: r.createdAt, usedBy: r.usedBy, token };
  }));
  return reads.filter((x): x is { id: string; expiresAt: number; createdAt: number; usedBy: string | null; token: string } => x !== null);
}

export async function deleteWorkspaceInvite(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(`workspace-invites:${id}`);
}
