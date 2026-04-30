export const JWT_TTL_SECONDS = 86400 * 7;
export const PREAUTH_TTL_SECONDS = 300;
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const WORKSPACE_INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export const MAX_BATCH_SIZE = 1000;       // for bulk POST/PUT/DELETE
export const MAX_BULK_IDS = 10_000;

export const KV_PREFIXES = {
  USER: (username: string, field: string) => `users:${username}:${field}`,
  INSTANCE_META: (id: string) => `instances:${id}`,
  INSTANCE_DATA: (id: string, kind: string) => `instances:${id}:${kind}`,
  PREAUTH: (id: string) => `preauth:${id}`,
  RATELIMIT_LOGIN: (username: string) => `ratelimit:login:${username}`,
  RATELIMIT_TOTP: (preauthId: string) => `ratelimit:totp:${preauthId}`,
  AUDIT: (ts: number, id: string) => `audit:${ts}:${id}`,
} as const;

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;
export const TOTP_MAX_ATTEMPTS = 5;
export const TOTP_LOCKOUT_SECONDS = 60;
