import { useState, type FormEvent } from 'react';
import { get, post, type Activity } from '../api';
import { useMe } from '../auth';
import { ErrorBanner, go, Spinner, TopBar, useAction, useLoad, when } from '../ui';

/** Screen 06: join request. Chat stays closed until the host approves. */
export function Join({ id }: { id: string }) {
  const { me } = useMe();
  const { data: a, loading } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id]);
  const [intro, setIntro] = useState('');
  const [agree, setAgree] = useState(false);
  const act = useAction();

  if (loading && !a) return <><TopBar title="Request to join" /><Spinner /></>;
  if (!a) return <TopBar title="Request to join" />;

  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => post(`/v1/activities/${id}/requests`, { intro: intro.trim() || undefined }));
    if (r) go(`/activity/${id}`);
  };

  return (
    <>
      <TopBar title="Request to join" />
      <div className="card">
        <strong>{a.title}</strong>
        <div className="muted small">
          {when(a.startsAt)} · {a.venueName} · {a.going}/{a.capacity} going
        </div>
      </div>
      <form className="stack" onSubmit={submit}>
        <ErrorBanner message={act.error} />
        <label>
          Introduce yourself to the host
          <textarea rows={4} maxLength={500} placeholder="Hi! I'm new to town and would love to join." value={intro} onChange={(e) => setIntro(e.target.value)} />
          <span className="muted small">{intro.length}/500</span>
        </label>

        <div className="card">
          <strong>Before joining</strong>
          <ul className="checklist">
            <li className={adult ? 'done' : 'todo'}>{adult ? '✓' : '✗'} I am at least 18 years old</li>
            <li className={verified ? 'done' : 'todo'}>
              {verified ? '✓' : '✗'} Identity verified {!verified && <a href="#/safety">Verify now</a>}
            </li>
          </ul>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I agree to the group guidelines: be respectful, meet in public, and report anything that feels wrong.</span>
          </label>
        </div>

        <button className="btn primary block" disabled={act.busy || !verified || !adult || !agree}>
          {act.busy ? 'Sending…' : 'Send request'}
        </button>
        <p className="muted small center">Chat access begins only after the host approves you.</p>
      </form>
    </>
  );
}
