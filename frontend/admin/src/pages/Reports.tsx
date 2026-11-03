import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Empty, ErrorBanner, fmt, Icon, Loading, Page, shortId, useAction, useLoad, useMore } from '../ui';
import './Reports.css';

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
/** What the server found out about a "host did not show up" report. */
type Evidence = {
  plan: { title: string; startsAt: string; endsAt: string; hostId: string };
  attendees: Count;
  reporters: Count;
  membersSaidTheyAttended: number | null;
  hostMessagesDuringPlan: number;
  hostMarkedThisReporter: boolean;
  earlierConfirmedAbsences: number;
};
type Workload = {
  policy: { coverage: { text: string; onDutyNow: boolean }; answerWithin: { urgent: string; normal: string } };
  queue: { unassigned: number; urgent: number; overdue: number; oldestUnassignedHours: number | null };
  moderators: { id: string; name: string; role: string; assigned: number; overdue: number; oldestHours: number | null; resolvedLast7Days: number }[];
};
type Status = 'open' | 'in_review' | 'resolved' | 'dismissed';

const NO_SHOW = 'host_no_show';
const CATEGORIES = [NO_SHOW, 'immediate_danger', 'harassment', 'fraud', 'inappropriate_content', 'underage', 'physical_safety', 'spam', 'financial_solicitation'];
const LABELS: Record<string, string> = { [NO_SHOW]: 'Host did not show up' };
const label = (c: string) => LABELS[c] ?? c.replace(/_/g, ' ');
const count = (v: Count) => (Array.isArray(v) ? v.length : v);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "due in 3 h" / "overdue by 40 min", from the time the server says an answer is due. */
function due(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  const h = Math.abs(ms) / 3600000;
  const t = h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
  return ms >= 0 ? { late: false, text: `due in ${t}` } : { late: true, text: `overdue by ${t}` };
}
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

/** "Overdue 7 h" / "1 h left" from the time an answer is due. */
function left(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  const h = Math.abs(ms) / 3600000;
  const t = h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
  return ms >= 0 ? { late: false, soon: h < 2, text: `${t} left` } : { late: true, soon: false, text: `Overdue ${t}` };
}
/** How much of the answer time has gone, 0 to 100. */
const used = (r: R, now = Date.now()) => {
  if (!r.answerBy) return 0;
  const a = +new Date(r.createdAt);
  const b = +new Date(r.answerBy);
  return Math.max(4, Math.min(100, ((now - a) / Math.max(1, b - a)) * 100));
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
const nameOf = (r: R) => r.subject?.displayName ?? `a ${r.targetType}`;
const byOf = (r: R) => r.reporter.profile?.displayName ?? shortId(r.reporter.id);
const activeOf = (r: R) => ['open', 'in_review'].includes(r.status);
const tint = (r: R) => activeOf(r) && (r.overdue || (r.escalationLevel ?? 0) > 0 || r.escalated);

export function ReportsPage({ me, openUser, focusId, onClearFocus, onCall }: { me: Session; openUser?: (id: string) => void; focusId?: string | null; onClearFocus?: () => void; onCall?: () => void }) {
  const [status, setStatus] = useState<Status>('open');
  const [category, setCategory] = useState('');
  const [who, setWho] = useState<'anyone' | 'unassigned' | 'me'>('anyone');
  const params = new URLSearchParams({ ...(!focusId && { status }), ...(category && { category }) });
  const { data, error, loading, reload } = useLoad(
    // opened from the audit log: look in every status so the report is found whatever state it is in
    () => get<{ items: R[]; nextCursor?: string | null }>(`/v1/admin/reports?${params}`),
    [status, category, focusId],
    6000,
  );
  // the waiting queue always comes whole (urgent first); finished reports come a page at a time
  const more = useMore(data, (c) => get(`/v1/admin/reports?${params}&cursor=${c}`), `${status}|${category}|${focusId}`);
  const all = focusId ? more.items.filter((r) => r.id === focusId) : more.items;
  const items = all.filter((r) => (who === 'unassigned' ? !r.assignedTo : who === 'me' ? r.assignedName === me.name : true));
  const open = useLoad(() => get<{ items: R[] }>('/v1/admin/reports?status=open'), [status], 6000);
  const review = useLoad(() => get<{ items: R[] }>('/v1/admin/reports?status=in_review'), [status], 6000);
  // the workload view is for staff of the whole service
  const regional = !!me.scope;
  const work = useLoad(() => (regional ? Promise.resolve<Workload | null>(null) : get<Workload>('/v1/admin/reports/workload')), [status, regional], 15000);
  const act = useAction(() => (more.reset(), reload(), open.reload(), review.reload(), work.reload()));
  const mod = can.moderate(me.role);

  const resolve = (r: R, s: 'resolved' | 'dismissed', resolution: string) => act.run(() => post(`/v1/admin/reports/${r.id}/resolve`, { status: s, resolution }));
  const removeMessage = async (r: R) => {
    const reason = await askText('Hide this message?', { label: 'Why? The sender is told this reason, and can ask for a review.', confirm: 'Hide message' });
    if (reason) act.run(() => post(`/v1/admin/messages/${r.message!.id}/remove`, { reason }));
  };
  const restoreMessage = (r: R) => act.run(() => post(`/v1/admin/messages/${r.message!.id}/restore`));
  const warn = async (r: R) => {
    const reason = await askText(`Warn ${r.subject?.displayName ?? 'this person'}?`, { label: 'What is the warning about? The person reads this and can ask for a review.', confirm: 'Send warning' });
    if (reason) act.run(() => post(`/v1/admin/users/${r.subject!.userId}/warn`, { reason, reportId: r.id }));
  };

  const w = work.data;
  const [sel, setSel] = useState<string | null>(null);
  const selected = items.find((r) => r.id === sel) ?? items[0] ?? null;
  const openList = open.data?.items ?? [];
  const overdue = openList.filter((r) => r.overdue).length;
  const unassigned = openList.filter((r) => !r.assignedTo).length;
  const title = open.data ? (openList.length === 0 ? 'No open reports' : `${openList.length} open${overdue ? `, ${overdue} overdue` : ''}`) : 'Reports';
  const pills: { id: Status; label: string; n?: number }[] = [
    { id: 'open', label: 'Open', n: open.data?.items.length },
    { id: 'in_review', label: 'In review', n: review.data?.items.length },
    { id: 'resolved', label: 'Resolved' },
    { id: 'dismissed', label: 'Dismissed' },
  ];

  return (
    <Page
      fill
      title={title}
      actions={
        <>
          {w && (
            <span className="rp-meta">
              {unassigned === openList.length && openList.length > 0 ? `All ${unassigned} unassigned` : `${unassigned} unassigned`} · urgent answered in {w.policy.answerWithin.urgent}, others in {w.policy.answerWithin.normal}
            </span>
          )}
          {onCall && !regional && (
            <button className="rp-pill-btn" onClick={onCall}>
              Who’s on call
            </button>
          )}
        </>
      }
    >
      <div className="rp-filters" style={focusId ? { display: 'none' } : undefined}>
        <div className="rp-pills" role="group" aria-label="Status">
          {pills.map((p) => (
            <button key={p.id} type="button" className={status === p.id ? 'rp-pill on' : 'rp-pill'} aria-pressed={status === p.id} onClick={() => setStatus(p.id)}>
              {p.label}
              {!!p.n && <span className="rp-count">{p.n}</span>}
            </button>
          ))}
        </div>
        <label className="rp-select">
          <span className="sr">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="rp-select">
          <span className="sr">Assigned to</span>
          <select value={who} onChange={(e) => setWho(e.target.value as typeof who)}>
            <option value="anyone">Anyone assigned</option>
            <option value="unassigned">Unassigned</option>
            <option value="me">Assigned to me</option>
          </select>
        </label>
      </div>
      {focusId && (
        <p className="note">
          <Icon name="flag" />
          Showing the one report you opened from the audit log.
          <button className="link" style={{ marginLeft: 'auto' }} onClick={onClearFocus}>
            Show the whole queue
          </button>
        </p>
      )}
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      {loading && !data && <Loading rows={6} />}
      {data && items.length === 0 && <Empty title="Nothing here">{focusId ? 'That report could not be found.' : 'No reports for this filter.'}</Empty>}
      {items.length > 0 && (
        <div className="split rp-split">
          <section className="rp-list" aria-label="Reports">
            <ul className="rp-cards">
              {items.map((r) => {
                const active = activeOf(r);
                const d = active && r.answerBy ? left(r.answerBy) : null;
                const bar = d?.late ? 'late' : d?.soon ? 'soon' : 'ok';
                return (
                  <li key={r.id}>
                    <button className={r.id === selected?.id ? 'rp-card on' : 'rp-card'} aria-current={r.id === selected?.id} onClick={() => setSel(r.id)}>
                      <span className="rp-card-top">
                        <span className="rp-cat">{label(r.category)}</span>
                        {d ? <span className={`rp-due ${bar}`}>{d.text}</span> : <span className="rp-due done">{r.status.replace(/_/g, ' ')}</span>}
                      </span>
                      <span className="rp-quote">“{r.details || 'No details given'}”</span>
                      <span className="rp-who">
                        {nameOf(r)} · by {byOf(r)}
                      </span>
                      {d && (
                        <span className="rp-bar" aria-hidden="true">
                          <i className={bar} style={{ width: `${used(r)}%` }} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {more.hasMore && <div style={{ paddingTop: 8 }}>{more.more}</div>}
          </section>

          <section className="rp-detail" aria-label="Report details">
            {selected && <ReportDetail key={selected.id} r={selected} mod={mod} regional={regional} busy={act.busy} w={w} openUser={openUser} onAssign={() => act.run(() => post(`/v1/admin/reports/${selected.id}/assign`))} onResolve={resolve} onHide={removeMessage} onRestore={restoreMessage} onWarn={warn} />}
          </section>
        </div>
      )}
    </Page>
  );
}

function ReportDetail(p: { r: R; w: Workload | null; mod: boolean; regional: boolean; busy: boolean; openUser?: (id: string) => void; onAssign: () => void; onResolve: (r: R, s: 'resolved' | 'dismissed', note: string) => void; onHide: (r: R) => void; onRestore: (r: R) => void; onWarn: (r: R) => void }) {
  const { r, mod, regional, busy, w } = p;
  const [note, setNote] = useState('');
  const active = activeOf(r);
  const d = active && r.answerBy ? left(r.answerBy) : null;
  const person = r.subject?.userId ?? (r.targetType === 'user' ? r.targetId : null);
  const first = (r.subject?.displayName ?? 'person').split(' ')[0];
  const noteOk = note.trim().length >= 3;
  const escalated = (r.escalationLevel ?? 0) > 0 || r.escalated;
  const history: { at: string; text: string; tone: 'grey' | 'red' | 'green' }[] = [{ at: r.createdAt, text: `${byOf(r)} filed the report`, tone: 'grey' }];
  if (escalated && r.answerBy) history.push({ at: r.answerBy, text: `Missed the ${r.priority === 'urgent' ? (w?.policy.answerWithin.urgent ?? 'urgent') : (w?.policy.answerWithin.normal ?? '24 h')} answer time, escalated to on-call`, tone: 'red' });
  if (r.assignedName) history.push({ at: r.createdAt, text: `Assigned to ${r.assignedName}`, tone: 'grey' });
  if (!active) history.push({ at: r.createdAt, text: `${r.status === 'resolved' ? 'Resolved' : 'Dismissed'}${r.resolution ? `: ${r.resolution}` : ''}`, tone: 'green' });
  return (
    <>
      <header className={tint(r) ? 'rp-head alert' : 'rp-head'}>
        <div className="rp-head-main">
          <div className="rp-chips">
            <span className="rp-chip">{label(r.category)}</span>
            <span className="rp-chip">{r.status === 'open' ? `Open · ${r.assignedName ? r.assignedName : 'unassigned'}` : r.status.replace(/_/g, ' ')}</span>
            {escalated && active && <span className="rp-chip red">{r.escalationLevel === 2 ? 'Critical' : 'Escalated'}</span>}
            {r.priority === 'urgent' && active && <span className="rp-chip red">Urgent</span>}
            {r.repeatOffender?.flag && <span className="rp-chip red">Repeat</span>}
          </div>
          <h2 className="rp-headline">“{r.details || 'No details given'}”</h2>
        </div>
        <div className="rp-head-side">
          {d && <strong className={d.late ? 'rp-big late' : 'rp-big'}>{d.text}</strong>}
          <span className="muted small">
            Filed {fmt(r.createdAt)}
            {active ? ` · waiting ${hours(r.ageHours)}` : ''}
          </span>
        </div>
      </header>

      <div className="rp-body">
        <div className="rp-two">
          <div className="rp-box">
            <small className="rp-label">Reported {r.targetType === 'user' ? 'person' : r.targetType}</small>
            <div className="rp-person">
              <span className="rp-ini red">{initials(r.subject?.displayName ?? r.targetType)}</span>
              <span>
                <strong>{r.subject?.displayName ?? `A ${r.targetType}`}</strong>
                <span className="mono small muted" style={{ display: 'block' }}>
                  {shortId(person ?? r.targetId)}
                </span>
              </span>
            </div>
            <p className="rp-note">{r.repeatOffender?.flag ? `Earlier: ${r.repeatOffender.reasons.join('; ')}.` : 'No earlier reports or warnings.'}</p>
            {person && p.openUser && (
              <button className="link" onClick={() => p.openUser!(person)}>
                Open profile →
              </button>
            )}
          </div>
          <div className="rp-box">
            <small className="rp-label">Reported by</small>
            <div className="rp-person">
              <span className="rp-ini blue">{initials(byOf(r))}</span>
              <strong>{byOf(r)}</strong>
            </div>
            {r.message?.moderationState === 'removed' && <p className="rp-note">The message was hidden.</p>}
          </div>
        </div>

        <div>
          <small className="rp-label">Where it happened</small>
          {r.evidence ? (
            <EvidenceBlock e={r.evidence} />
          ) : (
            <div className="rp-where">
              {r.message ? (
                <>
                  <strong>The message{r.message.moderationState === 'removed' ? ' (hidden)' : ''}:</strong> {r.message.body}
                </>
              ) : (
                <>
                  A {r.targetType} · <span className="mono">{shortId(r.targetId)}</span>
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <small className="rp-label">History</small>
          <ul className="rp-history">
            {history.map((h, i) => (
              <li key={i}>
                <i className={h.tone} />
                <span className="muted">{fmt(h.at)}</span>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {mod && active && (
        <footer className="rp-foot">
          <label className="rp-note-field">
            <span>
              <strong>Decision note</strong> <span className="muted">· saved to the audit log{person ? '; the person it is about can read it if you resolve' : ''}</span>
            </span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={person ? 'Why you decided this. The person it is about can read it (and ask for a review).' : 'Why you decided this'} maxLength={500} />
          </label>
          <div className="rp-actions">
            {r.status === 'open' && (
              <button className="rp-btn" onClick={p.onAssign} disabled={busy}>
                Assign to me
              </button>
            )}
            <button className="rp-btn" disabled={busy || !noteOk} onClick={() => p.onResolve(r, 'dismissed', note.trim())}>
              Dismiss
            </button>
            {!regional && r.message && r.message.moderationState !== 'removed' && (
              <button className="rp-btn pink" onClick={() => p.onHide(r)} disabled={busy}>
                Hide message
              </button>
            )}
            {!regional && r.subject && (
              <button className="rp-btn pink" onClick={() => p.onWarn(r)} disabled={busy}>
                Warn {first}
              </button>
            )}
            <button className="rp-btn dark" disabled={busy || !noteOk} onClick={() => p.onResolve(r, 'resolved', note.trim())}>
              {r.category === NO_SHOW ? 'Confirm' : 'Resolve'}
            </button>
          </div>
          {r.category === NO_SHOW && <small className="muted">Confirming cancels the host's no-show notes for this plan and counts against the host.</small>}
        </footer>
      )}
      {mod && !regional && !active && r.message?.moderationState === 'removed' && (
        <footer className="rp-foot">
          <div className="rp-actions">
            <button className="rp-btn" onClick={() => p.onRestore(r)} disabled={busy}>
              Put the message back
            </button>
          </div>
        </footer>
      )}
    </>
  );
}

function EvidenceBlock({ e }: { e: Evidence }) {
  const total = count(e.attendees);
  const said = count(e.reporters);
  return (
    <div className="evidence" role="group" aria-label="What we found about this plan">
      <h4>What we found</h4>
      <p>
        <strong>{e.plan.title}</strong>, {fmt(e.plan.startsAt)}.
      </p>
      <p>
        {said} of {total} {total === 1 ? 'member says' : 'members say'} the host did not come. The host wrote {plural(e.hostMessagesDuringPlan, 'message', 'messages')} in the chat during the plan.
        {e.membersSaidTheyAttended != null && ` ${plural(e.membersSaidTheyAttended, 'member', 'members')} marked themselves as attended.`}
        {e.hostMarkedThisReporter && ' The host also marked this reporter as a no-show.'} Earlier confirmed absences: {e.earlierConfirmedAbsences}.
      </p>
    </div>
  );
}
