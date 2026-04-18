import { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { getSetupStatus, initSetup, confirmSetup, login, verify2FA, isAuthenticated } from '../api/client';
import Logo from '../components/Logo';

type Step = 'loading' | 'setup-password' | 'setup-totp' | 'setup-confirm' | 'login-password' | 'login-totp';

export default function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [preAuthToken, setPreAuthToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/dashboard');
      return;
    }
    getSetupStatus()
      .then(({ initialized }) => {
        setStep(initialized ? 'login-password' : 'setup-password');
      })
      .catch(() => {
        setError('Could not connect to the server. Please check that the Worker is deployed and the API URL is configured correctly.');
        setStep('login-password');
      });
  }, [navigate]);

  async function handleSetupPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Your password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords you entered do not match. Please try again.');
      return;
    }
    setLoading(true);
    try {
      const { totpSecret: secret } = await initSetup(password);
      setTotpSecret(secret);
      setStep('setup-totp');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupConfirm(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (totpCode.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    try {
      await confirmSetup(totpCode);
      setStep('login-password');
      setPassword('');
      setTotpCode('');
    } catch (err) {
      setError('The code you entered is incorrect. Make sure your authenticator app is synced and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { preAuthToken: token } = await login(password);
      setPreAuthToken(token);
      setStep('login-totp');
    } catch (err) {
      setError('Incorrect password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

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
      navigate('/dashboard');
    } catch (err) {
      setError('The verification code is incorrect or has expired. Please check your authenticator app and try again.');
    } finally {
      setLoading(false);
    }
  }

  const otpauthUrl = totpSecret
    ? `otpauth://totp/Lotus:Lotus?secret=${totpSecret}&issuer=Lotus&algorithm=SHA1&digits=6&period=30`
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
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Logo size={56} color="var(--accent)" style={{ margin: '0 auto 12px' }} />
          <h1 style={{ fontSize: '1.5rem' }}>Lotus</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: 2, letterSpacing: '0.01em' }}>
            Budget. Bloom. Balance
          </p>
          <p className="subtitle" style={{ marginTop: 10 }}>
            {step === 'setup-password' || step === 'setup-totp' || step === 'setup-confirm'
              ? 'First-time setup'
              : 'Sign in to your account'}
          </p>
        </div>

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

        {/* Setup Step 1: Password */}
        {step === 'setup-password' && (
          <form onSubmit={handleSetupPassword} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 8 }}>
              Create a password and set up two-factor authentication to protect your financial data.
            </p>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <input
                type="password"
                className="input"
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

        {/* Login Step 1: Password */}
        {step === 'login-password' && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                autoFocus
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Continue'}
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
              onClick={() => { setStep('login-password'); setTotpCode(''); setError(''); }}
            >
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
