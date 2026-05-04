import type { KVNamespace } from '@cloudflare/workers-types';
import { signJWT, verifyJWT } from './crypto';
import { KV_PREFIXES, TRUSTED_DEVICE_TTL_SECONDS } from '../constants';

export interface TrustedDevicePayload {
  trustedDevice: true;
  username: string;
  tokenId: string;
  exp: number;
}

/**
 * Issue a new trusted-device token and persist its id to KV. The KV entry
 * is what makes the token revocable: deleting the entry invalidates the token
 * even though the JWT itself remains cryptographically valid.
 */
export async function issueTrustedDevice(
  kv: KVNamespace,
  secret: string,
  username: string,
): Promise<{ token: string; tokenId: string }> {
  const tokenId = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + TRUSTED_DEVICE_TTL_SECONDS;
  const token = await signJWT(
    { trustedDevice: true, username, tokenId, exp } satisfies TrustedDevicePayload,
    secret,
  );
  await kv.put(
    KV_PREFIXES.TRUSTED_DEVICE(tokenId),
    JSON.stringify({ username, exp }),
    { expirationTtl: TRUSTED_DEVICE_TTL_SECONDS },
  );
  return { token, tokenId };
}

/**
 * Verify a trusted-device token. Returns the username on success, or null
 * if the token is invalid, expired, or its KV record was revoked/rotated.
 */
export async function verifyTrustedDevice(
  kv: KVNamespace,
  secret: string,
  token: string,
): Promise<{ username: string; tokenId: string } | null> {
  let payload: Record<string, unknown>;
  try {
    payload = await verifyJWT(token, secret);
  } catch {
    return null;
  }
  if (
    payload.trustedDevice !== true ||
    typeof payload.username !== 'string' ||
    typeof payload.tokenId !== 'string'
  ) {
    return null;
  }
  const stored = await kv.get(KV_PREFIXES.TRUSTED_DEVICE(payload.tokenId));
  if (!stored) return null;
  let parsed: { username: string };
  try {
    parsed = JSON.parse(stored) as { username: string };
  } catch {
    return null;
  }
  if (parsed.username !== payload.username) return null;
  return { username: payload.username, tokenId: payload.tokenId };
}

/**
 * Rotate: revoke the old token (if provided) and issue a new one. Used after
 * every successful second-factor verification on a trusted device.
 */
export async function rotateTrustedDevice(
  kv: KVNamespace,
  secret: string,
  username: string,
  oldTokenId: string | null,
): Promise<{ token: string; tokenId: string }> {
  if (oldTokenId) {
    await kv.delete(KV_PREFIXES.TRUSTED_DEVICE(oldTokenId));
  }
  return issueTrustedDevice(kv, secret, username);
}
