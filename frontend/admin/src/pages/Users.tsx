import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { can, get, post, roleLabel, type Role, type Session } from '../api';
import './UserPanel.css';
import { actionLabel, say, type E } from './Audit';
import { askChoiceText, askText, Avatar, Chip, ErrorBanner, fmt, Icon, Loading, Page, PageBar, RowMenu, Search, Segmented, urlParam, useAction, useUrlParam, useLoad } from '../ui';

type U = { adminRegionKey?: string | null; id: string; email: string; role: Role; state: string; suspendedUntil: string | null; eligibility: string; emailVerified: boolean; adultVerified: boolean; phoneVerified: boolean; verifiedUntil: string | null; reverifyReason: string | null; lastRejectionReason: string | null; displayName?: string; photoUrl?: string | null; homeCity?: string; createdAt: string };
type Detail = {
  id: string;
  email: string;
  stats: { reportsAgainst: number; hosted: number; joined: number };
  history: { id: string; actorId?: string | null; action: string; createdAt: string; metadata: string | null }[];
  verifications: { id: string; eligibility: string; createdAt: string }[];
  reports: { id: string; category: string; status: string; details: string | null; resolution: string | null; createdAt: string; targetType: string; targetTitle: string | null; reporterName: string | null }[];
};
type Reliab = {
  label: string;
  summary: { kept: number; noShows: number; lateCancels: number; upheldReports: number; upheldLast12Months: number; rate: number };
  events: { kind: string; at: string; text: string; weight: number }[];
  marks: { id: string; title: string; state: string; markedAt: string; counts: boolean; disputeNote: string | null; decisionNote: string | null }[];
};
type View = 'all' | 'active' | 'suspended' | 'notverified';

const isGuest = (u: U) => u.email.startsWith('guest-') || u.displayName === 'Guest';
const nameOf = (u: U) => (isGuest(u) && u.displayName === 'Guest' ? 'Guest' : (u.displayName ?? '(no name)'));
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
/** "user.suspend" -> "Suspended"; anything not listed reads as words */
const ACTIONS: Record<string, string> = {
  'user.suspend': 'Suspended',
  'user.restore': 'Restored',
  'user.warn': 'Warned',
  'user.role_change': 'Role changed',
  'staff.create': 'Staff account created',
  'staff.update': 'Staff permissions changed',
  'mfa.reset_by_admin': 'Two-step sign-in reset',
  'verification.verified': 'Identity approved',
  'verification.rejected': 'Identity rejected',
  'verification.reset': 'Allowed another identity attempt',
  'verification.rejection_overturned': 'Rejection overturned',
  'verification.reverification_required': 'Asked to verify again',
  'report.resolved': 'Report resolved',
  'report.assign': 'Report taken',
  'message.removed': 'Message hidden',
  'message.restored': 'Message restored',
};
const SERIOUS = ['user.suspend', 'user.warn', 'verification.rejected', 'verification.reverification_required', 'message.removed'];
const actionText = (a: string) => ACTIONS[a] ?? (a.split('.').pop() ?? a).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** the readable part of an audit entry's details: its reason or note, never raw data */
const detailText = (meta: string | null) => {
  if (!meta) return null;
  try {
    const m = JSON.parse(meta) as Record<string, unknown>;
    const text = [m.reason, m.note, m.resolution].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    const extra = typeof m.days === 'number' ? `${m.days} days` : typeof m.role === 'string' ? 'now ' + roleLabel(m.role) : null;
    return [text, extra].filter(Boolean).join(' · ') || null;
  } catch {
    return null;
  }
};

export function UsersPage({ me, focusId, onClearFocus, openReport, onShowReports, backLabel, onBack }: { me: Session; focusId?: string | null; onClearFocus?: () => void; openReport?: (id: string) => void; onShowReports?: (term: string) => void; /** "Back to the report" etc.: this person was opened from there */ backLabel?: string | null; onBack?: () => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  // kept in the address, so a page reload stays on the same view and person
  const [viewRaw, setView] = useUrlParam<View>('view', 'all');
  const view: View = viewRaw ?? 'all';
  const [open, setOpen] = useUrlParam<string>('user');
  const state = view === 'active' || view === 'suspended' ? view : view === 'notverified' ? 'unverified' : '';
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  // the server pages the list by number ("Page 1 / 10"): only one small page is read at a time
  const [pageNo, setPageNo] = useState(1);
  useEffect(() => setPageNo(1), [term, state, focusId]);
  const query = new URLSearchParams(focusId ? { q: focusId } : { ...(term && { q: term }), ...(state && { state }) });
  const users = useLoad(() => get<{ items: U[]; page?: number; pages?: number; total?: number }>(`/v1/admin/users?${query}&page=${pageNo}&pageSize=20`), [term, state, focusId, pageNo]);
  const act = useAction(() => users.reload());
  const rows = (users.data?.items ?? []).filter((u) => (focusId ? u.id === focusId : true));
  const shown = rows;
  const listRef = useRef<HTMLDivElement>(null);
  const selectedId = focusId ?? open ?? rows[0]?.id ?? null;
  const selected = rows.find((u) => u.id === selectedId) ?? null;
  // on a phone or small tablet: the list, then the person opened from it with a way back (responsive.css reads data-pane)
  const [pane, setPane] = useState<'list' | 'detail'>(() => (focusId || urlParam('user') ? 'detail' : 'list'));
  const label = (u: U) => u.displayName ?? u.email;

  const suspend = async (u: U) => {
    const r = await askChoiceText(`Suspend ${label(u)}?`, [['1', '1 day'], ['3', '3 days'], ['7', '7 days'], ['30', '30 days'], ['0', 'Until restored']], { confirm: 'Suspend', choiceLabel: 'For' });
    if (r && r.text.length >= 3) act.run(() => post(`/v1/admin/users/${u.id}/suspend`, { reason: r.text, ...(r.choice !== '0' && { days: Number(r.choice) }) }));
  };
  const restore = async (u: U) => {
    const reason = await askText(`Restore ${label(u)}?`, { confirm: 'Restore' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/restore`, { reason }));
  };
  const warn = async (u: U) => {
    const reason = await askText(`Warn ${label(u)}?`, { label: 'Message (they can read it)', confirm: 'Send' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/warn`, { reason }));
  };
  const reverify = async (u: U) => {
    const r = await askChoiceText(`Require ${label(u)} to verify again?`, [['security', 'Security concern'], ['fraud_suspected', 'Suspected fraud'], ['other', 'Other']], { label: 'Note', confirm: 'Require' });
    if (r) act.run(() => post(`/v1/admin/users/${u.id}/require-reverification`, { reason: r.choice, note: r.text }));
  };
  const reset = async (u: U) => {
    const note = await askText(`Allow ${label(u)} another attempt?`, { confirm: 'Allow' });
    if (note) act.run(() => post(`/v1/admin/users/${u.id}/reset-verification`, { note }));
  };
  const overturn = async (u: U) => {
    const note = await askText(`Approve ${label(u)} as a genuine adult?`, { label: 'What you checked', confirm: 'Approve' });
    if (note) act.run(() => post(`/v1/admin/users/${u.id}/overturn-rejection`, { note }));
  };
  const resetMfa = async (u: U) => {
    const reason = await askText(`Reset two-step sign-in for ${label(u)}?`, { confirm: 'Reset' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/mfa/reset`, { reason }));
  };
  /** up and down move through the list */
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = rows.findIndex((u) => u.id === selectedId);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    setOpen(next.id);
    listRef.current?.querySelector<HTMLButtonElement>('[data-id="' + next.id + '"]')?.focus();
  };

  return (
    <Page
      fill
      title="Users"
      actions={
        focusId ? (
          <>
            {/* opened from a report (or appeals, attendance): straight back to it, in the same place */}
            {backLabel && onBack && (
              <button className="btn primary small" onClick={onBack}>
                <Icon name="back" />
                {backLabel}
              </button>
            )}
            <button className="btn small" onClick={() => (setPane('list'), onClearFocus?.())}>
              Show everyone
            </button>
          </>
        ) : (
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { id: 'all', label: 'All' },
              { id: 'active', label: 'Active' },
              { id: 'suspended', label: 'Suspended' },
              { id: 'notverified', label: 'Unverified' },
            ]}
          />
        )
      }
    >
      <ErrorBanner message={users.error ?? act.error} onRetry={users.reload} />
      {users.loading && !users.data && <Loading rows={6} />}
      {users.data && (
        <div className="split" data-pane={focusId ? 'detail' : pane}>
          <section className="split-list" aria-label="People">
            {!focusId && (
              <div className="split-tools">
                <Search label="Search people" placeholder="Name, email or ID" value={q} onChange={setQ} />
              </div>
            )}
            <div className="list-scroll smooth-scroll" ref={listRef} onKeyDown={keys}>
              <ul className="items">
                {shown.map((u) => (
                  <li key={u.id}>
                    <button data-id={u.id} className={u.id === selectedId ? 'list-item active' : 'list-item'} aria-current={u.id === selectedId} onClick={() => (setOpen(u.id), setPane('detail'))}>
                      <Avatar name={label(u)} photo={u.photoUrl} />
                      <span className="body">
                        <span className="title">{nameOf(u)}</span>
                        <span className="meta">{u.email}</span>
                      </span>
                      <span className="aside">
                        {u.state === 'suspended' ? <Chip value="Suspended" tone="dark" /> : u.eligibility === 'verified' ? <Chip value="Verified" tone="ok" /> : isGuest(u) ? <Chip value="Guest" tone="plain" /> : <Chip value={u.eligibility} tone="line" />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {shown.length === 0 && <div className="state">No one matches.</div>}
            </div>
            <PageBar page={users.data.page ?? 1} pages={users.data.pages ?? 1} total={users.data.total ?? rows.length} noun={['person', 'people']} onPage={setPageNo} busy={users.loading} />
          </section>
          <section className="split-detail" aria-label="Person">
            {/* a person opened from a report has its own way back in the page's top bar */}
            {!focusId && (
              <button type="button" className="btn small split-back" onClick={() => (setPane('list'), setOpen(null))}>
                <Icon name="back" />
                All people
              </button>
            )}
            {selected ? (
              <UserPanel key={selected.id} u={selected} me={me} busy={act.busy} onSuspend={suspend} onRestore={restore} onWarn={warn} onReverify={reverify} onReset={reset} onOverturn={overturn} onResetMfa={resetMfa} openReport={openReport} onShowReports={onShowReports} />
            ) : (
              <div className="detail-empty">Select a person.</div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

function UserPanel(p: { u: U; me: Session; busy: boolean; onSuspend: (u: U) => void; onRestore: (u: U) => void; onWarn: (u: U) => void; onReverify: (u: U) => void; onReset: (u: U) => void; onOverturn: (u: U) => void; onResetMfa: (u: U) => void; openReport?: (id: string) => void; onShowReports?: (term: string) => void }) {
  const { u, me } = p;
  const detail = useLoad(() => get<Detail>(`/v1/admin/users/${u.id}`), [u.id], 6000);
  const act = useAction(detail.reload);
  const rel = useLoad(() => get<Reliab>(`/v1/admin/users/${u.id}/reliability`).catch(() => null), [u.id], 30000);
  const d = detail.data;
  const r = rel.data;
  const canActOn = can.moderate(me.role) && (u.role === 'user' || me.role === 'admin') && u.email !== me.email;
  const canWarn = canActOn && u.role === 'user';
  const trust = can.trust(me.role) && u.role === 'user';
  const name = u.displayName ?? u.email;
  const menu = [
    ...(trust && ['rejected', 'pending', 'reverification_required'].includes(u.eligibility) ? [{ label: 'Allow another attempt', onSelect: () => p.onReset(u) }] : []),
    ...(trust && u.eligibility === 'rejected' && !['superseded', 'cancelled'].includes(u.lastRejectionReason ?? '') && !(u.lastRejectionReason === 'underage' && !can.admin(me.role)) ? [{ label: 'Approve after review', onSelect: () => p.onOverturn(u) }] : []),
    ...(can.admin(me.role) && u.role !== 'user' && u.email !== me.email ? [{ label: 'Reset two-step sign-in', onSelect: () => p.onResetMfa(u) }] : []),
  ];
  const decide = async (reportId: string, status: 'resolved' | 'dismissed') => {
    const resolution = await askText(status === 'resolved' ? 'Resolve report' : 'Dismiss report', { label: 'Decision', confirm: status === 'resolved' ? 'Resolve' : 'Dismiss' });
    if (resolution) act.run(() => post(`/v1/admin/reports/${reportId}/resolve`, { status, resolution }));
  };

  const checks: { label: string; ok: boolean; note?: string }[] = [
    { label: 'Email confirmed', ok: u.emailVerified },
    { label: 'Adult confirmed', ok: u.adultVerified },
    { label: 'Phone confirmed', ok: u.phoneVerified },
    { label: 'Identity verified', ok: u.eligibility === 'verified', note: u.eligibility === 'verified' && u.verifiedUntil ? `until ${day(u.verifiedUntil)}` : u.eligibility === 'rejected' ? (u.lastRejectionReason ?? 'rejected').replace(/_/g, ' ') : u.reverifyReason && u.eligibility !== 'verified' ? u.reverifyReason.replace(/_/g, ' ') : u.eligibility !== 'verified' ? u.eligibility.replace(/_/g, ' ') : undefined },
  ];
  const rated = r ? r.summary.kept + r.summary.noShows + r.summary.lateCancels : 0;

  return (
    <div className="detail-scroll up" key={u.id}>
      <header className="up-hero">
        <Avatar name={name} photo={u.photoUrl} size="xl" />
        <div className="up-who">
          <h2>{nameOf(u)}</h2>
          <span className="up-sub">
            {u.email}
            {u.homeCity ? ` · ${u.homeCity}` : ''} · joined {day(u.createdAt)}
          </span>
          <div className="up-chips">
            {u.state === 'active' ? <Chip value="Active" tone="ok" /> : <Chip value={u.state === 'suspended' && u.suspendedUntil ? `Suspended to ${day(u.suspendedUntil)}` : u.state} tone="dark" />}
            {u.eligibility === 'verified' ? <Chip value="ID verified" tone="ok" /> : <Chip value={u.eligibility} tone="line" />}
            {isGuest(u) && <Chip value="Guest" tone="plain" />}
          </div>
        </div>
        {(canActOn || trust || menu.length > 0) && (
          <div className="up-actions">
            {canActOn &&
              (u.state === 'suspended' ? (
                <button className="btn primary small" onClick={() => p.onRestore(u)} disabled={p.busy}>
                  Restore
                </button>
              ) : (
                <>
                  {canWarn && (
                    <button className="btn small" onClick={() => p.onWarn(u)} disabled={p.busy}>
                      Warn
                    </button>
                  )}
                  <button className="btn small suspend" onClick={() => p.onSuspend(u)} disabled={p.busy}>
                    Suspend
                  </button>
                </>
              ))}
            {trust && u.state === 'active' && ['verified', 'pending'].includes(u.eligibility) && (
              <button className="btn small" onClick={() => p.onReverify(u)} disabled={p.busy}>
                Require re-verification
              </button>
            )}
            <span className="grow" />
            {menu.length > 0 && <RowMenu label={`Actions for ${name}`} items={menu} />}
          </div>
        )}
      </header>

      <ErrorBanner message={detail.error ?? act.error} onRetry={detail.reload} />
      {detail.loading && !d && <Loading rows={4} />}

      <div className="up-tiles">
        <div className="up-tile">
          <b>{d?.stats.hosted ?? '–'}</b>
          <span>Hosted</span>
        </div>
        <div className="up-tile">
          <b>{d?.stats.joined ?? '–'}</b>
          <span>Joined</span>
        </div>
        <button
          type="button"
          className={d && d.stats.reportsAgainst > 0 ? 'up-tile hot linky' : 'up-tile linky'}
          disabled={!p.onShowReports || !d || d.stats.reportsAgainst === 0}
          onClick={() => p.onShowReports?.(u.email)}
          title="Open every report about this person"
        >
          <b>{d?.stats.reportsAgainst ?? '–'}</b>
          <span>Reports against{d && d.stats.reportsAgainst > 0 ? ' →' : ''}</span>
        </button>
      </div>

      {r && (
        <section className="up-section">
          <h3 className="up-title">Reliability</h3>
          <div className="up-rel">
            <div className="up-ring" style={{ ['--p' as string]: rated ? Math.round(r.summary.rate * 100) : 0 }} aria-label={rated ? `${Math.round(r.summary.rate * 100)}% kept` : 'No plans yet'}>
              <span>{rated ? `${Math.round(r.summary.rate * 100)}%` : 'New'}</span>
            </div>
            <div>
              <div className="up-rel-label">{rated ? r.label : 'No plans yet'}</div>
              <div className="up-counts">
                <div>
                  <b>{r.summary.kept}</b>
                  <span>Kept</span>
                </div>
                <div>
                  <b>{r.summary.noShows}</b>
                  <span>Missed</span>
                </div>
                <div>
                  <b>{r.summary.lateCancels}</b>
                  <span>Late cancels</span>
                </div>
                <div>
                  <b>{r.summary.upheldReports}</b>
                  <span>Upheld reports</span>
                </div>
              </div>
            </div>
            {(r.events.length > 0 || r.marks.length > 0) && (
              <details>
                <summary>What counted ({r.events.length + r.marks.length})</summary>
                <ul className="up-timeline" style={{ marginTop: 12 }}>
                  {r.marks.map((m) => (
                    <li key={m.id} className={m.counts ? 'serious' : ''}>
                      <span className="up-when">{fmt(m.markedAt)}</span>
                      <span className="up-what">Did not attend {m.title}</span>
                      <span className="up-why">
                        {m.state.replace(/_/g, ' ')}
                        {m.disputeNote ? ` · their side: ${m.disputeNote}` : ''}
                        {m.decisionNote ? ` · decision: ${m.decisionNote}` : ''}
                      </span>
                    </li>
                  ))}
                  {r.events.map((e, i) => (
                    <li key={i}>
                      <span className="up-when">{fmt(e.at)}</span>
                      <span className="up-why">{e.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      )}

      <section className="up-section">
        <h3 className="up-title">Account</h3>
        <ul className="up-checks">
          {checks.map((c) => (
            <li key={c.label}>
              <span className={c.ok ? 'up-tick on' : 'up-tick'}>
                <Icon name={c.ok ? 'check' : 'x'} />
              </span>
              {c.label}
              {c.note && <small>{c.note}</small>}
            </li>
          ))}
        </ul>
      </section>

      {d && d.reports.length > 0 && (
        <section className="up-section">
          <h3 className="up-title">
            Reports <span>{d.reports.length}</span>
          </h3>
          {d.reports.map((x) => (
            <div key={x.id} className={['open', 'in_review'].includes(x.status) ? 'up-report waiting' : 'up-report'}>
              <div className="row between wrap">
                <span className="row">
                  <Chip value={x.category} tone="plain" />
                  <Chip value={x.status} />
                </span>
                <span className="small muted">{fmt(x.createdAt)}</span>
              </div>
              <p className="quote">“{x.details || 'No details'}”</p>
              <div className="small muted">
                {x.targetType === 'user' ? 'About them' : `Their ${x.targetType}${x.targetTitle ? `: ${x.targetTitle}` : ''}`} · by {x.reporterName ?? 'someone'}
                {x.resolution && ` · ${x.resolution}`}
              </div>
              <div className="row wrap">
                {can.moderate(me.role) && ['open', 'in_review'].includes(x.status) && (
                  <>
                    <button className="btn small" onClick={() => decide(x.id, 'dismissed')} disabled={act.busy}>
                      Dismiss
                    </button>
                    <button className="btn small primary" onClick={() => decide(x.id, 'resolved')} disabled={act.busy}>
                      Resolve
                    </button>
                  </>
                )}
                {p.openReport && (
                  <button className="link small" onClick={() => p.openReport!(x.id)}>
                    Open report
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {d && d.history.length > 0 && (
        <section className="up-section">
          <h3 className="up-title">History</h3>
          <HistoryList items={d.history} personId={u.id} personName={name} />
        </section>
      )}
    </div>
  );
}

const HISTORY_PAGE = 6;
/** The person's history: six entries, and "Load more" for the next six. */
function HistoryList({ items, personId, personName }: { items: U_History[]; personId: string; personName: string }) {
  const [count, setCount] = useState(HISTORY_PAGE);
  const shown = items.slice(0, count);
  // each entry as a plain sentence ("Sofia signed in", "A staff member warned Sofia"), with its outcome and a single date format
  const sentence = (h: U_History) => {
    let meta: Record<string, unknown> | null = null;
    try {
      meta = h.metadata ? (JSON.parse(h.metadata) as Record<string, unknown>) : null;
    } catch {
      meta = null;
    }
    const mine = !h.actorId || h.actorId === personId;
    const e: E = { id: h.id, actorId: h.actorId ?? null, actorName: h.actorId ? (mine ? personName : 'A staff member') : null, objectName: personName, action: h.action, objectType: 'user', objectId: personId, metadata: meta, createdAt: h.createdAt };
    return { said: say(e, { [personId]: personName }), status: actionLabel(h.action) };
  };
  return (
    <>
      <ul className="up-timeline">
        {shown.map((h) => {
          const { said, status } = sentence(h);
          return (
            <li key={h.id} className={SERIOUS.includes(h.action) ? 'serious' : ''}>
              <span className="up-when">{fmt(h.createdAt)}</span>
              <span className="up-what">
                {said.parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <b key={i}>{p.b}</b>))}
                {status.tone !== 'plain' && (
                  <>
                    {' '}
                    <Chip value={status.text} tone={status.tone} />
                  </>
                )}
              </span>
              {said.facts.map((f, i) => (
                <span key={i} className="up-why">
                  {f}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
      {items.length > count && (
        <div className="row end" style={{ marginTop: 12 }}>
          <button type="button" className="btn small" onClick={() => setCount((c) => c + HISTORY_PAGE)}>
            Load more
          </button>
        </div>
      )}
    </>
  );
}
type U_History = { id: string; actorId?: string | null; action: string; createdAt: string; metadata: string | null };
