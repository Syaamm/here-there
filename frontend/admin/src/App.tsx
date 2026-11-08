import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, getPlace, getRefreshToken, loadSession, roleLabel, saveSession, setPlace, setRefreshToken, setToken, setUnauthorizedHandler, STAFF, type Permission, type Role, type Scope, type Session } from './api';
import { AuditPage } from './pages/Audit';
import { ContentPage } from './pages/Content';
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
import { AuthShell } from './AuthShell';
import { Avatar, DialogHost, errMsg, ErrorBanner, Icon, Loading, PageMeta, PopMenu, Tabs, useLoad, type IconName } from './ui';

// ---------------------------------------------------------------- sections and their tabs
type SectionId = 'dashboard' | 'reports' | 'verification' | 'users' | 'content' | 'team' | 'settings' | 'audit';
type Tab = { id: string; label: string; admin?: boolean; regional?: boolean; perm?: Permission };
type Section = { id: SectionId; label: string; icon: IconName; group: string; tabs?: Tab[]; admin?: boolean; regional?: boolean; perm?: Permission };

const SECTIONS: Section[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'overview', group: 'Decide', admin: true },
  { id: 'reports', label: 'Reports', icon: 'flag', group: 'Decide', regional: true, perm: 'reports', tabs: [{ id: 'reports', label: 'Reports', regional: true }, { id: 'appeals', label: 'Appeals', regional: true }, { id: 'noshows', label: 'Attendance', admin: true }] },
  { id: 'verification', label: 'Verification', icon: 'shield', group: 'Decide', regional: true, perm: 'verification' },
  { id: 'users', label: 'Users', icon: 'users', group: 'Community', regional: true, perm: 'users' },
  { id: 'content', label: 'Content', icon: 'layers', group: 'Community', regional: true, perm: 'content' },
  { id: 'team', label: 'Staff', icon: 'userPlus', group: 'Team', admin: true },
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Setup', regional: true, tabs: [{ id: 'places', label: 'Places & limits', regional: true }, { id: 'security', label: 'Two-step sign-in', regional: true }] },
  { id: 'audit', label: 'Audit log', icon: 'clock', group: 'Setup', admin: true },
];

/** What this account may open: an admin everything; staff only the parts of their area an admin allowed. */
const allowed = (role: Role, perms: Permission[]) => {
  const ok = (x: { admin?: boolean; regional?: boolean; perm?: Permission }) => role === 'admin' || (!x.admin && !!x.regional && (!x.perm || perms.includes(x.perm)));
  return SECTIONS.filter(ok)
    .map((s) => ({ ...s, tabs: s.tabs?.filter(ok) }))
    .filter((s) => !s.tabs || s.tabs.length > 0);
};

/** `#/reports/appeals` -> section and tab, so Back and Forward move between pages. */
const readHash = () => {
  const [s, t] = window.location.hash.replace(/^#\/?/, '').split(/[?]/)[0].split('/');
  return { section: (s || 'dashboard') as SectionId, tab: t || '' };
};
const WHOLE_SERVICE = { key: 'all', name: 'Whole service' };

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [loc, setLoc] = useState(readHash);
  const [reportId, setReportId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const go = (section: SectionId, tab = '', replace = false) => {
    try {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', `#/${section}${tab ? '/' + tab : ''}`);
    } catch {
      /* history unavailable: the page still changes */
    }
    setLoc({ section, tab });
  };
  useEffect(() => {
    const onBack = () => setLoc(readHash());
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  const logout = () => {
    if (getRefreshToken()) void api('POST', '/v1/auth/logout', { refreshToken: getRefreshToken() }).catch(() => undefined);
    setToken(null);
    setRefreshToken(null);
    setPlace(null);
    saveSession(null);
    setSession(null);
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* history unavailable */
    }
    setLoc({ section: 'dashboard', tab: '' });
  };
  useEffect(() => setUnauthorizedHandler(logout), []);

  // badges: waiting reports and identity checks this person has not opened yet (remembered in this browser)
  const [open, setOpen] = useState<{ reports: string[]; verifications: string[] } | null>(null);
  const seenKey = `ht_admin_seen:${session?.email ?? ''}`;
  const readSeen = () => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(seenKey) ?? '[]'));
    } catch {
      return new Set<string>();
    }
  };
  const [seen, setSeen] = useState<Set<string>>(readSeen);
  useEffect(() => setSeen(readSeen()), [seenKey]);
  useEffect(() => {
    if (!session) return;
    let live = true;
    const ids = (path: string) => api<{ items: { id: string }[] }>('GET', path).then((r) => r.items.map((x) => x.id), () => [] as string[]);
    const load = () => Promise.all([ids('/v1/admin/reports?status=open'), ids('/v1/admin/verifications?status=pending')]).then(([reports, verifications]) => live && setOpen({ reports, verifications }));
    load();
    const t = setInterval(() => !document.hidden && load(), 6000);
    const back = () => !document.hidden && load();
    document.addEventListener('visibilitychange', back);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', back);
    };
  }, [session]);
  useEffect(() => {
    const ids = loc.section === 'reports' && (loc.tab || 'reports') === 'reports' ? open?.reports : loc.section === 'verification' ? open?.verifications : null;
    if (!ids || ids.every((id) => seen.has(id))) return;
    const next = new Set([...seen, ...ids]);
    setSeen(next);
    try {
      localStorage.setItem(seenKey, JSON.stringify([...next].slice(-500)));
    } catch {
      /* storage unavailable */
    }
  }, [loc, open]);
  const fresh = (ids?: string[]) => (ids ?? []).filter((id) => !seen.has(id)).length;

  if (!session)
    return (
      <>
        <Login onDone={setSession} />
        <DialogHost />
      </>
    );
  return <Console session={session} updateSession={setSession} loc={loc} go={go} reportId={reportId} setReportId={setReportId} userId={userId} setUserId={setUserId} badge={{ reports: fresh(open?.reports), verification: fresh(open?.verifications) }} logout={logout} />;
}

type ConsoleProps = {
  session: Session;
  updateSession: (s: Session) => void;
  loc: { section: SectionId; tab: string };
  go: (section: SectionId, tab?: string, replace?: boolean) => void;
  reportId: string | null;
  setReportId: (id: string | null) => void;
  userId: string | null;
  setUserId: (id: string | null) => void;
  badge: { reports: number; verification: number };
  logout: () => void;
};

function Console({ session: signedIn, updateSession, loc, go, reportId, setReportId, userId, setUserId, badge, logout }: ConsoleProps) {
  const scopeLoad = useLoad(() => api<{ scope: Scope; permissions?: Permission[] }>('GET', '/v1/admin/scope'), [signedIn.token]);
  const session: Session = { ...signedIn, scope: scopeLoad.data?.scope ?? null, permissions: scopeLoad.data?.permissions ?? [] };
  const regional = !!session.scope;
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
    if (scopeLoad.data && !canSwitch && getPlace()) (setPlace(null), setChosen(null));
  }, [scopeLoad.data, canSwitch]);

  const [drawer, setDrawer] = useState(false);
  const [filter, setFilter] = useState('');
  const [passwordChosen, setPasswordChosen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const sections = allowed(session.role, session.permissions ?? []);
  const section = sections.find((s) => s.id === loc.section) ?? sections[0];
  const tab = section.tabs ? (section.tabs.find((t) => t.id === loc.tab) ?? section.tabs[0]).id : '';
  useEffect(() => {
    // an address this account may not open goes to its first page
    if (scopeLoad.data && section.id !== loc.section) go(section.id, '', true);
  }, [scopeLoad.data, section.id, loc.section]);
  useEffect(() => {
    setDrawer(false);
    mainRef.current?.focus({ preventScroll: true });
  }, [loc.section, loc.tab]);
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

  const mfa = useLoad(() => api<{ enabled: boolean; required: boolean; passwordChangeRequired: boolean; setupNeeded: boolean; canSkip: boolean; recoveryCodesLeft: number }>('GET', '/v1/me/mfa'), [session.token]);
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
  if ((!scopeLoad.data && !scopeLoad.error) || (!mfa.data && !mfa.error))
    return (
      <AuthShell headline="Getting your console ready." sub="Your places, queues and reports are loading.">
        <div className="lg-center">
          <Loading label="Loading your console…" />
        </div>
      </AuthShell>
    );

  const openUser = (id: string) => (setUserId(id), go('users'));
  const openReport = (id: string) => (setReportId(id), go('reports', 'reports'));
  const nav = (id: SectionId) => (setReportId(null), setUserId(null), go(id));
  const count = (id: SectionId) => (id === 'reports' ? badge.reports : id === 'verification' ? badge.verification : 0);

  let body: ReactNode = null;
  const key = `${section.id}/${tab}`;
  const fromDashboard = (p: string) => {
    if (p === 'verifications' || p === 'verification') return go('verification');
    if (p === 'noshows' || p === 'appeals') return go('reports', p);
    if (p === 'content') return go('content');
    if (SECTIONS.some((s) => s.id === p)) return go(p as SectionId);
  };
  if (key === 'dashboard/') body = <OverviewPage go={fromDashboard} openReport={openReport} />;
  if (key === 'reports/reports') body = <ReportsPage me={session} openUser={openUser} focusId={reportId} onClearFocus={() => setReportId(null)} />;
  if (key === 'reports/appeals') body = <AppealsPage me={session} openUser={openUser} />;
  if (key === 'reports/noshows') body = <NoShowsPage me={session} openUser={openUser} />;
  if (key === 'verification/') body = <VerificationsPage me={session} />;
  if (key === 'users/') body = <UsersPage me={session} focusId={userId} onClearFocus={() => setUserId(null)} openReport={openReport} />;
  if (key === 'content/') body = <ContentPage me={session} />;
  if (key === 'team/') body = <StaffPage me={session} />;
  if (key === 'settings/places') body = <RegionsPage me={session} />;
  if (key === 'settings/security' && mfa.data) body = <SecurityPage status={mfa.data} onChanged={mfa.reload} />;
  if (key === 'audit/') body = <AuditPage openReport={openReport} />;

  const tabs =
    section.tabs && section.tabs.length > 1 ? (
      <Tabs label={section.label} value={tab} onChange={(t) => (setReportId(null), setUserId(null), go(section.id, t))} options={section.tabs.map((t) => ({ id: t.id, label: t.label, count: t.id === 'reports' ? badge.reports : undefined }))} />
    ) : null;

  const shown = sections.filter((s) => s.label.toLowerCase().includes(filter.trim().toLowerCase()));
  const groups = [...new Set(shown.map((s) => s.group))];
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
              {shown
                .filter((s) => s.group === g)
                .map((s) => (
                  <button key={s.id} className={section.id === s.id ? 'nav active' : 'nav'} aria-current={section.id === s.id ? 'page' : undefined} onClick={() => nav(s.id)}>
                    <Icon name={s.icon} />
                    {s.label}
                    {!!count(s.id) && (
                      <span className={s.id === 'reports' ? 'badge hot' : 'badge'} aria-label={`${count(s.id)} new`}>
                        {count(s.id)}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          ))}
          {shown.length === 0 && <p className="nav-empty">No page matches “{filter}”.</p>}
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
                  {roleLabel(session.role)} · {session.scope ? `${session.scope.name} (${session.scope.kind})` : 'whole service'}
                </span>
              </>
            }
            items={[
              { label: 'Security and two-step sign-in', onSelect: () => go('settings', 'security') },
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
          <PageMeta.Provider value={{ eyebrow: `${section.group} · ${section.label}`, ...(section.tabs ? { title: section.label, tabs } : {}) }}>{body}</PageMeta.Provider>
        </main>
      </div>
      {switching && <PlaceSwitcher current={place.key} onPick={pick} onClose={() => setSwitching(false)} />}
      <DialogHost />
    </div>
  );
}

// ---------------------------------------------------------------- sign-in
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
