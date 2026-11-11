import { useEffect, useState } from 'react';
import { ApiError, can, get, post, type Session } from '../api';
import { Select } from '../controls';
import { askChecksText, askChoiceText, askText, Avatar, Chip, Empty, ErrorBanner, fmt, urlParam, setUrlParam, Icon, Loading, Page, PageBar, Segmented, useAction, useUrlParam, useLoad } from '../ui';

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
  reporter: { id: string; email?: string | null; profile?: { displayName: string } | null };
  subject: { userId: string; displayName: string | null; email?: string | null; state: string | null } | null;
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
const WORDS: Record<string, string> = {
  host_no_show: 'Host did not show up',
  immediate_danger: 'Someone is in danger',
  harassment: 'Bullying or harassment',
  fraud: 'Scam or fraud',
  inappropriate_content: 'Inappropriate content',
  underage: 'Person may be under 18',
  physical_safety: 'Feels unsafe',
  spam: 'Spam',
  financial_solicitation: 'Asking for money',
};
const label = (c: string) => WORDS[c] ?? c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
const STATUS_WORDS: Record<string, string> = { open: 'Waiting', in_review: 'Waiting', resolved: 'Action taken', dismissed: 'No action needed' };
const statusWord = (s: string) => STATUS_WORDS[s] ?? s;
const count = (v: Count) => (Array.isArray(v) ? v.length : v);
const span = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`);
/** "2h left" / "Overdue 3d" */
function due(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  const t = span(Math.abs(ms) / 3600000);
  // only an overdue report says so: there is no countdown
  return ms >= 0 ? null : { late: true, text: `Late by ${t}` };
}
type Person = {
  id: string;
  state?: string;
  suspendedUntil?: string | null;
  eligibility?: string; // the identity check: verified | pending | rejected | unverified | expired
  createdAt?: string;
  email?: string;
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
  const shown = u?.profile?.displayName ?? u?.email ?? name;
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
        <div className="row wrap" style={{ gap: 8 }}>
          <Chip value={u.state === 'suspended' ? (u.suspendedUntil ? `Suspended until ${fmt(u.suspendedUntil)}` : 'Suspended') : 'Active'} tone={u.state === 'suspended' ? 'dark' : 'plain'} />
          <Chip value={u.eligibility === 'verified' ? 'ID verified' : u.eligibility === 'pending' ? 'ID check pending' : u.eligibility === 'rejected' ? 'ID check failed' : 'Not verified'} tone={u.eligibility === 'verified' ? 'line' : 'plain'} />
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

const nameOf = (r: R) => r.subject?.displayName ?? r.subject?.email ?? `A ${r.targetType}`;
const byOf = (r: R) => r.reporter.profile?.displayName ?? r.reporter.email ?? 'A member';
const activeOf = (r: R) => ['open', 'in_review'].includes(r.status);

export function ReportsPage({ me, openUser, focusId, onClearFocus }: { me: Session; openUser?: (id: string, from?: string) => void; focusId?: string | null; onClearFocus?: () => void }) {
  // Waiting = every open or in-review report in one list, latest first. Finished reports (resolved, dismissed) come a page at a time.
  // kept in the address, so a page reload stays on the same list and report
  const [statusRaw, setStatus] = useUrlParam<'waiting' | 'resolved' | 'dismissed'>('status', 'waiting');
  const status = statusRaw ?? 'waiting';
  const [category, setCategory] = useState('');
  // find reports by a person: reports about them, or reports they filed
  // opened from a person's profile ("Reports against"): searched for them, on Against, across every state
  const [q, setQ] = useState(() => urlParam('q') ?? '');
  const [who, setWho] = useState<'both' | 'against' | 'by'>(() => (urlParam('who') === 'against' ? 'against' : 'both'));
  const [term, setTerm] = useState(() => (urlParam('q') ?? '').trim());
  useEffect(() => {
    setUrlParam('q', null);
    setUrlParam('who', null);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const waiting = status === 'waiting' && !focusId && !term;
  const cat = category ? '&category=' + category : '';
  // a search looks through every report of that person: all states and all types
  const [pageNo, setPageNo] = useState(1);
  useEffect(() => setPageNo(1), [term, who, status, category]);
  const params = new URLSearchParams({ limit: '20', page: String(pageNo), ...(!focusId && !term && { status }), ...(category && !term && { category }), ...(term && { q: term, who }) });
  // every list is read a page at a time (Waiting too: in queue order, urgent first), "Load more" asks for the next page
  const { data, error, loading, reload } = useLoad(() => get<{ items: R[]; nextCursor?: string | null; page?: number; pages?: number; total?: number }>('/v1/admin/reports?' + params), [status, category, focusId, term, who, pageNo], 10000);
  // how many wait, for the tab's number (a small summary, not the queue)
  const summary = useLoad(() => get<{ total: number }>('/v1/admin/reports/waiting'), [], 10000);
  const refreshAll = () => (reload(), summary.reload());
  const act = useAction(refreshAll);
  const mod = can.moderate(me.role);
  const regional = !!me.scope;

  // no assigning: any staff member who sees a report can decide it (the server makes sure only one decision counts)
  const groups: { title: string; items: R[] }[] = [{ title: '', items: focusId ? (data?.items ?? []).filter((r) => r.id === focusId) : (data?.items ?? []) }];
  const items = groups.flatMap((g) => g.items);
  const ready = !!data;
  const failed = error;

  const resolve = (r: R, s: 'resolved' | 'dismissed', resolution: string, pending: { hide?: string; warn?: string; verify?: string; suspend?: { days?: number; reason: string } } = {}) =>
    act.run(async () => {
      try {
        // the message hidden and the warning sent are only prepared in the report until Take action is pressed
        if (pending.hide && r.message) await post('/v1/admin/messages/' + r.message.id + '/remove', { reason: pending.hide });
        if (pending.warn && r.subject) await post('/v1/admin/users/' + r.subject.userId + '/warn', { reason: pending.warn, reportId: r.id });
        if (pending.verify && r.subject) await post('/v1/admin/users/' + r.subject.userId + '/require-reverification', { reason: 'security', note: pending.verify });
        if (pending.suspend && r.subject) await post('/v1/admin/users/' + r.subject.userId + '/suspend', { reason: pending.suspend.reason, ...(pending.suspend.days && { days: pending.suspend.days }) });
        await post('/v1/admin/reports/' + r.id + '/resolve', { status: s, resolution });
      } catch (e) {
        // someone else decided it a moment earlier: say who ("Already resolved by Priya.") and show the report as it is now
        if (e instanceof ApiError && e.code === 'REPORT_ALREADY_DECIDED') refreshAll();
        throw e;
      }
    });
  const restore = (r: R) => act.run(() => post('/v1/admin/messages/' + r.message!.id + '/restore'));

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
        <div className="toolbar tight">
          <div className="rs" role="search">
            <Icon name="search" />
            <input type="search" aria-label="Search reports by person" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button type="button" className="search-clear" aria-label="Clear the search" onClick={() => setQ('')}>
                <Icon name="x" />
              </button>
            )}
            <span className="rs-sep" aria-hidden="true" />
            {(['both', 'against', 'by'] as const).map((w) => (
              <button key={w} type="button" className={who === w ? 'on' : ''} aria-pressed={who === w} onClick={() => setWho(w)}>
                {w === 'both' ? 'Both' : w === 'against' ? 'Against' : 'By'}
              </button>
            ))}
          </div>
          <div className="rs-end">
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { id: 'waiting', label: 'Waiting', count: summary.data?.total ?? 0 },
              { id: 'resolved', label: 'Action taken' },
              { id: 'dismissed', label: 'No action needed' },
            ]}
          />
          <Select aria-label="Category" value={category} onChange={setCategory}>
            <option value="">All types</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </Select>
          </div>
        </div>
      )}
      <ErrorBanner message={failed ?? act.error} onRetry={() => (reload(), summary.reload())} />
      {loading && !data && <Loading rows={6} />}
      {ready && items.length === 0 && <Empty>{focusId ? 'Report not found.' : term ? `No ${status === 'waiting' ? 'waiting ' : ''}reports ${who === 'by' ? 'filed by' : 'against'} “${term}”.` : 'No reports.'}</Empty>}
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
                              <span className="aside">{d ? <Chip tone={hot ? 'dark' : 'plain'} value={d.text} /> : <Chip value={statusWord(r.status)} />}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ),
              )}
            </div>
            {!focusId && <PageBar page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? items.length} noun={['report', 'reports']} onPage={setPageNo} busy={loading} />}
          </section>
          <section className="split-detail" aria-label="Report">
            <button type="button" className="btn small split-back" onClick={() => (setPane('list'), setSel(null))}>
              <Icon name="back" />
              All reports
            </button>
            {selected &&<Detail key={selected.id} r={selected} mod={mod} regional={regional} busy={act.busy} openUser={openUser} from={`report:${selected.id}:${status}`} canSeePeople={me.role === 'admin' || !!me.permissions?.includes('users')} me={me} onResolve={resolve} onRestore={restore} />}
          </section>
        </div>
      )}
    </Page>
  );
}

function Detail(p: { r: R; me: Session; mod: boolean; regional: boolean; busy: boolean; openUser?: (id: string, from?: string) => void; from: string; canSeePeople: boolean; onResolve: (r: R, s: 'resolved' | 'dismissed', note: string, pending?: { hide?: string; warn?: string; verify?: string; suspend?: { days?: number; reason: string } }) => void; onRestore: (r: R) => void }) {
  const { r, mod, regional, busy } = p;
  const [note, setNote] = useState('');
  const active = activeOf(r);
  const d = active && r.answerBy ? due(r.answerBy) : null;
  const person = r.subject?.userId ?? (r.targetType === 'user' ? r.targetId : null);
  const first = (r.subject?.displayName ?? 'person').split(' ')[0];
  const noteOk = note.trim().length >= 3;
  // "Take action": tick what to do (at least one); "No action needed" is the button beside it, so closing with nothing done is not offered here
  const takeAction = async () => {
    const choices: [string, string][] = [];
    if (r.message && r.message.moderationState !== 'removed') choices.push(['hide', 'Hide the message']);
    if (r.subject) choices.push(['warn', 'Send a warning'], ['verify', 'Ask them to verify their identity again'], ['suspend', 'Suspend them']);
    if (choices.length === 0) {
      const t = await askText('Close the report', { label: 'Note (kept with the report)', confirm: 'Close report' });
      if (t) p.onResolve(r, 'resolved', note.trim() || t, {});
      return;
    }
    const a = await askChecksText('Take action', choices, { label: 'Message to the person (they will be told)', confirm: 'Take action', choiceLabel: 'What to do (choose at least one)' });
    if (!a) return;
    const on = (k: string) => a.choices.includes(k);
    let suspend: { days?: number; reason: string } | undefined;
    if (on('suspend')) {
      const sus = await askChoiceText(`Suspend ${first}`, [['1', '1 day'], ['3', '3 days'], ['7', '7 days'], ['30', '30 days'], ['0', 'Until restored']], { label: 'Reason for the suspension', confirm: 'Suspend', choiceLabel: 'For' });
      if (!sus) return;
      suspend = { reason: sus.text, ...(sus.choice !== '0' && { days: Number(sus.choice) }) };
    }
    p.onResolve(r, 'resolved', note.trim() || a.text, {
      hide: on('hide') ? a.text : undefined,
      warn: on('warn') ? a.text : undefined,
      verify: on('verify') ? a.text : undefined,
      suspend,
    });
  };
  const escalated = (r.escalationLevel ?? 0) > 0 || r.escalated;
  const history: { at: string; text: string }[] = [{ at: r.createdAt, text: `Filed by ${byOf(r)}` }];
  if (escalated && r.answerBy) history.push({ at: r.answerBy, text: 'Passed to a senior team member' });
  // a decided report names who decided it (the server records the decider on the report)
  if (!active) history.push({ at: r.createdAt, text: `${r.status === 'resolved' ? 'Action taken' : 'No action needed'}${r.assignedName ? ` by ${r.assignedName}` : ''}${r.resolution ? `: ${r.resolution}` : ''}` });

  return (
    <div className="detail-scroll">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap">
          <Chip tone="plain" value={label(r.category)} />
          <Chip value={statusWord(r.status)} />
          {r.priority === 'urgent' && active && <Chip tone="dark" value="Needs quick action" />}
          {escalated && active && <Chip tone="dark" value={r.escalationLevel === 2 ? 'Very serious' : 'Passed to a senior'} />}
        </div>
        <h2 style={{ margin: 0 }}>{r.details || 'No details'}</h2>
        <p className="small muted">
          {fmt(r.createdAt)}
          {d && ` · ${d.text}`}
        </p>
      </div>

      {/* both people in the report, each as a small profile with a way to their full one (and back to this report) */}
      <div className="grid-2">
        <PersonCard title="Person reported" id={person} name={nameOf(r)} canOpen={p.canSeePeople} onOpen={person && p.openUser ? () => p.openUser!(person, p.from) : undefined} />
        <PersonCard title="Reported by" id={r.reporter.id} name={byOf(r)} canOpen={p.canSeePeople} onOpen={p.openUser ? () => p.openUser!(r.reporter.id, p.from) : undefined} />
      </div>

      <WhatHappened id={r.id} />

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
        <div className="stack" style={{ gap: 12, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <label>
            Reason for closing without action (they will be told)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only needed for “No action needed”" maxLength={500} />
          </label>
          <div className="actions-bar">
            <span style={{ flex: 1 }} />
            <button className="btn" disabled={busy || !noteOk} onClick={() => p.onResolve(r, 'dismissed', note.trim())}>
              No action needed
            </button>
            <button className="btn primary" disabled={busy} onClick={takeAction}>
              {r.category === NO_SHOW ? 'Host did not show up' : 'Take action'}
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
      <dl className="facts" style={{ marginTop: 8 }}>
        <div>
          <dt>Guests who say the host did not come</dt>
          <dd>
            {count(e.reporters)} of {count(e.attendees)}
          </dd>
        </div>
        <div>
          <dt>Messages from the host during the plan</dt>
          <dd>{e.hostMessagesDuringPlan}</dd>
        </div>
        {e.membersSaidTheyAttended != null && (
          <div>
            <dt>Guests who say they went</dt>
            <dd>{e.membersSaidTheyAttended}</dd>
          </div>
        )}
        <div>
          <dt>Times the host missed a plan before</dt>
          <dd>{e.earlierConfirmedAbsences}</dd>
        </div>
      </dl>
      {e.hostMarkedThisReporter && <span className="small muted">The host also said this person did not come.</span>}
    </div>
  );
}

type Info = { target: { type: string; title: string; lines: string[]; state?: string | null } | null; reporter: { filed: number; actionTaken: number; noAction: number }; events: { at: string; action: string; by: string }[] };
const STEP: Record<string, string> = { 'report.resolved': 'Action taken', 'report.dismissed': 'Closed, no action needed', 'report.in_review': 'Taken for review', 'report.assign': 'Taken by' };
/** The facts behind a report, read from the server: what was reported, the reporter's record, and each step taken. */
function WhatHappened({ id }: { id: string }) {
  const info = useLoad(() => get<Info>('/v1/admin/reports/' + id), [id]);
  const d = info.data;
  if (info.error) return <p className="small muted">Could not load the full details.</p>;
  if (!d) return <Loading rows={2} />;
  const nice = (l: string) => l.replace(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/g, (m) => fmt(m));
  return (
    <>
      {d.target && (
        <div className="box">
          <span className="label">
            What was reported · {d.target.type}
            {d.target.state ? ` · ${d.target.state}` : ''}
          </span>
          <p className={d.target.type === 'Message' ? 'quote' : undefined}>
            <strong>{d.target.type === 'Message' ? `“${d.target.title}”` : d.target.title}</strong>
          </p>
          <ul className="timeline">
            {d.target.lines.map((l) => (
              <li key={l}>
                <span>{nice(l)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="box">
        <span className="label">The person who reported</span>
        <p className="small">
          Has sent {d.reporter.filed} {d.reporter.filed === 1 ? 'report' : 'reports'} in total: {d.reporter.actionTaken} led to action, {d.reporter.noAction} needed no action.
        </p>
      </div>
      {d.events.length > 0 && (
        <div className="box">
          <span className="label">Steps taken</span>
          <ul className="timeline">
            {d.events.map((e, i) => (
              <li key={i}>
                <span className="muted">{fmt(e.at)}</span>
                <span>
                  {STEP[e.action] ?? e.action.replace(/[._]/g, ' ')} · {e.by}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
