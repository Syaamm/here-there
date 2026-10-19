import { useEffect } from 'react';
import { del, get, post } from '../api';
import { useMe } from '../auth';
import { Chip, ErrorBanner, TopBar, useAction, useLoad } from '../ui';

/** Screen 10: safety controls, identity verification and blocked people. */
export function Safety() {
  const { me, reload } = useMe();
  const blocks = useLoad(() => get<{ items: { userId: string; displayName?: string }[] }>('/v1/blocks'), []);
  const verify = useAction(reload);
  const unblock = useAction(blocks.reload);
  const e = me?.eligibility;

  // opening this screen always re-checks the latest verification result
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <TopBar title="Safety & privacy" />
      <h2 className="big">Feel confident meeting people.</h2>
      <p className="muted">HERE and THERE provide safety features, not a guarantee of personal safety. Choose public places and trust your judgment.</p>

      <section className="card stack" aria-labelledby="idv">
        <div className="row between">
          <h3 id="idv">🪪 Identity verification</h3>
          {e === 'verified' ? <Chip tone="ok">Verified adult</Chip> : e === 'pending' ? <Chip tone="warn">Pending</Chip> : e === 'rejected' ? <Chip tone="bad">Not approved</Chip> : <Chip>Not started</Chip>}
        </div>
        <p className="muted small">A qualified provider checks you are an adult. Only the result is shared with others. We never show your documents. You need this to host or join in person.</p>
        <ErrorBanner message={verify.error} />
        {e === 'pending' && <p className="banner warn">Your check is being reviewed. We'll notify you as soon as there's a decision.</p>}
        {e === 'verified' && <p className="banner ok">You're verified. You can host and join activities.</p>}
        {(e === 'unverified' || e === 'rejected') && (
          <button className="btn primary block" disabled={verify.busy} onClick={() => verify.run(() => post('/v1/me/verification'))}>
            {e === 'rejected' ? 'Try verification again' : 'Start verification'}
          </button>
        )}
      </section>

      <section className="card stack">
        <h3>🚩 Report a user or activity</h3>
        <p className="muted small">Open any activity and tap ⋯ to report it or its host. In a group chat, tap Report under a message. Reports go to our moderation team.</p>
      </section>

      <section className="card stack" aria-labelledby="blk">
        <h3 id="blk">⛔ Blocked people</h3>
        <p className="muted small">Blocking applies across HERE and THERE. Blocked people can't see or contact you, and you won't see them.</p>
        <ErrorBanner message={unblock.error} />
        {blocks.data?.items.length === 0 && <p className="muted small">You haven't blocked anyone.</p>}
        {blocks.data?.items.map((b) => (
          <div key={b.userId} className="row between">
            <span>{b.displayName ?? b.userId}</span>
            <button className="btn small" disabled={unblock.busy} onClick={() => unblock.run(() => del(`/v1/blocks/${b.userId}`))}>
              Unblock
            </button>
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>📍 Location controls</h3>
        <p className="muted small">We never publish a participant's live location. The map only shows public venues. "Near me" uses an approximate area for one search and doesn't store it.</p>
      </section>
      <section className="card stack">
        <h3>🔒 Private group chat</h3>
        <p className="muted small">Only approved members can read an activity's conversation. Access ends immediately if you leave or are removed.</p>
      </section>
      <section className="card stack emergency">
        <h3>☎ Emergency support</h3>
        <p>If you are at risk, contact local emergency services right away (112 in the EU). HERE can't respond to emergencies.</p>
      </section>
    </>
  );
}
