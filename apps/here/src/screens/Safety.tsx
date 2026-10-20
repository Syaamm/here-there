import { useEffect, useState } from 'react';
import { del, get, post } from '../api';
import { useMe } from '../auth';
import { Chip, ErrorBanner, TopBar, useAction, useLoad } from '../ui';

/** Confirms the user's email with a 6-digit code. The identity check can only start after this. */
function EmailCard({ email, onDone }: { email?: string; onDone: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const verify = useAction(() => void onDone());
  const send = useAction();
  return (
    <section className="card stack" aria-labelledby="em">
      <h3 id="em">✉ Confirm your email</h3>
      <p className="muted small">We emailed a 6-digit code to {email}. It expires in 15 minutes.</p>
      <ErrorBanner message={verify.error ?? send.error} />
      {devCode && <p className="banner warn">Dev mode: no mail server is connected, so your code is {devCode}.</p>}
      <label>
        6-digit code
        <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
      </label>
      <button className="btn primary block" disabled={verify.busy || code.length !== 6} onClick={() => verify.run(() => post('/v1/me/email/verify', { code }))}>
        Confirm email
      </button>
      <button
        className="btn block"
        disabled={send.busy}
        onClick={async () => {
          const r = await send.run(() => post<{ devCode?: string }>('/v1/me/email/send-code'));
          if (r) setDevCode(r.devCode ?? null);
        }}
      >
        Send a new code
      </button>
    </section>
  );
}

/** Screen 10: safety controls, identity verification and blocked people. */
export function Safety() {
  const { me, reload } = useMe();
  const blocks = useLoad(() => get<{ items: { userId: string; displayName?: string }[] }>('/v1/blocks'), []);
  const verify = useAction(reload);
  const unblock = useAction(blocks.reload);
  const e = me?.eligibility;
  const [consent, setConsent] = useState(false);

  // opening this screen always re-checks the latest verification result
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <TopBar title="Safety & privacy" />
      <h2 className="big">Feel confident meeting people.</h2>
      <p className="muted">HERE and THERE provide safety features, not a guarantee of personal safety. Choose public places and trust your judgment.</p>

      {!me?.emailVerified && <EmailCard email={me?.email} onDone={reload} />}

      <section className="card stack" aria-labelledby="idv">
        <div className="row between">
          <h3 id="idv">🪪 Identity verification</h3>
          {e === 'verified' ? <Chip tone="ok">Verified adult</Chip> : e === 'pending' ? <Chip tone="warn">Pending</Chip> : e === 'rejected' ? <Chip tone="bad">Not approved</Chip> : <Chip>Not started</Chip>}
        </div>
        <p className="muted small">A qualified provider checks you are an adult. Only the result is shared with others. We never show your documents. You need this to host or join in person.</p>
        <ErrorBanner message={verify.error} />
        {e === 'pending' && <p className="banner warn">Your check is being reviewed. We'll notify you as soon as there's a decision.</p>}
        {e === 'verified' && <p className="banner ok">You're verified. You can host and join activities.</p>}
        {e && e !== 'verified' && e !== 'pending' && (
          <>
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} />
              <span>I agree that a specialist provider checks my ID document and compares a live selfie with it. This involves biometric data, used only to confirm I'm a real adult.</span>
            </label>
            <button className="btn primary block" disabled={verify.busy || !consent} onClick={() => verify.run(() => post('/v1/me/verification', { consent: true }))}>
              {e === 'unverified' ? 'Start verification' : 'Verify again'}
            </button>
          </>
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
