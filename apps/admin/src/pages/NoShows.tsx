import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Loading, Page, useAction, useLoad } from '../ui';
import './NoShows.css';

type Note = {
  id: string;
  kind: string;
  title: string;
  state: string;
  markedAt: string;
  disputedAt: string | null;
  disputeNote: string | null;
  decisionNote: string | null;
  member?: { id: string; email: string; displayName: string };
  host?: { id: string; email: string; displayName: string };
  /** why this host's notes look unusual (see the hosts list below), or null */
  hostUnusual?: string[] | null;
};
/** One host's pattern of notes over the last 90 days. */
type HostRow = { hostId: string; name: string; flag: boolean; reasons: string[]; marks: number; attendees: number; decided: number; overturned: number };
type View = 'disputed' | 'marked' | 'all';

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'plain'> = { marked: 'warn', disputed: 'info', upheld: 'bad', overturned: 'ok' };
const DOT: Record<string, string> = { marked: 'warn', disputed: 'info', upheld: 'bad', overturned: 'ok' };
const VIEWS: { id: View; label: string }[] = [
  { id: 'disputed', label: 'Disputed' },
  { id: 'marked', label: 'Waiting for the member' },
  { id: 'all', label: 'All' },
];

/** No-show notes: a host said a member did not come. Disputed ones wait here for a moderator. Any note can be reviewed later. */
export function NoShowsPage({ me, openUser }: { me: Session; openUser?: (id: string) => void }) {
  const [view, setView] = useState<View>('disputed');
  const { data, error, loading, reload } = useLoad(() => get<{ items: Note[] }>(`/v1/admin/no-shows?state=${view === 'all' ? 'all' : view}`), [view], 6000);
  const [allHosts, setAllHosts] = useState(false);
  const hosts = useLoad(() => get<{ items: HostRow[] }>(`/v1/admin/no-shows/hosts${allHosts ? '?all=true' : ''}`), [allHosts], 30000);
  const act = useAction(reload);
  const mod = can.moderate(me.role);
  const items = data?.items ?? [];

  const decide = async (n: Note, decision: 'uphold' | 'overturn') => {
    const note = await askText(decision === 'uphold' ? 'Uphold this note?' : 'Overturn this note?', {
      label: decision === 'uphold' ? 'Why is the note right? Both people are told, and it will count toward their reliability.' : 'Why is the note wrong? Both people are told, and it will not count.',
      confirm: decision === 'uphold' ? 'Uphold' : 'Overturn',
    });
    if (note) act.run(() => post(`/v1/admin/no-shows/${n.id}/decision`, { decision, note }));
  };

  return (
    <Page fill title="No-shows" sub="A host said a member did not come. A note counts once the member had 7 days to dispute it, or you upheld it.">
      <div className="ns-filters" role="group" aria-label="Which notes">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? 'ns-pill on' : 'ns-pill'} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <Loading rows={5} />}
      <div className="ns-grid">
        <section className="ns-scroll" aria-label="No-show notes">
          <header className="ns-head">
            <h2>Notes</h2>
            <span>{items.length}</span>
          </header>
          {data && items.length === 0 && <Empty title="Nothing here">{view === 'disputed' ? 'No disputed notes right now.' : 'No notes in this list.'}</Empty>}
          {items.map((n) => {
            const d = new Date(n.markedAt);
            return (
              <article key={n.id} className="ns-card">
                <header className="ns-date">
                  <span className="ns-kind">Noted</span>
                  <strong className="ns-num">{d.getDate()}</strong>
                  <span className="ns-mon">{d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
                  <span className="ns-state">
                    <Chip value={n.state} tone={TONE[n.state] ?? 'plain'} />
                  </span>
                </header>
                <div className="ns-body">
                  <div className="ns-title">
                    <span className={`ns-dot ${DOT[n.state] ?? ''}`} aria-hidden="true" />
                    <strong>{n.title}</strong>
                    {n.hostUnusual && n.hostUnusual.length > 0 && <Chip value="Host's notes look unusual" tone="warn" icon="alert" />}
                  </div>
                  <div className="ns-says">
                    Host{' '}
                    <button className="ns-link" onClick={() => n.host && openUser?.(n.host.id)}>
                      {n.host?.displayName}
                    </button>{' '}
                    says{' '}
                    <button className="ns-link" onClick={() => n.member && openUser?.(n.member.id)}>
                      {n.member?.displayName}
                    </button>{' '}
                    did not come · noted {fmt(n.markedAt)}
                  </div>
                  {n.hostUnusual && n.hostUnusual.length > 0 && <p className="ns-warn">This host {n.hostUnusual.join('; ')}. Read their notes with care.</p>}
                  {n.disputeNote && (
                    <p className="ns-quote">
                      <strong>Their side:</strong> {n.disputeNote}
                    </p>
                  )}
                  {n.decisionNote && <p className="ns-decision">Decision: {n.decisionNote}</p>}
                  {mod ? (
                    <div className="ns-actions">
                      {n.state !== 'upheld' && (
                        <button className="ns-uphold" onClick={() => decide(n, 'uphold')} disabled={act.busy}>
                          Uphold (it counts)
                        </button>
                      )}
                      {n.state !== 'overturned' && (
                        <button className="ns-overturn" onClick={() => decide(n, 'overturn')} disabled={act.busy}>
                          Overturn (it does not count)
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="ns-decision">Moderators decide these.</p>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="ns-hosts" aria-labelledby="noshow-hosts">
          <header className="ns-head">
            <h2 id="noshow-hosts">Hosts to look at</h2>
            <label className="ns-check">
              <input type="checkbox" checked={allHosts} onChange={(e) => setAllHosts(e.target.checked)} /> Show all hosts
            </label>
          </header>
          <p className="ns-intro">Hosts whose notes cover half of the people they hosted, or half overturned. It only points; it never acts.</p>
          <ErrorBanner message={hosts.error} />
          {hosts.loading && !hosts.data && <Loading rows={5} />}
          {hosts.data && hosts.data.items.length === 0 && <Empty>{allHosts ? 'No host has made a note lately.' : 'No host looks unusual.'}</Empty>}
          <ul className="ns-host-list">
            {(hosts.data?.items ?? []).map((h) => (
              <li key={h.hostId} className="ns-host">
                <span style={{ minWidth: 0 }}>
                  <button className="ns-link strong" onClick={() => openUser?.(h.hostId)}>
                    {h.name}
                  </button>
                  <span className="ns-host-sub">
                    {h.marks} {h.marks === 1 ? 'note' : 'notes'} for {h.attendees} {h.attendees === 1 ? 'person' : 'people'} hosted
                    {h.decided > 0 ? ` · ${h.overturned} of ${h.decided} decided overturned` : ''}
                  </span>
                  {h.reasons.length > 0 && <span className="ns-host-why">{h.reasons.join('; ')}</span>}
                </span>
                {h.flag ? <Chip value="unusual" tone="warn" icon="alert" /> : <Chip value="normal" tone="ok" />}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Page>
  );
}
