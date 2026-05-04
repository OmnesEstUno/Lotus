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
  ACTIVE_INSTANCE: 'ft_active_instance',
  PENDING_WORKSPACE_INVITE: 'ft_pending_workspace_invite',
  DASHBOARD_ORDER: (instanceId: string) => `dashboard:cardOrder:${instanceId}`,
  DASHBOARD_MINIMIZED: (instanceId: string) => `dashboard:minimized:${instanceId}`,
  HIDDEN: (instanceId: string) => `dashboard:hidden:${instanceId}`,
} as const;

// ── Backups ──────────────────────────────────────────────────────────────
export const BACKUP_FILENAME_PREFIX = 'lotus-backup';

// ── Upload chunking ──────────────────────────────────────────────────────
// Worker caps batch POSTs at MAX_BATCH_SIZE (1000); 500 leaves headroom.
export const TRANSACTION_UPLOAD_CHUNK_SIZE = 500;
