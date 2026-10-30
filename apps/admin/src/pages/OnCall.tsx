import { useEffect, useState, type FormEvent } from 'react';
import { api, can, get, post, type Role, type Session } from '../api';
import { CardHead } from '../charts';
import { ErrorBanner, fmt, Icon, useAction, useLoad } from '../ui';

type Shift = { id: string; userId: string; name: string; startsAt: string; endsAt: string; note: string | null };
type OnCallInfo = {
  now: { id: string; name: string; role: string; hasConfirmedPhone: boolean }[];
  fallback: boolean;
  shifts: Shift[];
  steps: { afterMinutes: number; who: string; when: string }[];
  ownerContactSet: boolean;
};
type Found = { id: string; email: string; role: Role; displayName?: string };

const MAX_DAYS = 14;
const role = (r: string) => r.replace('_', ' ');

/** Who answers urgent reports right now, who is next, and what happens when nobody does. Administrators can change the shifts. */
export function OnCall({ me }: { me: Session }) {
  const { data, error, reload } = useLoad(() => get<OnCallInfo>('/v1/admin/oncall'), [], 30000);
  const act = useAction(reload);
  const admin = can.admin(me.role);

  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [userId, setUserId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // search staff by name, email or id (the people list has no role filter, so keep only the staff from the answer)
  useEffect(() => {
    if (!admin || term.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      get<{ items: Found[] }>(`/v1/admin/users?${new URLSearchParams({ q: term.trim(), limit: '30' })}`)
        .then((r) => live && setFound(r.items.filter((u) => u.role !== 'user')))
        .catch(() => live && setFound([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term, admin]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const from = new Date(startsAt);
    const to = new Date(endsAt);
    if (!userId.trim()) return setFormError('Pick a staff member or paste a user id.');
    if (isNaN(+from) || isNaN(+to)) return setFormError('Set a start and an end time.');
    if (to <= from) return setFormError('The end must be after the start.');
    if (+to - +from > MAX_DAYS * 86400000) return setFormError(`A shift can be at most ${MAX_DAYS} days.`);
    act.run(async () => {
      await post('/v1/admin/oncall', { userId: userId.trim(), startsAt: from.toISOString(), endsAt: to.toISOString(), ...(note.trim() && { note: note.trim() }) });
      setNote('');
      setStartsAt('');
      setEndsAt('');
    });
  };
  const remove = (s: Shift) => {
    if (confirm(`Remove ${s.name}'s shift on ${fmt(s.startsAt)}?`)) act.run(() => api('DELETE', `/v1/admin/oncall/${s.id}`));
  };

  const noPhone = data?.now.filter((p) => !p.hasConfirmedPhone) ?? [];
  return (
    <section className="card oncall" aria-labelledby="oncall-h">
      <CardHead id="oncall-h" title="On-call" right={<span className="muted small">Who answers urgent reports</span>} />
      <ErrorBanner message={error ?? act.error} />
      {!data && !error && <p className="muted small">Loading…</p>}
      {data && (
        <>
          {data.fallback && (
            <p className="warn-note" role="status">
              <strong>Nobody has a shift right now.</strong> Trust leads and administrators are on call until someone is scheduled.
            </p>
          )}
          {noPhone.length > 0 && (
            <p className="warn-note" role="status">
              <strong>{noPhone.map((p) => p.name).join(', ')}</strong> {noPhone.length === 1 ? 'is' : 'are'} on call but {noPhone.length === 1 ? 'has' : 'have'} no confirmed phone number, so urgent alerts may not reach them.
            </p>
          )}
          {!data.ownerContactSet && (
            <p className="warn-note" role="status">
              The owner contact is not set, so the last step below has nobody to reach.
            </p>
          )}

          <div className="oncall-cols">
            <div>
              <h3>On call now</h3>
              {data.now.length === 0 ? (
                <p className="muted small">Nobody.</p>
              ) : (
                <ul className="plain">
                  {data.now.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name}</strong> <span className="muted small">{role(p.role)}</span>
                      {!p.hasConfirmedPhone && <span className="small" style={{ color: 'var(--orange)' }}> · no confirmed phone</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>What happens if nobody answers</h3>
              {data.steps.length === 0 ? (
                <p className="muted small">No steps are set.</p>
              ) : (
                <ol>
                  {data.steps.map((st, i) => (
                    <li key={i}>
                      <strong>{st.afterMinutes === 0 ? 'At once' : `After ${st.afterMinutes} min`}:</strong> {st.who}. <span className="muted">{st.when}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div>
            <h3>Upcoming shifts</h3>
            {data.shifts.length === 0 ? (
              <p className="muted small">No shifts scheduled.</p>
            ) : (
              <ul className="plain">
                {data.shifts.map((s) => (
                  <li key={s.id} className="row between wrap">
                    <span>
                      <strong>{s.name}</strong> · {fmt(s.startsAt)} to {fmt(s.endsAt)}
                      {s.note && <span className="muted small"> · {s.note}</span>}
                    </span>
                    {admin && (
                      <button className="btn small danger" onClick={() => remove(s)} disabled={act.busy} aria-label={`Remove ${s.name}'s shift starting ${fmt(s.startsAt)}`}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {admin && (
            <form className="oncall-form" onSubmit={add} aria-label="Add a shift">
              <label>
                Find staff (name, email or id)
                <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type 2 letters or more" />
              </label>
              <label>
                Staff member
                <select value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">{found.length || !term ? 'Choose…' : 'No staff found'}</option>
                  {userId && !found.some((u) => u.id === userId) && <option value={userId}>{userId}</option>}
                  {found.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName ?? u.email} ({role(u.role)})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Or user id
                <input value={userId} onChange={(e) => setUserId(e.target.value)} className="mono" />
              </label>
              <label>
                Starts
                <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </label>
              <label>
                Ends (up to {MAX_DAYS} days)
                <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </label>
              <label>
                Note (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
              </label>
              <button className="btn primary" type="submit" disabled={act.busy}>
                <Icon name="plus" /> Add shift
              </button>
              {formError && (
                <p role="alert" className="banner error" style={{ margin: 0, gridColumn: '1 / -1' }}>
                  {formError}
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
