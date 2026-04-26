import type { KVNamespace } from '@cloudflare/workers-types';
import {
  InviteCommon, encodeToken, decodeAndVerifyToken, readInviteRecord, markUsed, hmacSign, getDomainKeyCached, b64urlEncodeStr,
} from './invite-primitives';
import { INVITE_TTL_SECONDS } from './constants';

export interface InviteRecord extends InviteCommon {}

const PURPOSE = 'invite-token-v1';
const kvKey = (id: string) => `invites:${id}`;

export async function createInvite(kv: KVNamespace, jwtSecret: string): Promise<{ id: string; token: string; expiresAt: number }> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + INVITE_TTL_SECONDS;
  const record: InviteRecord = { expiresAt, createdAt: now, usedBy: null };
  await kv.put(kvKey(id), JSON.stringify(record), { expirationTtl: INVITE_TTL_SECONDS });
  const token = await encodeToken(id, jwtSecret, PURPOSE);
  return { id, token, expiresAt };
}

export async function verifyInvite(kv: KVNamespace, token: string, jwtSecret: string): Promise<{ ok: true; id: string; record: InviteRecord } | { ok: false; reason: string }> {
  const dec = await decodeAndVerifyToken(token, jwtSecret, PURPOSE);
  if (!dec.ok) return dec;
  const read = await readInviteRecord<InviteRecord>(kv, kvKey(dec.id));
  if (!read.ok) return read;
  return { ok: true, id: dec.id, record: read.record };
}

export async function markInviteUsed(kv: KVNamespace, id: string, username: string): Promise<boolean> {
  return markUsed<InviteRecord>(kv, kvKey(id), username);
}

export async function listInvites(kv: KVNamespace, jwtSecret: string): Promise<Array<{ id: string; expiresAt: number; createdAt: number; usedBy: string | null; token: string }>> {
  const list = await kv.list({ prefix: 'invites:' });
  const key = await getDomainKeyCached(jwtSecret, PURPOSE);
  const reads = await Promise.all(list.keys.map(async (k) => {
    const raw = await kv.get(k.name);
    if (!raw) return null;
    const r = JSON.parse(raw) as InviteRecord;
    const id = k.name.slice('invites:'.length);
    const sig = await hmacSign(id, key);
    const token = b64urlEncodeStr(`${id}:${sig}`);
    return { id, ...r, token };
  }));
  return reads.filter((x): x is { id: string; expiresAt: number; createdAt: number; usedBy: string | null; token: string } => x !== null);
}

export async function deleteInvite(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(kvKey(id));
}
