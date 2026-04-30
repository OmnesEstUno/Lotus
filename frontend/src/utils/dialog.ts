// Wraps window.alert/confirm/prompt so RN port can swap to Alert.alert.
// Signatures are async-returning so RN's async Alert can be dropped in
// without touching call sites.

export const dialog = {
  alert(message: string): Promise<void> {
    window.alert(message);
    return Promise.resolve();
  },
  confirm(message: string): Promise<boolean> {
    return Promise.resolve(window.confirm(message));
  },
  prompt(message: string, defaultValue?: string): Promise<string | null> {
    return Promise.resolve(window.prompt(message, defaultValue));
  },
};
