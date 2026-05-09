import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';
import { isPlatformAuthenticatorAvailable } from '../api/biometric';
import { storage, sessionStore } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

/**
 * One-time onboarding prompt shown on the first dashboard mount after signup.
 * Trigger: `STORAGE_KEYS.BIOMETRIC_PROMPT_PENDING` is set to '1'.
 * Suppressed if the device has no platform authenticator.
 */
export default function BiometricPromptModal() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (storage.get(STORAGE_KEYS.BIOMETRIC_PROMPT_PENDING) !== '1') return;
    let cancelled = false;
    isPlatformAuthenticatorAvailable().then((supported) => {
      if (cancelled) return;
      if (!supported) {
        // No biometric on this device — clear the flag silently.
        storage.remove(STORAGE_KEYS.BIOMETRIC_PROMPT_PENDING);
        return;
      }
      setOpen(true);
    });
    return () => { cancelled = true; };
  }, []);

  function handleEnable() {
    storage.remove(STORAGE_KEYS.BIOMETRIC_PROMPT_PENDING);
    sessionStore.set(STORAGE_KEYS.SETTINGS_FOCUS_SECURITY, '1');
    setOpen(false);
    navigate('/settings');
  }

  function handleLater() {
    storage.remove(STORAGE_KEYS.BIOMETRIC_PROMPT_PENDING);
    setOpen(false);
  }

  return (
    <Modal open={open} onClose={handleLater}>
      <div style={{ padding: '8px 4px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ fontSize: 48, color: 'var(--accent)', alignSelf: 'center' }}
        >
          fingerprint
        </span>
        <h2 style={{ margin: 0, textAlign: 'center', fontSize: '1.25rem' }}>
          Enable biometric login?
        </h2>
        <p style={{ margin: 0, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Sign in faster next time with your fingerprint or face. You can always
          add or remove devices later from Settings.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <button className="btn btn-primary btn-lg w-full" onClick={handleEnable}>
            Enable biometrics
          </button>
          <button className="btn btn-ghost w-full" onClick={handleLater}>
            Maybe later
          </button>
        </div>
      </div>
    </Modal>
  );
}
