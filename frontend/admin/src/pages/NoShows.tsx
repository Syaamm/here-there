import { useEffect, useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Loading, Page, PageBar, ProofImages, Segmented, useAction, useLoad, type Tone } from '../ui';
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
type HostRow = { hostId: string; name: string; flag: boolean; reasons: string[]; marks: number; attendees: number; decided: number; overturned: number };
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
  const [pageNo, setPageNo] = useState(1);
  useEffect(() => setPageNo(1), [view]);
  const { data, error, loading, reload } = useLoad(() => get<{ items: Note[]; page?: number; pages?: number; total?: number }>(`/v1/admin/no-shows?limit=20&page=${pageNo}&state=${view}`), [view, pageNo], 10000);
  // older records come a page at a time ("Load more"), not only the first 50
  // always on: only hosts who mark unusually many people absent (half or more of their guests, or marks that keep being overturned)
  const [hostsOpen, setHostsOpen] = useState(false);
  const hosts = useLoad(() => get<{ items: HostRow[] }>('/v1/admin/no-shows/hosts'), [], 30000);
  const act = useAction(() => reload());
  const mod = can.moderate(me.role);
  const items = data?.items ?? [];
  // hosts who often say people did not come, but whose marks were mostly taken back
  const flagged = (hosts.data?.items ?? []).filter((h) => h.overturned > 0 && h.decided > 0 && h.overturned / h.decided >= 0.5);

  const decide = async (n: Note, decision: 'uphold' | 'overturn') => {
    const note = await askText(decision === 'uphold' ? 'Confirm: they did not come' : 'Remove this record', { label: 'Reason (both people will be told)', confirm: decision === 'uphold' ? 'Confirm' : 'Remove record' });
    if (note) act.run(() => post(`/v1/admin/no-shows/${n.id}/decision`, { decision, note }));
  };
  const person = (p?: Person) =>
    p ? (
      <button className="ns-link" onClick={() => openUser?.(p.id, 'noshows')}>
        {p.displayName}
      </button>
    ) : (
      <span className="muted">Unknown</span>
    );

  return (
    <Page fill title="Attendance" actions={<Segmented label="Which records" value={view} onChange={setView} options={VIEWS.map((v) => ({ id: v.id, label: v.label }))} />}>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <Loading rows={5} />}
      <details className="ns-hosts-box" open={hostsOpen} onToggle={(e) => setHostsOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          <span>Hosts to look at</span>
          <span className="ns-count">{flagged.length}</span>
        </summary>
        <p className="ns-meta" style={{ padding: '0 20px' }}>Hosts who often say people did not come, but most of it was taken back. Last 90 days.</p>
        <ErrorBanner message={hosts.error} />
        {hosts.loading && !hosts.data && <Loading rows={2} />}
        {hosts.data && flagged.length === 0 && <Empty>No host to look at.</Empty>}
        <ul className="ns-host-list">
          {flagged.map((h) => (
            <li key={h.hostId} className="ns-host">
              <span style={{ minWidth: 0 }}>
                <button className="ns-link strong" onClick={() => openUser?.(h.hostId, 'noshows')}>
                  {h.name}
                </button>
                <span className="ns-host-sub">
                  Said {h.marks} of {h.attendees} guests did not come · {h.overturned} of {h.decided} decided were taken back
                </span>
              </span>
            </li>
          ))}
        </ul>
      </details>
      <div className="ns-grid">
        <section className="ns-scroll" aria-label="Missed attendance">
          <header className="ns-head">
            <h2>{`People who did not come · ${VIEWS.find((v) => v.id === view)?.label}`}</h2>
            <span>{items.length}</span>
          </header>
          {data && items.length === 0 && <Empty>{{ disputed: 'Nobody has disagreed.', marked: 'Nothing waiting.', upheld: 'Nothing confirmed yet.', overturned: 'Nothing removed yet.' }[view]}</Empty>}
          {items.map((n) => {
            const st = STATE[n.state] ?? { label: n.state, tone: 'plain' as Tone, dot: '' };
            const d = new Date(n.plan?.at ?? n.markedAt);
            return (
              <article key={n.id} className="ns-card">
                <header className="ns-date">
                  <span className="ns-kind">{n.kind === 'trip' ? 'Trip' : 'Activity'}</span>
                  <strong className="ns-num">{d.getDate()}</strong>
                  <span className="ns-mon">{d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
                  <span className="ns-state">
                    <Chip value={st.label} tone={st.tone} />
                  </span>
                </header>
                <div className="ns-body">
                  <div className="ns-title">
                    <span className={`ns-dot ${st.dot}`} aria-hidden="true" />
                    <strong>{n.title}</strong>
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
              </article>
            );
          })}
          <PageBar page={data?.page ?? 1} pages={data?.pages ?? 1} total={data?.total ?? items.length} noun={['record', 'records']} onPage={setPageNo} busy={loading} />
        </section>

      </div>
    </Page>
  );
}
