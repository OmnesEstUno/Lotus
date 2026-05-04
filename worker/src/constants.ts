export const JWT_TTL_SECONDS = 86400; // 1 day
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
  // ─── Biometric / trusted-device ───
  WEBAUTHN_CREDENTIAL: (username: string, credentialId: string) => `webauthn:credential:${username}:${credentialId}`,
  WEBAUTHN_CREDENTIALS_PREFIX: (username: string) => `webauthn:credential:${username}:`,
  WEBAUTHN_CHALLENGE: (username: string) => `webauthn:challenge:${username}`,
  TRUSTED_DEVICE: (tokenId: string) => `auth:trusted-device:${tokenId}`,
  RATELIMIT_WEBAUTHN_REGISTER: (username: string) => `ratelimit:webauthn-register:${username}`,
  RATELIMIT_WEBAUTHN_VERIFY: (username: string) => `ratelimit:webauthn-verify:${username}`,
  RATELIMIT_TRUSTED_DEVICE: (ip: string) => `ratelimit:trusted-device:${ip}`,
} as const;

// ─── Trusted device & biometric ──────────────────────────────────────────────
export const TRUSTED_DEVICE_TTL_SECONDS = 30 * 24 * 60 * 60;     // 30 days
export const BIOMETRIC_REAUTH_THRESHOLD_SECONDS = 30 * 60;       // 30 minutes
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 60;                // single-use
export const WEBAUTHN_REGISTER_MAX_ATTEMPTS = 5;
export const WEBAUTHN_REGISTER_LOCKOUT_SECONDS = 60 * 60;        // 1 hour
export const WEBAUTHN_VERIFY_MAX_ATTEMPTS = 10;
export const WEBAUTHN_VERIFY_LOCKOUT_SECONDS = 5 * 60;           // 5 minutes
export const TRUSTED_DEVICE_RATELIMIT_PER_MIN = 20;              // per IP

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;
export const TOTP_MAX_ATTEMPTS = 5;
export const TOTP_LOCKOUT_SECONDS = 60;
