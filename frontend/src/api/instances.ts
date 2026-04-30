import { Instance } from '../types';
import { request, rememberVersion, lastKnownVersion, subscribeActiveInstance, getActiveInstanceId, setActiveInstanceIdLocal } from './core';

export { subscribeActiveInstance, getActiveInstanceId, setActiveInstanceIdLocal };

// ─── Instances ───────────────────────────────────────────────────────────────

/**
 * Fetch all instances the user belongs to.  Stashes each instance's version
 * so subsequent writes can supply the correct expectedVersion.
 */
export async function getInstances(): Promise<{ instances: Instance[]; activeInstanceId: string | null }> {
  const result = await request<{ instances: Instance[]; activeInstanceId: string | null }>('/api/instances');
  for (const inst of result.instances) {
    rememberVersion(`instance:${inst.id}`, inst.version ?? 0);
  }
  return result;
}

export async function createInstance(name: string): Promise<Instance> {
  const inst = await request<Instance>('/api/instances', { method: 'POST', body: JSON.stringify({ name }) });
  rememberVersion(`instance:${inst.id}`, inst.version ?? 1);
  return inst;
}

/**
 * Rename a workspace.  Requires a fresh version from a prior getInstances()
 * call.  Throws ConflictError on 409.
 */
export async function renameInstance(id: string, name: string): Promise<Instance> {
  const expectedVersion = lastKnownVersion(`instance:${id}`) ?? 0;
  const inst = await request<Instance>(`/api/instances/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name, expectedVersion }),
  });
  rememberVersion(`instance:${inst.id}`, inst.version ?? 0);
  return inst;
}

export async function deleteInstance(id: string): Promise<void> {
  await request(`/api/instances/${id}`, { method: 'DELETE' });
}

/**
 * Remove a member from a workspace (owner removing someone, or self-removal).
 * Requires a fresh version from a prior getInstances() call.  Throws
 * ConflictError on 409.
 */
export async function removeInstanceMember(id: string, username: string): Promise<Instance> {
  const expectedVersion = lastKnownVersion(`instance:${id}`) ?? 0;
  const inst = await request<Instance>(
    `/api/instances/${id}/members/${encodeURIComponent(username)}?expectedVersion=${expectedVersion}`,
    { method: 'DELETE' },
  );
  rememberVersion(`instance:${inst.id}`, inst.version ?? 0);
  return inst;
}

export async function setActiveInstance(instanceId: string): Promise<void> {
  await request('/api/instances/active', { method: 'PUT', body: JSON.stringify({ instanceId }) });
}
