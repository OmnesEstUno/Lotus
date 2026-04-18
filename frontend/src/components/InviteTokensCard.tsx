import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { createInvite, listInvites, deleteInvite, InviteSummary } from '../api/client';

export default function InviteTokensCard() {
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [newestToken, setNewestToken] = useState<{ id: string; token: string; expiresAt: number; qrDataUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const r = await listInvites();
      setInvites(r.invites.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleGenerate() {
    setLoading(true); setError('');
    try {
      const created = await createInvite();
      const url = `${window.location.origin}${window.location.pathname}#/signup?token=${encodeURIComponent(created.token)}`;
      const qrDataUrl = await QRCode.toDataURL(url, { width: 256, margin: 1 });
      setNewestToken({ ...created, qrDataUrl });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this invite?')) return;
    try { await deleteInvite(id); await refresh(); }
    catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2>Invite Tokens</h2>
      <button onClick={handleGenerate} disabled={loading} className="btn btn-primary">
        {loading ? 'Generating…' : 'Generate invite'}
      </button>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      {newestToken && (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>New invite (save or share now):</p>
          <img src={newestToken.qrDataUrl} alt="Invite QR" style={{ marginTop: 8 }} />
          <p style={{ marginTop: 8, fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.85rem' }}>
            {newestToken.token}
          </p>
          <button
            onClick={() => navigator.clipboard.writeText(newestToken.token)}
            className="btn btn-ghost"
          >Copy token</button>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Active invites</h3>
      {invites.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No active invites.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {invites.map((inv) => (
          <li key={inv.id} style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'monospace' }}>{inv.id.slice(0, 8)}…</span>
            {' — expires '}
            {new Date(inv.expiresAt * 1000).toLocaleDateString()}
            {inv.usedBy && <span style={{ color: 'var(--success)', marginLeft: 8 }}>claimed by {inv.usedBy}</span>}
            <button onClick={() => handleRevoke(inv.id)} style={{ marginLeft: 12 }} className="btn btn-ghost">Revoke</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
