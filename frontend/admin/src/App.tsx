import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, getPlace, getRefreshToken, loadSession, roleLabel, saveSession, setPlace, setRefreshToken, setToken, setUnauthorizedHandler, STAFF, type Permission, type Role, type Scope, type Session } from './api';
import { AuditPage } from './pages/Audit';
import { ContentPage } from './pages/Content';
import { AppealsPage } from './pages/Appeals';
import { NoShowsPage } from './pages/NoShows';
import { OverviewPage } from './pages/Overview';
import { ChoosePassword } from './pages/ChoosePassword';
import { PlaceSwitcher } from './pages/PlacePicker';
import { CategoriesPage } from './pages/Categories';
import { RegionsPage } from './pages/Regions';
import { ReportsPage } from './pages/Reports';
import { SecurityPage } from './pages/Security';
import { StaffPage } from './pages/Staff';
import { UsersPage } from './pages/Users';
import { VerificationsPage } from './pages/Verifications';
import { AuthShell } from './AuthShell';
import lamisLogo from './assets/lamis-logo-light.svg';
import lamisMark from './assets/lamis-mark-light.svg';
import { Avatar, clearLoadCache, DialogHost, errMsg, ErrorBanner, urlParam, Icon, Loading, setUrlParam, PageFrame, PageMeta, PopMenu, Tabs, useLoad, type IconName } from './ui';

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
  { id: 'settings', label: 'Settings', icon: 'settings', group: 'Setup', regional: true, tabs: [{ id: 'places', label: 'Places & limits', regional: true }, { id: 'categories', label: 'Categories', admin: true }, { id: 'security', label: 'Two-step sign-in', regional: true }] },
  { id: 'audit', label: 'Audit log', icon: 'clock', group: 'Setup', admin: true },
];

/** What this account may open: an admin everything; staff only the parts of their area an admin allowed. */
const allowed = (role: Role, perms: Permission[]) => {
  const ok = (x: { admin?: boolean; regional?: boolean; perm?: Permission }) => role === 'admin' || (!x.admin && !!x.regional && (!x.perm || perms.includes(x.perm)));
  return SECTIONS.filter(ok)
    .map((s) => ({ ...s, tabs: s.tabs?.filter(ok) }))
    .filter((s) => !s.tabs || s.tabs.length > 0);
};

/** Where the console lives (`/admin/`, from vite.config's base). A page's address is that plus `section/tab`, e.g. `/admin/reports/appeals`. */
const BASE = import.meta.env.BASE_URL;
const pagePath = (section: string, tab = '') => `${BASE}${section}${tab ? '/' + tab : ''}`;
// An old bookmark or link in the earlier style (`/admin/#/reports/appeals?status=resolved`) is turned into the clean address,
// without reloading, so existing links keep working (on opening the console, and if such an address is typed while it is open).
const fixOldAddress = () => {
  if (!window.location.hash.startsWith('#/')) return;
  try {
    window.history.replaceState(null, '', BASE + window.location.hash.slice(2));
  } catch {
    /* history unavailable */
  }
};
if (typeof window !== 'undefined') fixOldAddress();
/** `/admin/reports/appeals` -> section and tab, so Back and Forward move between pages. */
const readRoute = () => {
  const rest = window.location.pathname.startsWith(BASE) ? window.location.pathname.slice(BASE.length) : '';
  const [s, t] = rest.split('/').filter(Boolean);
  return { section: (s || 'dashboard') as SectionId, tab: t || '' };
};
const WHOLE_SERVICE = { key: 'all', name: 'Whole service' };

type MfaStatus = { enabled: boolean; required: boolean; passwordChangeRequired: boolean; setupNeeded: boolean; canSkip: boolean; recoveryCodesLeft: number };
type Boot = { scope: { scope: Scope; permissions?: Permission[] }; mfa: MfaStatus };
/**
 * What the console last learned about this account (its area, permissions and two-step status), kept in this browser so a
 * page reload opens the console at once instead of a loading screen; the server is asked again straight away and its answer
 * wins. Only a plain, finished state is kept (no password change or two-step setup pending). It only shapes the menu: the
 * server checks every request itself.
 */
const BOOT_PREFIX = 'ht_admin_boot:';
const readBoot = (email: string): Boot | null => {
  try {
    return JSON.parse(localStorage.getItem(BOOT_PREFIX + email) ?? 'null') as Boot | null;
  } catch {
    return null;
  }
};
const writeBoot = (email: string, boot: Boot | null) => {
  try {
    if (boot) localStorage.setItem(BOOT_PREFIX + email, JSON.stringify(boot));
    else localStorage.removeItem(BOOT_PREFIX + email);
  } catch {
    /* storage unavailable: the console simply loads as before */
  }
};

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [loc, setLoc] = useState(readRoute);
  // one report or person opened from another page (the audit log, a report's "open person"): kept in the address as
  // `?focus=<id>`, so a page reload shows the same one again
  const [reportId, setReportIdRaw] = useState<string | null>(() => (readRoute().section === 'reports' ? urlParam('focus') : null));
  const [userId, setUserIdRaw] = useState<string | null>(() => (readRoute().section === 'users' ? urlParam('focus') : null));
  const setReportId = (id: string | null) => (setReportIdRaw(id), setUrlParam('focus', id));
  const setUserId = (id: string | null) => (setUserIdRaw(id), setUrlParam('focus', id));

  const go = (section: SectionId, tab = '', replace = false) => {
    try {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', pagePath(section, tab));
    } catch {
      /* history unavailable: the page still changes */
    }
    // the new page simply fades in (motion.css, .page)
    setLoc({ section, tab });
  };
  useEffect(() => {
    const onBack = () => (fixOldAddress(), setLoc(readRoute()));
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  const logout = () => {
    if (session) writeBoot(session.email, null);
    clearLoadCache(); // nothing this person saw is kept for the next one
    if (getRefreshToken()) void api('POST', '/v1/auth/logout', { refreshToken: getRefreshToken() }).catch(() => undefined);
    setToken(null);
    setRefreshToken(null);
    setPlace(null);
    saveSession(null);
    setSession(null);
    try {
      window.history.replaceState(null, '', pagePath('dashboard')); // the next sign-in starts at the dashboard, not at the page left
    } catch {
      /* history unavailable */
    }
    setLoc({ section: 'dashboard', tab: '' });
  };
  // braces on purpose: setUnauthorizedHandler returns the function it was given, and React would run that return value as the
  // effect's cleanup, which signs the person out on every reload while the dev server (StrictMode) is running
  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, []);

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
    // the ids of the open reports come from a small summary (not the whole queue), so asking every few seconds stays cheap
    const ids = () => api<{ openIds: string[] }>('GET', '/v1/admin/reports/waiting').then((r) => r.openIds, () => [] as string[]);
    const load = () => Promise.all([ids(), Promise.resolve([] as string[])]).then(([reports, verifications]) => live && setOpen({ reports, verifications }));
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
  const mfa = useLoad(() => api<MfaStatus>('GET', '/v1/me/mfa'), [signedIn.token]);
  // a reload shows the console straight away from what this browser remembers; the fresh answers replace it when they come
  const [boot] = useState(() => readBoot(signedIn.email));
  const scopeData = scopeLoad.data ?? boot?.scope ?? null;
  const mfaData = mfa.data ?? boot?.mfa ?? null;
  useEffect(() => {
    if (!scopeLoad.data || !mfa.data) return;
    writeBoot(signedIn.email, mfa.data.passwordChangeRequired || mfa.data.setupNeeded ? null : { scope: scopeLoad.data, mfa: mfa.data });
  }, [scopeLoad.data, mfa.data, signedIn.email]);
  const session: Session = { ...signedIn, scope: scopeData?.scope ?? null, permissions: scopeData?.permissions ?? [] };
  const regional = !!session.scope;
  const canSwitch = session.role === 'admin' && !regional;
  const [chosen, setChosen] = useState(getPlace);
  const place = canSwitch && chosen ? chosen : WHOLE_SERVICE;
  const [switching, setSwitching] = useState(false);
  const pick = (key: string, name: string) => {
    const next = key === 'all' ? null : { key, name };
    setPlace(next);
    clearLoadCache(); // what was loaded for the old place is not shown for the new one
    setChosen(next);
    setSwitching(false);
  };
  useEffect(() => {
    if (scopeLoad.data && !canSwitch && getPlace()) (setPlace(null), setChosen(null));
  }, [scopeLoad.data, canSwitch]);

  const [drawer, setDrawer] = useState(false);
  // The sidebar can be folded to a narrow strip of icons (computers and tablets; on a phone it is the drawer). The choice is
  // remembered in this browser. Ctrl B does the same as the button.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ht_admin_side') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggleSide = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('ht_admin_side', c ? 'open' : 'collapsed');
      } catch {
        /* storage unavailable: it just lasts until the page is reloaded */
      }
      return !c;
    });
  }, []);
  const [filter, setFilter] = useState('');
  const [back, setBack] = useState<string | null>(() => (loc.section === 'users' ? urlParam('back') : null));
  useEffect(() => {
    if (loc.section !== 'users') setBack(null); // left People some other way: the way back no longer applies
  }, [loc.section]);
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
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSide();
        return;
      }
      if ((e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setDrawer(true);
        setCollapsed(false); // the search box lives in the open sidebar (this opening is not remembered)
        setTimeout(() => searchRef.current?.focus(), 30);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [toggleSide]);

  if (mfaData?.passwordChangeRequired && !passwordChosen)
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
  if (mfaData && mfaData.setupNeeded)
    return (
      <>
        <AuthShell headline="One more step to keep it secure." sub="A code from your phone protects the console, and everyone's data in it, if a password is ever stolen.">
          <div className="lg-card lg-wide">
            <SecurityPage status={mfaData} onChanged={mfa.reload} forced />
            <button type="button" className="lg-link" onClick={logout}>
              Sign out
            </button>
          </div>
        </AuthShell>
        <DialogHost />
      </>
    );
  // nothing remembered yet (the first sign-in in this browser): a plain loading screen in the console's colours, never the
  // green sign-in panel, so it does not look like being signed out
  if ((!scopeData && !scopeLoad.error) || (!mfaData && !mfa.error))
    return (
      <div className="boot-loading">
        <Loading label="Loading your console…" />
      </div>
    );

  // the page first, then the one opened (its id goes into the new page's address)
  // A person opened from somewhere else remembers where (`back`, in the address, so a reload keeps it):
  // "report:<id>:<list>" = that report in that list, "appeals" / "noshows" = that tab. People shows a button back to it.
  const openUser = (id: string, from?: string) => {
    go('users');
    setUserId(id);
    setUrlParam('back', from ?? null);
    setBack(from ?? null);
  };
  const goBack = () => {
    if (!back) return;
    const [kind, reportId, list] = back.split(':');
    setUserId(null);
    setBack(null);
    if (kind === 'report') {
      go('reports', 'reports');
      // the report's page opens on the same list with the same report selected (Reports reads these from the address)
      setUrlParam('status', list && list !== 'waiting' ? list : null);
      setUrlParam('report', reportId || null);
    } else go('reports', kind);
  };
  const backLabel = !back ? null : back.startsWith('report:') ? 'Back to the report' : back === 'appeals' ? 'Back to appeals' : back === 'noshows' ? 'Back to attendance' : null;
  const openReport = (id: string) => (go('reports', 'reports'), setReportId(id));
  // every report about one person, in every state: the Reports page opens searched for them, on "Against"
  const showReportsAbout = (term: string) => {
    setReportId(null);
    go('reports', 'reports');
    setUrlParam('q', term);
    setUrlParam('who', 'against');
  };
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
  if (key === 'users/') body = <UsersPage me={session} focusId={userId} onClearFocus={() => (setUserId(null), setBack(null), setUrlParam('back', null))} openReport={openReport} onShowReports={showReportsAbout} backLabel={backLabel} onBack={goBack} />;
  if (key === 'content/') body = <ContentPage me={session} />;
  if (key === 'team/') body = <StaffPage me={session} />;
  if (key === 'settings/places') body = <RegionsPage me={session} />;
  if (key === 'settings/categories') body = <CategoriesPage />;
  if (key === 'settings/security' && mfaData) body = <SecurityPage status={mfaData} onChanged={mfa.reload} />;
  if (key === 'audit/') body = <AuditPage openReport={openReport} />;

  const tabs =
    section.tabs && section.tabs.length > 1 ? (
      <Tabs label={section.label} value={tab} onChange={(t) => (setReportId(null), setUserId(null), go(section.id, t))} options={section.tabs.map((t) => ({ id: t.id, label: t.label, count: t.id === 'reports' ? badge.reports : undefined }))} />
    ) : null;

  const shown = sections.filter((s) => s.label.toLowerCase().includes(filter.trim().toLowerCase()));
  const groups = [...new Set(shown.map((s) => s.group))];
  return (
    <div className={collapsed ? 'shell collapsed' : 'shell'}>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), mainRef.current?.focus())}>
        Skip to content
      </a>
      <aside className={drawer ? 'side open' : 'side'} aria-label="Sidebar">
        <div className="side-top">
          <div className="brand">
            <img className="brand-logo" src={lamisLogo} alt="LAMIS" />
            <img className="brand-mark" src={lamisMark} alt="LAMIS" />
            <span className="brand-sub">Admin</span>
          </div>
          <button type="button" className="side-toggle" onClick={toggleSide} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'} title={collapsed ? 'Expand the sidebar (Ctrl B)' : 'Collapse the sidebar (Ctrl B)'}>
            <Icon name="panelLeft" />
          </button>
        </div>
        <label className="side-search">
          <span className="sr">Search or jump to a page (Ctrl K)</span>
          <Icon name="search" />
          <input ref={searchRef} type="search" placeholder="Search pages" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && (
            <button type="button" className="search-clear" aria-label="Clear the search" onClick={() => setFilter('')}>
              <Icon name="x" />
            </button>
          )}
          <kbd aria-hidden="true">Ctrl K</kbd>
        </label>
        <nav aria-label="Main">
          {groups.map((g) => (
            <div key={g} style={{ display: 'contents' }}>
              <div className="nav-group">{g}</div>
              {shown
                .filter((s) => s.group === g)
                .map((s) => (
                  <button key={s.id} className={section.id === s.id ? 'nav active' : 'nav'} aria-current={section.id === s.id ? 'page' : undefined} title={collapsed ? s.label : undefined} onClick={() => nav(s.id)}>
                    <Icon name={s.icon} />
                    <span className="nav-label">{s.label}</span>
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
            <button className="working-btn" onClick={() => setSwitching(true)} title={collapsed ? `Working in ${place.name}: switch to another country, region or city` : 'Switch to another country, region or city'} aria-label={`Working in ${place.name}. Switch place`}>
              <span className="where-abbr" aria-hidden="true">
                {place.name.slice(0, 2)}
              </span>
              <span className="where">
                <small>Working in</small>
                <strong>{place.name}</strong>
              </span>
              <span className="switch">Switch</span>
            </button>
          )}
          <div className="side-account">
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
            ]}
          />
          <button type="button" className="side-signout" onClick={logout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
          </div>
        </div>
      </aside>
      <div className={drawer ? 'scrim show' : 'scrim'} onClick={() => setDrawer(false)} aria-hidden="true" />
      <div className="workspace">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open the menu" aria-expanded={drawer} onClick={() => setDrawer(true)}>
            <Icon name="menu" />
          </button>
          <div className="brand">
            <img className="brand-logo" src={lamisLogo} alt="LAMIS" />
            <span className="brand-sub">Admin</span>
          </div>
        </header>
        <main className="main" id="main" ref={mainRef} tabIndex={-1} key={place.key}>
          {section.tabs ? (
            // a section with tabs: its heading and tab bar are built once, only the page under them changes between tabs
            <PageFrame key={section.id} title={section.label} tabs={tabs}>
              {body}
            </PageFrame>
          ) : (
            <PageMeta.Provider value={{}}>{body}</PageMeta.Provider>
          )}
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
          <p className="lg-sub">Open your authenticator app and type the 6-digit code for LAMIS. Lost your phone? Use one of your recovery codes instead.</p>
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
