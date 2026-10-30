import { useState } from 'react';
import { can, get, post, STAFF, type Role, type Session } from '../api';
import { askChoiceText, askText, Avatar, Chip, Empty, ErrorBanner, fmt, Icon, Page, RowMenu, Search, Segmented, useAction, useLoad, useMore, usePages } from '../ui';

type U = { adminRegionKey?: string | null; id: string; email: string; role: Role; state: string; suspendedUntil: string | null; eligibility: string; emailVerified: boolean; adultVerified: boolean; phoneVerified: boolean; verifiedUntil: string | null; reverifyReason: string | null; lastRejectionReason: string | null; displayName?: string; homeCity?: string; createdAt: string };
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
type State = '' | 'active' | 'suspended';

const isGuest = (u: U) => u.email.startsWith('guest-') || u.displayName === 'Guest';

export function UsersPage({ me, focusId, onClearFocus, openReport }: { me: Session; focusId?: string | null; onClearFocus?: () => void; openReport?: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [state, setState] = useState<State>('');
  const [identity, setIdentity] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // opened from a report: look up just that one person by id and show their details straight away
  const query = new URLSearchParams(focusId ? { q: focusId } : { ...(term && { q: term }), ...(state && { state }) });
  const users = useLoad(() => get<{ items: U[]; nextCursor: string | null }>(`/v1/admin/users?${query}`), [term, state, focusId]);
  const more = useMore(users.data, (c) => get(`/v1/admin/users?${query}&cursor=${c}`), `${term}|${state}|${focusId}`);
  const act = useAction(() => (more.reset(), users.reload()));
  const rows = more.items.filter((u) => (focusId ? u.id === focusId : !identity || u.eligibility === identity));
  const pages = usePages(rows, `${term}|${state}|${identity}`);

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

  return (
    <Page title="Users" sub={focusId ? undefined : users.data ? `${more.items.length}${more.hasMore ? '+' : ''} registered accounts` : undefined}>
      {focusId && (
        <p className="note">
          <Icon name="users" />
          Showing only the person from the report.
          <button className="link" style={{ marginLeft: 'auto' }} onClick={onClearFocus}>
            Show all users
          </button>
        </p>
      )}
      <form
        className="toolbar"
        style={focusId ? { display: 'none' } : undefined}
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(q.trim());
        }}
      >
        <Search label="Search users" placeholder="Search by email, name or user ID" value={q} onChange={setQ} />
        <Segmented
          label="State"
          value={state}
          onChange={setState}
          options={[
            { id: '', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'suspended', label: 'Suspended' },
          ]}
        />
        <label>
          <span className="sr">Identity</span>
          <select value={identity} onChange={(e) => setIdentity(e.target.value)}>
            <option value="">Any identity</option>
            {['unverified', 'pending', 'verified', 'rejected', 'expired', 'reverification_required'].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary">Search</button>
      </form>
      <ErrorBanner message={users.error ?? act.error} />
      {users.data && rows.length === 0 && <Empty>No users match.</Empty>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>State</th>
                  <th>Identity</th>
                  <th>Joined</th>
                  <th>
                    <span className="sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pages.shown.map((u) => (
                  <UserRow key={u.id} u={u} me={me} open={open === u.id || focusId === u.id} onToggle={() => setOpen(open === u.id ? null : u.id)} onSuspend={suspend} onRestore={restore} onRole={setRole} onReverify={reverify} onReset={reset} onOverturn={overturn} onResetMfa={resetMfa} busy={act.busy} openReport={openReport} />
                ))}
              </tbody>
            </table>
          </div>
          {pages.foot}
        </div>
      )}
      {more.more}
    </Page>
  );
}

function UserRow(p: { u: U; me: Session; open: boolean; onToggle: () => void; onSuspend: (u: U) => void; onRestore: (u: U) => void; onRole: (u: U, r: string) => void; onReverify: (u: U) => void; onReset: (u: U) => void; onOverturn: (u: U) => void; onResetMfa: (u: U) => void; busy: boolean; openReport?: (id: string) => void }) {
  const { u, me } = p;
  // moderators cannot touch staff accounts; the server enforces this too
  const canActOn = can.moderate(me.role) && (u.role === 'user' || me.role === 'admin') && u.email !== me.email;
  const trust = can.trust(me.role) && u.role === 'user';
  const more = [
    ...(trust && u.state === 'active' && ['verified', 'pending'].includes(u.eligibility) ? [{ label: 'Require re-verification', onSelect: () => p.onReverify(u) }] : []),
    // a rejection or a stuck check can be reopened or, as an appeal, overturned by a reviewer
    ...(can.admin(me.role) && u.role !== 'user' && u.email !== me.email ? [{ label: 'Reset two-step sign-in', onSelect: () => p.onResetMfa(u) }] : []),
    ...(trust && ['rejected', 'pending', 'reverification_required'].includes(u.eligibility) ? [{ label: 'Allow another attempt', onSelect: () => p.onReset(u) }] : []),
    ...(trust && u.eligibility === 'rejected' && !['superseded', 'cancelled'].includes(u.lastRejectionReason ?? '') && !(u.lastRejectionReason === 'underage' && !can.admin(me.role)) ? [{ label: 'Approve after review', onSelect: () => p.onOverturn(u) }] : []),
  ];
  return (
    <>
      <tr>
        <td>
          <div className="person">
            <Avatar name={u.displayName ?? u.email} size="lg" />
            <div style={{ minWidth: 0 }}>
              <div className="name">
                <button className="link" style={{ color: 'inherit' }} onClick={p.onToggle} aria-expanded={p.open}>
                  {u.displayName ?? '(no name)'}
                </button>
                {isGuest(u) && <Chip value="Guest" tone="plain" />}
              </div>
              <div className="sub">{u.email}</div>
            </div>
          </div>
        </td>
        <td>
          {can.admin(me.role) && u.email !== me.email ? (
            <select aria-label={`Role for ${u.email}`} value={u.role} onChange={(e) => p.onRole(u, e.target.value)} disabled={p.busy} style={{ minWidth: 148 }}>
              {(['user', ...STAFF] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
          ) : (
            u.role.replace('_', ' ')
          )}
          {u.role !== 'user' && <div className="muted small">{u.adminRegionKey ? `area: ${u.adminRegionKey}` : 'whole service'}</div>}
        </td>
        <td>
          <Chip value={u.state} />
          {u.state === 'suspended' && <div className="muted small nowrap" style={{ marginTop: 4 }}>{u.suspendedUntil ? `Until ${new Date(u.suspendedUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Until restored'}</div>}
        </td>
        <td>
          <Chip value={u.eligibility} />
          <div className="muted small nowrap" style={{ marginTop: 4 }}>
            Email {u.emailVerified ? '✓' : '✗'} &nbsp;Adult {u.adultVerified ? '✓' : '✗'} &nbsp;Mobile {u.phoneVerified ? '✓' : '–'}
          </div>
          {u.eligibility === 'verified' && u.verifiedUntil && <div className="muted small">Valid until {new Date(u.verifiedUntil).toLocaleDateString()}</div>}
          {u.reverifyReason && u.eligibility !== 'verified' && <div className="muted small">Re-check: {u.reverifyReason.replace(/_/g, ' ')}</div>}
          {u.eligibility === 'rejected' && <div className="muted small">Rejected: {(u.lastRejectionReason ?? 'other').replace(/_/g, ' ')}</div>}
        </td>
        <td className="nowrap">{fmt(u.createdAt)}</td>
        <td>
          {/* two fixed slots (the main button, the "..." menu) so every row lines up whether or not it has both */}
          <div className="action-slots">
            <span className="slot-main">
              {canActOn &&
                (u.state === 'suspended' ? (
                  <button className="btn" onClick={() => p.onRestore(u)} disabled={p.busy}>
                    Restore
                  </button>
                ) : (
                  <button className="btn danger" onClick={() => p.onSuspend(u)} disabled={p.busy}>
                    Suspend
                  </button>
                ))}
            </span>
            <span className="slot-menu">
              <RowMenu label={`More actions for ${u.displayName ?? u.email}`} items={more} />
            </span>
          </div>
        </td>
      </tr>
      {p.open && (
        <tr className="detail-row">
          <td colSpan={6}>
            <UserDetail id={u.id} me={me} openReport={p.openReport} />
          </td>
        </tr>
      )}
    </>
  );
}

function UserDetail({ id, me, openReport }: { id: string; me: Session; openReport?: (id: string) => void }) {
  const { data, error, loading, reload } = useLoad(() => get<Detail>(`/v1/admin/users/${id}`), [id], 6000);
  const act = useAction(reload);
  // the reliability detail is for staff of the whole service
  const rel = useLoad(() => (me.scope ? Promise.resolve<Reliab | null>(null) : get<Reliab>(`/v1/admin/users/${id}/reliability`)), [id, !!me.scope], 30000);
  const mod = can.moderate(me.role);
  const decide = async (reportId: string, status: 'resolved' | 'dismissed') => {
    const resolution = await askText(status === 'resolved' ? 'Resolve report' : 'Dismiss report', {
      label: 'What was decided? (kept in the audit log)',
      confirm: status === 'resolved' ? 'Resolve' : 'Dismiss',
    });
    if (resolution) act.run(() => post(`/v1/admin/reports/${reportId}/resolve`, { status, resolution }));
  };
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;
  return (
    <div className="detail">
      <dl className="facts">
        <div>
          <dt>Reports against</dt>
          <dd>{data.stats.reportsAgainst}</dd>
        </div>
        <div>
          <dt>Hosted</dt>
          <dd>{data.stats.hosted}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>{data.stats.joined}</dd>
        </div>
        <div>
          <dt>User ID</dt>
          <dd className="mono">{data.id}</dd>
        </div>
      </dl>
      {rel.data && (
        <>
          <h3>Reliability: {rel.data.label}</h3>
          <p className="muted small">
            Kept {rel.data.summary.kept} · confirmed no-shows {rel.data.summary.noShows} · left late {rel.data.summary.lateCancels} · upheld reports {rel.data.summary.upheldReports} ({rel.data.summary.upheldLast12Months} in the last 12 months) · good-event share {Math.round(rel.data.summary.rate * 100)}%
          </p>
          {rel.data.marks.length > 0 && (
            <ul className="stack" style={{ marginBottom: 8 }}>
              {rel.data.marks.map((m) => (
                <li key={m.id} className="card">
                  <div className="row wrap" style={{ justifyContent: 'space-between' }}>
                    <span>No-show note: {m.title}</span>
                    <Chip value={m.counts ? `${m.state} · counts` : m.state} />
                  </div>
                  {m.disputeNote && <div className="muted small">Their side: {m.disputeNote}</div>}
                  {m.decisionNote && <div className="muted small">Decision: {m.decisionNote}</div>}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>Every event behind the level ({rel.data.events.length})</summary>
            <ul className="stack">
              {rel.data.events.map((e, i) => (
                <li key={i} className="muted small">
                  {fmt(e.at)} · {e.text} · weight {e.weight}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <ErrorBanner message={act.error} />
      <h3>Reports about this person ({data.reports.length})</h3>
      {data.reports.length === 0 ? (
        <p className="muted">No one has reported them.</p>
      ) : (
        <ul className="stack" style={{ marginBottom: 8 }}>
          {data.reports.map((r) => (
            <li key={r.id} className="card" style={{ padding: '14px 16px' }}>
              <div className="row between wrap">
                <div className="row wrap">
                  <Chip value={r.category} />
                  <Chip value={r.status} />
                  <span className="muted small">{r.targetType === 'user' ? 'About them' : `About their ${r.targetType}${r.targetTitle ? `: ${r.targetTitle}` : ''}`}</span>
                </div>
                <span className="muted small">{fmt(r.createdAt)}</span>
              </div>
              <p style={{ margin: '8px 0 4px' }}>“{r.details || 'No details given'}”</p>
              <div className="row between wrap">
                <span className="muted small">
                  Reported by {r.reporterName ?? 'someone'}
                  {r.resolution && ` · Resolution: ${r.resolution}`}
                </span>
                <div className="row wrap">
                  {mod && ['open', 'in_review'].includes(r.status) && (
                    <>
                      <button className="btn small" onClick={() => decide(r.id, 'dismissed')} disabled={act.busy}>
                        Dismiss
                      </button>
                      <button className="btn small primary" onClick={() => decide(r.id, 'resolved')} disabled={act.busy}>
                        <Icon name="check" /> Resolve
                      </button>
                    </>
                  )}
                  {openReport && (
                    <button className="link small" onClick={() => openReport(r.id)}>
                      Open report →
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3>Recent staff actions on this account</h3>
      {data.history.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul className="plain">
          {data.history.map((h) => (
            <li key={h.id}>
              <span className="mono">{h.action}</span> <span className="muted">{fmt(h.createdAt)}</span>
              {h.metadata && <span className="muted small"> {h.metadata}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
