import { API_URL, request } from './core';

// ─── Admin invite-tokens ──────────────────────────────────────────────────────

export interface InviteSummary {
  id: string;
  expiresAt: number;
  createdAt: number;
  usedBy: string | null;
  token: string;
}

export async function adminInit(adminSecret: string, password: string): Promise<{ totpSecret: string; otpauthUrl: string }> {
  const res = await fetch(`${API_URL}/api/admin/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({ error: 'Unexpected server response.' }));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed with status ${res.status}`);
  }
  return data as { totpSecret: string; otpauthUrl: string };
}

export async function createInvite(): Promise<{ id: string; token: string; expiresAt: number }> {
  return request('/api/admin/invites', { method: 'POST' });
}
export async function listInvites(): Promise<{ invites: InviteSummary[] }> {
  return request('/api/admin/invites');
}
export async function deleteInvite(id: string): Promise<{ ok: true }> {
  return request(`/api/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ─── Workspace Invites ────────────────────────────────────────────────────────

export interface WorkspaceInviteSummary {
  id: string;
  expiresAt: number;
  createdAt: number;
  usedBy: string | null;
  token: string;
}

export async function createWorkspaceInvite(instanceId: string): Promise<{ id: string; token: string; expiresAt: number }> {
  return request(`/api/instances/${instanceId}/invites`, { method: 'POST' });
}
export async function listWorkspaceInvites(instanceId: string): Promise<{ invites: WorkspaceInviteSummary[] }> {
  return request(`/api/instances/${instanceId}/invites`);
}
export async function deleteWorkspaceInvite(instanceId: string, inviteId: string): Promise<{ ok: true }> {
  return request(`/api/instances/${instanceId}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
}
export async function acceptWorkspaceInvite(token: string): Promise<{ id: string; name: string; owner: string; members: string[]; createdAt: string }> {
  return request('/api/instances/invites/accept', { method: 'POST', body: JSON.stringify({ token }) });
}
export async function getWorkspaceInviteMeta(token: string): Promise<{ instanceName: string; ownerUsername: string; expiresAt: number; usedBy: string | null; alreadyMember: boolean }> {
  return request(`/api/instances/invites/meta?token=${encodeURIComponent(token)}`);
}
