import type { KVNamespace } from '@cloudflare/workers-types';

const profileKey = (username: string) => `users:${username}:profile`;
const userDataKey = (username: string, leaf: string) => `users:${username}:${leaf}`;

// Shared with index.ts — keeps the Instance shape consistent across migration and CRUD paths.
export interface MigrationInstance {
  id: string;
  name: string;
  owner: string;
  members: string[];
  createdAt: string;
}

export const instanceMetaKey = (id: string) => `instances:${id}`;

export async function createDefaultInstance(kv: KVNamespace, username: string): Promise<MigrationInstance> {
  const id = crypto.randomUUID();
  const instance: MigrationInstance = {
    id,
    name: 'My Finances',
    owner: username,
    members: [username],
    createdAt: new Date().toISOString(),
  };
  await kv.put(instanceMetaKey(id), JSON.stringify(instance));
  return instance;
}

export async function migrateSingleUserToMultiTenant(
  kv: KVNamespace,
  username: string,
): Promise<{ moved: number; instanceId: string }> {
  const legacyAuthKeys = ['auth:passwordHash', 'auth:totpSecret'] as const;
  const legacyDataKeys = ['data:transactions', 'data:income', 'data:userCategories'] as const;
  let moved = 0;

  const [hashVal, totpVal] = await Promise.all(legacyAuthKeys.map((k) => kv.get(k)));
  if (!hashVal || !totpVal) throw new Error('Legacy auth data missing; cannot migrate.');

  // Create the default instance via shared helper
  const instance = await createDefaultInstance(kv, username);
  const instanceId = instance.id;

  // Move legacy data keys into instance-scoped keys
  for (const leaf of legacyDataKeys) {
    const val = await kv.get(leaf);
    if (val) {
      await kv.put(`instances:${instanceId}:${leaf}`, val);
      moved++;
    }
  }

  // Write the user profile with instance membership
  const profile = {
    passwordHash: hashVal,
    totpSecret: totpVal,
    createdAt: new Date().toISOString(),
    confirmed: true,
    instanceIds: [instanceId],
    activeInstanceId: instanceId,
  };
  await kv.put(profileKey(username), JSON.stringify(profile));
  moved++;

  const existingUsernames = JSON.parse((await kv.get('meta:usernames')) ?? '[]') as string[];
  if (!existingUsernames.includes(username)) {
    existingUsernames.push(username);
    await kv.put('meta:usernames', JSON.stringify(existingUsernames));
  }

  await kv.put('meta:initialized', 'true');

  await Promise.all([
    kv.delete('auth:initialized'),
    kv.delete('auth:passwordHash'),
    kv.delete('auth:totpSecret'),
    ...legacyDataKeys.map((k) => kv.delete(k)),
  ]);

  return { moved, instanceId };
}

