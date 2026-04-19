import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './api/client';
import Login from './pages/Login';
import DataEntry from './pages/DataEntry';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import WorkspaceInvitePage from './pages/WorkspaceInvitePage';

function ProtectedRoute({ element }: { element: React.ReactElement }) {
  return isAuthenticated() ? element : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/workspace-invite" element={<WorkspaceInvitePage />} />
        <Route path="/data-entry" element={<ProtectedRoute element={<DataEntry />} />} />
        <Route path="/dashboard" element={<ProtectedRoute element={<Dashboard />} />} />
        <Route path="/settings" element={<ProtectedRoute element={<Settings />} />} />
        <Route path="*" element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
}
