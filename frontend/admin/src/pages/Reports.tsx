import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Avatar, Chip, Empty, ErrorBanner, fmt, Loading, Page, Segmented, shortId, useAction, useLoad, useMore } from '../ui';

type R = {
  id: string;
  targetType: string;
  targetId: string;
  category: string;
  details: string | null;
  status: string;
  assignedTo: string | null;
  assignedName: string | null;
  resolution: string | null;
  createdAt: string;
  priority: 'urgent' | 'normal';
  ageHours: number;
  overdue: boolean;
  escalated: boolean;
  reporter: { id: string; profile?: { displayName: string } | null };
  subject: { userId: string; displayName: string | null; state: string | null } | null;
  message: { id: string; body: string; moderationState: string } | null;
  repeatOffender: { flag: boolean; reasons: string[] } | null;
  open?: boolean;
  answerBy?: string | null;
  escalationLevel?: 0 | 1 | 2;
  evidence?: Evidence | null;
};
type Count = number | unknown[];
type Evidence = {
  plan: { title: string; startsAt: string; endsAt: string; hostId: string };
  attendees: Count;
  reporters: Count;
  membersSaidTheyAttended: number | null;
  hostMessagesDuringPlan: number;
  hostMarkedThisReporter: boolean;
  earlierConfirmedAbsences: number;
};

const NO_SHOW = 'host_no_show';
const CATEGORIES = [NO_SHOW, 'immediate_danger', 'harassment', 'fraud', 'inappropriate_content', 'underage', 'physical_safety', 'spam', 'financial_solicitation'];
const label = (c: string) => (c === NO_SHOW ? 'Host did not attend' : c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()));
const count = (v: Count) => (Array.isArray(v) ? v.length : v);
const span = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
/** "2h left" / "Overdue 3d" */
function due(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  const t = span(Math.abs(ms) / 3600000);
  return ms >= 0 ? { late: false, text: `${t} left` } : { late: true, text: `Overdue ${t}` };
}
const nameOf = (r: R) => r.subject?.displayName ?? `A ${r.targetType}`;
const byOf = (r: R) => r.reporter.profile?.displayName ?? shortId(r.reporter.id);
const activeOf = (r: R) => ['open', 'in_review'].includes(r.status);

export function ReportsPage({ me, openUser, focusId, onClearFocus }: { me: Session; openUser?: (id: string) => void; focusId?: string | null; onClearFocus?: () => void }) {
  // Waiting = every open or in-review report in one list, latest first. Finished reports (resolved, dismissed) come a page at a time.
  const [status, setStatus] = useState<'waiting' | 'resolved' | 'dismissed'>('waiting');
  const [category, setCategory] = useState('');
  const [who, setWho] = useState<'anyone' | 'unassigned' | 'me'>('anyone');
  const waiting = status === 'waiting' && !focusId;
  const cat = category ? '&category=' + category : '';
  const params = new URLSearchParams({ ...(!focusId && { status }), ...(category && { category }) });
  const { data, error, loading, reload } = useLoad(() => (waiting ? Promise.resolve({ items: [] as R[], nextCursor: null }) : get<{ items: R[]; nextCursor?: string | null }>('/v1/admin/reports?' + params)), [status, category, focusId], 6000);
  const more = useMore(data, (c) => get('/v1/admin/reports?' + params + '&cursor=' + c), status + '|' + category + '|' + focusId);
  const review = useLoad(() => get<{ items: R[] }>('/v1/admin/reports?status=in_review' + cat), [category], 6000);
  const open = useLoad(() => get<{ items: R[] }>('/v1/admin/reports?status=open' + cat), [category], 6000);
  const act = useAction(() => (more.reset(), reload(), open.reload(), review.reload()));
  const team = useLoad(
    () =>
      can.admin(me.role)
        ? get<{ items: { id: string; displayName: string | null; email: string; role: string; state: string; permissions: string[] }[] }>('/v1/admin/staff').then((r) =>
            r.items.filter((m) => m.state === 'active' && (m.role === 'admin' || m.permissions.includes('reports'))).map((m) => ({ id: m.id, name: m.displayName ?? m.email, role: m.role })),
          )
        : Promise.resolve(null),
    [me.role],
  );
  const mod = can.moderate(me.role);
  const regional = !!me.scope;
  const mine = (list: R[]) => list.filter((r) => (who === 'unassigned' ? !r.assignedTo : who === 'me' ? r.assignedName === me.name : true));

  const groups: { title: string; items: R[] }[] = waiting
    ? [{ title: '', items: mine([...(review.data?.items ?? []), ...(open.data?.items ?? [])]).sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt)) }]
    : [{ title: '', items: mine(focusId ? more.items.filter((r) => r.id === focusId) : more.items) }];
  const items = groups.flatMap((g) => g.items);
  const ready = waiting ? !!(review.data && open.data) : !!data;
  const failed = waiting ? (review.error ?? open.error) : error;

  const resolve = (r: R, s: 'resolved' | 'dismissed', resolution: string) => act.run(() => post('/v1/admin/reports/' + r.id + '/resolve', { status: s, resolution }));
  const hide = async (r: R) => {
    const reason = await askText('Hide message', { label: 'Reason (shown to the sender)', confirm: 'Hide' });
    if (reason) act.run(() => post('/v1/admin/messages/' + r.message!.id + '/remove', { reason }));
  };
  const restore = (r: R) => act.run(() => post('/v1/admin/messages/' + r.message!.id + '/restore'));
  const warn = async (r: R) => {
    const reason = await askText('Warn ' + (r.subject?.displayName ?? 'this person'), { label: 'Warning (shown to the person)', confirm: 'Send warning' });
    if (reason) act.run(() => post('/v1/admin/users/' + r.subject!.userId + '/warn', { reason, reportId: r.id }));
  };

  const [sel, setSel] = useState<string | null>(null);
  const selected = items.find((r) => r.id === sel) ?? items[0] ?? null;

  return (
    <Page fill title="Reports">
      {focusId ? (
        <p className="banner">
          One report from the audit log.
          <button className="link" onClick={onClearFocus}>
            Show all
          </button>
        </p>
      ) : (
        <div className="toolbar">
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { id: 'waiting', label: 'Waiting', count: (review.data?.items.length ?? 0) + (open.data?.items.length ?? 0) },
              { id: 'resolved', label: 'Resolved' },
              { id: 'dismissed', label: 'Dismissed' },
            ]}
          />
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
          <select aria-label="Assigned to" value={who} onChange={(e) => setWho(e.target.value as typeof who)}>
            <option value="anyone">Anyone</option>
            <option value="unassigned">Unassigned</option>
            <option value="me">Mine</option>
          </select>
        </div>
      )}
      <ErrorBanner message={failed ?? act.error} onRetry={() => (reload(), review.reload(), open.reload())} />
      {(waiting ? !ready && (review.loading || open.loading) : loading && !data) && <Loading rows={6} />}
      {ready && items.length === 0 && <Empty>{focusId ? 'Report not found.' : 'No reports.'}</Empty>}
      {items.length > 0 && (
        <div className="split">
          <section className="split-list" aria-label="Reports">
            <div className="list-scroll">
              {groups.map((g) =>
                g.items.length === 0 && g.title ? null : (
                  <div key={g.title || 'all'}>
                    {g.title && (
                      <div className="group-head">
                        <span>{g.title}</span>
                        <span>{g.items.length}</span>
                      </div>
                    )}
                    <ul className="items">
                      {g.items.map((r) => {
                        const active = activeOf(r);
                        const d = active && r.answerBy ? due(r.answerBy) : null;
                        const hot = active && (d?.late || r.priority === 'urgent');
                        return (
                          <li key={r.id}>
                            <button className={r.id === selected?.id ? 'list-item active' : 'list-item'} aria-current={r.id === selected?.id} onClick={() => setSel(r.id)}>
                              <span className="body">
                                <span className="title">{r.details || label(r.category)}</span>
                                <span className="meta">
                                  {label(r.category)} · {nameOf(r)}
                                </span>
                              </span>
                              <span className="aside">{d ? hot ? <Chip tone="dark" value={d.text} /> : <span className="small muted">{d.text}</span> : <Chip value={r.status} />}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ),
              )}
              {!waiting && more.hasMore && <div style={{ padding: 12 }}>{more.more}</div>}
            </div>
          </section>
          <section className="split-detail" aria-label="Report">
            {selected && <Detail key={selected.id} r={selected} mod={mod} regional={regional} busy={act.busy} openUser={openUser} me={me} team={team.data} onAssign={(userId?: string) => act.run(() => post('/v1/admin/reports/' + selected.id + '/assign', userId ? { userId } : {}))} onResolve={resolve} onHide={hide} onRestore={restore} onWarn={warn} />}
          </section>
        </div>
      )}
    </Page>
  );
}

function Detail(p: { r: R; me: Session; team: { id: string; name: string; role: string }[] | null; mod: boolean; regional: boolean; busy: boolean; openUser?: (id: string) => void; onAssign: (userId?: string) => void; onResolve: (r: R, s: 'resolved' | 'dismissed', note: string) => void; onHide: (r: R) => void; onRestore: (r: R) => void; onWarn: (r: R) => void }) {
  const { r, mod, regional, busy } = p;
  const [note, setNote] = useState('');
  const active = activeOf(r);
  const d = active && r.answerBy ? due(r.answerBy) : null;
  const person = r.subject?.userId ?? (r.targetType === 'user' ? r.targetId : null);
  const first = (r.subject?.displayName ?? 'person').split(' ')[0];
  const noteOk = note.trim().length >= 3;
  const escalated = (r.escalationLevel ?? 0) > 0 || r.escalated;
  const history: { at: string; text: string }[] = [{ at: r.createdAt, text: `Filed by ${byOf(r)}` }];
  if (escalated && r.answerBy) history.push({ at: r.answerBy, text: 'Escalated to on-call' });
  if (r.assignedName) history.push({ at: r.createdAt, text: `Assigned to ${r.assignedName}` });
  if (!active) history.push({ at: r.createdAt, text: `${r.status === 'resolved' ? 'Resolved' : 'Dismissed'}${r.resolution ? `: ${r.resolution}` : ''}` });

  return (
    <div className="detail-scroll">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <Chip tone="plain" value={label(r.category)} />
          <Chip value={r.status} />
          {r.priority === 'urgent' && active && <Chip tone="dark" value="Urgent" />}
          {escalated && active && <Chip tone="dark" value={r.escalationLevel === 2 ? 'Critical' : 'Escalated'} />}
          {r.repeatOffender?.flag && <Chip tone="dark" value="Repeat" />}
        </div>
        <h2 style={{ margin: 0 }}>{r.details || 'No details'}</h2>
        <p className="small muted">
          {fmt(r.createdAt)}
          {d && ` · ${d.text}`}
          {r.assignedName ? ` · ${r.assignedName}` : active ? ' · Unassigned' : ''}
        </p>
      </div>

      <div className="grid-2">
        <div className="box">
          <span className="label">Reported</span>
          <div className="person">
            <Avatar name={nameOf(r)} size="sm" />
            <span style={{ minWidth: 0 }}>
              <span className="name">{nameOf(r)}</span>
            </span>
          </div>
          {r.repeatOffender?.flag && <span className="small muted">{r.repeatOffender.reasons.join('; ')}</span>}
          {person && p.openUser && (
            <button className="link small" onClick={() => p.openUser!(person)}>
              Open profile
            </button>
          )}
        </div>
        <div className="box">
          <span className="label">Reported by</span>
          <div className="person">
            <Avatar name={byOf(r)} size="sm" />
            <span className="name">{byOf(r)}</span>
          </div>
        </div>
      </div>

      {r.evidence ? (
        <EvidenceBox e={r.evidence} />
      ) : r.message ? (
        <div className="box">
          <span className="label">Message{r.message.moderationState === 'removed' ? ' · hidden' : ''}</span>
          <p className="quote">{r.message.body}</p>
        </div>
      ) : null}

      <div>
        <h3 style={{ marginTop: 0 }}>History</h3>
        <ul className="timeline">
          {history.map((h, i) => (
            <li key={i}>
              <span className="muted">{fmt(h.at)}</span>
              <span>{h.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {mod && active && (
        <div className="stack" style={{ gap: 10, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <label>
            Decision note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" maxLength={500} />
          </label>
          <div className="actions-bar">
            {p.team ? (
              <select aria-label="Assign to" value={r.assignedTo ?? ''} onChange={(e) => e.target.value && p.onAssign(e.target.value)} disabled={busy} style={{ width: 'auto', minHeight: 38 }}>
                <option value="" disabled>
                  Assign to…
                </option>
                {p.team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.role === 'admin' ? ' (admin)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              r.assignedName !== p.me.name && (
                <button className="btn" onClick={() => p.onAssign()} disabled={busy}>
                  Take this report
                </button>
              )
            )}
            {r.message && r.message.moderationState !== 'removed' && (
              <button className="btn" onClick={() => p.onHide(r)} disabled={busy}>
                Hide message
              </button>
            )}
            {r.subject && (
              <button className="btn" onClick={() => p.onWarn(r)} disabled={busy}>
                Warn {first}
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn" disabled={busy || !noteOk} onClick={() => p.onResolve(r, 'dismissed', note.trim())}>
              Dismiss
            </button>
            <button className="btn primary" disabled={busy || !noteOk} onClick={() => p.onResolve(r, 'resolved', note.trim())}>
              {r.category === NO_SHOW ? 'Confirm absence' : 'Resolve'}
            </button>
          </div>
        </div>
      )}
      {mod && !active && r.message?.moderationState === 'removed' && (
        <div className="actions-bar">
          <button className="btn" onClick={() => p.onRestore(r)} disabled={busy}>
            Restore message
          </button>
        </div>
      )}
    </div>
  );
}

function EvidenceBox({ e }: { e: Evidence }) {
  return (
    <div className="box">
      <span className="label">Plan</span>
      <p>
        <strong>{e.plan.title}</strong> · {fmt(e.plan.startsAt)}
      </p>
      <dl className="facts" style={{ marginTop: 6 }}>
        <div>
          <dt>Say host absent</dt>
          <dd>
            {count(e.reporters)} of {count(e.attendees)}
          </dd>
        </div>
        <div>
          <dt>Host messages</dt>
          <dd>{e.hostMessagesDuringPlan}</dd>
        </div>
        {e.membersSaidTheyAttended != null && (
          <div>
            <dt>Marked attended</dt>
            <dd>{e.membersSaidTheyAttended}</dd>
          </div>
        )}
        <div>
          <dt>Earlier absences</dt>
          <dd>{e.earlierConfirmedAbsences}</dd>
        </div>
      </dl>
      {e.hostMarkedThisReporter && <span className="small muted">Host marked this reporter absent.</span>}
    </div>
  );
}
