import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import CollapsibleCard from './CollapsibleCard';
import { createInvite, listInvites, deleteInvite } from '../api/invites';
import type { InviteSummary } from '../api/invites';
import { UNIX_MS_MULTIPLIER } from '../utils/constants';
import { dialog } from '../utils/dialog';

// Build the full invite deep-link URL.
function buildInviteLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/signup?token=${encodeURIComponent(token)}`;
}

// Check if the Web Share API is available.
const SHARE_SUPPORTED = typeof navigator !== 'undefined' && 'share' in navigator;

// Pre-compute QR data URLs for all active invites (eager, ~fast).
async function buildQrMap(invites: InviteSummary[]): Promise<Map<string, string>> {
  const entries = await Promise.all(
    invites.map(async (inv) => {
      const url = buildInviteLink(inv.token);
      const dataUrl = await QRCode.toDataURL(url, { width: 256, margin: 1 });
      return [inv.id, dataUrl] as const;
    }),
  );
  return new Map(entries);
}

// Chevron icons
function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function InviteTokensCard() {
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [qrMap, setQrMap] = useState<Map<string, string>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleCopyLink(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard blocked; user can still copy from the visible link block */
    }
  }

  async function handleShare(link: string) {
    try {
      await navigator.share({
        title: 'Lotus invite',
        text: 'Set up your Lotus account',
        url: link,
      });
    } catch {
      /* user cancellation throws AbortError; silently swallow */
    }
  }

  async function refresh(autoExpandId?: string) {
    try {
      const r = await listInvites();
      const sorted = r.invites.sort((a, b) => b.createdAt - a.createdAt);
      setInvites(sorted);
      const map = await buildQrMap(sorted);
      setQrMap(map);
      if (autoExpandId) setExpandedId(autoExpandId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleGenerate() {
    setLoading(true); setError('');
    try {
      const created = await createInvite();
      await refresh(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!await dialog.confirm('Revoke this invite?')) return;
    try {
      await deleteInvite(id);
      if (expandedId === id) setExpandedId(null);
      await refresh();
    } catch (err) { setError((err as Error).message); }
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <CollapsibleCard
      title="Invite Tokens"
      headerExtra={
        <button onClick={handleGenerate} disabled={loading} className="btn btn-primary btn-sm">
          {loading ? 'Generating…' : 'Generate invite'}
        </button>
      }
    >
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}

      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Active invites</h3>
      {invites.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No active invites.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {invites.map((inv) => {
          const isExpanded = expandedId === inv.id;
          const qrDataUrl = qrMap.get(inv.id);

          return (
            <li key={inv.id} style={{ borderBottom: '1px solid var(--border)' }}>
              {/* Collapsed header — always visible */}
              <button
                type="button"
                onClick={() => toggleExpand(inv.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '10px 0',
                  textAlign: 'left',
                  color: 'var(--text-primary)',
                }}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                  {inv.id.slice(0, 8)}…
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', flex: 1 }}>
                  expires {new Date(inv.expiresAt * UNIX_MS_MULTIPLIER).toLocaleDateString()}
                </span>
                {inv.usedBy && (
                  <span style={{ color: 'var(--success)', fontSize: '0.8125rem', flexShrink: 0 }}>
                    claimed by {inv.usedBy}
                  </span>
                )}
              </button>

              {/* Expanded body */}
              {isExpanded && (() => {
                const link = buildInviteLink(inv.token);
                return (
                  <div style={{ paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {qrDataUrl && (
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <img src={qrDataUrl} alt="Invite QR code" style={{ borderRadius: 8 }} />
                      </div>
                    )}
                    <div
                      style={{
                        background: 'var(--bg-elevated)',
                        borderRadius: 8,
                        padding: '10px 14px',
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        wordBreak: 'break-all',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {link}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleCopyLink(inv.id, link)}
                      >
                        {copiedId === inv.id ? 'Copied' : 'Copy link'}
                      </button>
                      {SHARE_SUPPORTED && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleShare(link)}
                        >
                          Share
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => navigator.clipboard.writeText(inv.token)}
                      >
                        Copy token
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleRevoke(inv.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                );
              })()}
            </li>
          );
        })}
      </ul>
    </CollapsibleCard>
  );
}
