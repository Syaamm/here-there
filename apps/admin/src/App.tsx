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
  const [reportId, setReportId] = useState<string | null>(null); // a report opened from the audit log
  const [userId, setUserId] = useState<string | null>(null); // one person opened from a report

  const logout = () => {
    setToken(null);
    saveSession(null);
    setSession(null);
  };
  useEffect(() => setUnauthorizedHandler(logout), []);

  // The orange numbers beside Verification and Reports count what is NEW: waiting items this admin has not looked at yet.
  // Opening the page marks everything on it as seen in the same instant, and the badge is gone. Which items were seen is
  // remembered in this browser, per signed-in person.
  const [open, setOpen] = useState<{ reports: string[]; verifications: string[] } | null>(null);
  const seenKey = `ht_admin_seen:${session?.email ?? ''}`;
  const [seen, setSeen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(seenKey) ?? '[]'));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    // signing in as someone else brings back that person's own list of what they have seen
    try {
      setSeen(new Set(JSON.parse(localStorage.getItem(seenKey) ?? '[]')));
    } catch {
      setSeen(new Set());
    }
  }, [seenKey]);
  useEffect(() => {
    if (!session) return;
    let live = true;
    const load = () =>
      Promise.all([api<{ items: { id: string }[] }>('GET', '/v1/admin/reports?status=open'), api<{ items: { id: string }[] }>('GET', '/v1/admin/verifications?status=pending')]).then(
        ([r, v]) => live && setOpen({ reports: r.items.map((x) => x.id), verifications: v.items.map((x) => x.id) }),
        () => {},
      );
    load();
    const t = setInterval(() => !document.hidden && load(), 6000); // a new entry shows up within seconds
    const back = () => !document.hidden && load(); // and straight away when the admin comes back to this tab
    document.addEventListener('visibilitychange', back);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', back);
    };
  }, [session]);
  // looking at a page marks its entries seen, including ones that arrive while it is open
  useEffect(() => {
    const ids = page === 'reports' ? open?.reports : page === 'verifications' ? open?.verifications : null;
    if (!ids || ids.every((id) => seen.has(id))) return;
    const next = new Set([...seen, ...ids]);
    setSeen(next);
    try {
      localStorage.setItem(seenKey, JSON.stringify([...next].slice(-500)));
    } catch {
      /* storage unavailable: the badge just comes back next visit */
    }
  }, [page, open]);
  const fresh = (ids?: string[]) => (ids ?? []).filter((id) => !seen.has(id)).length;

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
            const badge = n.id === 'verifications' ? fresh(open?.verifications) : n.id === 'reports' ? fresh(open?.reports) : 0;
            return (
              <button key={n.id} className={page === n.id ? 'nav active' : 'nav'} aria-current={page === n.id ? 'page' : undefined} onClick={() => (setReportId(null), setUserId(null), setPage(n.id))}>
                <Icon name={n.icon} />
                {n.label}
                {!!badge && (
                  <span className="badge" aria-label={`${badge} new`}>
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
        {page === 'reports' && <ReportsPage me={session} openUser={(id) => (setUserId(id), setPage('users'))} focusId={reportId} onClearFocus={() => setReportId(null)} />}
        {page === 'content' && <ContentPage me={session} />}
        {page === 'users' && <UsersPage me={session} focusId={userId} onClearFocus={() => setUserId(null)} openReport={(id) => (setReportId(id), setPage('reports'))} />}
        {page === 'audit' && can.trust(session.role) && <AuditPage openReport={(id) => (setReportId(id), setPage('reports'))} />}
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
