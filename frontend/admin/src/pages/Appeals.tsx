import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Avatar, Chip, Empty, ErrorBanner, fmt, Loading, Page, useAction, useLoad, useMore } from '../ui';
import './Appeals.css';

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
  target: { reason?: string | null; method?: string | null; type?: string | null; title?: string | null; suspendedUntil?: string | null; reportCategory?: string; reportAbout?: string; decidedWith?: string | null; warning?: string; message?: string; removedBecause?: string | null } | null;
};
type View = 'open' | 'upheld' | 'rejected';
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'plain'> = { open: 'warn', upheld: 'ok', rejected: 'bad' };
const VIEWS: { id: View; label: string }[] = [
  { id: 'open', label: 'Waiting' },
  { id: 'upheld', label: 'Accepted' },
  { id: 'rejected', label: 'Rejected' },
];

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
    <Page fill title="Appeals" sub="People asking us to look again at a decision. Each decision can be appealed once.">
      <div className="ap-filters" role="group" aria-label="Which appeals">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={view === v.id ? 'ap-pill on' : 'ap-pill'} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <Loading rows={5} />}
      {data && items.length === 0 && <Empty title="Nothing here">No appeals in this list.</Empty>}
      {items.length > 0 && (
        <div className="ap-scroll" aria-label="Appeals">
          {items.map((a) => {
            const d = new Date(a.createdAt);
            const name = a.user.displayName ?? a.user.email;
            return (
              <section key={a.id} className="ap-card">
                <header className="ap-date">
                  <span className="ap-kind">{a.what}</span>
                  <strong className="ap-num">{d.getDate()}</strong>
                  <span className="ap-mon">{d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
                  <span className="ap-state">
                    <Chip value={a.state} tone={TONE[a.state] ?? 'plain'} />
                  </span>
                </header>
                <div className="ap-body">
                  <div className="ap-person">
                    <Avatar name={name} size="lg" />
                    <div style={{ minWidth: 0 }}>
                      <button className="ap-name" onClick={() => openUser?.(a.user.id)}>
                        {name}
                      </button>
                      <div className="ap-sub">sent {fmt(a.createdAt)}</div>
                    </div>
                  </div>
                  {(a.target || a.kind === 'suspension') && (
                    <div className="ap-target">
                      {a.target?.reason ? <span>rejected for: {a.target.reason}</span> : null}
                      {a.target?.title ? <span>{a.target.type}: {a.target.title}</span> : null}
                      {a.target?.warning ? <span>warning: {a.target.warning}</span> : null}
                      {a.target?.message ? <span>message: “{a.target.message}”{a.target.removedBecause ? ` (removed: ${a.target.removedBecause})` : ''}</span> : null}
                      {a.target?.reportCategory ? <span>decision on a {a.target.reportCategory.replace(/_/g, ' ')} report about their {a.target.reportAbout}{a.target.decidedWith ? ` (${a.target.decidedWith})` : ''}</span> : null}
                      {a.kind === 'suspension' ? <span>{a.target?.suspendedUntil ? `suspended until ${fmt(a.target.suspendedUntil)}` : 'suspended until staff restore the account'}</span> : null}
                    </div>
                  )}
                  <p className="ap-quote">{a.message}</p>
                  {a.decision && <p className="ap-decision">Decision: {a.decision}</p>}
                  {a.state === 'open' &&
                    (canDecide(a) ? (
                      <>
                        <p className="ap-hint">{undo(a)}</p>
                        <div className="ap-actions">
                          <button className="ap-accept" onClick={() => decide(a, 'uphold')} disabled={act.busy}>
                            Accept the appeal
                          </button>
                          <button className="ap-reject" onClick={() => decide(a, 'reject')} disabled={act.busy}>
                            Reject it
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="ap-hint">{a.kind === 'verification' ? 'The trust team decides identity appeals.' : 'Moderators decide these. A different moderator from the one who made the decision.'}</p>
                    ))}
                </div>
              </section>
            );
          })}
          {more.hasMore && <div className="ap-more">{more.more}</div>}
        </div>
      )}
    </Page>
  );
}
