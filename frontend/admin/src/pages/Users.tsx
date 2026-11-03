import { useEffect, useState } from 'react';
import { can, get, post, STAFF, type Role, type Session } from '../api';
import { askChoiceText, askText, Avatar, Chip, Empty, ErrorBanner, fmt, Icon, Loading, Page, RowMenu, useAction, useLoad, useMore } from '../ui';
import './Users.css';

type U = { adminRegionKey?: string | null; id: string; email: string; role: Role; state: string; suspendedUntil: string | null; eligibility: string; emailVerified: boolean; adultVerified: boolean; phoneVerified: boolean; verifiedUntil: string | null; reverifyReason: string | null; lastRejectionReason: string | null; displayName?: string; photoUrl?: string | null; homeCity?: string; createdAt: string };
type Detail = {
  id: string;
  email: string;
  stats: { reportsAgainst: number; hosted: number; joined: number };
  history: { id: string; action: string; createdAt: string; metadata: string | null }[];
  verifications: { id: string; eligibility: string; createdAt: string }[];
  reports: { id: string; category: string; status: string; details: string | null; resolution: string | null; createdAt: string; targetType: string; targetTitle: string | null; reporterName: string | null }[];
};
type Reliab = {
  label: string;
  summary: { kept: number; noShows: number; lateCancels: number; upheldReports: number; upheldLast12Months: number; rate: number };
  events: { kind: string; at: string; text: string; weight: number }[];
  marks: { id: string; title: string; state: string; markedAt: string; counts: boolean; disputeNote: string | null; decisionNote: string | null }[];
};
type View = 'all' | 'active' | 'suspended' | 'notverified' | 'guests';

const isGuest = (u: U) => u.email.startsWith('guest-') || u.displayName === 'Guest';
const PAGE = 10;
const nameOf = (u: U) => (isGuest(u) && u.displayName === 'Guest' ? 'Guest visitor' : (u.displayName ?? '(no name)'));

export function UsersPage({ me, focusId, onClearFocus, openReport }: { me: Session; focusId?: string | null; onClearFocus?: () => void; openReport?: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [view, setView] = useState<View>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const state = view === 'active' || view === 'suspended' ? view : '';
  // typing in the search box looks people up a moment after the last key
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  // opened from a report: look up just that one person by id and show their details straight away
  const query = new URLSearchParams(focusId ? { q: focusId } : { ...(term && { q: term }), ...(state && { state }) });
  const users = useLoad(() => get<{ items: U[]; nextCursor: string | null }>(`/v1/admin/users?${query}`), [term, state, focusId]);
  const more = useMore(users.data, (c) => get(`/v1/admin/users?${query}&cursor=${c}`), `${term}|${state}|${focusId}`);
  const act = useAction(() => (more.reset(), users.reload()));
  const rows = more.items.filter((u) => (focusId ? u.id === focusId : view === 'guests' ? isGuest(u) : view === 'notverified' ? u.eligibility !== 'verified' && !isGuest(u) : true));
  useEffect(() => setPage(0), [term, view, focusId]);
  const last = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
  const p = Math.min(page, last);
  const shown = rows.slice(p * PAGE, p * PAGE + PAGE);

  const suspend = async (u: U) => {
    const r = await askChoiceText(
      `Suspend ${u.displayName ?? u.email}?`,
      [['1', '1 day'], ['3', '3 days'], ['7', '7 days'], ['30', '30 days'], ['0', 'Until I restore them']],
      { label: 'Reason (kept in the audit log, not shown to the user)', confirm: 'Suspend', choiceLabel: 'For how long' },
    );
    if (r && r.text.length >= 3) act.run(() => post(`/v1/admin/users/${u.id}/suspend`, { reason: r.text, ...(r.choice !== '0' && { days: Number(r.choice) }) }));
  };
  const restore = async (u: U) => {
    const reason = await askText(`Restore ${u.displayName ?? u.email}?`, { confirm: 'Restore' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/restore`, { reason }));
  };
  const warn = async (u: U) => {
    const reason = await askText(`Warn ${u.displayName ?? u.email}?`, { label: 'What is the warning about? The person reads this and can ask for a review.', confirm: 'Send warning' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/warn`, { reason }));
  };
  // A new identity check is needed only for expiry (automatic), a security concern, suspected fraud, or the provider's say-so.
  const reverify = async (u: U) => {
    const r = await askChoiceText(
      `Require ${u.displayName ?? u.email} to verify again?`,
      [['security', 'Security concern'], ['fraud_suspected', 'Suspected fraud'], ['other', 'Other']],
      { label: 'What happened? (kept in the audit log, not shown to the user)', confirm: 'Require re-verification' },
    );
    if (r) act.run(() => post(`/v1/admin/users/${u.id}/require-reverification`, { reason: r.choice, note: r.text }));
  };
  const reset = async (u: U) => {
    const note = await askText(`Let ${u.displayName ?? u.email} try verification again?`, { label: 'Why? (kept in the audit log)', confirm: 'Allow another attempt' });
    if (note) act.run(() => post(`/v1/admin/users/${u.id}/reset-verification`, { note }));
  };
  const overturn = async (u: U) => {
    const note = await askText(`Approve ${u.displayName ?? u.email} after review?`, { label: 'What did you check? You are confirming this person is a genuine adult. (kept in the audit log)', confirm: 'Approve' });
    if (note) act.run(() => post(`/v1/admin/users/${u.id}/overturn-rejection`, { note }));
  };
  const resetMfa = async (u: U) => {
    const reason = await askText(`Reset two-step sign-in for ${u.displayName ?? u.email}?`, { label: 'Why? (kept in the audit log) They will sign in with just a password until they set it up again.', confirm: 'Reset' });
    if (reason) act.run(() => post(`/v1/admin/users/${u.id}/mfa/reset`, { reason }));
  };
  const setRole = async (u: U, role: string) => {
    if (role === u.role) return users.reload();
    // staff can look after the whole service, or one country, region or city: ask which
    if (role !== 'user') {
      const places = await get<{ items: { key: string; name: string; kind: string }[] }>('/v1/admin/regions').catch(() => ({ items: [] }));
      const pick = await askChoiceText(`Make ${u.email} ${role.replace('_', ' ')}`, [['', 'The whole service'], ...places.items.filter((p) => p.kind !== 'global').map((p) => [p.key, `${p.name} (${p.kind})`] as [string, string])], {
        label: 'Anything to note? (optional)',
        choiceLabel: 'Which part of the service do they look after?',
        confirm: 'Make staff',
        required: false,
      });
      if (!pick) return users.reload();
      act.run(() => post(`/v1/admin/users/${u.id}/role`, { role, regionKey: pick.choice || null }));
    } else if (confirm(`Make ${u.email} an ordinary member again? They lose staff access.`)) act.run(() => post(`/v1/admin/users/${u.id}/role`, { role }));
    else users.reload();
  };

  const selectedId = focusId ?? open ?? rows[0]?.id ?? null;
  const selected = rows.find((u) => u.id === selectedId) ?? null;
  const count = `${more.items.length}${more.hasMore ? '+' : ''}`;
  const pills: { id: View; label: string }[] = [
    { id: 'all', label: `Everyone ${count}` },
    { id: 'active', label: 'Active' },
    { id: 'suspended', label: 'Suspended' },
    { id: 'notverified', label: 'Not verified' },
    { id: 'guests', label: 'Guests' },
  ];

  return (
    <Page
      fill
      title={focusId ? 'Person from a report' : users.data ? `${count} ${more.items.length === 1 && !more.hasMore ? 'person' : 'people'}` : 'People'}
      actions={
        focusId ? undefined : (
          <div className="us-pills" role="group" aria-label="Show">
            {pills.map((x) => (
              <button key={x.id} type="button" className={view === x.id ? 'us-pill on' : 'us-pill'} aria-pressed={view === x.id} onClick={() => setView(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
        )
      }
    >
      {focusId && (
        <p className="note">
          <Icon name="users" />
          Showing only the person from the report.
          <button className="link" style={{ marginLeft: 'auto' }} onClick={onClearFocus}>
            Show all users
          </button>
        </p>
      )}
      <ErrorBanner message={users.error ?? act.error} onRetry={users.reload} />
      {users.loading && !users.data && <Loading rows={6} />}
      {users.data && rows.length === 0 && !term && view === 'all' && <Empty title="No users yet">Accounts show up here when people sign up.</Empty>}
      {users.data && (rows.length > 0 || term || view !== 'all') && (
        <div className="us-grid">
          <section className="us-list" aria-label="People">
            {!focusId && (
              <label className="us-search">
                <span className="sr">Search users</span>
                <Icon name="search" />
                <input type="search" placeholder="Search name, email or user ID" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            )}
            <ul className="us-rows">
              {shown.map((u) => (
                <li key={u.id}>
                  <button className={u.id === selectedId ? 'us-row on' : 'us-row'} aria-current={u.id === selectedId} onClick={() => (setOpen(u.id), window.innerWidth < 1100 && setTimeout(() => document.querySelector('.us-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60))}>
                    <Avatar name={u.displayName ?? u.email} photo={u.photoUrl} size="lg" />
                    <span className="us-who">
                      <b>{nameOf(u)}</b>
                      <span>{u.email}</span>
                    </span>
                    <span className={isGuest(u) ? 'us-tag warn' : u.eligibility === 'verified' ? 'us-tag ok' : 'us-tag'}>{isGuest(u) ? `Guest · ${u.eligibility === 'verified' ? 'verified' : 'unverified'}` : u.eligibility === 'verified' ? 'Verified' : u.eligibility.replace(/_/g, ' ')}</span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="us-none">No one matches.</li>}
            </ul>
            <div className="us-pager">
              <span>{rows.length === 0 ? '0 people' : `${p * PAGE + 1}–${p * PAGE + shown.length} of ${rows.length}${more.hasMore ? '+' : ''}`}</span>
              <span className="us-arrows">
                <button aria-label="Previous page" disabled={p === 0} onClick={() => setPage(p - 1)}>
                  ←
                </button>
                <button aria-label="Next page" disabled={p === last} onClick={() => setPage(p + 1)}>
                  →
                </button>
              </span>
            </div>
            {p === last && more.hasMore && <div style={{ padding: '0 16px 14px' }}>{more.more}</div>}
          </section>
          <section className="us-detail" aria-label="Person details">
            {selected ? (
              <UserPanel key={selected.id} u={selected} me={me} busy={act.busy} onSuspend={suspend} onRestore={restore} onWarn={warn} onRole={setRole} onReverify={reverify} onReset={reset} onOverturn={overturn} onResetMfa={resetMfa} openReport={openReport} />
            ) : (
              <div className="us-empty">
                <Icon name="users" />
                <strong>Select a person</strong>
                <span>Their details, reports and staff actions show here.</span>
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

const SEGMENTS: Record<string, number> = { new: 1, 'needs care': 2, reliable: 3, 'very reliable': 5 };

function UserPanel(p: { u: U; me: Session; busy: boolean; onSuspend: (u: U) => void; onRestore: (u: U) => void; onWarn: (u: U) => void; onRole: (u: U, r: string) => void; onReverify: (u: U) => void; onReset: (u: U) => void; onOverturn: (u: U) => void; onResetMfa: (u: U) => void; openReport?: (id: string) => void }) {
  const { u, me } = p;
  const detail = useLoad(() => get<Detail>(`/v1/admin/users/${u.id}`), [u.id], 6000);
  const act = useAction(detail.reload);
  // the reliability detail is for staff of the whole service
  const rel = useLoad(() => (me.scope ? Promise.resolve<Reliab | null>(null) : get<Reliab>(`/v1/admin/users/${u.id}/reliability`)), [u.id, !!me.scope], 30000);
  const d = detail.data;
  const r = rel.data;
  const [copied, setCopied] = useState(false);
  // moderators cannot touch staff accounts; the server enforces this too
  const canActOn = can.moderate(me.role) && (u.role === 'user' || me.role === 'admin') && u.email !== me.email;
  const canWarn = canActOn && u.role === 'user' && !me.scope;
  const trust = can.trust(me.role) && u.role === 'user';
  const name = u.displayName ?? u.email;
  const more = [
    ...(trust && u.state === 'active' && ['verified', 'pending'].includes(u.eligibility) ? [{ label: 'Require re-verification', onSelect: () => p.onReverify(u) }] : []),
    // a rejection or a stuck check can be reopened or, as an appeal, overturned by a reviewer
    ...(can.admin(me.role) && u.role !== 'user' && u.email !== me.email ? [{ label: 'Reset two-step sign-in', onSelect: () => p.onResetMfa(u) }] : []),
    ...(trust && ['rejected', 'pending', 'reverification_required'].includes(u.eligibility) ? [{ label: 'Allow another attempt', onSelect: () => p.onReset(u) }] : []),
    ...(trust && u.eligibility === 'rejected' && !['superseded', 'cancelled'].includes(u.lastRejectionReason ?? '') && !(u.lastRejectionReason === 'underage' && !can.admin(me.role)) ? [{ label: 'Approve after review', onSelect: () => p.onOverturn(u) }] : []),
  ];
  const decide = async (reportId: string, status: 'resolved' | 'dismissed') => {
    const resolution = await askText(status === 'resolved' ? 'Resolve report' : 'Dismiss report', {
      label: status === 'resolved' ? 'What was decided? The person it is about can read this (and ask for a review).' : 'What was decided? (kept in the audit log)',
      confirm: status === 'resolved' ? 'Resolve' : 'Dismiss',
    });
    if (resolution) act.run(() => post(`/v1/admin/reports/${reportId}/resolve`, { status, resolution }));
  };
  const copy = () => {
    void navigator.clipboard?.writeText(u.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const filled = r ? (SEGMENTS[r.label.toLowerCase()] ?? 1) : 0;

  return (
    <>
      <div className="us-hero">
        <Avatar name={name} photo={u.photoUrl} size="xl" />
        <div className="us-hero-main">
          <h2>{nameOf(u)}</h2>
          <p>
            {u.email} · joined {fmt(u.createdAt)}
          </p>
          <div className="us-chips">
            <span className={u.state === 'active' ? 'us-c ok' : 'us-c bad'}>{u.state === 'active' ? 'Active' : u.state === 'suspended' ? (u.suspendedUntil ? `Suspended until ${new Date(u.suspendedUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Suspended') : u.state}</span>
            {u.eligibility === 'verified' && u.verifiedUntil && <span className="us-c">ID verified until {new Date(u.verifiedUntil).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            {u.eligibility !== 'verified' && <span className="us-c warn">Identity: {u.eligibility.replace(/_/g, ' ')}</span>}
            {r && <span className="us-c">Reliability: {r.label.toLowerCase()}</span>}
            {isGuest(u) && <span className="us-c">Guest</span>}
          </div>
        </div>
        <div className="us-hero-side">
          <label>
            <span>Role</span>
            {can.admin(me.role) && u.email !== me.email ? (
              <select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => p.onRole(u, e.target.value)} disabled={p.busy}>
                {(['user', ...STAFF] as Role[]).map((x) => (
                  <option key={x} value={x}>
                    {x === 'user' ? 'User' : x.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{u.role === 'user' ? 'User' : u.role.replace('_', ' ')}</strong>
            )}
            {u.role !== 'user' && <small>{u.adminRegionKey ? `area: ${u.adminRegionKey}` : 'whole service'}</small>}
          </label>
          {more.length > 0 && <RowMenu label={`More actions for ${name}`} items={more} />}
        </div>
      </div>

      <ErrorBanner message={detail.error ?? act.error} onRetry={detail.reload} />
      {detail.loading && !d && <Loading rows={4} />}

      {d && (
        <>
          <div className="us-stats">
            <div>
              <span>Hosted</span>
              <b>{d.stats.hosted}</b>
            </div>
            <div>
              <span>Joined</span>
              <b>{d.stats.joined}</b>
            </div>
            <div>
              <span>No-shows</span>
              <b>{r ? r.summary.noShows : '–'}</b>
            </div>
            <div>
              <span>Reports against</span>
              <b>{d.stats.reportsAgainst}</b>
            </div>
          </div>

          <div className="us-two">
            <section className="us-card">
              <h3>Checks</h3>
              <dl className="us-checks">
                <div>
                  <dt>Email</dt>
                  <dd className={u.emailVerified ? 'good' : 'late'}>{u.emailVerified ? '✓ Confirmed' : 'Not confirmed'}</dd>
                </div>
                <div>
                  <dt>Adult (18+)</dt>
                  <dd className={u.adultVerified ? 'good' : 'late'}>{u.adultVerified ? '✓ Confirmed' : 'Not confirmed'}</dd>
                </div>
                <div>
                  <dt>Mobile number</dt>
                  <dd className={u.phoneVerified ? 'good' : 'late'}>{u.phoneVerified ? '✓ Confirmed' : 'Not added'}</dd>
                </div>
                <div>
                  <dt>User ID</dt>
                  <dd>
                    <button type="button" className="us-id" onClick={copy} title="Copy the user ID">
                      <code>{u.id}</code>
                      <Icon name={copied ? 'check' : 'copy'} />
                    </button>
                  </dd>
                </div>
              </dl>
              {u.reverifyReason && u.eligibility !== 'verified' && <p className="us-note">Re-check asked for: {u.reverifyReason.replace(/_/g, ' ')}</p>}
              {u.eligibility === 'rejected' && <p className="us-note">Rejected: {(u.lastRejectionReason ?? 'other').replace(/_/g, ' ')}</p>}
            </section>

            <section className="us-card">
              <div className="us-card-head">
                <h3>Reliability</h3>
                <span>{r ? (r.summary.kept + r.summary.noShows + r.summary.lateCancels === 0 ? 'Not enough events yet' : r.label) : 'Whole-service staff only'}</span>
              </div>
              {r ? (
                <>
                  <div className="us-meter" aria-label={`Reliability ${r.label}`}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <i key={i} className={i < filled ? 'on' : ''} />
                    ))}
                  </div>
                  <div className="us-rel">
                    <span>
                      Kept <b>{r.summary.kept}</b>
                    </span>
                    <span>
                      Left late <b>{r.summary.lateCancels}</b>
                    </span>
                    <span>
                      Upheld reports <b>{r.summary.upheldReports}</b>
                    </span>
                    <span>
                      Good events <b>{Math.round(r.summary.rate * 100)}%</b>
                    </span>
                  </div>
                  <details className="us-events">
                    <summary>Every event behind the level ({r.events.length}) →</summary>
                    {r.marks.length > 0 && (
                      <ul>
                        {r.marks.map((m) => (
                          <li key={m.id}>
                            No-show note: {m.title} · {m.counts ? `${m.state}, counts` : m.state}
                            {m.disputeNote && <small>Their side: {m.disputeNote}</small>}
                            {m.decisionNote && <small>Decision: {m.decisionNote}</small>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <ul>
                      {r.events.map((e, i) => (
                        <li key={i}>
                          {fmt(e.at)} · {e.text} · weight {e.weight}
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                <p className="us-note">The reliability detail is for staff of the whole service.</p>
              )}
            </section>
          </div>

          <section className="us-card">
            <h3>History</h3>
            {d.reports.length === 0 && d.history.length === 0 ? (
              <p className="us-note">No reports about {name} and no staff actions on this account yet.</p>
            ) : (
              <>
                {d.reports.length > 0 && (
                  <ul className="us-hist">
                    {d.reports.map((x) => (
                      <li key={x.id}>
                        <div className="us-hist-top">
                          <span>
                            <Chip value={x.category} /> <Chip value={x.status} />
                          </span>
                          <small>{fmt(x.createdAt)}</small>
                        </div>
                        <p>“{x.details || 'No details given'}”</p>
                        <div className="us-hist-top">
                          <small>
                            {x.targetType === 'user' ? 'About them' : `About their ${x.targetType}${x.targetTitle ? `: ${x.targetTitle}` : ''}`} · reported by {x.reporterName ?? 'someone'}
                            {x.resolution && ` · decision: ${x.resolution}`}
                          </small>
                          <span className="us-hist-actions">
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
                                Open report →
                              </button>
                            )}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {d.history.length > 0 && (
                  <>
                    <h4>Recent staff actions on this account</h4>
                    <ul className="us-actions">
                      {d.history.map((h) => (
                        <li key={h.id}>
                          <code>{h.action}</code> <span>{fmt(h.createdAt)}</span>
                          {h.metadata && <small>{h.metadata}</small>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}

      {canActOn && (
        <section className={u.state === 'suspended' ? 'us-suspend lifted' : 'us-suspend'}>
          <div>
            <h3>{u.state === 'suspended' ? 'Restore account' : 'Suspend account'}</h3>
            <p>{u.state === 'suspended' ? `${name} is suspended${u.suspendedUntil ? ` until ${fmt(u.suspendedUntil)}` : ' until you lift it'}.` : `${name} can’t sign in, join or host until you lift it.`}</p>
          </div>
          <div className="us-suspend-btns">
            {u.state === 'suspended' ? (
              <button className="btn" onClick={() => p.onRestore(u)} disabled={p.busy}>
                Restore
              </button>
            ) : (
              <>
                {canWarn && (
                  <button className="btn" onClick={() => p.onWarn(u)} disabled={p.busy}>
                    Send a warning
                  </button>
                )}
                <button className="us-red" onClick={() => p.onSuspend(u)} disabled={p.busy}>
                  Suspend
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
