import { Link, useLocation, useNavigate } from 'react-router-dom';
import { logout } from '../../api/client';
import Logo from '../Logo';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const path = location.pathname;

  return (
    <div className="page-wrapper">
      <nav className="navbar">
        <div className="container">
          <span className="navbar-brand">
            <Logo size={22} />
            Finastic
          </span>
          <div className="navbar-links">
            <Link to="/data-entry" className={`nav-link ${path === '/data-entry' ? 'active' : ''}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              Enter Data
            </Link>
            <Link to="/dashboard" className={`nav-link ${path === '/dashboard' ? 'active' : ''}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Dashboard
            </Link>
            <button onClick={handleLogout} className="nav-link nav-link-logout">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main style={{ flex: 1, padding: '32px 0' }}>
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
