// ── UI Timing ────────────────────────────────────────────────────────────
export const TOAST_DEFAULT_DURATION_MS = 5000;
export const TOAST_TICK_INTERVAL_MS = 50;
export const SUCCESS_FLASH_DURATION_MS = 1200;

// ── Drag / Touch ─────────────────────────────────────────────────────────
export const TOUCH_SENSOR_DELAY_MS = 200;
export const TOUCH_SENSOR_TOLERANCE_PX = 5;

// ── Date ranges ──────────────────────────────────────────────────────────
export const YEAR_LOOKBACK = 10;
export const YEAR_LOOKFORWARD = 10;
export const UNIX_MS_MULTIPLIER = 1000;

// ── Auth ─────────────────────────────────────────────────────────────────
export const PASSWORD_MIN_LENGTH = 8;
export const USERNAME_REGEX = /^[a-z0-9_-]{3,32}$/;
export const USERNAME_HINT = '3–32 characters: lowercase letters, digits, underscore, or dash.';

// ── Charts ───────────────────────────────────────────────────────────────
export const CHART_HEIGHT_PX = 400;
export const CHART_Y_AXIS_HEADROOM = 1.1;
export const CHART_Y_TICK_STEP = 50;

// ── Storage keys ─────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  TOKEN: 'ft_token',
  TRUSTED_DEVICE: 'ft_trusted_device',
  USERNAME: 'ft_username',
  // JSON array of usernames who have enrolled a biometric credential
  // *on this device*. Server's `hasBiometricCreds` flag tells us whether
  // ANY device has one; this localStorage hint tells us whether THIS one
  // has — used to avoid auto-prompting WebAuthn on devices that will
  // immediately fail (and trigger the OS credential-manager fallback).
  BIOMETRIC_LOCAL_USERS: 'ft_biometric_local_users',
  ACTIVE_INSTANCE: 'ft_active_instance',
  PENDING_WORKSPACE_INVITE: 'ft_pending_workspace_invite',
  // Set on signup completion. Read on Dashboard mount; if present, show the
  // "enable biometrics?" onboarding modal once, then clear.
  BIOMETRIC_PROMPT_PENDING: 'ft_biometric_prompt_pending',
  // Session-scoped flag set when the user taps "Enable biometrics" in the
  // onboarding modal. Read by SecurityCard on mount → triggers auto-expand,
  // scroll-into-view, and a brief highlight pulse on the Add button.
  SETTINGS_FOCUS_SECURITY: 'ft_settings_focus_security',
  DASHBOARD_ORDER: (instanceId: string) => `dashboard:cardOrder:${instanceId}`,
  DASHBOARD_MINIMIZED: (instanceId: string) => `dashboard:minimized:${instanceId}`,
  HIDDEN: (instanceId: string) => `dashboard:hidden:${instanceId}`,
} as const;

// ── Backups ──────────────────────────────────────────────────────────────
export const BACKUP_FILENAME_PREFIX = 'lotus-backup';

// ── Upload chunking ──────────────────────────────────────────────────────
// Worker caps batch POSTs at MAX_BATCH_SIZE (1000); 500 leaves headroom.
export const TRANSACTION_UPLOAD_CHUNK_SIZE = 500;
