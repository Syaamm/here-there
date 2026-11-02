import { useEffect, useState, type FormEvent } from 'react';
import { api, can, get, post, type Role, type Session } from '../api';
import './OnCall.css';
import { Chip, Empty, ErrorBanner, fmt, Icon, Loading, Page, useAction, useLoad } from '../ui';

type Shift = { id: string; userId: string; name: string; startsAt: string; endsAt: string; note: string | null };
type OnCallInfo = {
  now: { id: string; name: string; role: string; hasConfirmedPhone: boolean }[];
  fallback: boolean;
  shifts: Shift[];
  steps: { afterMinutes: number; who: string; when: string }[];
  ownerContactSet: boolean;
};
type Workload = {
  policy: { answerWithin: { urgent: string; normal: string } };
  queue: { unassigned: number };
  moderators: { id: string; name: string; role: string; assigned: number; overdue: number; oldestHours: number | null; resolvedLast7Days: number }[];
};
type Found = { id: string; email: string; role: Role; displayName?: string };

const MAX_DAYS = 14;
const DAY = 86_400_000;
const LENGTHS: [string, string][] = [
  ['8', '8 hours'],
  ['12', '12 hours'],
  ['24', '1 day'],
  ['48', '2 days'],
  ['72', '3 days'],
  ['168', '1 week'],
  ['336', '2 weeks'],
];
const COLORS = ['#12302b', '#4f86f7', '#b9d8cc', '#8a6d3b', '#5b4b8a'];
const LIGHT = new Set(['#b9d8cc']);
const role = (r: string) => r.replace('_', ' ');
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
const clock = (iso: string | number) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayName = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
/** "now" as the value a datetime-local box wants, in this person's own time. */
const localNow = () => {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/**
 * Who answers urgent reports. The headline says who is on call and until when; below it what happens when nobody answers,
 * the next three days as a timeline, and how busy the moderators are. Administrators add and remove shifts.
 */
export function OnCallPage({ me }: { me: Session }) {
  const { data, error, reload } = useLoad(() => get<OnCallInfo>('/v1/admin/oncall'), [], 30000);
  const work = useLoad(() => get<Workload>('/v1/admin/reports/workload').catch(() => null), [], 30000);
  const act = useAction(() => (reload(), work.reload()));
  const admin = can.admin(me.role);
  const [adding, setAdding] = useState(false);

  const now = Date.now();
  const first = data?.now[0];
  const current = data?.shifts.filter((s) => +new Date(s.startsAt) <= now && +new Date(s.endsAt) > now) ?? [];
  const until = current.length ? Math.max(...current.map((s) => +new Date(s.endsAt))) : null;
  const title = !data
    ? 'On-call'
    : data.fallback || !first
      ? 'Nobody has a shift right now'
      : data.now.length === 1
        ? `${first.name} is on call${until ? ` until ${clock(until)}` : ''}`
        : `${data.now.map((p) => p.name).join(' and ')} are on call`;

  const remove = (s: Shift) => {
    if (confirm(`Remove ${s.name}'s shift on ${fmt(s.startsAt)}?`)) act.run(() => api('DELETE', `/v1/admin/oncall/${s.id}`));
  };

  // the next three days, from this morning
  const t0 = new Date();
  t0.setHours(0, 0, 0, 0);
  const w0 = +t0;
  const span = 3 * DAY;
  const pos = (t: number) => Math.max(0, Math.min(100, ((t - w0) / span) * 100));
  const people = data ? [...new Map(data.shifts.map((s) => [s.userId, s.name])).entries()] : [];
  // how long the cover runs without a hole, from now
  const sorted = [...(data?.shifts ?? [])].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  let coveredTo = now;
  let coveredNow = false;
  for (const s of sorted) {
    const a = +new Date(s.startsAt);
    const b = +new Date(s.endsAt);
    if (a <= coveredTo && b > coveredTo) (coveredTo = b), (coveredNow = true);
  }
  const noGaps = coveredNow && coveredTo >= w0 + span;
  const noPhone = data?.now.filter((p) => !p.hasConfirmedPhone) ?? [];
  const w = work.data;

  return (
    <Page
      title={title}
      actions={
        admin && (
          <button className="btn primary oc-add" onClick={() => setAdding(!adding)} aria-expanded={adding}>
            <Icon name="plus" /> Add shift
          </button>
        )
      }
    >
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      {!data && !error && <Loading rows={6} />}
      {data && (
        <div className="oncall-page oc-page">
          {adding && admin && <AddShift onDone={() => (setAdding(false), reload())} onCancel={() => setAdding(false)} />}

          {(data.fallback || noPhone.length > 0) && (
            <div style={{ display: 'grid', gap: 8 }}>
              {data.fallback && <p className="warn-note">Nobody has a shift now, so trust leads and administrators cover until someone is scheduled.</p>}
              {noPhone.length > 0 && <p className="warn-note">{noPhone.map((p) => p.name).join(', ')}: no confirmed phone number, so urgent alerts may not arrive.</p>}
            </div>
          )}

          <section className="card" aria-label="Escalation">
            <div className="card-title">
              <h2>When an urgent report isn’t answered</h2>
              {w && <span className="muted small">Urgent: {w.policy.answerWithin.urgent} to answer · others: {w.policy.answerWithin.normal}</span>}
            </div>
            {data.steps.length === 0 ? (
              <p className="muted">No steps are set.</p>
            ) : (
              <div className="step-row">
                {data.steps.map((st, i) => {
                  const last = i === data.steps.length - 1;
                  const missing = last && !data.ownerContactSet;
                  return (
                    <div key={i} style={{ display: 'contents' }}>
                      {i > 0 && (
                        <span className="step-arrow" aria-hidden="true">
                          →
                        </span>
                      )}
                      <div className={missing ? 'step missing' : 'step'}>
                        <small>{missing ? 'Last step · missing' : st.afterMinutes === 0 ? 'At once' : `After ${st.afterMinutes} min`}</small>
                        <strong>{missing ? 'Owner' : st.who}</strong>
                        {missing ? <span className="oc-link">Set an owner contact →</span> : <span>{st.when}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card" aria-label="Shifts">
            <div className="card-title">
              <h2>Next 3 days</h2>
              <span className="small">
                {noGaps ? (
                  <>
                    <strong style={{ color: '#12302b' }}>No gaps</strong> until {fmt(new Date(w0 + span).toISOString())}
                  </>
                ) : coveredNow ? (
                  <strong style={{ color: '#a02828' }}>Cover ends {fmt(new Date(coveredTo).toISOString())}</strong>
                ) : (
                  <strong style={{ color: '#a02828' }}>Nobody on call now</strong>
                )}
              </span>
            </div>
            {people.length === 0 ? (
              <Empty>No shifts scheduled.</Empty>
            ) : (
              <div className="timeline">
                <div className="timeline-inner">
                  <div className="tl-row">
                    <span />
                    <span className="tl-days">
                      {[0, 1, 2].map((d) => (
                        <span key={d}>{dayName(w0 + d * DAY)}</span>
                      ))}
                    </span>
                  </div>
                  {people.map(([id, name], pi) => (
                    <div className="tl-row" key={id}>
                      <span style={{ display: 'grid' }}>
                        <strong>{name}</strong>
                      </span>
                      <span className="tl-track">
                        {data.shifts
                          .filter((s) => s.userId === id && +new Date(s.endsAt) > w0 && +new Date(s.startsAt) < w0 + span)
                          .map((s) => {
                            const l = pos(+new Date(s.startsAt));
                            const r = pos(+new Date(s.endsAt));
                            return (
                              <span key={s.id} className="tl-bar" style={{ left: `${l}%`, width: `${Math.max(2, r - l)}%`, background: COLORS[pi % COLORS.length], color: LIGHT.has(COLORS[pi % COLORS.length]) ? '#12302b' : '#fff' }}>
                                {s.note ?? 'Shift'} · {clock(s.startsAt)}–{clock(s.endsAt)}
                                {admin && (
                                  <button aria-label={`Remove ${s.name}'s shift starting ${fmt(s.startsAt)}`} disabled={act.busy} onClick={() => remove(s)}>
                                    ×
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        <span className="tl-now" style={{ left: `${pos(now)}%` }} aria-hidden="true" />
                      </span>
                    </div>
                  ))}
                  <div className="tl-row">
                    <span />
                    <span className="tl-now-label oc-now-label" style={{ paddingLeft: `calc(${pos(now)}% - 14px)` }}>
                      Now {clock(now)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {w && w.moderators.length > 0 && (
            <section className="card" aria-label="Moderator workload">
              <div className="card-title">
                <h2>Who is carrying the load</h2>
                <span className="muted small">{w.queue.unassigned} open {w.queue.unassigned === 1 ? 'report is' : 'reports are'} still unassigned</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 640 }}>
                  <div className="load-grid load-head">
                    <span>Moderator</span>
                    <span>Assigned now</span>
                    <span>Oldest</span>
                    <span>Done, 7 days</span>
                  </div>
                  {w.moderators.map((m) => (
                    <div className="load-grid load-row" key={m.id}>
                      <span>
                        <strong>{m.name}</strong> <span className="muted">{role(m.role)}</span>
                      </span>
                      <span className="load-bar">
                        <i style={{ width: `${m.assigned * 60}px` }} />
                        {m.assigned}
                        {m.overdue > 0 && <Chip value={`${m.overdue} overdue`} tone="warn" />}
                      </span>
                      <span className="muted">{m.oldestHours != null ? hours(m.oldestHours) : '–'}</span>
                      <strong>{m.resolvedLast7Days}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}

/** A short form: who, when it starts, how long. */
function AddShift({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [who, setWho] = useState<Found | null>(null);
  const [startsAt, setStartsAt] = useState(localNow);
  const [length, setLength] = useState('12');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const act = useAction(onDone);

  // search staff by name, email or id (the people list has no role filter, so keep only the staff from the answer)
  useEffect(() => {
    if (who || term.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      get<{ items: Found[] }>(`/v1/admin/users?${new URLSearchParams({ q: term.trim(), limit: '30' })}`)
        .then((r) => live && setFound(r.items.filter((u) => u.role !== 'user').slice(0, 6)))
        .catch(() => live && setFound([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term, who]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const from = new Date(startsAt);
    const to = new Date(+from + Number(length) * 3600000);
    if (!who) return setFormError('Choose who is on call.');
    if (isNaN(+from)) return setFormError('Set a start time.');
    if (+to - +from > MAX_DAYS * DAY) return setFormError(`A shift can be at most ${MAX_DAYS} days.`);
    act.run(() => post('/v1/admin/oncall', { userId: who.id, startsAt: from.toISOString(), endsAt: to.toISOString(), ...(note.trim() && { note: note.trim() }) }));
  };

  return (
    <form className="card" onSubmit={add} aria-label="Add a shift" style={{ display: 'grid', gap: 14 }}>
      <div className="card-title">
        <h2>Add a shift</h2>
      </div>
      <ErrorBanner message={act.error} />
      <div className="form-grid">
        {who ? (
          <div className="row between" style={{ padding: '8px 12px', border: '1px solid var(--line-2)', borderRadius: 10, alignSelf: 'end', minHeight: 44 }}>
            <span>
              <strong>{who.displayName ?? who.email}</strong> <span className="muted small">{role(who.role)}</span>
            </span>
            <button type="button" className="link small" onClick={() => (setWho(null), setTerm(''))}>
              Change
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6, position: 'relative' }}>
            <label>
              Who
              <input type="search" autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search staff by name or email" autoComplete="off" />
            </label>
            {found.length > 0 && (
              <ul className="plain" role="listbox" aria-label="Staff found" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 4, background: 'var(--surface)' }}>
                {found.map((u) => (
                  <li key={u.id}>
                    <button type="button" className="list-item" style={{ border: 0, padding: '8px 10px' }} onClick={() => setWho(u)}>
                      <span className="title">{u.displayName ?? u.email}</span>
                      <span className="aside muted small">{role(u.role)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {term.trim().length >= 2 && found.length === 0 && <span className="muted small">No staff found.</span>}
          </div>
        )}
        <label>
          Starts
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label>
          For
          <select value={length} onChange={(e) => setLength(e.target.value)}>
            {LENGTHS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
      </div>
      {formError && (
        <p role="alert" className="banner error">
          {formError}
        </p>
      )}
      <div className="row end" style={{ margin: 0 }}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={act.busy}>
          <Icon name="plus" /> Add shift
        </button>
      </div>
    </form>
  );
}
