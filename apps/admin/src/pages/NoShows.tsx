import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Page, Segmented, useAction, useLoad } from '../ui';

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
    <Page title="No-shows" sub="A host said a member did not come. A note only counts once the member had 7 days to dispute it, or you upheld it.">
      <Segmented<View>
        label="Which notes"
        value={view}
        onChange={setView}
        options={[
          { id: 'disputed', label: 'Disputed' },
          { id: 'marked', label: 'Waiting for the member' },
          { id: 'all', label: 'All' },
        ]}
      />
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && items.length === 0 && <Empty>{view === 'disputed' ? 'No disputed notes right now.' : 'Nothing here.'}</Empty>}
      <ul className="stack">
        {items.map((n) => (
          <li key={n.id} className="card" style={{ display: 'grid', gap: 8 }}>
            <div className="row wrap" style={{ justifyContent: 'space-between' }}>
              <strong>{n.title}</strong>
              <span className="row wrap">
                {n.hostUnusual && n.hostUnusual.length > 0 && <Chip value="Host's notes look unusual" tone="warn" icon="alert" />}
                <Chip value={n.state} tone={TONE[n.state] ?? 'plain'} />
              </span>
            </div>
            <div className="muted small">
              Host{' '}
              <button className="link" onClick={() => n.host && openUser?.(n.host.id)}>
                {n.host?.displayName}
              </button>{' '}
              says{' '}
              <button className="link" onClick={() => n.member && openUser?.(n.member.id)}>
                {n.member?.displayName}
              </button>{' '}
              did not come · noted {fmt(n.markedAt)}
            </div>
            {n.hostUnusual && n.hostUnusual.length > 0 && <p className="small" style={{ margin: 0, color: 'var(--orange)' }}>This host {n.hostUnusual.join('; ')}. Read their notes with care.</p>}
            {n.disputeNote && (
              <p className="note" style={{ margin: 0 }}>
                <strong>Their side:</strong> {n.disputeNote}
              </p>
            )}
            {n.decisionNote && <p className="muted small" style={{ margin: 0 }}>Decision: {n.decisionNote}</p>}
            {mod ? (
              <div className="row wrap">
                {n.state !== 'upheld' && (
                  <button className="btn danger small" onClick={() => decide(n, 'uphold')} disabled={act.busy}>
                    Uphold (it counts)
                  </button>
                )}
                {n.state !== 'overturned' && (
                  <button className="btn small" onClick={() => decide(n, 'overturn')} disabled={act.busy}>
                    Overturn (it does not count)
                  </button>
                )}
              </div>
            ) : (
              <p className="muted small">Moderators decide these.</p>
            )}
          </li>
        ))}
      </ul>

      <section className="card" style={{ display: 'grid', gap: 8 }} aria-labelledby="noshow-hosts">
        <div className="row between wrap">
          <h2 id="noshow-hosts" style={{ margin: 0, fontSize: 16 }}>Hosts who say many people did not come</h2>
          <label className="row small">
            <input type="checkbox" checked={allHosts} onChange={(e) => setAllHosts(e.target.checked)} /> Show all hosts
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Looked at when a host made 4 or more notes in 90 days and they cover half of the people they hosted, or half of their decided notes were overturned. It never acts by itself: it only tells you where to look.
        </p>
        <ErrorBanner message={hosts.error} />
        {hosts.loading && !hosts.data && <p className="muted">Loading…</p>}
        {hosts.data && hosts.data.items.length === 0 && <Empty>{allHosts ? 'No host has made a note lately.' : 'No host looks unusual.'}</Empty>}
        <ul className="stack">
          {(hosts.data?.items ?? []).map((h) => (
            <li key={h.hostId} className="row between wrap">
              <span>
                <button className="link" onClick={() => openUser?.(h.hostId)}>
                  {h.name}
                </button>
                <span className="muted small">
                  {' '}
                  · {h.marks} {h.marks === 1 ? 'note' : 'notes'} for {h.attendees} {h.attendees === 1 ? 'person' : 'people'} hosted
                  {h.decided > 0 ? ` · ${h.overturned} of ${h.decided} decided overturned` : ''}
                </span>
                {h.reasons.length > 0 && <span className="small" style={{ color: 'var(--orange)' }}> · {h.reasons.join('; ')}</span>}
              </span>
              {h.flag ? <Chip value="unusual" tone="warn" icon="alert" /> : <Chip value="normal" tone="ok" />}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
