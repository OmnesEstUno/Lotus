import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  getSetupStatus,
  initSetup,
  confirmSetup,
  login,
  verify2FA,
  migrateLegacy,
  isAuthenticated,
} from '../api/client';
import Logo from '../components/Logo';
import PasswordInput from '../components/PasswordInput';
import { STORAGE_KEYS, PASSWORD_MIN_LENGTH, USERNAME_REGEX, USERNAME_HINT } from '../utils/constants';
import { sessionStore } from '../utils/storage';

type Step =
  | 'loading'
  | 'migrate'
  | 'setup-password'
  | 'setup-totp'
  | 'setup-confirm'
  | 'login-password'
  | 'login-totp';

// Shared back-button style used on every step that has one
const backButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: '0.8125rem',
  padding: '4px 0',
  marginBottom: 8,
};

export default function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('loading');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [preAuthToken, setPreAuthToken] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/dashboard');
      return;
    }
    // Check for deep-link invite token in the hash (#/signup?token=...)
    const hash = window.location.hash;
    const match = hash.match(/[?&]token=([^&]+)/);
    if (match) {
      let decoded: string;
      try { decoded = decodeURIComponent(match[1]); } catch { /* malformed token — fall through to normal flow */ return; }
      setInviteToken(decoded);
      setStep('setup-password');
      // Clear the token from the URL bar but keep the router on a valid route
      history.replaceState(null, '', window.location.pathname + window.location.search + '#/signup');
      return;
    }
    getSetupStatus()
      .then(({ initialized, migrationPending }) => {
        if (migrationPending) {
          setStep('migrate');
        } else {
          setStep(initialized ? 'login-password' : 'setup-password');
        }
      })
      .catch(() => {
        setError('Could not connect to the server. Please check that the Worker is deployed and the API URL is configured correctly.');
        setStep('login-password');
      });
  }, [navigate]);

  // ── Back button helper ──

  function goBack(target: Step, resetFields?: () => void) {
    setError('');
    resetFields?.();
    setStep(target);
  }

  // ── Migration: claim existing data under a new username ──

  async function handleMigrate(e: FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedUsername = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      setError('Username must be 3–32 characters: lowercase letters, digits, underscore, or dash.');
      return;
    }
    if (!password) {
      setError('Please enter your existing password.');
      return;
    }
    setLoading(true);
    try {
      await migrateLegacy(trimmedUsername, password);
      // Migration done — now log in normally
      setUsername(trimmedUsername);
      setPassword('');
      setStep('login-password');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── Setup Step 1: username + password ──

  async function handleSetupPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedUsername = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(trimmedUsername)) {
      setError('Username must be 3–32 characters: lowercase letters, digits, underscore, or dash.');
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError('Your password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords you entered do not match. Please try again.');
      return;
    }
    setLoading(true);
    try {
      const { totpSecret: secret, setupToken: token } = await initSetup(trimmedUsername, password, inviteToken);
      setUsername(trimmedUsername);
      setTotpSecret(secret);
      setSetupToken(token);
      setStep('setup-totp');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── Setup Step 3: confirm TOTP ──

  async function handleSetupConfirm(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (totpCode.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    try {
      await confirmSetup(username, totpCode, setupToken);
      setStep('login-password');
      setPassword('');
      setTotpCode('');
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'The code you entered is incorrect. Make sure your authenticator app is synced and try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Login Step 1: username + password ──

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { preAuthToken: token } = await login(username, password);
      setPreAuthToken(token);
      setStep('login-totp');
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'Incorrect username or password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Login Step 2: 2FA ──

  async function handleVerify2FA(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (totpCode.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    try {
      await verify2FA(preAuthToken, totpCode);
      const pending = sessionStore.get(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
      if (pending) {
        sessionStore.remove(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
        window.location.hash = `#/workspace-invite?token=${encodeURIComponent(pending)}`;
        return;
      }
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'The verification code is incorrect or has expired. Please check your authenticator app and try again.');
    } finally {
      setLoading(false);
    }
  }

  const otpauthUrl = totpSecret
    ? `otpauth://totp/Lotus:${encodeURIComponent(username || 'Lotus')}?secret=${totpSecret}&issuer=Lotus&algorithm=SHA1&digits=6&period=30`
    : '';

  if (step === 'loading') {
    return (
      <div className="login-page">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
          <p style={{ color: 'var(--text-muted)' }}>Connecting…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Back button — shown above the brand block for steps that need it */}
        {step === 'login-totp' && (
          <button
            type="button"
            style={backButtonStyle}
            onClick={() => goBack('login-password', () => setTotpCode(''))}
          >
            ← Back
          </button>
        )}
        {step === 'setup-totp' && (
          <button
            type="button"
            style={backButtonStyle}
            onClick={() => goBack('setup-password', () => setTotpCode(''))}
          >
            ← Back
          </button>
        )}
        {step === 'setup-confirm' && (
          <button
            type="button"
            style={backButtonStyle}
            onClick={() => goBack('setup-totp', () => setTotpCode(''))}
          >
            ← Back
          </button>
        )}
        {step === 'migrate' && (
          <button
            type="button"
            style={backButtonStyle}
            onClick={() => goBack('login-password', () => { setUsername(''); setPassword(''); })}
          >
            ← Back
          </button>
        )}

        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Logo size={56} color="var(--accent)" style={{ margin: '0 auto 12px' }} />
          <h1 style={{ fontSize: '1.5rem' }}>Lotus</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: 2, letterSpacing: '0.01em' }}>
            Budget. Bloom. Balance
          </p>
          <p className="subtitle" style={{ marginTop: 10 }}>
            {step === 'migrate'
              ? 'Claim your existing data'
              : step === 'setup-password' || step === 'setup-totp' || step === 'setup-confirm'
              ? 'First-time setup'
              : 'Sign in to your account'}
          </p>
        </div>

        {/* Welcome message on 2FA step */}
        {step === 'login-totp' && username && (
          <div style={{ marginTop: 48, marginBottom: 24, textAlign: 'center' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '1.125rem', margin: 0 }}>
              Welcome, <strong>{username}</strong>
            </p>
          </div>
        )}

        {error && (
          <div className="alert alert-danger" style={{ marginBottom: 20 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* Migration: claim existing single-user data */}
        {step === 'migrate' && (
          <form onSubmit={handleMigrate} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 8 }}>
              A previous single-user setup was detected. Choose a username and enter your existing password to migrate your data to the new format.
            </p>
            <div className="form-group">
              <label className="form-label">Choose a username</label>
              <input
                type="text"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice"
                autoComplete="username"
                autoFocus
                required
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {USERNAME_HINT}
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Existing password</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your current password"
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Claim & Migrate'}
            </button>
          </form>
        )}

        {/* Setup Step 1: username + password */}
        {step === 'setup-password' && (
          <form onSubmit={handleSetupPassword} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 8 }}>
              Create a username, password, and set up two-factor authentication to protect your financial data.
            </p>
            <div className="form-group">
              <label className="form-label">Invite token</label>
              <input
                type="text"
                className="input"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="Paste your invite token"
                autoComplete="off"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alice"
                autoComplete="username"
                autoFocus
                required
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {USERNAME_HINT}
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Continue'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => goBack('login-password')}
            >
              Back to log in
            </button>
          </form>
        )}

        {/* Setup Step 2: QR Code */}
        {step === 'setup-totp' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code to confirm.
            </p>
            <div
              style={{
                padding: 16,
                background: '#fff',
                borderRadius: 12,
              }}
            >
              <QRCodeSVG value={otpauthUrl} size={180} />
            </div>
            <div
              style={{
                background: 'var(--bg-surface)',
                borderRadius: 8,
                padding: '10px 16px',
                width: '100%',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Manual entry code</p>
              <code
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--accent)',
                  letterSpacing: '0.1em',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}
              >
                {totpSecret}
              </code>
            </div>
            <button className="btn btn-primary w-full" onClick={() => setStep('setup-confirm')}>
              I've scanned the code
            </button>
          </div>
        )}

        {/* Setup Step 3: Confirm TOTP */}
        {step === 'setup-confirm' && (
          <form onSubmit={handleSetupConfirm} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Enter the 6-digit code from your authenticator app to confirm setup.
            </p>
            <div className="form-group">
              <label className="form-label">Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoComplete="one-time-code"
                style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.25em' }}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Complete Setup'}
            </button>
          </form>
        )}

        {/* Login Step 1: username + password */}
        {step === 'login-password' && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Continue'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => { setStep('setup-password'); setError(''); }}
            >
              Sign up
            </button>
          </form>
        )}

        {/* Login Step 2: 2FA */}
        {step === 'login-totp' && (
          <form onSubmit={handleVerify2FA} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Enter the 6-digit code from your authenticator app.
            </p>
            <div className="form-group">
              <label className="form-label">Authentication code</label>
              <input
                type="text"
                inputMode="numeric"
                className="input"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoComplete="one-time-code"
                style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.25em' }}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Verify'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => { setStep('setup-password'); setError(''); }}
            >
              Sign up
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
