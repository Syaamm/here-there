import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, post, type Activity } from '../api';
import { useMe } from '../auth';
import { CATS, MILAN_AREAS } from '../constants';
import { ErrorBanner, go, useAction } from '../ui';
import { useCity } from './Explore';

const DRAFT = 'here_activity_draft';
const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function initial(city: string) {
  const start = new Date(Date.now() + 3600e3);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  return { title: '', category: 'drinks', date: localDate(start), time: localTime(start), duration: '2', capacity: '6', city, area: 'Brera', venueName: '', description: '', publicPlace: false };
}
type Form = ReturnType<typeof initial>;

/** Screen 04: create an activity. Drafts are kept on this device only. */
export function Create() {
  const { me } = useMe();
  const [city] = useCity();
  const [f, setF] = useState<Form>(() => {
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw) return { ...initial(city), ...JSON.parse(raw), publicPlace: false };
    } catch {
      /* ignore */
    }
    return initial(city);
  });
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const [needsVerify, setNeedsVerify] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const { publicPlace: _p, ...rest } = f;
        localStorage.setItem(DRAFT, JSON.stringify(rest));
        setSaved(true);
      } catch {
        /* ignore */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [f]);

  const isMilan = f.city.trim().toLowerCase() === 'milan';
  const verified = me?.eligibility === 'verified';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNeedsVerify(false);
    const startsAt = new Date(`${f.date}T${f.time}`);
    const endsAt = new Date(+startsAt + Number(f.duration) * 3600e3);
    const geo = isMilan ? MILAN_AREAS[f.area] : undefined;
    const body = {
      title: f.title,
      category: f.category,
      description: f.description.trim() || undefined,
      city: f.city.trim(),
      venueName: isMilan ? `${f.venueName.trim()} (${f.area})` : f.venueName.trim(),
      lat: geo?.[0],
      lng: geo?.[1],
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      capacity: Number(f.capacity),
    };
    try {
      const a = await act.run(() => post<Activity>('/v1/activities', body));
      if (a) {
        try {
          localStorage.removeItem(DRAFT);
        } catch {
          /* ignore */
        }
        go(`/activity/${a.id}`);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERIFICATION_REQUIRED') setNeedsVerify(true);
    }
  };

  // useAction swallows the error, so surface the verification case from its message
  const verifyCase = needsVerify || /identity verification/i.test(act.error ?? '');

  return (
    <>
      <div className="row between">
        <h2 className="big">Create an activity</h2>
        <span className="muted small" role="status">
          {saved ? 'Draft saved' : ''}
        </span>
      </div>

      {!verified && (
        <a href="#/safety" className="banner info">
          You need a verified identity to publish. You can fill this in now and it will be saved as a draft. <strong>Verify ›</strong>
        </a>
      )}
      <ErrorBanner message={act.error} />
      {verifyCase && (
        <a href="#/safety" className="btn primary block">
          Go to identity verification
        </a>
      )}

      <form className="stack" onSubmit={submit}>
        <label>
          Activity name *
          <input required minLength={2} maxLength={80} placeholder="After-work aperitivo" value={f.title} onChange={(e) => set('title', e.target.value)} />
        </label>

        <fieldset>
          <legend>Category *</legend>
          <div className="chips">
            {Object.entries(CATS).map(([k, v]) => (
              <label key={k} className={f.category === k ? 'pill active' : 'pill'}>
                <input type="radio" name="category" className="sr" checked={f.category === k} onChange={() => set('category', k)} />
                {v.emoji} {v.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid2">
          <label>
            Date *
            <input type="date" required min={localDate(new Date())} value={f.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label>
            Starts at *
            <input type="time" required value={f.time} onChange={(e) => set('time', e.target.value)} />
          </label>
          <label>
            Duration
            <select value={f.duration} onChange={(e) => set('duration', e.target.value)}>
              {['1', '2', '3', '4', '6', '8'].map((h) => (
                <option key={h} value={h}>
                  {h} {h === '1' ? 'hour' : 'hours'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Maximum people *
            <input type="number" required min={2} max={20} value={f.capacity} onChange={(e) => set('capacity', e.target.value)} />
          </label>
        </div>

        <label>
          City *
          <input required minLength={2} value={f.city} onChange={(e) => set('city', e.target.value)} />
        </label>
        {isMilan ? (
          <label>
            Neighborhood *
            <select value={f.area} onChange={(e) => set('area', e.target.value)}>
              {Object.keys(MILAN_AREAS).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted small">Map pins are only available in Milan for now. Your activity will still appear in the list.</p>
        )}
        <label>
          Public meeting location *
          <input required minLength={2} maxLength={100} placeholder="e.g. Bar Brera, Parco Sempione north gate" value={f.venueName} onChange={(e) => set('venueName', e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" required checked={f.publicPlace} onChange={(e) => set('publicPlace', e.target.checked)} />
          <span>This is a public place. First meetings never happen at a private home.</span>
        </label>

        <label>
          Description
          <textarea rows={3} maxLength={1000} placeholder="Casual drinks and conversation with new people." value={f.description} onChange={(e) => set('description', e.target.value)} />
        </label>

        <label className="check locked">
          <input type="checkbox" checked disabled readOnly />
          <span>
            Approve requests manually
            <small className="muted"> Members join after you review them. This is always on for now.</small>
          </span>
        </label>

        <button className="btn primary block" disabled={act.busy || !f.publicPlace}>
          {act.busy ? 'Publishing…' : 'Publish activity'}
        </button>
        <p className="muted small">Your activity is public in the feed. Only the venue is shown, never anyone's live location.</p>
      </form>
    </>
  );
}
