import { useEffect, useRef, useState, FormEvent } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import CollapsibleCard from './CollapsibleCard';
import RateLimitMessage from './RateLimitMessage';
import {
  listCredentials,
  registerBegin,
  registerFinish,
  renameCredential,
  deleteCredential,
  isPlatformAuthenticatorAvailable,
  markBiometricEnrolledLocally,
  type CredentialSummary,
} from '../api/biometric';
import { getCurrentUsername } from '../api/auth';
import { defaultDeviceLabel } from '../utils/webauthnUserAgent';
import { dialog } from '../utils/dialog';
import { sessionStore } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

function formatRelative(timestamp: number | null): string {
  if (timestamp === null) return 'Never used';
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatAdded(timestamp: number): string {
  return `Added ${new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })}`;
}

export default function SecurityCard() {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [supported, setSupported] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reauthOpen, setReauthOpen] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightAdd, setHighlightAdd] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    Promise.all([
      listCredentials().catch(() => ({ credentials: [] })),
      isPlatformAuthenticatorAvailable(),
    ]).then(([{ credentials }, supported]) => {
      setCredentials(credentials);
      setSupported(supported);
      setLoading(false);
    });
  }, []);

  // Onboarding focus: when the biometric prompt modal redirects here, expand
  // the card, scroll its Add button into view, and pulse a highlight ring.
  useEffect(() => {
    if (loading) return;
    if (sessionStore.get(STORAGE_KEYS.SETTINGS_FOCUS_SECURITY) !== '1') return;
    sessionStore.remove(STORAGE_KEYS.SETTINGS_FOCUS_SECURITY);
    setOpen(true);
    const scrollTimer = window.setTimeout(() => {
      addButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightAdd(true);
    }, 250);
    const clearTimer = window.setTimeout(() => setHighlightAdd(false), 3000);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [loading]);

  async function handleAdd(totpCodeArg?: string): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const begin = await registerBegin(totpCodeArg);
      if ('requiresReauth' in begin) {
        setReauthOpen(true);
        setBusy(false);
        return;
      }
      const attestation = await startRegistration({ optionsJSON: begin.options });
      const label = defaultDeviceLabel();
      const { credential } = await registerFinish(attestation, label);
      const currentUsername = getCurrentUsername();
      if (currentUsername) markBiometricEnrolledLocally(currentUsername);
      setCredentials((prev) => [credential, ...prev]);
      setReauthOpen(false);
      setTotpCode('');
    } catch (e) {
      setError((e as Error).message || 'Could not enroll device.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReauthSubmit(e: FormEvent) {
    e.preventDefault();
    if (totpCode.length !== 6) return;
    await handleAdd(totpCode);
  }

  async function handleRename(credentialId: string, currentLabel: string) {
    const next = (await dialog.prompt('Rename device:', currentLabel))?.trim();
    if (!next || next === currentLabel) return;
    setBusy(true);
    try {
      const { credential } = await renameCredential(credentialId, next);
      setCredentials((prev) => prev.map((c) => (c.credentialId === credentialId ? credential : c)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(credentialId: string, label: string) {
    if (!await dialog.confirm(`Remove "${label}"? You won't be able to use this device for biometric login until you re-enroll.`)) return;
    setBusy(true);
    try {
      await deleteCredential(credentialId);
      setCredentials((prev) => prev.filter((c) => c.credentialId !== credentialId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CollapsibleCard title="Security" open={open} onOpenChange={setOpen}>
      <h3 style={{ marginBottom: 8 }}>Biometric devices</h3>
      {loading ? (
        <p className="security-empty">Loading…</p>
      ) : credentials.length === 0 ? (
        <p className="security-empty">
          Sign in faster with your fingerprint or face. Each device must be enrolled separately.
        </p>
      ) : (
        <div>
          {credentials.map((c) => (
            <div key={c.credentialId} className="security-credential-row">
              <span className="material-symbols-outlined security-credential-icon" aria-hidden="true">
                {c.deviceType === 'multiDevice' ? 'sync_lock' : 'fingerprint'}
              </span>
              <div className="security-credential-details">
                <button
                  type="button"
                  className="security-credential-label"
                  onClick={() => handleRename(c.credentialId, c.label)}
                  disabled={busy}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
                  aria-label={`Rename ${c.label}`}
                >
                  {c.label}
                </button>
                <div className="security-credential-meta">
                  Last used {formatRelative(c.lastUsedAt)} · {formatAdded(c.createdAt)}
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => handleRemove(c.credentialId, c.label)}
                disabled={busy}
                style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="alert alert-danger" style={{ marginTop: 12 }}><RateLimitMessage message={error} /></div>}

      {reauthOpen ? (
        <form onSubmit={handleReauthSubmit} className="security-totp-prompt">
          <p style={{ fontSize: 'var(--font-size-sm)', margin: 0 }}>
            Enter the 6-digit code from your authenticator app to add this device:
          </p>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            autoComplete="one-time-code"
            autoFocus
            style={{ textAlign: 'center', letterSpacing: '0.25em' }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy || totpCode.length !== 6}>
              {busy ? <span className="spinner" /> : 'Continue'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setReauthOpen(false); setTotpCode(''); }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            ref={addButtonRef}
            className={`btn btn-primary security-add-button${highlightAdd ? ' is-highlighted' : ''}`}
            onClick={() => handleAdd()}
            disabled={busy || !supported}
          >
            {busy ? <span className="spinner" /> : '+ Add this device'}
          </button>
          {!supported && (
            <p className="security-empty" style={{ marginTop: 8 }}>
              This device doesn't support biometric authentication.
            </p>
          )}
        </>
      )}
    </CollapsibleCard>
  );
}
