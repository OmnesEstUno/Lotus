import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  otpauthUrl: string;
  secret: string;
}

export default function TotpEnrollStep({ otpauthUrl, secret }: Props) {
  const [copied, setCopied] = useState(false);
  const [showApps, setShowApps] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; user can long-press the code instead */
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
      <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
        Set up two-factor authentication with an authenticator app.
      </p>

      <a
        href={otpauthUrl}
        className="btn btn-primary w-full"
        style={{ textDecoration: 'none', textAlign: 'center' }}
      >
        Open in authenticator app
      </a>

      <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>
        On a different device? Scan this QR code instead:
      </p>
      <div style={{ padding: 16, background: '#fff', borderRadius: 12 }}>
        <QRCodeSVG value={otpauthUrl} size={180} />
      </div>

      <div
        style={{
          background: 'var(--bg-surface)',
          borderRadius: 8,
          padding: '10px 16px',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Manual entry code</p>
          <button
            type="button"
            onClick={handleCopy}
            className="btn btn-ghost"
            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
            aria-label="Copy manual entry code"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <code
          style={{
            display: 'block',
            fontSize: '0.875rem',
            color: 'var(--accent)',
            letterSpacing: '0.1em',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
            marginTop: 4,
          }}
        >
          {secret}
        </code>
      </div>

      <button
        type="button"
        onClick={() => setShowApps((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: '0.75rem',
          cursor: 'pointer',
          padding: 0,
          textDecoration: 'underline',
        }}
      >
        Don't have an authenticator app yet?
      </button>
      {showApps && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0 }}>
            Tap "Open in authenticator app" above to pick from any TOTP app already on your device. No app yet? Install Google Authenticator:
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <a
              href="https://apps.apple.com/app/google-authenticator/id388497605"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              App Store
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Play Store
            </a>
            <a
              href="https://safety.google/authentication/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              About
            </a>
          </div>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>
            Install, then come back and tap "Open in authenticator app" above.
          </p>
        </div>
      )}

    </div>
  );
}
