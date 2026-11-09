import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Loading, Page, ProofImages, useAction, useLoad, type Tone } from '../ui';
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
type View = 'disputed' | 'marked' | 'upheld' | 'overturned' | 'all';

const STATE: Record<string, { label: string; tone: Tone; dot: string }> = {
  marked: { label: 'Waiting', tone: 'line', dot: 'wait' },
  disputed: { label: 'Disputed', tone: 'dark', dot: 'dark' },
  upheld: { label: 'Upheld', tone: 'plain', dot: 'mute' },
  overturned: { label: 'Overturned', tone: 'ok', dot: 'ok' },
};
const VIEWS: { id: View; label: string }[] = [
  { id: 'disputed', label: 'Disputed' },
  { id: 'marked', label: 'Waiting' },
  { id: 'upheld', label: 'Upheld' },
  { id: 'overturned', label: 'Overturned' },
  { id: 'all', label: 'All' },
];
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Missed attendance: a host said a member did not attend. Disputed ones wait here for a decision. */
export function NoShowsPage({ me, openUser }: { me: Session; openUser?: (id: string, from?: string) => void }) {
  const [view, setView] = useState<View>('disputed');
  const { data, error, loading, reload } = useLoad(() => get<{ items: Note[] }>(`/v1/admin/no-shows?state=${view}`), [view], 6000);
  // always on: only hosts who mark unusually many people absent (half or more of their guests, or marks that keep being overturned)
  const hosts = useLoad(() => get<{ items: HostRow[] }>('/v1/admin/no-shows/hosts'), [], 30000);
  const act = useAction(reload);
  const mod = can.moderate(me.role);
  const items = data?.items ?? [];

  const decide = async (n: Note, decision: 'uphold' | 'overturn') => {
    const note = await askText(decision === 'uphold' ? 'Uphold: they did not attend' : 'Overturn: remove the record', { label: 'Reason (both people are told)', confirm: decision === 'uphold' ? 'Uphold' : 'Overturn' });
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
    <Page fill title="Attendance">
      <div className="ns-filters" role="group" aria-label="Which records">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? 'ns-pill on' : 'ns-pill'} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <Loading rows={5} />}
      <div className="ns-grid">
        <section className="ns-scroll" aria-label="Missed attendance">
          <header className="ns-head">
            <h2>{VIEWS.find((v) => v.id === view)?.label === 'All' ? 'Missed attendance' : `Missed attendance · ${VIEWS.find((v) => v.id === view)?.label}`}</h2>
            <span>{items.length}</span>
          </header>
          {data && items.length === 0 && <Empty>{{ disputed: 'No disputes.', marked: 'Nothing waiting.', upheld: 'Nothing upheld yet.', overturned: 'Nothing overturned yet.', all: 'No records yet.' }[view]}</Empty>}
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
                    {n.hostUnusual && n.hostUnusual.length > 0 && <Chip value="Check host" tone="line" icon="alert" />}
                  </div>
                  <dl className="ns-facts">
                    <div>
                      <dt>Did not attend</dt>
                      <dd>{person(n.member)}</dd>
                    </div>
                    <div>
                      <dt>Hosted by</dt>
                      <dd>{person(n.host)}</dd>
                    </div>
                    <div>
                      <dt>When</dt>
                      <dd>{n.plan ? when(n.plan.at) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Where</dt>
                      <dd>{n.plan ? [n.plan.place, n.plan.city].filter(Boolean).join(', ') : '—'}</dd>
                    </div>
                  </dl>
                  <p className="ns-meta">Recorded {fmt(n.markedAt)}</p>
                  {n.hostUnusual && n.hostUnusual.length > 0 && <p className="ns-warn">Host {n.hostUnusual.join('; ')}.</p>}
                  {n.disputeNote && (
                    <p className="ns-quote">
                      <strong>Their side:</strong> {n.disputeNote}
                    </p>
                  )}
                  <ProofImages ids={n.proofs} />
                  {n.decisionNote && <p className="ns-meta">Decision: {n.decisionNote}</p>}
                  {mod && (
                    <div className="ns-actions">
                      {n.state !== 'upheld' && (
                        <button className="ns-uphold" onClick={() => decide(n, 'uphold')} disabled={act.busy}>
                          Uphold
                        </button>
                      )}
                      {n.state !== 'overturned' && (
                        <button className="ns-overturn" onClick={() => decide(n, 'overturn')} disabled={act.busy}>
                          Overturn
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="ns-hosts" aria-labelledby="att-hosts">
          <header className="ns-head">
            <h2 id="att-hosts">Hosts to check</h2>
            <span>Last 90 days</span>
          </header>
          <ErrorBanner message={hosts.error} />
          {hosts.loading && !hosts.data && <Loading rows={5} />}
          {hosts.data && hosts.data.items.length === 0 && <Empty>No host stands out.</Empty>}
          <ul className="ns-host-list">
            {(hosts.data?.items ?? []).map((h) => (
              <li key={h.hostId} className="ns-host">
                <span style={{ minWidth: 0 }}>
                  <button className="ns-link strong" onClick={() => openUser?.(h.hostId, 'noshows')}>
                    {h.name}
                  </button>
                  <span className="ns-host-sub">
                    {h.marks} of {h.attendees} guests marked absent{h.decided > 0 ? ` · ${h.overturned}/${h.decided} overturned` : ''}
                  </span>
                  {h.reasons.length > 0 && <span className="ns-host-why">{h.reasons.join('; ')}</span>}
                </span>
                {h.flag ? <Chip value="Unusual" tone="dark" /> : <Chip value="Normal" tone="ok" />}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Page>
  );
}
