import { useState, useEffect, useRef, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import {
  getSetupStatus,
  initSetup,
  login,
  completeLogin,
  verify2FA,
  migrateLegacy,
  isAuthenticated,
  getTrustedDeviceToken,
  clearTrustedDeviceToken,
  forgotBegin,
  forgotWebauthnBegin,
  forgotWebauthnFinish,
  forgotConfirm,
  adminResetMeta,
  adminResetRedeem,
} from '../api/auth';
import { notifyUsernameChange, AuthError } from '../api/core';
import {
  trustedSecondFactor,
  authenticateBegin,
  verifyBiometric,
  isBiometricEnrolledLocally,
} from '../api/biometric';
import Logo from '../components/Logo';
import LotusSpinner from '../components/LotusSpinner';
import PasswordInput from '../components/PasswordInput';
import RateLimitMessage from '../components/RateLimitMessage';
import TurnstileWidget from '../components/TurnstileWidget';
import { STORAGE_KEYS, PASSWORD_MIN_LENGTH, USERNAME_REGEX, USERNAME_HINT } from '../utils/constants';
import { storage, sessionStore } from '../utils/storage';

type Step =
  | 'loading'
  | 'migrate'
  | 'setup-password'
  | 'login-password'
  | 'login-totp'
  | 'forgot-username-totp'
  | 'forgot-webauthn'
  | 'forgot-new-password'
  | 'admin-reset';

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
  const [preAuthToken, setPreAuthToken] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasBiometricCreds, setHasBiometricCreds] = useState(false);
  const [hasTotp, setHasTotp] = useState(false);
  const [oldTrustedDeviceTokenId, setOldTrustedDeviceTokenId] = useState<string | null>(null);
  const [biometricPrompted, setBiometricPrompted] = useState(false);
  const biometricCancelledRef = useRef(false);
  // Self-service forgot-password state
  const [pwresetToken, setPwresetToken] = useState('');
  // Admin-issued reset state (deep-link path)
  const [adminResetToken, setAdminResetToken] = useState('');
  const [adminResetUsername, setAdminResetUsername] = useState('');
  // Display name (signup field + trusted-device welcome)
  const [displayName, setDisplayName] = useState('');
  const [trustedDisplayName, setTrustedDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/dashboard');
      return;
    }
    // Deep-link: admin-issued password reset (#/reset?token=...)
    const hash = window.location.hash;
    const resetMatch = hash.match(/^#\/reset\?(?:.*&)?token=([^&]+)/);
    if (resetMatch) {
      let decoded: string;
      try { decoded = decodeURIComponent(resetMatch[1]); }
      catch { return; }
      setAdminResetToken(decoded);
      setStep('loading');
      adminResetMeta(decoded)
        .then(({ username }) => {
          setAdminResetUsername(username);
          setStep('admin-reset');
        })
        .catch((e: Error) => {
          setError(e.message || 'This reset link is invalid or has expired.');
          setStep('login-password');
        });
      history.replaceState(null, '', window.location.pathname + window.location.search + '#/reset');
      return;
    }
    const trustedToken = getTrustedDeviceToken();
    const continueToInit = () => {
      getSetupStatus()
        .then(({ initialized, migrationPending }) => {
          if (migrationPending) setStep('migrate');
          else setStep(initialized ? 'login-password' : 'setup-password');
        })
        .catch(() => {
          setError('Could not connect to the server. Please check that the Worker is deployed and the API URL is configured correctly.');
          setStep('login-password');
        });
    };

    if (trustedToken) {
      trustedSecondFactor(trustedToken)
        .then(({ preAuthToken, username, hasBiometricCreds, hasTotp: trustedHasTotp, oldTokenId, displayName: tdDisplayName }) => {
          setUsername(username);
          setPreAuthToken(preAuthToken);
          setHasBiometricCreds(hasBiometricCreds);
          setHasTotp(trustedHasTotp);
          setOldTrustedDeviceTokenId(oldTokenId);
          setTrustedDisplayName(tdDisplayName ?? null);
          setStep('login-totp');
        })
        .catch(() => {
          clearTrustedDeviceToken();
          continueToInit();
        });
    } else {
      continueToInit();
    }
  }, [navigate]);

  useEffect(() => {
    if (step !== 'login-totp') return;
    if (!hasBiometricCreds) return;
    // Only auto-prompt if THIS device has previously enrolled a credential for
    // this user. Server's hasBiometricCreds tells us whether the account has
    // any credential on any device — without this gate, fresh devices would
    // launch the OS credential manager (which on Android offers Google PM,
    // suggesting a passkey enrollment instead of using the local biometric).
    if (!isBiometricEnrolledLocally(username.trim().toLowerCase())) return;
    if (biometricPrompted) return;
    setBiometricPrompted(true);
    void runBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hasBiometricCreds]);

  useEffect(() => {
    if (step !== 'login-totp') return;
    if (hasTotp) return;
    if (hasBiometricCreds) return;
    if (!preAuthToken) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await completeLogin(preAuthToken, oldTrustedDeviceTokenId);
        if (cancelled) return;
        storage.set(STORAGE_KEYS.TRUSTED_DEVICE, result.trustedDeviceJwt);
        const pending = sessionStore.get(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
        if (pending) {
          sessionStore.remove(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
          window.location.hash = `#/workspace-invite?token=${encodeURIComponent(pending)}`;
          return;
        }
        navigate('/dashboard');
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message || 'Could not sign you in. Please try again.');
        setStep('login-password');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hasTotp, hasBiometricCreds, preAuthToken]);

  async function runBiometric(): Promise<void> {
    biometricCancelledRef.current = false;
    try {
      const { options } = await authenticateBegin(preAuthToken);
      if (biometricCancelledRef.current) return;
      const assertion = await startAuthentication({ optionsJSON: options });
      if (biometricCancelledRef.current) return;
      const result = await verifyBiometric(preAuthToken, assertion, oldTrustedDeviceTokenId);
      if (biometricCancelledRef.current) return;
      storage.set(STORAGE_KEYS.TOKEN, result.token);
      storage.set(STORAGE_KEYS.TRUSTED_DEVICE, result.trustedDeviceJwt);
      storage.set(STORAGE_KEYS.USERNAME, result.username);
      if (result.displayName) storage.set(STORAGE_KEYS.DISPLAY_NAME, result.displayName);
      else storage.remove(STORAGE_KEYS.DISPLAY_NAME);
      notifyUsernameChange(result.username);
      const pending = sessionStore.get(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
      if (pending) {
        sessionStore.remove(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
        window.location.hash = `#/workspace-invite?token=${encodeURIComponent(pending)}`;
        return;
      }
      navigate('/dashboard');
    } catch {
      // user cancelled or device declined; remain on TOTP screen silently
    }
  }

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
      await initSetup(trimmedUsername, password, turnstileToken, displayName.trim() || undefined, honeypot);
      setUsername(trimmedUsername);
      // First-login biometric onboarding (modal also surfaces optional TOTP).
      storage.set(STORAGE_KEYS.BIOMETRIC_PROMPT_PENDING, '1');
      setStep('login-password');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError((err as Error).message);
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
      const { preAuthToken: token, hasBiometricCreds: hasCreds, hasTotp: gotTotp } = await login(username, password);
      setPreAuthToken(token);
      setHasBiometricCreds(hasCreds);
      setHasTotp(gotTotp);
      setBiometricPrompted(false);
      setStep('login-totp');
    } catch (err) {
      console.error(err);
      if (err instanceof AuthError && typeof err.attemptsRemaining === 'number') {
        const tries = err.attemptsRemaining;
        if (tries === 0) {
          setError('Username or password incorrect. The next attempt will lock the account briefly.');
        } else {
          setError(`Username or password incorrect. You have ${tries} ${tries === 1 ? 'try' : 'tries'} remaining before lockout.`);
        }
      } else {
        setError((err as Error).message || 'Incorrect username or password. Please try again.');
      }
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
      await verify2FA(preAuthToken, totpCode, oldTrustedDeviceTokenId);
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

  // ── Forgot password (self-service) ──

  async function handleForgotBegin(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (totpCode.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    try {
      const trimmed = username.trim().toLowerCase();
      const { pwresetToken: token, needsWebauthn } = await forgotBegin(trimmed, totpCode);
      setUsername(trimmed);
      setPwresetToken(token);
      setTotpCode('');
      setStep(needsWebauthn ? 'forgot-webauthn' : 'forgot-new-password');
    } catch (err) {
      setError((err as Error).message || 'Could not start password reset.');
    } finally {
      setLoading(false);
    }
  }

  async function runForgotWebauthn(): Promise<void> {
    setError('');
    setLoading(true);
    try {
      const { options } = await forgotWebauthnBegin(pwresetToken);
      const assertion = await startAuthentication({ optionsJSON: options as never });
      const { pwresetToken: nextToken } = await forgotWebauthnFinish(pwresetToken, assertion);
      setPwresetToken(nextToken);
      setStep('forgot-new-password');
    } catch (err) {
      setError((err as Error).message || 'Verification was cancelled or failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotConfirm(e: FormEvent) {
    e.preventDefault();
    setError('');
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
      await forgotConfirm(pwresetToken, password);
      // Wipe local trusted-device token (server has revoked it anyway).
      clearTrustedDeviceToken();
      setPassword('');
      setConfirmPassword('');
      setPwresetToken('');
      setStep('login-password');
    } catch (err) {
      setError((err as Error).message || 'Could not set new password.');
    } finally {
      setLoading(false);
    }
  }

  // ── Admin-issued reset (deep-link) ──

  async function handleAdminResetConfirm(e: FormEvent) {
    e.preventDefault();
    setError('');
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
      await adminResetRedeem(adminResetToken, password);
      clearTrustedDeviceToken();
      setPassword('');
      setConfirmPassword('');
      setAdminResetToken('');
      setStep('login-password');
    } catch (err) {
      setError((err as Error).message || 'Could not set new password.');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'loading') {
    return <LotusSpinner />;
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
            Budget. Balance. Bloom.
          </p>
          <p className="subtitle" style={{ marginTop: 10 }}>
            {step === 'migrate'
              ? 'Claim your existing data'
              : step === 'setup-password'
              ? 'First-time setup'
              : step === 'forgot-username-totp' || step === 'forgot-webauthn' || step === 'forgot-new-password' || step === 'admin-reset'
              ? 'Reset your password'
              : 'Sign in to your account'}
          </p>
        </div>

        {/* Welcome message on 2FA step. When the trusted-device path put us
            here, prefer the friendly display name returned by the server. */}
        {step === 'login-totp' && username && (
          <div style={{ marginTop: 48, marginBottom: 24, textAlign: 'center' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '1.125rem', margin: 0 }}>
              Welcome, <strong>{trustedDisplayName ?? username}</strong>
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
            <RateLimitMessage message={error} />
          </div>
        )}

        {/* Migration: claim existing single-user data */}
        {step === 'migrate' && (
          <form onSubmit={handleMigrate} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 8 }}>
              A previous single-user setup was detected. Choose a username and enter your existing password to migrate your data to the new format.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="migrate-username">Choose a username</label>
              <input
                id="migrate-username"
                name="username"
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
              <label className="form-label" htmlFor="migrate-password">Existing password</label>
              <PasswordInput
                id="migrate-password"
                name="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your current password"
                autoComplete="current-password"
                required
                maxLength={256}
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
              Create a username and password to protect your financial data. You can add biometric and authenticator-app sign-in from Settings after you log in.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="setup-username">Username</label>
              <input
                id="setup-username"
                name="username"
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
              <label className="form-label" htmlFor="setup-display-name">Display name <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input
                id="setup-display-name"
                name="nickname"
                type="text"
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="What we'll call you"
                autoComplete="nickname"
                maxLength={64}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Shown in greetings; doesn't change how you sign in.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="setup-password">Password</label>
              <PasswordInput
                id="setup-password"
                name="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={256}
                passwordrules={`minlength: ${PASSWORD_MIN_LENGTH};`}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="setup-confirm-password">Confirm password</label>
              <PasswordInput
                id="setup-confirm-password"
                name="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={256}
                passwordrules={`minlength: ${PASSWORD_MIN_LENGTH};`}
              />
            </div>
            <TurnstileWidget
              siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY as string}
              onToken={setTurnstileToken}
            />
            <input
              type="text"
              name="website"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }}
            />
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading || !turnstileToken}>
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

        {/* Login Step 1: username + password */}
        {step === 'login-password' && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">Username</label>
              <input
                id="login-username"
                name="username"
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
              <label className="form-label" htmlFor="login-password">Password</label>
              <PasswordInput
                id="login-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setTotpCode('');
                  setStep('forgot-username-totp');
                }}
                style={{
                  alignSelf: 'flex-start',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  marginTop: 4,
                  color: 'var(--accent)',
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                }}
              >
                Forgot password?
              </button>
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Continue'}
            </button>
          </form>
        )}

        {/* Login Step 2: 2FA */}
        {step === 'login-totp' && (
          <>
            {!hasTotp && !hasBiometricCreds && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
                <LotusSpinner />
              </div>
            )}
            {hasTotp && (
              <form onSubmit={handleVerify2FA} className="login-form">
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  Enter the 6-digit code from your authenticator app.
                </p>
                <div className="form-group">
                  <label className="form-label" htmlFor="login-totp-code">Authentication code</label>
                  <input
                    id="login-totp-code"
                    name="otp"
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
                {hasBiometricCreds && (
                  <button
                    type="button"
                    className="btn btn-ghost w-full"
                    onClick={() => {
                      biometricCancelledRef.current = false;
                      setBiometricPrompted(true);
                      setError('');
                      void runBiometric();
                    }}
                    disabled={loading}
                  >
                    Use a passkey or biometric
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost w-full"
                  onClick={() => {
                    biometricCancelledRef.current = true;
                    clearTrustedDeviceToken();
                    storage.remove(STORAGE_KEYS.DISPLAY_NAME);
                    setUsername('');
                    setPassword('');
                    setTotpCode('');
                    setPreAuthToken('');
                    setHasBiometricCreds(false);
                    setHasTotp(false);
                    setOldTrustedDeviceTokenId(null);
                    setBiometricPrompted(false);
                    setTrustedDisplayName(null);
                    setError('');
                    setStep('login-password');
                  }}
                >
                  Sign in as a different account
                </button>
              </form>
            )}
            {!hasTotp && hasBiometricCreds && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  Verify with the biometric or passkey registered to this account. If the prompt didn't appear or you dismissed it, try again below.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-lg w-full"
                  onClick={() => {
                    biometricCancelledRef.current = false;
                    setBiometricPrompted(true);
                    setError('');
                    void runBiometric();
                  }}
                  disabled={loading}
                >
                  {loading ? <span className="spinner" /> : 'Use a passkey or biometric'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost w-full"
                  onClick={() => {
                    biometricCancelledRef.current = true;
                    clearTrustedDeviceToken();
                    storage.remove(STORAGE_KEYS.DISPLAY_NAME);
                    setUsername('');
                    setPassword('');
                    setTotpCode('');
                    setPreAuthToken('');
                    setHasBiometricCreds(false);
                    setHasTotp(false);
                    setOldTrustedDeviceTokenId(null);
                    setBiometricPrompted(false);
                    setTrustedDisplayName(null);
                    setError('');
                    setStep('login-password');
                  }}
                >
                  Sign in as a different account
                </button>
              </div>
            )}
          </>
        )}

        {/* Forgot password Step 1: username + TOTP */}
        {step === 'forgot-username-totp' && (
          <form onSubmit={handleForgotBegin} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Enter your username and the current 6-digit code from your authenticator app to start a password reset.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-username">Username</label>
              <input
                id="forgot-username"
                name="username"
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
              <label className="form-label" htmlFor="forgot-totp-code">Authentication code</label>
              <input
                id="forgot-totp-code"
                name="otp"
                type="text"
                inputMode="numeric"
                className="input"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoComplete="one-time-code"
                style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.25em' }}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Continue'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => { setError(''); setTotpCode(''); setStep('login-password'); }}
            >
              Back to sign in
            </button>
          </form>
        )}

        {/* Forgot password Step 2: WebAuthn (any registered factor) */}
        {step === 'forgot-webauthn' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <span
              className="material-symbols-outlined"
              aria-hidden="true"
              style={{ fontSize: 48, color: 'var(--accent)' }}
            >
              fingerprint
            </span>
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              One more step. Verify with a security key or biometric you've previously registered for this account.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-lg w-full"
              onClick={() => void runForgotWebauthn()}
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : 'Verify identity'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => { setError(''); setPwresetToken(''); setStep('login-password'); }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Forgot password Step 3: new password */}
        {step === 'forgot-new-password' && (
          <form onSubmit={handleForgotConfirm} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Choose a new password for <strong>{username}</strong>. All other sessions will be signed out.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-new-password">New password</label>
              <PasswordInput
                id="forgot-new-password"
                name="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={256}
                passwordrules={`minlength: ${PASSWORD_MIN_LENGTH};`}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="forgot-confirm-password">Confirm password</label>
              <PasswordInput
                id="forgot-confirm-password"
                name="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={256}
                passwordrules={`minlength: ${PASSWORD_MIN_LENGTH};`}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Set new password'}
            </button>
          </form>
        )}

        {/* Admin-issued reset link */}
        {step === 'admin-reset' && (
          <form onSubmit={handleAdminResetConfirm} className="login-form">
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Set a new password for <strong>{adminResetUsername}</strong>. All other sessions will be signed out.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="admin-reset-username">Username</label>
              <input
                id="admin-reset-username"
                name="username"
                type="text"
                className="input"
                value={adminResetUsername}
                readOnly
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="admin-reset-new-password">New password</label>
              <PasswordInput
                id="admin-reset-new-password"
                name="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={256}
                passwordrules={`minlength: ${PASSWORD_MIN_LENGTH};`}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="admin-reset-confirm-password">Confirm password</label>
              <PasswordInput
                id="admin-reset-confirm-password"
                name="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={256}
                passwordrules={`minlength: ${PASSWORD_MIN_LENGTH};`}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={loading}>
              {loading ? <span className="spinner" /> : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
