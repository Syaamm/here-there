import { useEffect, useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, cap, Chip, Empty, ErrorBanner, FilterBar, fmt, Loading, Page, PageBar, ProofImages, Search, Segmented, useAction, useLoad, type Tone } from '../ui';
import './NoShows.css';

type Person = { id: string; email: string; displayName: string };
type Note = {
  id: string;
  kind: 'activity' | 'trip' | string;
  title: string;
  /** when and where the plan was */
  plan?: { at: string; city: string; place: string | null } | null;
  state: string;
  markedAt: string;
  disputedAt: string | null;
  disputeNote: string | null;
  proofs?: string[];
  decisionNote: string | null;
  member?: Person;
  host?: Person;
  hostUnusual?: string[] | null;
};
type HostReport = { id: string; createdAt: string; details: string | null; resolution?: string | null; assignedName?: string | null; reporter: { profile?: { displayName: string } | null; email?: string | null }; subject: { displayName: string | null; email?: string | null; userId: string } | null; target?: { type?: string; title: string; startsAt: string; hostName?: string | null } | null; evidence?: { plan: { title: string; startsAt: string }; attendees: number | unknown[]; reporters: number | unknown[]; hostMessagesDuringPlan: number } | null };
type View = 'disputed' | 'marked' | 'upheld' | 'overturned';

const STATE: Record<string, { label: string; tone: Tone; dot: string }> = {
  marked: { label: 'Pending', tone: 'line', dot: 'wait' },
  disputed: { label: 'Disputed', tone: 'dark', dot: 'dark' },
  upheld: { label: 'Confirmed', tone: 'plain', dot: 'mute' },
  overturned: { label: 'Removed', tone: 'ok', dot: 'ok' },
};
const VIEWS: { id: View; label: string }[] = [
  { id: 'marked', label: 'Pending' },
  { id: 'disputed', label: 'Disputed' },
  { id: 'upheld', label: 'Confirmed' },
  { id: 'overturned', label: 'Removed' },
];
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Missed attendance: a host said a member did not attend. Disputed ones wait here for a decision. */
export function NoShowsPage({ me, openUser }: { me: Session; openUser?: (id: string, from?: string) => void }) {
  const [view, setView] = useState<View>('marked');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const [pageNo, setPageNo] = useState(1);
  useEffect(() => setPageNo(1), [view, term]);
  const { data, error, loading, reload } = useLoad(() => get<{ items: Note[]; page?: number; pages?: number; total?: number }>(`/v1/admin/no-shows?limit=20&page=${pageNo}&state=${view}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [view, pageNo, term], 10000);
  // older records come a page at a time ("Load more"), not only the first 50
  const act = useAction(() => reload());
  const mod = can.moderate(me.role);
  const items = data?.items ?? [];

  // guests who say the host did not come: an ordinary report on the server, answered here instead of under Reports
  const [hostPage, setHostPage] = useState(1);
  useEffect(() => setHostPage(1), [view, term]);
  // the same four tabs for the host reports: waiting, with an open request for a review, confirmed (action taken), removed (no action needed)
  const hostStatus = { marked: 'waiting', disputed: 'disputed', upheld: 'resolved', overturned: 'dismissed' }[view];
  const hostLoad = useLoad(() => get<{ items: HostReport[]; page?: number; pages?: number; total?: number }>(`/v1/admin/reports?status=waiting&category=host_no_show&limit=20&page=${hostPage}`.replace('status=waiting', `status=${hostStatus}`) + (term ? `&q=${encodeURIComponent(term)}` : '')), [hostPage, hostStatus, term], 8000);
  const hostReports = hostLoad.data?.items ?? [];
  const decideHost = async (h: HostReport, status: 'resolved' | 'dismissed') => {
    const note = await askText(status === 'resolved' ? 'Confirm: the host did not come' : 'The host was there', { label: 'Reason (they will be told)', confirm: status === 'resolved' ? 'Confirm' : 'Close' });
    if (note) act.run(async () => { await post(`/v1/admin/reports/${h.id}/resolve`, { status, resolution: note }); hostLoad.reload(); });
  };

  // one block per day (the day of the plan), with every record of that day under it
  const groups = (() => {
    const out: { key: string; day: Date; rows: Note[]; kinds: string }[] = [];
    for (const n of items) {
      const day = new Date(n.plan?.at ?? n.markedAt);
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const g = out.find((x) => x.key === key);
      if (g) g.rows.push(n);
      else out.push({ key, day, rows: [n], kinds: '' });
    }
    for (const g of out) {
      const k = new Set(g.rows.map((r) => (r.kind === 'trip' ? 'Trip' : 'Activity')));
      g.kinds = k.size === 1 ? [...k][0] : 'Plans';
    }
    return out;
  })();

  const decide = async (n: Note, decision: 'uphold' | 'overturn') => {
    const note = await askText(decision === 'uphold' ? 'Confirm: they did not come' : 'Remove this record', { label: 'Reason (both people will be told)', confirm: decision === 'uphold' ? 'Confirm' : 'Remove record' });
    if (note) act.run(() => post(`/v1/admin/no-shows/${n.id}/decision`, { decision, note }));
  };
  // the host reports, one block per day of the plan (like the records beside them)
  const hostGroups = (() => {
    const out: { key: string; day: Date; rows: HostReport[]; kinds: string }[] = [];
    for (const h of hostReports) {
      const plan = h.evidence?.plan ?? h.target;
      const day = new Date(plan?.startsAt ?? h.createdAt);
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const g = out.find((x) => x.key === key);
      if (g) g.rows.push(h);
      else out.push({ key, day, rows: [h], kinds: '' });
    }
    for (const g of out) {
      const k = new Set(g.rows.map((r) => (r.target?.type === 'trip' ? 'Trip' : 'Activity')));
      g.kinds = k.size === 1 ? [...k][0] : 'Plans';
    }
    return out;
  })();
  const person = (p?: Person) =>
    p ? (
      <button className="ns-link" onClick={() => openUser?.(p.id, 'noshows')}>
        {p.displayName}
      </button>
    ) : (
      <span className="muted">Unknown</span>
    );

  return (
    <Page fill title="Attendance">
      <FilterBar search={<Search label="Search attendance records" onEnter={() => setTerm(q.trim())} placeholder="Search a person or plan" value={q} onChange={setQ} />}>
        <Segmented label="Which records" value={view} onChange={setView} options={VIEWS.map((v) => ({ id: v.id, label: v.label }))} />
      </FilterBar>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <Loading rows={5} />}
      <div className="ns-cols">
      <section className="ns-scroll ns-box ns-hosts-box" aria-label="The host did not come">
        <div className="ns-list">
          <header className="ns-head">
            <h2>{`Host did not come · ${VIEWS.find((v) => v.id === view)?.label}`}</h2>
            <span>{hostLoad.data?.total ?? hostReports.length}</span>
          </header>
          <ErrorBanner message={hostLoad.error} />
          {hostLoad.loading && !hostLoad.data && <Loading rows={2} />}
          {hostLoad.data && hostReports.length === 0 && <Empty>{term ? `No records match “${term}”.` : { disputed: 'Nobody has disagreed.', marked: 'Nobody has said a host did not come.', upheld: 'Nothing confirmed yet.', overturned: 'Nothing removed yet.' }[view]}</Empty>}
          {hostGroups.map((g) => (
            <article key={g.key} className="ns-card">
              <header className="ns-date">
                <span className="ns-kind">{g.kinds}</span>
                <strong className="ns-num">{g.day.getDate()}</strong>
                <span className="ns-mon">{g.day.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                <span className="ns-count-note">{g.rows.length} {g.rows.length === 1 ? 'record' : 'records'}</span>
              </header>
              <div className="ns-day-items">
                {g.rows.map((h) => {
                  const host = h.subject?.displayName ?? h.subject?.email ?? 'The host';
                  const num = (v: number | unknown[] | undefined) => (Array.isArray(v) ? v.length : (v ?? 0));
                  const plan = h.evidence?.plan ?? h.target;
                  return (
                    <div key={h.id} className="ns-rec">
                      <div className="ns-title">
                        <span className={`ns-dot ${STATE[view].dot}`} aria-hidden="true" />
                        <strong>{plan?.title ?? 'A plan'}</strong>
                        <Chip value={STATE[view].label} tone={STATE[view].tone} />
                      </div>
                      <dl className="ns-facts">
                        <div>
                          <dt>Host</dt>
                          <dd>{h.subject ? <button className="ns-link" onClick={() => openUser?.(h.subject!.userId, 'noshows')}>{host}</button> : host}</dd>
                        </div>
                        <div>
                          <dt>Said by</dt>
                          <dd>{h.reporter.profile?.displayName ?? h.reporter.email ?? 'a guest'}</dd>
                        </div>
                      </dl>
                      {plan && <p className="ns-meta">{when(plan.startsAt)} · reported {fmt(h.createdAt)}</p>}
                      {h.evidence && (
                        <p className="ns-meta">
                          {num(h.evidence.reporters)} of {num(h.evidence.attendees)} guests say so · {h.evidence.hostMessagesDuringPlan} messages from the host during the plan
                        </p>
                      )}
                      {h.details && (
                        <p className="ns-quote">
                          <strong>What they say:</strong> {h.details}
                        </p>
                      )}
                      {view === 'disputed' && <p className="ns-meta">The host asked for a review. It is decided under Appeals.</p>}
                      {(view === 'upheld' || view === 'overturned') && (h.resolution || h.assignedName) && (
                        <p className="ns-meta">
                          Our decision{h.assignedName ? ` (${h.assignedName})` : ''}: {h.resolution ? cap(h.resolution) : view === 'upheld' ? 'Action taken' : 'No action needed'}
                        </p>
                      )}
                      {mod && view === 'marked' && (
                        <div className="ns-actions">
                          <button className="ns-uphold" disabled={act.busy} onClick={() => decideHost(h, 'resolved')}>
                            Confirm: did not come
                          </button>
                          <button className="ns-overturn" disabled={act.busy} onClick={() => decideHost(h, 'dismissed')}>
                            The host was there
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
        <PageBar page={hostLoad.data?.page ?? 1} pages={hostLoad.data?.pages ?? 1} total={hostLoad.data?.total ?? hostReports.length} noun={['record', 'records']} onPage={setHostPage} busy={hostLoad.loading} />
      </section>
      <div className="ns-grid">
        <section className="ns-scroll ns-box" aria-label="Missed attendance">
          <div className="ns-list">
          <header className="ns-head">
            <h2>{`People who did not come · ${VIEWS.find((v) => v.id === view)?.label}`}</h2>
            <span>{items.length}</span>
          </header>
          {data && items.length === 0 && <Empty>{term ? `No records match “${term}”.` : { disputed: 'Nobody has disagreed.', marked: 'Nothing waiting.', upheld: 'Nothing confirmed yet.', overturned: 'Nothing removed yet.' }[view]}</Empty>}
          {groups.map((g) => (
            <article key={g.key} className="ns-card">
              <header className="ns-date">
                <span className="ns-kind">{g.kinds}</span>
                <strong className="ns-num">{g.day.getDate()}</strong>
                <span className="ns-mon">{g.day.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                <span className="ns-count-note">{g.rows.length} {g.rows.length === 1 ? 'record' : 'records'}</span>
              </header>
              <div className="ns-day-items">
                {g.rows.map((n) => {
                  const st = STATE[n.state] ?? { label: n.state, tone: 'plain' as Tone, dot: '' };
                  return (
                    <div key={n.id} className="ns-rec">
                      <div className="ns-title">
                        <span className={`ns-dot ${st.dot}`} aria-hidden="true" />
                        <strong>{n.title}</strong>
                        <Chip value={st.label} tone={st.tone} />
                      </div>
                      <dl className="ns-facts">
                        <div>
                          <dt>Did not come</dt>
                          <dd>{person(n.member)}</dd>
                        </div>
                        <div>
                          <dt>Host</dt>
                          <dd>{person(n.host)}</dd>
                        </div>
                      </dl>
                      {n.plan && <p className="ns-meta">{[when(n.plan.at), n.plan.place, n.plan.city].filter(Boolean).join(' · ')}</p>}
                      {n.disputeNote && (
                        <p className="ns-quote">
                          <strong>What they say:</strong> {n.disputeNote}
                        </p>
                      )}
                      <ProofImages ids={n.proofs} />
                      {n.decisionNote && <p className="ns-meta">Our decision: {n.decisionNote}</p>}
                      {mod && (
                        <div className="ns-actions">
                          {n.state !== 'upheld' && (
                            <button className="ns-uphold" onClick={() => decide(n, 'uphold')} disabled={act.busy}>
                              Confirm they did not come
                            </button>
                          )}
                          {n.state !== 'overturned' && (
                            <button className="ns-overturn" onClick={() => decide(n, 'overturn')} disabled={act.busy}>
                              Remove this record
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
          </div>
          <PageBar page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? items.length} noun={['record', 'records']} onPage={setPageNo} busy={loading} />
        </section>

      </div>
      </div>
    </Page>
  );
}
