import type { KVNamespace } from '@cloudflare/workers-types';
import { InviteCommon } from './primitives';
import { makeInviteModule, InviteListItem } from './moduleFactory';
import { INVITE_TTL_SECONDS } from '../constants';

export interface InviteRecord extends InviteCommon {}

const inviteModule = makeInviteModule<InviteRecord>({
  kvPrefix: 'invites:',
  purpose: 'invite-token-v1',
  ttlSeconds: INVITE_TTL_SECONDS,
  buildExtraFields: () => ({} as Omit<InviteRecord, keyof InviteCommon>),
});

export async function createInvite(kv: KVNamespace, jwtSecret: string): Promise<{ id: string; token: string; expiresAt: number }> {
  return inviteModule.create(kv, jwtSecret, undefined);
}
export const verifyInvite = inviteModule.verify.bind(inviteModule);
export const markInviteUsed = inviteModule.markUsed.bind(inviteModule);
export async function listInvites(kv: KVNamespace, jwtSecret: string): Promise<InviteListItem[]> {
  return inviteModule.list(kv, jwtSecret, undefined);
}
export const deleteInvite = inviteModule.delete.bind(inviteModule);
