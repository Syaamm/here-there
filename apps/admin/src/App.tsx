import { useEffect, useState, type FormEvent } from 'react';
import { api, can, getPlace, getRefreshToken, loadSession, saveSession, setPlace, setRefreshToken, setToken, setUnauthorizedHandler, STAFF, type Role, type Scope, type Session } from './api';
import { AuditPage } from './pages/Audit';
import { ContentPage } from './pages/Content';
import { AppealsPage } from './pages/Appeals';
import { NoShowsPage } from './pages/NoShows';
import { OverviewPage } from './pages/Overview';
import { PlacePicker } from './pages/PlacePicker';
import { RegionsPage } from './pages/Regions';
import { ReportsPage } from './pages/Reports';
import { SecurityPage } from './pages/Security';
import { UsersPage } from './pages/Users';
import { VerificationsPage } from './pages/Verifications';
import { Avatar, DialogHost, errMsg, ErrorBanner, Icon, useLoad, type IconName } from './ui';

type PageId = 'overview' | 'verifications' | 'reports' | 'noshows' | 'appeals' | 'content' | 'users' | 'audit' | 'security' | 'regions';
/** `regional`: staff who look after one city, region or country may open it. Everything else is for staff of the whole service. */
const NAV: { id: PageId; label: string; icon: IconName; show: (r: Role) => boolean; regional?: boolean }[] = [
  { id: 'overview', label: 'Overview', icon: 'overview', show: () => true },
  { id: 'verifications', label: 'Verification', icon: 'shield', show: () => true },
  { id: 'reports', label: 'Reports', icon: 'flag', show: () => true, regional: true },
  { id: 'noshows', label: 'No-shows', icon: 'alert', show: () => true },
  { id: 'appeals', label: 'Appeals', icon: 'alert', show: () => true },
  { id: 'content', label: 'Content', icon: 'layers', show: () => true, regional: true },
  { id: 'users', label: 'Users', icon: 'users', show: () => true, regional: true },
  { id: 'regions', label: 'Places & limits', icon: 'plane', show: () => true, regional: true },
  { id: 'audit', label: 'Audit log', icon: 'clock', show: can.trust },
  { id: 'security', label: 'Security', icon: 'key', show: () => true },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [page, setPage] = useState<PageId>('overview');
  const [reportId, setReportId] = useState<string | null>(null); // a report opened from the audit log
  const [userId, setUserId] = useState<string | null>(null); // one person opened from a report

  const logout = () => {
    // also ends this sign-in on the server (best effort)
    if (getRefreshToken()) void api('POST', '/v1/auth/logout', { refreshToken: getRefreshToken() }).catch(() => undefined);
    setToken(null);
    setRefreshToken(null);
    setPlace(null); // the next sign-in asks again where to work
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
    // each list on its own: staff who look after one area may not read the verification list, and that must not hide the reports
    const ids = (path: string) => api<{ items: { id: string }[] }>('GET', path).then((r) => r.items.map((x) => x.id), () => [] as string[]);
    const load = () => Promise.all([ids('/v1/admin/reports?status=open'), ids('/v1/admin/verifications?status=pending')]).then(([reports, verifications]) => live && setOpen({ reports, verifications }));
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

  return <Console session={session} page={page} setPage={setPage} setReportId={setReportId} setUserId={setUserId} reportId={reportId} userId={userId} fresh={fresh} open={open} logout={logout} />;
}

type ConsoleProps = {
  session: Session;
  page: PageId;
  setPage: (p: PageId) => void;
  reportId: string | null;
  setReportId: (id: string | null) => void;
  userId: string | null;
  setUserId: (id: string | null) => void;
  fresh: (ids?: string[]) => number;
  open: { reports: string[]; verifications: string[] } | null;
  logout: () => void;
};

function Console({ session: signedIn, page, setPage, reportId, setReportId, userId, setUserId, fresh, open, logout }: ConsoleProps) {
  // which part of the service this account looks after (asked once; staff of the whole service have none)
  const scopeLoad = useLoad(() => api<{ scope: Scope }>('GET', '/v1/admin/scope'), [signedIn.token]);
  const session: Session = { ...signedIn, scope: scopeLoad.data?.scope ?? null };
  const regional = !!session.scope;
  // where this person chose to work (asked right after signing in)
  const [place, setPlaceState] = useState(getPlace);
  const pick = (key: string, name: string) => (setPlace({ key, name }), setPlaceState({ key, name }));
  const changePlace = () => (setPlace(null), setPlaceState(null));
  useEffect(() => {
    // a staff account with an area has no overview: it starts at the reports
    if (regional && !NAV.find((n) => n.id === page)?.regional) setPage('reports');
  }, [regional, page]);
  // two-step sign-in: where it is required and not yet set up, nothing else opens until it is
  const mfa = useLoad(() => api<{ enabled: boolean; required: boolean; recoveryCodesLeft: number }>('GET', '/v1/me/mfa'), [session.token]);
  if (mfa.data && mfa.data.required && !mfa.data.enabled)
    return (
      <div className="login-wrap" style={{ alignItems: 'start' }}>
        <div style={{ width: 'min(560px, 100%)', display: 'grid', gap: 12, paddingTop: 40 }}>
          <SecurityPage status={mfa.data} onChanged={mfa.reload} forced />
          <button className="btn" onClick={logout}>
            Sign out
          </button>
        </div>
        <DialogHost />
      </div>
    );

  if (!scopeLoad.data && !scopeLoad.error) return <div className="login-wrap"><p className="muted">Loading…</p></div>;
  if (!place) return <PlacePicker me={session} onPick={pick} onSignOut={logout} />;
  const nav = NAV.filter((n) => n.show(session.role) && (!regional || n.regional));
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          HERE<span>.</span> / THERE<span>.</span>
          <small>Admin console</small>
        </div>
        <div className="working-in">
          <span className="muted small">Working in</span>
          <strong>{place.key === 'all' ? 'Whole service' : place.name}</strong>
          <button className="link small" onClick={changePlace}>
            Change
          </button>
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
            <div className="mail" title="The part of the service this account looks after">
              {session.scope ? `${session.scope.name} · ${session.scope.kind}` : 'Whole service'}
            </div>
          </div>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main className="main">
        {place.key !== 'all' && ['overview', 'noshows', 'appeals', 'audit'].includes(page) && (
          <p className="note">
            This page always shows the whole service, not only {place.name}. Members, reports, content and identity checks are limited to {place.name}.
          </p>
        )}
        {page === 'overview' && <OverviewPage go={(p) => setPage(p as PageId)} openReport={(id) => (setReportId(id), setPage('reports'))} />}
        {page === 'verifications' && <VerificationsPage me={session} />}
        {page === 'reports' && <ReportsPage me={session} openUser={(id) => (setUserId(id), setPage('users'))} focusId={reportId} onClearFocus={() => setReportId(null)} />}
        {page === 'appeals' && <AppealsPage me={session} openUser={(id) => (setUserId(id), setPage('users'))} />}
        {page === 'noshows' && <NoShowsPage me={session} openUser={(id) => (setUserId(id), setPage('users'))} />}
        {page === 'content' && <ContentPage me={session} />}
        {page === 'users' && <UsersPage me={session} focusId={userId} onClearFocus={() => setUserId(null)} openReport={(id) => (setReportId(id), setPage('reports'))} />}
        {page === 'audit' && can.trust(session.role) && <AuditPage openReport={(id) => (setReportId(id), setPage('reports'))} />}
        {page === 'regions' && <RegionsPage me={session} />}
        {page === 'security' && mfa.data && <SecurityPage status={mfa.data} onChanged={mfa.reload} />}
      </main>
      <DialogHost />
    </div>
  );
}

type LoginReply = { token?: string; refreshToken?: string; mfaRequired?: boolean; mfaToken?: string; user?: { email: string; role: Role; profile?: { displayName: string } } };

function Login({ onDone }: { onDone: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ mfaToken: string } | null>(null); // the password was right: now the code
  const [code, setCode] = useState('');

  const finish = (r: LoginReply) => {
    if (!r.token || !r.user) throw new Error('Sign-in failed.');
    if (!STAFF.includes(r.user.role)) throw new Error('This account does not have staff access.');
    const s: Session = { token: r.token, refreshToken: r.refreshToken, email: r.user.email, role: r.user.role, name: r.user.profile?.displayName ?? r.user.email };
    setToken(s.token);
    setRefreshToken(s.refreshToken ?? null);
    saveSession(s);
    onDone(s);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step) {
        finish(await api<LoginReply>('POST', '/v1/auth/mfa/verify', { mfaToken: step.mfaToken, code }));
      } else {
        const r = await api<LoginReply>('POST', '/v1/auth/login', { email, password });
        if (r.mfaRequired && r.mfaToken) {
          setStep({ mfaToken: r.mfaToken });
          setPassword('');
        } else finish(r);
      }
    } catch (err) {
      setError(errMsg(err));
      if (step && /took too long/i.test(errMsg(err))) setStep(null); // the pass expired: start again
    } finally {
      setBusy(false);
    }
  };

  if (step)
    return (
      <div className="login-wrap">
        <form className="login card" onSubmit={submit}>
          <div className="brand">
            HERE<span>.</span> / THERE<span>.</span>
            <small>Admin console</small>
          </div>
          <ErrorBanner message={error} />
          <p className="muted">Open your authenticator app and type the 6-digit code for HERE &amp; THERE. Lost your phone? Use one of your recovery codes instead.</p>
          <label>
            Code
            <input inputMode="text" autoComplete="one-time-code" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy || code.trim().length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button type="button" className="btn small" onClick={() => (setStep(null), setCode(''), setError(null))}>
            Back
          </button>
        </form>
      </div>
    );

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
