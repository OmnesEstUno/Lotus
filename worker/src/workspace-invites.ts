import type { KVNamespace } from '@cloudflare/workers-types';
import {
  InviteCommon, encodeToken, decodeAndVerifyToken, readInviteRecord, markUsed, hmacSign, getDomainKeyCached, b64urlEncodeStr,
} from './invite-primitives';

export interface WorkspaceInviteRecord extends InviteCommon {
  instanceId: string;
  createdBy: string;
}

const PURPOSE = 'workspace-invite-v1';
const TTL_SECONDS = 7 * 24 * 60 * 60;
const kvKey = (id: string) => `workspace-invites:${id}`;

export async function createWorkspaceInvite(
  kv: KVNamespace,
  instanceId: string,
  createdBy: string,
  jwtSecret: string,
): Promise<{ id: string; token: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;
  const record: WorkspaceInviteRecord = { instanceId, createdBy, expiresAt, createdAt: now, usedBy: null };
  await kv.put(kvKey(id), JSON.stringify(record), { expirationTtl: TTL_SECONDS });
  const token = await encodeToken(id, jwtSecret, PURPOSE);
  return { id, token, expiresAt };
}

export async function verifyWorkspaceInvite(
  kv: KVNamespace,
  token: string,
  jwtSecret: string,
): Promise<{ ok: true; id: string; record: WorkspaceInviteRecord } | { ok: false; reason: string }> {
  const dec = await decodeAndVerifyToken(token, jwtSecret, PURPOSE);
  if (!dec.ok) return dec;
  const read = await readInviteRecord<WorkspaceInviteRecord>(kv, kvKey(dec.id));
  if (!read.ok) return read;
  return { ok: true, id: dec.id, record: read.record };
}

export async function markWorkspaceInviteUsed(kv: KVNamespace, id: string, username: string): Promise<boolean> {
  return markUsed<WorkspaceInviteRecord>(kv, kvKey(id), username);
}

export async function listWorkspaceInvites(
  kv: KVNamespace,
  instanceId: string,
  jwtSecret: string,
): Promise<Array<{ id: string; expiresAt: number; createdAt: number; usedBy: string | null; token: string }>> {
  const list = await kv.list({ prefix: 'workspace-invites:' });
  const key = await getDomainKeyCached(jwtSecret, PURPOSE);
  const reads = await Promise.all(list.keys.map(async (k) => {
    const raw = await kv.get(k.name);
    if (!raw) return null;
    const r = JSON.parse(raw) as WorkspaceInviteRecord;
    if (r.instanceId !== instanceId) return null;
    const id = k.name.slice('workspace-invites:'.length);
    const sig = await hmacSign(id, key);
    const token = b64urlEncodeStr(`${id}:${sig}`);
    return { id, expiresAt: r.expiresAt, createdAt: r.createdAt, usedBy: r.usedBy, token };
  }));
  return reads.filter((x): x is { id: string; expiresAt: number; createdAt: number; usedBy: string | null; token: string } => x !== null);
}

export async function deleteWorkspaceInvite(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(kvKey(id));
}
