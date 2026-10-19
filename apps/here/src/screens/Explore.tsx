import { useEffect, useMemo, useState } from 'react';
import { get, type Activity } from '../api';
import { useMe } from '../auth';
import { CATS } from '../constants';
import { Chip, Empty, ErrorBanner, go, Sheet, Spinner, useLoad, when } from '../ui';

const HORIZONS = [
  { id: '2h', label: 'Next 2 hours' },
  { id: 'tonight', label: 'Tonight' },
  { id: 'tomorrow', label: 'Tomorrow' },
] as const;
export type Horizon = (typeof HORIZONS)[number]['id'];

export function horizonRange(h: Horizon): [Date, Date] {
  const now = new Date();
  if (h === '2h') return [now, new Date(+now + 2 * 3600e3)];
  if (h === 'tonight') {
    const end = new Date(now);
    end.setHours(23, 59, 59, 0);
    return [now, end > now ? end : new Date(+now + 6 * 3600e3)];
  }
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 0);
  return [start, end];
}

export function useCity() {
  const { me } = useMe();
  const [city, setCity] = useState(() => {
    try {
      return localStorage.getItem('here_city') ?? '';
    } catch {
      return '';
    }
  });
  const value = city || me?.profile?.homeCity || 'Milan';
  const update = (c: string) => {
    setCity(c);
    try {
      localStorage.setItem('here_city', c);
    } catch {
      /* ignore */
    }
  };
  return [value, update] as const;
}

export function CitySheet({ city, onPick, onClose }: { city: string; onPick: (c: string) => void; onClose: () => void }) {
  const [v, setV] = useState(city);
  return (
    <Sheet title="Choose your city" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim().length >= 2) onPick(v.trim());
          onClose();
        }}
      >
        <label>
          City
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        <p className="muted small">You never need to share your device location to browse. Pick a city instead.</p>
        <button className="btn primary block">Use this city</button>
      </form>
    </Sheet>
  );
}

export function ActivityCard({ a, wide }: { a: Activity; wide?: boolean }) {
  const cat = CATS[a.category];
  const full = a.spotsLeft === 0;
  return (
    <a href={`#/activity/${a.id}`} className={wide ? 'act-card wide' : 'act-card'}>
      <div className="act-emoji" aria-hidden="true">
        {cat?.emoji ?? '📍'}
      </div>
      <div className="act-main">
        <strong>{a.title}</strong>
        <span className="muted small">
          {when(a.startsAt)} · {a.venueName}
          {a.distanceKm !== undefined && ` · ${a.distanceKm} km`}
        </span>
        <span className="act-meta">
          <span>
            👥 {a.going}/{a.capacity}
          </span>
          {full ? <Chip tone="warn">Full</Chip> : <Chip tone="ok">{a.spotsLeft} spots left</Chip>}
          <Chip>{cat?.label ?? a.category}</Chip>
        </span>
      </div>
    </a>
  );
}

/** Screen 02: time-sensitive discovery feed. */
export function Explore() {
  const { me } = useMe();
  const [city, setCity] = useCity();
  const [cat, setCat] = useState('');
  const [horizon, setHorizon] = useState<Horizon>('2h');
  const [q, setQ] = useState('');
  const [cityOpen, setCityOpen] = useState(false);

  const feed = useLoad(
    () => {
      const [from, to] = horizonRange(horizon);
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50', ...(cat && { category: cat }) });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city, cat, horizon],
    60_000,
  );

  // The API has no free-text search yet, so search filters the fetched feed on this device.
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = feed.data?.items ?? [];
    return t ? all.filter((a) => `${a.title} ${a.venueName} ${a.tags.join(' ')}`.toLowerCase().includes(t)) : all;
  }, [feed.data, q]);

  const soonCut = Date.now() + 2 * 3600e3;
  const soon = items.filter((a) => +new Date(a.startsAt) <= soonCut);
  const later = items.filter((a) => +new Date(a.startsAt) > soonCut);

  useEffect(() => {
    document.title = 'HERE. Explore';
  }, []);

  return (
    <>
      <header className="home-head">
        <div>
          <h1 className="logo dark">
            HERE<span>.</span>
          </h1>
          <button className="link small" onClick={() => setCityOpen(true)}>
            📍 {city} · Around you ▾
          </button>
        </div>
        <a href="#/profile" className="avatar" aria-label="Your profile">
          {me?.profile?.displayName?.[0]?.toUpperCase() ?? '?'}
        </a>
      </header>

      {me && me.eligibility !== 'verified' && (
        <a href="#/safety" className="banner info">
          {me.eligibility === 'pending' ? 'Your identity check is being reviewed.' : 'Verify your identity to host or join activities.'} <strong>Details ›</strong>
        </a>
      )}

      <h2 className="big">What are you up for?</h2>
      <label className="search">
        <span className="sr">Search activities or neighborhoods</span>
        <input type="search" placeholder="Search activities or neighborhoods" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>

      <div className="chips" role="group" aria-label="Category">
        {[['', 'All'], ...Object.entries(CATS).map(([k, v]) => [k, v.label])].map(([k, l]) => (
          <button key={k} className={cat === k ? 'pill active' : 'pill'} aria-pressed={cat === k} onClick={() => setCat(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="row between">
        <h3>{horizon === '2h' ? 'Happening soon' : 'Activities'}</h3>
        <label className="inline">
          <span className="sr">Time range</span>
          <select value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)}>
            {HORIZONS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {feed.data && items.length === 0 && (
        <Empty title={q ? 'No matches' : 'Nothing planned yet'}>
          {q ? 'Try a different search, category or time range.' : 'Be the first. Start an activity in a minute.'}
          <br />
          <button className="btn primary" onClick={() => go('/create')}>
            Create an activity
          </button>
        </Empty>
      )}

      <div className="stack">
        {(horizon === '2h' ? soon : items).map((a) => (
          <ActivityCard key={a.id} a={a} />
        ))}
      </div>

      {horizon === '2h' && later.length > 0 && (
        <>
          <h3>More around you</h3>
          <div className="stack">
            {later.map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </div>
        </>
      )}

      {items.length > 0 && (
        <div className="card row between">
          <div>
            <strong>Nothing planned?</strong>
            <div className="muted small">Start an activity in minutes.</div>
          </div>
          <button className="btn primary" onClick={() => go('/create')}>
            Create +
          </button>
        </div>
      )}

      {cityOpen && <CitySheet city={city} onPick={setCity} onClose={() => setCityOpen(false)} />}
    </>
  );
}
