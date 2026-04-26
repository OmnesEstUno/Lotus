import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { getWorkspaceInviteMeta, acceptWorkspaceInvite } from '../api/client';
import Logo from '../components/Logo';
import { STORAGE_KEYS, UNIX_MS_MULTIPLIER } from '../utils/constants';

interface InviteMeta {
  instanceName: string;
  ownerUsername: string;
  expiresAt: number;
  usedBy: string | null;
  alreadyMember: boolean;
}

export default function WorkspaceInvitePage() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const { refresh, switchTo } = useWorkspaces();

  const [token, setToken] = useState<string | null>(null);
  const [meta, setMeta] = useState<InviteMeta | null>(null);
  const [metaError, setMetaError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [actionError, setActionError] = useState('');

  // Parse token from hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/[?&]token=([^&]+)/);
    if (!match) {
      navigate('/dashboard');
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(match[1]);
    } catch {
      navigate('/dashboard');
      return;
    }
    setToken(decoded);

    // If not logged in, stash the token and redirect to login
    if (!currentUser) {
      sessionStorage.setItem(STORAGE_KEYS.PENDING_WORKSPACE_INVITE, decoded);
      window.location.hash = '#/login';
      return;
    }
  }, []);

  // Once we have a token and are logged in, fetch metadata
  useEffect(() => {
    if (!token || !currentUser) return;
    setLoading(true);
    getWorkspaceInviteMeta(token)
      .then((data) => { setMeta(data); setLoading(false); })
      .catch((err) => { setMetaError((err as Error).message); setLoading(false); });
  }, [token, currentUser]);

  async function handleAccept() {
    if (!token) return;
    setAccepting(true);
    setActionError('');
    try {
      const result = await acceptWorkspaceInvite(token);
      sessionStorage.removeItem(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
      await refresh();
      await switchTo(result.id);
      navigate('/dashboard');
    } catch (err) {
      setActionError((err as Error).message);
      setAccepting(false);
    }
  }

  function handleDecline() {
    sessionStorage.removeItem(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
    navigate('/dashboard');
  }

  function handleNavigateToWorkspace() {
    sessionStorage.removeItem(STORAGE_KEYS.PENDING_WORKSPACE_INVITE);
    navigate('/dashboard');
  }

  if (!currentUser) {
    return (
      <div className="login-page">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
          <p style={{ color: 'var(--text-muted)' }}>Redirecting to login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Logo size={56} color="var(--accent)" style={{ margin: '0 auto 12px' }} />
          <h1 style={{ fontSize: '1.5rem' }}>Workspace Invite</h1>
        </div>

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div className="spinner" style={{ width: 24, height: 24 }} />
            <p style={{ color: 'var(--text-muted)' }}>Checking invite…</p>
          </div>
        )}

        {!loading && metaError && (
          <div className="alert alert-danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {metaError}
          </div>
        )}

        {!loading && meta && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', padding: '16px 20px' }}>
              <p style={{ margin: '0 0 12px', fontSize: '1.05rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                Join workspace <strong style={{ color: 'var(--accent)' }}>{meta.instanceName}</strong>?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                <span>Owner: <strong style={{ color: 'var(--text-primary)' }}>{meta.ownerUsername}</strong></span>
                <span>Expires: {new Date(meta.expiresAt * UNIX_MS_MULTIPLIER).toLocaleDateString()}</span>
              </div>
            </div>

            {actionError && (
              <div className="alert alert-danger">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {actionError}
              </div>
            )}

            {meta.alreadyMember ? (
              <>
                <div className="alert alert-success">
                  You're already a member of this workspace.
                </div>
                <button type="button" className="btn btn-primary w-full" onClick={handleNavigateToWorkspace}>
                  Go to dashboard
                </button>
              </>
            ) : meta.usedBy && meta.usedBy !== currentUser ? (
              <>
                <div className="alert alert-danger">
                  This invite has already been used by <strong>{meta.usedBy}</strong>.
                </div>
                <button type="button" className="btn btn-ghost w-full" onClick={handleDecline}>
                  Back to dashboard
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={handleAccept}
                  disabled={accepting}
                >
                  {accepting ? <span className="spinner" /> : 'Accept'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost w-full"
                  onClick={handleDecline}
                  disabled={accepting}
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
