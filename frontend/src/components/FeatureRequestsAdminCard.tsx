import { useEffect, useState } from 'react';
import { listFeatureRequests } from '../api/featureRequests';
import type { FeatureRequest } from '../api/featureRequests';

export default function FeatureRequestsAdminCard() {
  const [items, setItems] = useState<FeatureRequest[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listFeatureRequests()
      .then(setItems)
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Feature Requests (admin)</h2>
        {!loading && !err && <span className="text-xs text-muted">{items.length} total</span>}
      </div>
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {err && <p className="text-sm text-danger">{err}</p>}
      {!loading && !err && items.length === 0 && (
        <p className="text-sm text-muted">No submissions yet.</p>
      )}
      {!loading && !err && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((it) => (
            <div key={it.id} style={{ borderLeft: '3px solid var(--accent-dim)', padding: '6px 12px' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                {it.username} · {it.createdAt.slice(0, 10)}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{it.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
