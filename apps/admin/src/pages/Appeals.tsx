import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Page, Segmented, useAction, useLoad, useMore } from '../ui';

type Appeal = {
  id: string;
  kind: 'verification' | 'suspension' | 'removal' | 'report' | 'warning' | 'message';
  what: string;
  state: 'open' | 'upheld' | 'rejected';
  message: string;
  decision: string | null;
  createdAt: string;
  decidedAt: string | null;
  user: { id: string; email: string; displayName: string | null; state: string; eligibility: string };
  target: { reason?: string | null; method?: string | null; type?: string | null; title?: string | null; suspendedUntil?: string | null; reportCategory?: string; reportAbout?: string; dismissedWith?: string | null; warning?: string; message?: string; removedBecause?: string | null } | null;
};
type View = 'open' | 'upheld' | 'rejected';
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'plain'> = { open: 'warn', upheld: 'ok', rejected: 'bad' };

/** Appeals: a person asking us to look at a decision again. Accepting undoes the decision; either way they are told, with your note. */
export function AppealsPage({ me, openUser }: { me: Session; openUser?: (id: string) => void }) {
  const [view, setView] = useState<View>('open');
  const first = useLoad(() => get<{ items: Appeal[]; nextCursor: string | null }>(`/v1/admin/appeals?state=${view}`), [view], 6000);
  const more = useMore(first.data, (c) => get(`/v1/admin/appeals?state=${view}&cursor=${c}`), view);
  const { error, loading } = first;
  const data = first.data && { items: more.items };
  const reload = () => (more.reset(), first.reload());
  const act = useAction(reload);
  const items = more.items;

  const decide = async (a: Appeal, decision: 'uphold' | 'reject') => {
    const note = await askText(decision === 'uphold' ? 'Accept this appeal?' : 'Reject this appeal?', {
      label: decision === 'uphold' ? 'The decision is undone. Say what changed; the person reads this.' : 'The decision stands. Say why; the person reads this.',
      confirm: decision === 'uphold' ? 'Accept' : 'Reject',
    });
    if (note) act.run(() => post(`/v1/admin/appeals/${a.id}/decision`, { decision, note }));
  };
  const canDecide = (a: Appeal) => (a.kind === 'verification' ? can.trust(me.role) : can.moderate(me.role));

  const undo = (a: Appeal) =>
    a.kind === 'verification' ? 'Accepting verifies them as an adult.' : a.kind === 'suspension' ? 'Accepting restores the account and lifts any ban.' : a.kind === 'report' ? 'Accepting sends the report back to the queue, unassigned, for a fresh review.' : a.kind === 'warning' ? 'Accepting withdraws the warning (and puts back the message it was about).' : a.kind === 'message' ? 'Accepting puts the message back in its chat.' : 'Accepting puts the listing back, if it has not ended.';

  return (
    <Page title="Appeals" sub="People asking us to look again: a rejected identity check, a suspension, or a listing we removed. Each decision can be appealed once.">
      <Segmented<View>
        label="Which appeals"
        value={view}
        onChange={setView}
        options={[
          { id: 'open', label: 'Waiting' },
          { id: 'upheld', label: 'Accepted' },
          { id: 'rejected', label: 'Rejected' },
        ]}
      />
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && items.length === 0 && <Empty>Nothing here.</Empty>}
      <ul className="stack">
        {items.map((a) => (
          <li key={a.id} className="card" style={{ display: 'grid', gap: 8 }}>
            <div className="row wrap" style={{ justifyContent: 'space-between' }}>
              <strong>{a.what.charAt(0).toUpperCase() + a.what.slice(1)}</strong>
              <Chip value={a.state} tone={TONE[a.state] ?? 'plain'} />
            </div>
            <div className="muted small">
              <button className="link" onClick={() => openUser?.(a.user.id)}>{a.user.displayName ?? a.user.email}</button> · sent {fmt(a.createdAt)}
              {a.target?.reason ? ` · rejected for: ${a.target.reason}` : ''}
              {a.target?.title ? ` · ${a.target.type}: ${a.target.title}` : ''}
              {a.target?.warning ? ` · warning: ${a.target.warning}` : ''}
              {a.target?.message ? ` · message: “${a.target.message}”${a.target.removedBecause ? ` (removed: ${a.target.removedBecause})` : ''}` : ''}
              {a.target?.reportCategory ? ` · dismissed ${a.target.reportCategory.replace(/_/g, ' ')} report about a ${a.target.reportAbout}${a.target.dismissedWith ? ` (${a.target.dismissedWith})` : ''}` : ''}
              {a.kind === 'suspension' ? (a.target?.suspendedUntil ? ` · suspended until ${fmt(a.target.suspendedUntil)}` : ' · suspended until staff restore the account') : ''}
            </div>
            <p className="note" style={{ margin: 0 }}>{a.message}</p>
            {a.decision && <p className="muted small" style={{ margin: 0 }}>Decision: {a.decision}</p>}
            {a.state === 'open' &&
              (canDecide(a) ? (
                <>
                  <p className="muted small" style={{ margin: 0 }}>{undo(a)}</p>
                  <div className="row wrap">
                    <button className="btn small" onClick={() => decide(a, 'uphold')} disabled={act.busy}>Accept the appeal</button>
                    <button className="btn danger small" onClick={() => decide(a, 'reject')} disabled={act.busy}>Reject it</button>
                  </div>
                </>
              ) : (
                <p className="muted small">{a.kind === 'verification' ? 'The trust team decides identity appeals.' : 'Moderators decide these. A different moderator from the one who made the decision.'}</p>
              ))}
          </li>
        ))}
      </ul>
      {more.more}
    </Page>
  );
}
