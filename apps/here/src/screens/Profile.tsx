import { useState, type FormEvent } from 'react';
import { get, patch, type Activity } from '../api';
import { useMe } from '../auth';
import { ActivityCard } from './Explore';
import { Chip, Empty, ErrorBanner, Spinner, useAction, useLoad } from '../ui';

type Mine = { joined: (Activity & { role: string })[]; requests: { requestId: string; state: string; activity: Activity }[] };
type PublicProfile = { stats: { activitiesHosted: number; activitiesJoined: number } };

const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Screen 09: shared profile. Only a verified-adult badge is ever public, never documents. */
export function Profile() {
  const { me, reload, logout } = useMe();
  const [editing, setEditing] = useState(false);
  const stats = useLoad(() => get<PublicProfile>(`/v1/users/${me!.id}`), [me?.id]);
  const mine = useLoad(() => get<Mine>('/v1/me/activities'), []);
  const favs = useLoad(() => get<{ items: Activity[] }>('/v1/me/favorites'), []);
  const [tab, setTab] = useState<'activities' | 'saved'>('activities');
  if (!me?.profile) return <Spinner />;
  const p = me.profile;

  return (
    <>
      <h2 className="big">Your profile</h2>
      <div className="center stack">
        <span className="avatar xl" aria-hidden="true">{p.displayName[0]?.toUpperCase()}</span>
        <h3 className="name">
          {p.displayName} {me.eligibility === 'verified' && <span title="Verified adult">✓</span>}
        </h3>
        <div className="muted small">
          {p.homeCity ?? 'No city set'} · {me.eligibility === 'verified' ? 'Verified adult' : me.eligibility === 'pending' ? 'Identity check pending' : 'Not verified yet'}
        </div>
      </div>

      <div className="stats">
        <div>
          <strong>{stats.data?.stats.activitiesHosted ?? '–'}</strong>
          <span className="muted small">Hosted</span>
        </div>
        <div>
          <strong>{stats.data?.stats.activitiesJoined ?? '–'}</strong>
          <span className="muted small">Joined</span>
        </div>
        <div>
          <strong>–</strong>
          <span className="muted small">No reviews yet</span>
        </div>
      </div>

      {p.bio && <p className="center">{p.bio}</p>}
      <h3>Interests</h3>
      {p.interests.length ? (
        <div className="chips">
          {p.interests.map((i) => (
            <Chip key={i}>{i}</Chip>
          ))}
        </div>
      ) : (
        <p className="muted small">Add interests so people know what you enjoy.</p>
      )}
      {p.languages.length > 0 && <p className="muted small">Languages: {p.languages.join(', ')}</p>}

      <div className="stack">
        <button className="btn block" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Close editor' : 'Edit profile'}
        </button>
        {editing && <EditForm onDone={() => (setEditing(false), reload())} />}
        <a className="btn block" href="#/safety">
          Safety &amp; privacy
        </a>
        <button className="btn block" disabled title="THERE is not available yet">
          Switch to THERE ↗ (coming soon)
        </button>
      </div>

      <div className="chips" role="tablist">
        <button role="tab" aria-selected={tab === 'activities'} className={tab === 'activities' ? 'pill active' : 'pill'} onClick={() => setTab('activities')}>
          My activities
        </button>
        <button role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'pill active' : 'pill'} onClick={() => setTab('saved')}>
          Saved
        </button>
      </div>

      {tab === 'activities' ? (
        <>
          {mine.data && mine.data.joined.length + mine.data.requests.length === 0 && <Empty title="Nothing yet">Join or host an activity and it will show up here.</Empty>}
          <div className="stack">
            {mine.data?.joined.map((a) => (
              <div key={a.id} className="stack tight">
                <ActivityCard a={a} />
                <div className="row">
                  <Chip tone="ok">{a.role === 'host' ? 'You host this' : 'Going'}</Chip>
                  {a.role === 'host' && (
                    <a className="link small" href={`#/host/${a.id}`}>
                      Manage requests ›
                    </a>
                  )}
                </div>
              </div>
            ))}
            {mine.data?.requests.map((r) => (
              <div key={r.requestId} className="stack tight">
                <ActivityCard a={r.activity} />
                <Chip tone={r.state === 'declined' ? 'bad' : 'warn'}>{r.state === 'requested' ? 'Request pending' : 'Not approved'}</Chip>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {favs.data && favs.data.items.length === 0 && <Empty title="No saved activities">Use ⋯ on an activity to save it for later.</Empty>}
          <div className="stack">
            {favs.data?.items.map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </div>
        </>
      )}

      <button className="btn ghost block" onClick={logout}>
        Sign out
      </button>
    </>
  );
}

function EditForm({ onDone }: { onDone: () => void }) {
  const { me } = useMe();
  const p = me!.profile!;
  const [f, setF] = useState({ displayName: p.displayName, homeCity: p.homeCity ?? '', languages: p.languages.join(', '), interests: p.interests.join(', '), bio: p.bio ?? '' });
  const act = useAction(onDone);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    return act.run(() =>
      patch('/v1/me/profile', {
        displayName: f.displayName,
        homeCity: f.homeCity.trim() || null,
        languages: csv(f.languages),
        interests: csv(f.interests),
        bio: f.bio.trim() || null,
      }),
    );
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <ErrorBanner message={act.error} />
      <label>
        Display name
        <input required minLength={2} maxLength={40} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
      </label>
      <label>
        Home city (city only)
        <input maxLength={60} value={f.homeCity} onChange={(e) => setF({ ...f, homeCity: e.target.value })} />
      </label>
      <label>
        Languages <span className="muted small">(comma separated)</span>
        <input value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} />
      </label>
      <label>
        Interests <span className="muted small">(comma separated)</span>
        <input value={f.interests} onChange={(e) => setF({ ...f, interests: e.target.value })} />
      </label>
      <label>
        Bio
        <textarea rows={3} maxLength={300} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
      </label>
      <button className="btn primary block" disabled={act.busy}>
        Save changes
      </button>
    </form>
  );
}
