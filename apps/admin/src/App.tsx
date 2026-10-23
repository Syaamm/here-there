import { useEffect, useState, type FormEvent } from 'react';
import { api, can, loadSession, saveSession, setToken, setUnauthorizedHandler, STAFF, type Role, type Session } from './api';
import { AuditPage } from './pages/Audit';
import { ContentPage } from './pages/Content';
import { OverviewPage } from './pages/Overview';
import { ReportsPage } from './pages/Reports';
import { UsersPage } from './pages/Users';
import { VerificationsPage } from './pages/Verifications';
import { Avatar, DialogHost, errMsg, ErrorBanner, Icon, type IconName } from './ui';

type PageId = 'overview' | 'verifications' | 'reports' | 'content' | 'users' | 'audit';
const NAV: { id: PageId; label: string; icon: IconName; show: (r: Role) => boolean }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', show: () => true },
  { id: 'verifications', label: 'Verification', icon: 'shield', show: () => true },
  { id: 'reports', label: 'Reports', icon: 'flag', show: () => true },
  { id: 'content', label: 'Content', icon: 'layers', show: () => true },
  { id: 'users', label: 'Users', icon: 'users', show: () => true },
  { id: 'audit', label: 'Audit log', icon: 'clock', show: can.trust },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [page, setPage] = useState<PageId>('overview');

  const logout = () => {
    setToken(null);
    saveSession(null);
    setSession(null);
  };
  useEffect(() => setUnauthorizedHandler(logout), []);

  // the orange numbers beside Verification and Reports: what is waiting for a decision
  const [counts, setCounts] = useState<{ pendingVerifications: number; openReports: number } | null>(null);
  useEffect(() => {
    if (!session) return;
    const load = () => api<{ pendingVerifications: number; openReports: number }>('GET', '/v1/admin/overview').then(setCounts, () => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [session, page]);

  if (!session)
    return (
      <>
        <Login onDone={setSession} />
        <DialogHost />
      </>
    );

  const nav = NAV.filter((n) => n.show(session.role));
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          HERE<span>.</span> / THERE<span>.</span>
          <small>Admin console</small>
        </div>
        <nav aria-label="Main">
          {nav.map((n) => {
            const badge = n.id === 'verifications' ? counts?.pendingVerifications : n.id === 'reports' ? counts?.openReports : 0;
            return (
              <button key={n.id} className={page === n.id ? 'nav active' : 'nav'} aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}>
                <Icon name={n.icon} />
                {n.label}
                {!!badge && (
                  <span className="badge" aria-label={`${badge} waiting`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="who">
          <Avatar name={session.name} />
          <div className="info">
            <div className="name">{session.name}</div>
            <div className="mail" title={`${session.email} · ${session.role.replace('_', ' ')}`}>
              {session.email}
            </div>
          </div>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main className="main">
        {page === 'overview' && <OverviewPage go={(p) => setPage(p as PageId)} />}
        {page === 'verifications' && <VerificationsPage me={session} />}
        {page === 'reports' && <ReportsPage me={session} go={(p) => setPage(p as PageId)} />}
        {page === 'content' && <ContentPage me={session} />}
        {page === 'users' && <UsersPage me={session} />}
        {page === 'audit' && can.trust(session.role) && <AuditPage />}
      </main>
      <DialogHost />
    </div>
  );
}

function Login({ onDone }: { onDone: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: { email: string; role: Role; profile?: { displayName: string } } }>('POST', '/v1/auth/login', { email, password });
      if (!STAFF.includes(r.user.role)) throw new Error('This account does not have staff access.');
      const s: Session = { token: r.token, email: r.user.email, role: r.user.role, name: r.user.profile?.displayName ?? r.user.email };
      setToken(s.token);
      saveSession(s);
      onDone(s);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit}>
        <div className="brand">
          HERE<span>.</span> / THERE<span>.</span>
          <small>Admin console</small>
        </div>
        <ErrorBanner message={error} />
        <label>
          Email
          <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">Staff accounts only. Every action you take is recorded in the audit log.</p>
      </form>
    </div>
  );
}
