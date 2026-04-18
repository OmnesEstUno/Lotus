import type { KVNamespace } from '@cloudflare/workers-types';

const profileKey = (username: string) => `users:${username}:profile`;
const userDataKey = (username: string, leaf: string) => `users:${username}:${leaf}`;

export async function migrateSingleUserToMultiTenant(
  kv: KVNamespace,
  username: string,
): Promise<{ moved: number }> {
  const legacyAuthKeys = ['auth:passwordHash', 'auth:totpSecret'] as const;
  const legacyDataKeys = ['data:transactions', 'data:income', 'data:userCategories'] as const;
  let moved = 0;

  const [hashVal, totpVal] = await Promise.all(legacyAuthKeys.map((k) => kv.get(k)));
  if (!hashVal || !totpVal) throw new Error('Legacy auth data missing; cannot migrate.');

  const profile = {
    passwordHash: hashVal,
    totpSecret: totpVal,
    createdAt: new Date().toISOString(),
    confirmed: true,
  };
  await kv.put(profileKey(username), JSON.stringify(profile));
  moved++;

  for (const leaf of legacyDataKeys) {
    const val = await kv.get(leaf);
    if (val) {
      await kv.put(userDataKey(username, leaf), val);
      moved++;
    }
  }

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

  return { moved };
}
