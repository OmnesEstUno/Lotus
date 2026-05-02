// Single source of truth for the localStorage key used by the accessibility
// settings hook AND by modules that read the same key at load time (e.g.,
// categorization/colors.ts) to avoid silent drift if the key is ever renamed.
export const ACCESSIBILITY_STORAGE_KEY = 'lotus.accessibility.v1';
