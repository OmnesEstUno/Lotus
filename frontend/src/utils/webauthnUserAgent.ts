/**
 * Best-effort default device label for newly enrolled credentials.
 * Examples:
 *   "Safari on iPhone"
 *   "Chrome on macOS"
 *   "Firefox on Windows"
 *   "Chrome on Android"
 *   "This device" (fallback)
 */
export function defaultDeviceLabel(userAgent: string = navigator.userAgent): string {
  const browser = detectBrowser(userAgent);
  const os = detectOS(userAgent);
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return 'This device';
}

function detectBrowser(ua: string): string | null {
  if (/CriOS\//i.test(ua)) return 'Chrome';
  if (/FxiOS\//i.test(ua)) return 'Firefox';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua)) return 'Opera';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return null;
}

function detectOS(ua: string): string | null {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return null;
}
