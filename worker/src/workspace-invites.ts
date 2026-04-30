import type { KVNamespace } from '@cloudflare/workers-types';
import { InviteCommon } from './invites/primitives';
import { makeInviteModule, InviteListItem } from './invites/moduleFactory';
import { WORKSPACE_INVITE_TTL_SECONDS } from './constants';

export interface WorkspaceInviteRecord extends InviteCommon {
  instanceId: string;
  createdBy: string;
}

type CreateOpts = { instanceId: string; createdBy: string };
type ListOpts = { instanceId: string };

const workspaceInviteModule = makeInviteModule<WorkspaceInviteRecord, CreateOpts, ListOpts>({
  kvPrefix: 'workspace-invites:',
  purpose: 'workspace-invite-v1',
  ttlSeconds: WORKSPACE_INVITE_TTL_SECONDS,
  buildExtraFields: ({ instanceId, createdBy }) => ({ instanceId, createdBy }),
  filterListed: (record, opts) => record.instanceId === opts.instanceId,
});

export async function createWorkspaceInvite(
  kv: KVNamespace, instanceId: string, createdBy: string, jwtSecret: string,
): Promise<{ id: string; token: string; expiresAt: number }> {
  return workspaceInviteModule.create(kv, jwtSecret, { instanceId, createdBy });
}
export const verifyWorkspaceInvite = workspaceInviteModule.verify.bind(workspaceInviteModule);
export const markWorkspaceInviteUsed = workspaceInviteModule.markUsed.bind(workspaceInviteModule);
export async function listWorkspaceInvites(
  kv: KVNamespace, instanceId: string, jwtSecret: string,
): Promise<InviteListItem[]> {
  return workspaceInviteModule.list(kv, jwtSecret, { instanceId });
}
export const deleteWorkspaceInvite = workspaceInviteModule.delete.bind(workspaceInviteModule);
