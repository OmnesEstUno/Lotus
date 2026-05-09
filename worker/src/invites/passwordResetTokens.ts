import type { KVNamespace } from '@cloudflare/workers-types';
import { InviteCommon } from './primitives';
import { makeInviteModule, InviteListItem } from './moduleFactory';
import { PASSWORD_RESET_TOKEN_TTL_SECONDS } from '../constants';

export interface PasswordResetRecord extends InviteCommon {
  username: string;
}

export interface PasswordResetListItem extends InviteListItem {
  username: string;
}

const resetModule = makeInviteModule<PasswordResetRecord, { username: string }>({
  kvPrefix: 'pwreset:token:',
  purpose: 'password-reset-token-v1',
  ttlSeconds: PASSWORD_RESET_TOKEN_TTL_SECONDS,
  buildExtraFields: (opts) => ({ username: opts.username }),
});

export async function createPasswordResetToken(
  kv: KVNamespace,
  jwtSecret: string,
  username: string,
): Promise<{ id: string; token: string; expiresAt: number }> {
  return resetModule.create(kv, jwtSecret, { username });
}

export const verifyPasswordResetToken = resetModule.verify.bind(resetModule);
export const markPasswordResetTokenUsed = resetModule.markUsed.bind(resetModule);
export const deletePasswordResetToken = resetModule.delete.bind(resetModule);

export async function listPasswordResetTokens(
  kv: KVNamespace,
  jwtSecret: string,
): Promise<PasswordResetListItem[]> {
  const items = await resetModule.list(kv, jwtSecret, undefined);
  // The factory doesn't expose record fields beyond InviteListItem; re-read each
  // entry to attach the username so the admin UI can label entries.
  const enriched: PasswordResetListItem[] = [];
  for (const item of items) {
    const raw = await kv.get(`pwreset:token:${item.id}`);
    if (!raw) continue;
    const record = JSON.parse(raw) as PasswordResetRecord;
    enriched.push({ ...item, username: record.username });
  }
  return enriched;
}
