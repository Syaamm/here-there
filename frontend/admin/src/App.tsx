import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, can, getPlace, getRefreshToken, loadSession, saveSession, setPlace, setRefreshToken, setToken, setUnauthorizedHandler, STAFF, type Role, type Scope, type Session } from './api';
import { AuditPage } from './pages/Audit';
import { ContentPage } from './pages/Content';
import { OnCallPage } from './pages/OnCall';
import { AppealsPage } from './pages/Appeals';
import { NoShowsPage } from './pages/NoShows';
import { OverviewPage } from './pages/Overview';
import { ChoosePassword } from './pages/ChoosePassword';
import { PlaceSwitcher } from './pages/PlacePicker';
import { RegionsPage } from './pages/Regions';
import { ReportsPage } from './pages/Reports';
import { SecurityPage } from './pages/Security';
import { StaffPage } from './pages/Staff';
import { UsersPage } from './pages/Users';
import { VerificationsPage } from './pages/Verifications';
import './Login.css';
import { AuthShell } from './AuthShell';
import { Avatar, DialogHost, errMsg, ErrorBanner, Icon, Loading, PageMeta, PopMenu, useLoad, type IconName } from './ui';

type PageId = 'overview' | 'verifications' | 'reports' | 'noshows' | 'appeals' | 'content' | 'users' | 'staff' | 'oncall' | 'audit' | 'security' | 'regions';
/** `regional`: staff who look after one city, region or country may open it. Everything else is for staff of the whole service. */
const NAV: { id: PageId; label: string; icon: IconName; group: string; show: (r: Role) => boolean; regional?: boolean }[] = [
  { id: 'overview', label: 'Today', icon: 'overview', group: 'Decide', show: () => true },
  { id: 'reports', label: 'Reports', icon: 'flag', group: 'Decide', show: () => true, regional: true },
  { id: 'verifications', label: 'Verification', icon: 'shield', group: 'Decide', show: () => true },
  { id: 'appeals', label: 'Appeals', icon: 'alert', group: 'Decide', show: () => true },
  { id: 'noshows', label: 'No-shows', icon: 'clock', group: 'Decide', show: () => true },
  { id: 'users', label: 'Users', icon: 'users', group: 'Community', show: () => true, regional: true },
  { id: 'content', label: 'Content', icon: 'layers', group: 'Community', show: () => true, regional: true },
  { id: 'staff', label: 'Staff', icon: 'userPlus', group: 'Team', show: can.admin },
  { id: 'oncall', label: 'On-call', icon: 'bell', group: 'Team', show: () => true },
  { id: 'regions', label: 'Places & limits', icon: 'plane', group: 'Setup', show: () => true, regional: true },
  { id: 'security', label: 'Security', icon: 'key', group: 'Setup', show: () => true },
  { id: 'audit', label: 'Audit log', icon: 'clock', group: 'Setup', show: can.trust },
];

/** The page named in the address (`/admin/#/reports`), so the browser's Back and Forward buttons move between the console's pages. */
const pageFromHash = (): PageId => {
  const id = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] as PageId;
  return NAV.some((n) => n.id === id) ? id : 'overview';
};
const WHOLE_SERVICE = { key: 'all', name: 'Whole service' };

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [page, setPageState] = useState<PageId>(pageFromHash);
  const [reportId, setReportId] = useState<string | null>(null); // a report opened from the audit log
  const [userId, setUserId] = useState<string | null>(null); // one person opened from a report

  // Each page the person opens is one step in the browser's history, so Back goes to the page before instead of leaving the
  // console. `replace` is for automatic moves (a page this account may not open), which must not add a step.
  const setPage = (p: PageId, replace = false) => {
    if (p === pageFromHash() && p === page) return;
    try {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', `#/${p}`);
    } catch {
      /* history unavailable: the page still changes */
    }
    setPageState(p);
  };
  useEffect(() => {
    const onBack = () => setPageState(pageFromHash());
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  const logout = () => {
    // also ends this sign-in on the server (best effort)
    if (getRefreshToken()) void api('POST', '/v1/auth/logout', { refreshToken: getRefreshToken() }).catch(() => undefined);
    setToken(null);
    setRefreshToken(null);
    setPlace(null); // the next sign-in starts in the whole service again
    saveSession(null);
    setSession(null);
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search); // the next person starts on the first page
    } catch {
      /* history unavailable */
    }
    setPageState('overview');
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

  return <Console session={session} updateSession={setSession} page={page} setPage={setPage} setReportId={setReportId} setUserId={setUserId} reportId={reportId} userId={userId} fresh={fresh} open={open} logout={logout} />;
}

type ConsoleProps = {
  session: Session;
  updateSession: (s: Session) => void;
  page: PageId;
  setPage: (p: PageId, replace?: boolean) => void;
  reportId: string | null;
  setReportId: (id: string | null) => void;
  userId: string | null;
  setUserId: (id: string | null) => void;
  fresh: (ids?: string[]) => number;
  open: { reports: string[]; verifications: string[] } | null;
  logout: () => void;
};

function Console({ session: signedIn, updateSession, page, setPage, reportId, setReportId, userId, setUserId, fresh, open, logout }: ConsoleProps) {
  // which part of the service this account looks after (asked once; staff of the whole service have none)
  const scopeLoad = useLoad(() => api<{ scope: Scope }>('GET', '/v1/admin/scope'), [signedIn.token]);
  const session: Session = { ...signedIn, scope: scopeLoad.data?.scope ?? null };
  const regional = !!session.scope;
  // Nobody is asked where to work. Everyone starts in the whole service (staff with an area are kept inside it by the server).
  // Only the administrator of the whole service can move around: "Switch" in the sidebar opens the list of countries and cities.
  const canSwitch = session.role === 'admin' && !regional;
  const [chosen, setChosen] = useState(getPlace);
  const place = canSwitch && chosen ? chosen : WHOLE_SERVICE;
  const [switching, setSwitching] = useState(false);
  const pick = (key: string, name: string) => {
    const next = key === 'all' ? null : { key, name };
    setPlace(next);
    setChosen(next);
    setSwitching(false);
  };
  useEffect(() => {
    // an account that cannot switch never carries a place along (the server would refuse one outside its area)
    if (scopeLoad.data && !canSwitch && getPlace()) (setPlace(null), setChosen(null));
  }, [scopeLoad.data, canSwitch]);
  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState('');
  // once the person has chosen their own password the console must not ask again while the new sign-in is being loaded
  const [passwordChosen, setPasswordChosen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // a page this account may not open (an old link, or Back after signing in as someone else) goes to its own first page
    const cur = NAV.find((n) => n.id === page);
    if (cur && !cur.show(session.role)) setPage(regional ? 'reports' : 'overview', true);
    // a staff account with an area has no overview: it starts at the reports
    else if (regional && !cur?.regional) setPage('reports', true);
  }, [regional, page, session.role]);
  useEffect(() => {
    // keyboard users land on the new page, not back at the top of the menu
    setDrawer(false);
    mainRef.current?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false);
      if ((e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setDrawer(true);
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  // two-step sign-in: right after the first sign-in, a staff account without an authenticator sets one up before anything else opens
  const mfa = useLoad(() => api<{ enabled: boolean; required: boolean; passwordChangeRequired: boolean; setupNeeded: boolean; canSkip: boolean; recoveryCodesLeft: number }>('GET', '/v1/me/mfa'), [session.token]);
  // an account an administrator made starts with a temporary password: its owner chooses their own first, once, before anything else
  if (mfa.data?.passwordChangeRequired && !passwordChosen)
    return (
      <>
        <ChoosePassword
          session={signedIn}
          onDone={(s) => {
            setPasswordChosen(true);
            updateSession(s);
          }}
          onSignOut={logout}
        />
        <DialogHost />
      </>
    );
  if (mfa.data && mfa.data.setupNeeded)
    return (
      <>
        <AuthShell headline="One more step to keep it secure." sub="A code from your phone protects the console, and everyone's data in it, if a password is ever stolen.">
          <div className="lg-card lg-wide">
            <SecurityPage status={mfa.data} onChanged={mfa.reload} forced />
            <button type="button" className="lg-link" onClick={logout}>
              Sign out
            </button>
          </div>
        </AuthShell>
        <DialogHost />
      </>
    );

  // wait for both answers, so the console never flashes open before a password or two-step screen that has to come first
  if ((!scopeLoad.data && !scopeLoad.error) || (!mfa.data && !mfa.error))
    return (
      <AuthShell headline="Getting your console ready." sub="Your places, queues and reports are loading.">
        <div className="lg-center">
          <Loading label="Loading your console…" />
        </div>
      </AuthShell>
    );
  const nav = NAV.filter((n) => n.show(session.role) && (!regional || n.regional) && n.label.toLowerCase().includes(filter.trim().toLowerCase()));
  const groups = [...new Set(nav.map((n) => n.group))];
  const here = NAV.find((n) => n.id === page);
  const go = (id: PageId) => (setReportId(null), setUserId(null), setPage(id));
  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), mainRef.current?.focus())}>
        Skip to content
      </a>
      <aside className={drawer ? 'side open' : 'side'} aria-label="Sidebar">
        <div className="brand">
          HERE<span>.</span> / THERE<span>.</span>
        </div>
        <label className="side-search">
          <span className="sr">Search or jump to a page (Ctrl K)</span>
          <Icon name="search" />
          <input ref={searchRef} type="search" placeholder="Search or jump to" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <kbd aria-hidden="true">Ctrl K</kbd>
        </label>
        <nav aria-label="Main">
          {groups.map((g) => (
            <div key={g} style={{ display: 'contents' }}>
              <div className="nav-group">{g}</div>
              {nav
                .filter((n) => n.group === g)
                .map((n) => {
                  const badge = n.id === 'verifications' ? fresh(open?.verifications) : n.id === 'reports' ? fresh(open?.reports) : n.id === 'overview' ? fresh(open?.reports) + fresh(open?.verifications) : 0;
                  return (
                    <button key={n.id} className={page === n.id ? 'nav active' : 'nav'} aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                      <Icon name={n.icon} />
                      {n.label}
                      {!!badge && (
                        <span className={n.id === 'reports' ? 'badge hot' : n.id === 'overview' ? 'badge light' : 'badge'} aria-label={`${badge} new`}>
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
          {nav.length === 0 && <p className="nav-empty">No page matches “{filter}”.</p>}
        </nav>
        <div className="side-foot">
          {canSwitch && (
            <button className="working-btn" onClick={() => setSwitching(true)} title="Switch to another country, region or city">
              <span className="where">
                <small>Working in</small>
                <strong>{place.name}</strong>
              </span>
              <span className="switch">Switch</span>
            </button>
          )}
          <PopMenu
            label="Your account"
            buttonClass="side-user"
            align="start"
            trigger={
              <>
                <Avatar name={session.name} />
                <span className="info">
                  <b>{session.name}</b>
                  <span>{session.email}</span>
                </span>
              </>
            }
            header={
              <>
                <strong>{session.name}</strong>
                <span className="muted small">
                  {session.role.replace('_', ' ')} · {session.scope ? `${session.scope.name} (${session.scope.kind})` : 'whole service'}
                </span>
              </>
            }
            items={[
              { label: 'Security and two-step sign-in', onSelect: () => go('security') },
              { label: 'Sign out', danger: true, onSelect: logout },
            ]}
          />
        </div>
      </aside>
      <div className={drawer ? 'scrim show' : 'scrim'} onClick={() => setDrawer(false)} aria-hidden="true" />
      <div className="workspace">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open the menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
          <div className="brand">
            HERE<span>.</span> / THERE<span>.</span>
          </div>
        </header>
        <main className="main" id="main" ref={mainRef} tabIndex={-1}>
          <PageMeta.Provider value={{ eyebrow: here ? `${here.group} · ${here.label}` : undefined }}>
          {place.key !== 'all' && ['overview', 'noshows', 'appeals', 'audit'].includes(page) && (
            <p className="note" style={{ marginBottom: 14 }}>
              This page always shows the whole service, not only {place.name}. Members, reports, content and identity checks are limited to {place.name}.
            </p>
          )}
          {page === 'overview' && <OverviewPage go={(p) => setPage(p as PageId)} openReport={(id) => (setReportId(id), setPage('reports'))} />}
          {page === 'verifications' && <VerificationsPage me={session} />}
          {page === 'reports' && <ReportsPage me={session} openUser={(id) => (setUserId(id), setPage('users'))} focusId={reportId} onClearFocus={() => setReportId(null)} onCall={() => go('oncall')} />}
          {page === 'appeals' && <AppealsPage me={session} openUser={(id) => (setUserId(id), setPage('users'))} />}
          {page === 'noshows' && <NoShowsPage me={session} openUser={(id) => (setUserId(id), setPage('users'))} />}
          {page === 'content' && <ContentPage me={session} />}
          {page === 'users' && <UsersPage me={session} focusId={userId} onClearFocus={() => setUserId(null)} openReport={(id) => (setReportId(id), setPage('reports'))} />}
          {page === 'staff' && can.admin(session.role) && <StaffPage me={session} />}
          {page === 'audit' && can.trust(session.role) && <AuditPage openReport={(id) => (setReportId(id), setPage('reports'))} />}
          {page === 'regions' && <RegionsPage me={session} />}
          {page === 'oncall' && <OnCallPage me={session} />}
          {page === 'security' && mfa.data && <SecurityPage status={mfa.data} onChanged={mfa.reload} />}
          </PageMeta.Provider>
        </main>
      </div>
      {switching && <PlaceSwitcher current={place.key} onPick={pick} onClose={() => setSwitching(false)} />}
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
  const [showPw, setShowPw] = useState(false);

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

  const eye = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {showPw ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c5 0 8.5 4.2 9.5 6a11 11 0 0 1-2.6 3.1M6.3 7.6A11 11 0 0 0 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      ) : (
        <>
          <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );

  if (step)
    return (
      <AuthShell headline="Almost there." sub="Type the code from your authenticator app to finish signing in.">
        <form className="lg-card" onSubmit={submit}>
          <p className="lg-card-eyebrow">Two-step sign-in</p>
          <h1 className="lg-title">Enter your code</h1>
          <p className="lg-sub">Open your authenticator app and type the 6-digit code for HERE &amp; THERE. Lost your phone? Use one of your recovery codes instead.</p>
          <ErrorBanner message={error} />
          <label className="lg-field lg-code">
            Code
            <input inputMode="text" autoComplete="one-time-code" placeholder="000000" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="lg-btn" disabled={busy || code.trim().length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
            {!busy && <Icon name="arrow" />}
          </button>
          <button type="button" className="lg-link" onClick={() => (setStep(null), setCode(''), setError(null))}>
            Back
          </button>
        </form>
      </AuthShell>
    );

  return (
    <AuthShell headline="Keep every meet-up safe and fair." sub="Reports, identity checks and appeals get decided here, calmly and on the record.">
      <form className="lg-card" onSubmit={submit}>
        <p className="lg-card-eyebrow">Welcome back</p>
        <h1 className="lg-title">Staff sign-in</h1>
        <ErrorBanner message={error} />
        <div className="lg-form">
          <label className="lg-field">
            Email
            <input type="email" autoComplete="username" placeholder="you@herethere.local" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="lg-field">
            Password
            <span className="lg-pass">
              <input type={showPw ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="lg-eye" onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>
                {eye}
              </button>
            </span>
          </label>
        </div>
        <button className="lg-btn" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
          {!busy && <Icon name="arrow" />}
        </button>
        <p className="lg-note">Staff accounts only. Every action you take is recorded in the audit log.</p>
      </form>
    </AuthShell>
  );
}
