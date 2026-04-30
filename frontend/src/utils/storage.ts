// Thin abstraction over browser storage so RN port can swap to AsyncStorage.
// All methods are intentionally synchronous (matching localStorage). When ported
// to RN the surface becomes async and all callers get updated at once.

export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* quota / private mode */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
  subscribe(cb: (ev: StorageEvent) => void): () => void {
    window.addEventListener('storage', cb);
    return () => window.removeEventListener('storage', cb);
  },
};

export const sessionStore = {
  get(key: string): string | null {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
  },
  remove(key: string): void {
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  },
};
