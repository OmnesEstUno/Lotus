import type { KVNamespace } from '@cloudflare/workers-types';
import { writeAllYears, yearOfISODate } from './paginatedYearStorage';

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

export async function migrateToYearPartitioned(
  kv: KVNamespace,
  instanceId: string,
): Promise<void> {
  const txRaw = await kv.get(`instances:${instanceId}:data:transactions`);
  if (txRaw) {
    const txs = JSON.parse(txRaw) as { date: string }[];
    await writeAllYears(kv, `instances:${instanceId}:data:transactions`, txs as unknown as { id: string; date: string }[], (t) => yearOfISODate((t as { date: string }).date));
    await kv.delete(`instances:${instanceId}:data:transactions`);
  }
  const incRaw = await kv.get(`instances:${instanceId}:data:income`);
  if (incRaw) {
    const inc = JSON.parse(incRaw) as { date: string }[];
    await writeAllYears(kv, `instances:${instanceId}:data:income`, inc as unknown as { id: string; date: string }[], (i) => yearOfISODate((i as { date: string }).date));
    await kv.delete(`instances:${instanceId}:data:income`);
  }
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

  // Migrate the default instance's monolithic data keys to year-partitioned shards.
  // Freshly migrated users (single-user → Task 2 → Task 3 → Task 3.5) land directly
  // on the paginated layout without needing the admin migrate-years endpoint.
  await migrateToYearPartitioned(kv, instanceId);

  return { moved, instanceId };
}
