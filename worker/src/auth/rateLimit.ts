import type { KVNamespace } from '@cloudflare/workers-types';

export interface RateLimitState { count: number; firstAt: number; }

export async function checkAndIncrement(
  kv: KVNamespace,
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remainingSeconds: number }> {
  const raw = await kv.get(key);
  const now = Math.floor(Date.now() / 1000);
  let state: RateLimitState;
  if (raw) {
    state = JSON.parse(raw) as RateLimitState;
    if (now - state.firstAt > windowSeconds) {
      state = { count: 1, firstAt: now };
    } else {
      state = { count: state.count + 1, firstAt: state.firstAt };
    }
  } else {
    state = { count: 1, firstAt: now };
  }
  const remainingSeconds = Math.max(0, windowSeconds - (now - state.firstAt));
  await kv.put(key, JSON.stringify(state), { expirationTtl: Math.max(60, remainingSeconds) });
  return { allowed: state.count <= maxAttempts, remainingSeconds };
}

export async function clearRateLimit(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(key);
}
