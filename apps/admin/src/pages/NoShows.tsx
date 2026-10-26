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
};
type View = 'disputed' | 'marked' | 'all';

const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'plain'> = { marked: 'warn', disputed: 'info', upheld: 'bad', overturned: 'ok' };

/** No-show notes: a host said a member did not come. Disputed ones wait here for a moderator. Any note can be reviewed later. */
export function NoShowsPage({ me, openUser }: { me: Session; openUser?: (id: string) => void }) {
  const [view, setView] = useState<View>('disputed');
  const { data, error, loading, reload } = useLoad(() => get<{ items: Note[] }>(`/v1/admin/no-shows?state=${view === 'all' ? 'all' : view}`), [view], 6000);
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
              <Chip value={n.state} tone={TONE[n.state] ?? 'plain'} />
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
    </Page>
  );
}
