import { FormEvent, useEffect, useState } from 'react';
import CollapsibleCard from './CollapsibleCard';
import PasswordInput from './PasswordInput';
import RateLimitMessage from './RateLimitMessage';
import { changePassword, updateDisplayName, getCurrentDisplayName, getAccountTotpStatus } from '../api/auth';
import { PASSWORD_MIN_LENGTH } from '../utils/constants';

export default function AccountCard() {
  // Display name state
  const [displayName, setDisplayName] = useState(getCurrentDisplayName() ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [hasTotp, setHasTotp] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccountTotpStatus()
      .then(({ enrolled }) => { if (!cancelled) setHasTotp(enrolled); })
      .catch(() => { if (!cancelled) setHasTotp(false); });
    return () => { cancelled = true; };
  }, []);

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    setNameMessage(null);
    setSavingName(true);
    try {
      const res = await updateDisplayName(displayName.trim());
      setDisplayName(res.displayName ?? '');
      setNameMessage({ kind: 'ok', text: 'Display name saved.' });
    } catch (err) {
      setNameMessage({ kind: 'err', text: (err as Error).message || 'Could not save.' });
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwMessage(null);
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPwMessage({ kind: 'err', text: `New password must be at least ${PASSWORD_MIN_LENGTH} characters.` });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMessage({ kind: 'err', text: 'New passwords do not match.' });
      return;
    }
    if (hasTotp && totpCode.length !== 6) {
      setPwMessage({ kind: 'err', text: 'Enter the 6-digit code from your authenticator app.' });
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword, hasTotp ? totpCode : '');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTotpCode('');
      setPwMessage({ kind: 'ok', text: 'Password changed. Other devices will be signed out.' });
    } catch (err) {
      setPwMessage({ kind: 'err', text: (err as Error).message || 'Could not change password.' });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <CollapsibleCard title="Credentials">
      {/* ── Display name ── */}
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Display name</h3>
      <form onSubmit={handleSaveName} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="account-display-name">Shown in greetings; doesn't change how you sign in.</label>
          <input
            id="account-display-name"
            name="nickname"
            type="text"
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What we'll call you"
            autoComplete="nickname"
            maxLength={64}
            style={{ width: '100%' }}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={savingName} style={{ alignSelf: 'flex-start' }}>
          {savingName ? <span className="spinner" /> : 'Save display name'}
        </button>
        {nameMessage && (
          <div
            className={nameMessage.kind === 'ok' ? 'alert alert-success' : 'alert alert-danger'}
            style={{ marginTop: 4 }}
          >
            {nameMessage.text}
          </div>
        )}
      </form>

      {/* ── Change password ── */}
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Change password</h3>
      <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="account-current-password">Current password</label>
          <PasswordInput
            id="account-current-password"
            name="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            maxLength={256}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="account-new-password">New password</label>
          <PasswordInput
            id="account-new-password"
            name="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min. 8 characters"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={256}
            passwordrules={`minlength: ${PASSWORD_MIN_LENGTH};`}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="account-confirm-password">Confirm new password</label>
          <PasswordInput
            id="account-confirm-password"
            name="confirm-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            maxLength={256}
          />
        </div>
        {hasTotp && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="account-totp">Authenticator code</label>
            <input
              id="account-totp"
              name="otp"
              type="text"
              inputMode="numeric"
              className="input"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              autoComplete="one-time-code"
              style={{ textAlign: 'center', letterSpacing: '0.25em', width: '100%' }}
            />
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={savingPassword} style={{ alignSelf: 'flex-start' }}>
          {savingPassword ? <span className="spinner" /> : 'Change password'}
        </button>
        {pwMessage && (
          <div
            className={pwMessage.kind === 'ok' ? 'alert alert-success' : 'alert alert-danger'}
            style={{ marginTop: 4 }}
          >
            <RateLimitMessage message={pwMessage.text} />
          </div>
        )}
      </form>
    </CollapsibleCard>
  );
}
