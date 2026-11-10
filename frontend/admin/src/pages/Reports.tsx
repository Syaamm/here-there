import { useEffect, useState } from 'react';
import { ApiError, can, get, post, type Session } from '../api';
import { Select } from '../controls';
import { askText, Avatar, Chip, Empty, ErrorBanner, fmt, urlParam, Icon, Loading, Page, Segmented, shortId, useAction, useUrlParam, useLoad, useMore } from '../ui';

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
type Person = {
  id: string;
  state?: string;
  suspendedUntil?: string | null;
  eligibility?: string; // the identity check: verified | pending | rejected | unverified | expired
  createdAt?: string;
  profile?: { displayName?: string | null; photoUrl?: string | null; homeCity?: string | null } | null;
  stats?: { reportsAgainst: number; hosted: number; joined: number };
};
const monthYear = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/**
 * One of the two people in a report (the reported person, the person who reported), as a small profile: photo, name, account
 * state, identity check, city, joined, and their record (reports against them, plans hosted and joined), with a button to the
 * full profile under People. Staff who may not open People (no "users" permission, or the person is outside their area) see
 * the name only.
 */
function PersonCard({ title, id, name, canOpen, onOpen, note }: { title: string; id: string | null; name: string; canOpen: boolean; onOpen?: () => void; note?: string | null }) {
  const p = useLoad(() => (id && canOpen ? get<Person>(`/v1/admin/users/${id}`).catch(() => null) : Promise.resolve(null)), [id, canOpen]);
  const u = p.data;
  const shown = u?.profile?.displayName ?? name;
  const facts = [u?.profile?.homeCity, u?.createdAt ? `Joined ${monthYear(u.createdAt)}` : null].filter(Boolean).join(' · ');
  return (
    <div className="box person-card">
      <span className="label">{title}</span>
      <div className="person">
        <Avatar name={shown} photo={u?.profile?.photoUrl ?? null} />
        <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
          <span className="name">{shown}</span>
          {facts && <span className="small muted">{facts}</span>}
        </span>
      </div>
      {u && (
        <div className="row wrap" style={{ gap: 6 }}>
          <Chip value={u.state === 'suspended' ? (u.suspendedUntil ? `Suspended until ${fmt(u.suspendedUntil)}` : 'Suspended') : 'Active'} tone={u.state === 'suspended' ? 'dark' : 'plain'} />
          <Chip value={u.eligibility === 'verified' ? 'Identity verified' : u.eligibility === 'pending' ? 'Identity check pending' : u.eligibility === 'rejected' ? 'Identity rejected' : 'Not verified'} tone={u.eligibility === 'verified' ? 'line' : 'plain'} />
        </div>
      )}
      {u?.stats && (
        <span className="small muted">
          {u.stats.reportsAgainst} {u.stats.reportsAgainst === 1 ? 'report' : 'reports'} against · hosted {u.stats.hosted} · joined {u.stats.joined}
        </span>
      )}
      {note && <span className="small muted">{note}</span>}
      {id && canOpen && onOpen && (
        <button className="btn small" onClick={onOpen} style={{ justifySelf: 'start' }}>
          Open full profile
        </button>
      )}
    </div>
  );
}

const nameOf = (r: R) => r.subject?.displayName ?? `A ${r.targetType}`;
const byOf = (r: R) => r.reporter.profile?.displayName ?? shortId(r.reporter.id);
const activeOf = (r: R) => ['open', 'in_review'].includes(r.status);

export function ReportsPage({ me, openUser, focusId, onClearFocus }: { me: Session; openUser?: (id: string, from?: string) => void; focusId?: string | null; onClearFocus?: () => void }) {
  // Waiting = every open or in-review report in one list, latest first. Finished reports (resolved, dismissed) come a page at a time.
  // kept in the address, so a page reload stays on the same list and report
  const [statusRaw, setStatus] = useUrlParam<'waiting' | 'resolved' | 'dismissed'>('status', 'waiting');
  const status = statusRaw ?? 'waiting';
  const [category, setCategory] = useState('');
  const waiting = status === 'waiting' && !focusId;
  const cat = category ? '&category=' + category : '';
  const params = new URLSearchParams({ ...(!focusId && { status }), ...(category && { category }) });
  // every list is read a page at a time (Waiting too: in queue order, urgent first), "Load more" asks for the next page
  const { data, error, loading, reload } = useLoad(() => get<{ items: R[]; nextCursor?: string | null }>('/v1/admin/reports?' + params), [status, category, focusId], 10000);
  const more = useMore(data, (c) => get('/v1/admin/reports?' + params + '&cursor=' + c), status + '|' + category + '|' + focusId);
  // how many wait, for the tab's number (a small summary, not the queue)
  const summary = useLoad(() => get<{ total: number }>('/v1/admin/reports/waiting'), [], 10000);
  const refreshAll = () => (more.reset(), reload(), summary.reload());
  const act = useAction(refreshAll);
  const mod = can.moderate(me.role);
  const regional = !!me.scope;

  // no assigning: any staff member who sees a report can decide it (the server makes sure only one decision counts)
  const groups: { title: string; items: R[] }[] = [{ title: '', items: focusId ? more.items.filter((r) => r.id === focusId) : more.items }];
  const items = groups.flatMap((g) => g.items);
  const ready = !!data;
  const failed = error;

  const resolve = (r: R, s: 'resolved' | 'dismissed', resolution: string) =>
    act.run(async () => {
      try {
        await post('/v1/admin/reports/' + r.id + '/resolve', { status: s, resolution });
      } catch (e) {
        // someone else decided it a moment earlier: say who ("Already resolved by Priya.") and show the report as it is now
        if (e instanceof ApiError && e.code === 'REPORT_ALREADY_DECIDED') refreshAll();
        throw e;
      }
    });
  const hide = async (r: R) => {
    const reason = await askText('Hide message', { label: 'Reason (shown to the sender)', confirm: 'Hide' });
    if (reason) act.run(() => post('/v1/admin/messages/' + r.message!.id + '/remove', { reason }));
  };
  const restore = (r: R) => act.run(() => post('/v1/admin/messages/' + r.message!.id + '/restore'));
  const warn = async (r: R) => {
    const reason = await askText('Warn ' + (r.subject?.displayName ?? 'this person'), { label: 'Warning (shown to the person)', confirm: 'Send warning' });
    if (reason) act.run(() => post('/v1/admin/users/' + r.subject!.userId + '/warn', { reason, reportId: r.id }));
  };

  const [sel, setSel] = useUrlParam<string>('report');
  const selected = items.find((r) => r.id === sel) ?? items[0] ?? null;
  // On a phone or small tablet the list and the report are one pane each (responsive.css reads data-pane): tapping a report opens
  // it, "All reports" comes back. A report you were on when the page was reloaded (or opened from the audit log) opens at once.
  const [pane, setPane] = useState<'list' | 'detail'>(() => (focusId || urlParam('report') ? 'detail' : 'list'));
  useEffect(() => {
    // the report on screen is no longer in the list (it was just resolved): back to the list, not to some other report
    if (pane === 'detail' && ready && sel && !items.some((r) => r.id === sel)) (setPane('list'), setSel(null));
  }, [pane, ready, sel, items]); // eslint-disable-line react-hooks/exhaustive-deps

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
              { id: 'waiting', label: 'Waiting', count: summary.data?.total ?? 0 },
              { id: 'resolved', label: 'Resolved' },
              { id: 'dismissed', label: 'Dismissed' },
            ]}
          />
          <Select aria-label="Category" value={category} onChange={setCategory}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </Select>
        </div>
      )}
      <ErrorBanner message={failed ?? act.error} onRetry={() => (reload(), summary.reload())} />
      {loading && !data && <Loading rows={6} />}
      {ready && items.length === 0 && <Empty>{focusId ? 'Report not found.' : 'No reports.'}</Empty>}
      {items.length > 0 && (
        <div className="split" data-pane={pane}>
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
                            <button className={r.id === selected?.id ? 'list-item active' : 'list-item'} aria-current={r.id === selected?.id} onClick={() => (setSel(r.id), setPane('detail'))}>
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
              {more.hasMore && <div style={{ padding: 12 }}>{more.more}</div>}
            </div>
          </section>
          <section className="split-detail" aria-label="Report">
            <button type="button" className="btn small split-back" onClick={() => (setPane('list'), setSel(null))}>
              <Icon name="back" />
              All reports
            </button>
            {selected &&<Detail key={selected.id} r={selected} mod={mod} regional={regional} busy={act.busy} openUser={openUser} from={`report:${selected.id}:${status}`} canSeePeople={me.role === 'admin' || !!me.permissions?.includes('users')} me={me} onResolve={resolve} onHide={hide} onRestore={restore} onWarn={warn} />}
          </section>
        </div>
      )}
    </Page>
  );
}

function Detail(p: { r: R; me: Session; mod: boolean; regional: boolean; busy: boolean; openUser?: (id: string, from?: string) => void; from: string; canSeePeople: boolean; onResolve: (r: R, s: 'resolved' | 'dismissed', note: string) => void; onHide: (r: R) => void; onRestore: (r: R) => void; onWarn: (r: R) => void }) {
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
  // a decided report names who decided it (the server records the decider on the report)
  if (!active) history.push({ at: r.createdAt, text: `${r.status === 'resolved' ? 'Resolved' : 'Dismissed'}${r.assignedName ? ` by ${r.assignedName}` : ''}${r.resolution ? `: ${r.resolution}` : ''}` });

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
        </p>
      </div>

      {/* both people in the report, each as a small profile with a way to their full one (and back to this report) */}
      <div className="grid-2">
        <PersonCard title="Reported" id={person} name={nameOf(r)} canOpen={p.canSeePeople} onOpen={person && p.openUser ? () => p.openUser!(person, p.from) : undefined} note={r.repeatOffender?.flag ? r.repeatOffender.reasons.join('; ') : null} />
        <PersonCard title="Reported by" id={r.reporter.id} name={byOf(r)} canOpen={p.canSeePeople} onOpen={p.openUser ? () => p.openUser!(r.reporter.id, p.from) : undefined} />
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
