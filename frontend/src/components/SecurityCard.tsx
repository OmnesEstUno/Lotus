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
import { getCurrentUsername, getAccountTotpStatus, accountTotpInit, accountTotpConfirm, accountTotpDelete } from '../api/auth';
import TotpEnrollStep from './TotpEnrollStep';
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
  const [totpEnrolled, setTotpEnrolled] = useState<boolean>(false);
  const [totpFlow, setTotpFlow] = useState<
    | { kind: 'idle' }
    | { kind: 'enrolling'; secret: string; otpauthUrl: string; setupToken: string; code: string }
    | { kind: 'removing'; code: string }
  >({ kind: 'idle' });
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState('');
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
      getAccountTotpStatus().catch(() => ({ enrolled: false })),
    ]).then(([{ credentials }, supported, { enrolled }]) => {
      setCredentials(credentials);
      setSupported(supported);
      setTotpEnrolled(enrolled);
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
        if (begin.requiresRelogin) {
          setError('Your session is too old to enroll a new device. Please sign out and sign back in to continue.');
          setBusy(false);
          return;
        }
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

  async function startTotpEnroll() {
    setTotpError('');
    setTotpBusy(true);
    try {
      const { totpSecret, otpauthUrl, setupToken } = await accountTotpInit();
      setTotpFlow({ kind: 'enrolling', secret: totpSecret, otpauthUrl, setupToken, code: '' });
    } catch (e) {
      setTotpError((e as Error).message || 'Could not start TOTP setup.');
    } finally {
      setTotpBusy(false);
    }
  }

  async function confirmTotpEnroll(e: FormEvent) {
    e.preventDefault();
    if (totpFlow.kind !== 'enrolling') return;
    if (totpFlow.code.length !== 6) return;
    setTotpError('');
    setTotpBusy(true);
    try {
      await accountTotpConfirm(totpFlow.setupToken, totpFlow.code);
      setTotpEnrolled(true);
      setTotpFlow({ kind: 'idle' });
    } catch (e) {
      setTotpError((e as Error).message || 'Could not confirm TOTP.');
    } finally {
      setTotpBusy(false);
    }
  }

  async function startTotpRemove() {
    setTotpError('');
    setTotpFlow({ kind: 'removing', code: '' });
  }

  async function confirmTotpRemove(e: FormEvent) {
    e.preventDefault();
    if (totpFlow.kind !== 'removing') return;
    if (totpFlow.code.length !== 6) return;
    setTotpError('');
    setTotpBusy(true);
    try {
      await accountTotpDelete(totpFlow.code);
      setTotpEnrolled(false);
      setTotpFlow({ kind: 'idle' });
    } catch (e) {
      setTotpError((e as Error).message || 'Could not remove TOTP.');
    } finally {
      setTotpBusy(false);
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
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
        <h3 style={{ marginBottom: 8 }}>Authenticator app</h3>
        {totpEnrolled ? (
          totpFlow.kind === 'removing' ? (
            <form onSubmit={confirmTotpRemove} className="security-totp-prompt">
              <p style={{ fontSize: 'var(--font-size-sm)', margin: 0 }}>
                Enter the current 6-digit code from your authenticator to confirm removal.
              </p>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={totpFlow.code}
                onChange={(e) =>
                  setTotpFlow({ ...totpFlow, code: e.target.value.replace(/\D/g, '').slice(0, 6) })
                }
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                style={{ textAlign: 'center', letterSpacing: '0.25em' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={totpBusy || totpFlow.code.length !== 6}>
                  {totpBusy ? <span className="spinner" /> : 'Remove'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setTotpFlow({ kind: 'idle' })}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="security-credential-row">
              <span className="material-symbols-outlined security-credential-icon" aria-hidden="true">
                lock_clock
              </span>
              <div className="security-credential-details">
                <div className="security-credential-label">Authenticator app enabled</div>
                <div className="security-credential-meta">Backup second factor on this account</div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => void startTotpRemove()}
                disabled={busy || totpBusy}
                style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger)' }}
              >
                Remove
              </button>
            </div>
          )
        ) : totpFlow.kind === 'enrolling' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <TotpEnrollStep
              otpauthUrl={totpFlow.otpauthUrl}
              secret={totpFlow.secret}
            />
            <form onSubmit={confirmTotpEnroll} className="security-totp-prompt">
              <p style={{ fontSize: 'var(--font-size-sm)', margin: 0 }}>
                Enter the 6-digit code from your authenticator to finish setup:
              </p>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={totpFlow.code}
                onChange={(e) =>
                  setTotpFlow({ ...totpFlow, code: e.target.value.replace(/\D/g, '').slice(0, 6) })
                }
                placeholder="000000"
                autoComplete="one-time-code"
                autoFocus
                style={{ textAlign: 'center', letterSpacing: '0.25em' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={totpBusy || totpFlow.code.length !== 6}>
                  {totpBusy ? <span className="spinner" /> : 'Confirm'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setTotpFlow({ kind: 'idle' })}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <p className="security-empty">
              Pair an authenticator app (Google Authenticator, 1Password, Authy, etc.) to add a backup second factor for password changes, account deletion, and self-service password reset.
            </p>
            <button
              className="btn btn-primary security-add-button"
              onClick={() => void startTotpEnroll()}
              disabled={busy || totpBusy}
            >
              {totpBusy ? <span className="spinner" /> : '+ Add authenticator app'}
            </button>
          </>
        )}
        {totpError && (
          <div className="alert alert-danger" style={{ marginTop: 12 }}>
            <RateLimitMessage message={totpError} />
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}
