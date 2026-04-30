import { useState } from 'react';
import { submitFeatureRequest } from '../api/featureRequests';

export default function FeatureRequestCard() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setStatus(null);
    try {
      await submitFeatureRequest(trimmed);
      setText('');
      setStatus({ kind: 'success', msg: 'Thanks — we got it.' });
    } catch (err) {
      setStatus({ kind: 'error', msg: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>Feature Request</h2>
      </div>
      <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
        Got an idea? Send it here — we read every submission.
      </p>
      <textarea
        className="input"
        rows={4}
        maxLength={2000}
        placeholder="What would you like to see?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ width: '100%', marginBottom: 8, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || text.trim().length === 0}
          onClick={handleSubmit}
        >
          {busy ? 'Sending…' : 'Submit'}
        </button>
        {status && (
          <span className={`text-xs ${status.kind === 'success' ? 'text-success' : 'text-danger'}`}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}
