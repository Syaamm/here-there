import './Content.css';
import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Avatar, Empty, ErrorBanner, fmt, Icon, Loading, Page, RowMenu, useAction, useLoad, useMore } from '../ui';

type A = { id: string; title: string; status: string; city: string; venueName: string; startsAt: string; capacity: number; going: number; host: { id: string; displayName?: string } };
type T = { id: string; title: string; status: string; destination: string; dateStart: string; members: number; host: { id: string; displayName?: string } };

const STEP = 25;
const STATUSES = ['published', 'full', 'planning', 'confirmed', 'completed', 'cancelled'];

export function ContentPage({ me }: { me: Session }) {
  const [tab, setTab] = useState<'activities' | 'trips'>('activities');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [newest, setNewest] = useState(true);
  const [shown, setShown] = useState(STEP);
  const base = `/v1/admin/${tab}${status ? `?status=${status}` : ''}`;
  const list = useLoad(() => get<{ items: (A | T)[]; nextCursor: string | null }>(base), [tab, status]);
  const more = useMore(list.data, (c) => get(`${base}${status ? '&' : '?'}cursor=${c}`), `${tab}|${status}`);
  const act = useAction(() => (more.reset(), list.reload()));
  const mod = can.moderate(me.role);

  const remove = async (id: string, title: string) => {
    const reason = await askText(`Remove "${title}"?`, { label: 'Reason (members are notified it was cancelled; kept in the audit log)', confirm: 'Remove' });
    if (reason) act.run(() => post(`/v1/admin/${tab}/${id}/remove`, { reason }));
  };

  const when = (x: A | T) => +new Date(tab === 'activities' ? (x as A).startsAt : (x as T).dateStart);
  const needle = q.trim().toLowerCase();
  const all = more.items
    .filter((x) => !needle || [x.title, (x as A).venueName, (x as T).destination, x.host.displayName].some((f) => f?.toLowerCase().includes(needle)))
    .sort((a, b) => (newest ? when(b) - when(a) : when(a) - when(b)));
  const items = all.slice(0, shown);

  return (
    <Page fill title="Content moderation" sub="HERE activities and THERE trips published by members.">
      <div className="ct-tools">
        <div className="ct-filters" role="tablist" aria-label="What to moderate">
          {(['activities', 'trips'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'ct-pill on' : 'ct-pill'} onClick={() => (setTab(t), setStatus(''), setShown(STEP))}>
              {t === 'activities' ? 'HERE activities' : 'THERE trips'}
            </button>
          ))}
        </div>
        <label className="ct-search">
          <span className="sr">Search content</span>
          <Icon name="search" />
          <input type="search" placeholder="Search title, venue or host" value={q} onChange={(e) => (setQ(e.target.value), setShown(STEP))} />
        </label>
        <label className="ct-select">
          <span className="sr">Status</span>
          <select value={status} onChange={(e) => (setStatus(e.target.value), setShown(STEP))}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="ct-select">
          <span className="sr">Order</span>
          <select value={newest ? 'new' : 'old'} onChange={(e) => setNewest(e.target.value === 'new')}>
            <option value="new">Newest start first</option>
            <option value="old">Oldest start first</option>
          </select>
        </label>
      </div>
      <ErrorBanner message={list.error ?? act.error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading rows={5} />}
      {list.data && all.length === 0 && <Empty title="Nothing here">No {tab === 'activities' ? 'activities' : 'trips'} match.</Empty>}
      {items.length > 0 && (
        <div className="ct-scroll">
          <ul className="ct-rows">
            {items.map((x) => {
              const a = x as A & T;
              const pct = Math.min(100, (a.going / Math.max(1, a.capacity)) * 100);
              return (
                <li key={x.id} className="ct-row">
                  <div className="ct-title">
                    <b>{x.title}</b>
                    <span>{tab === 'activities' ? `${a.venueName}, ${a.city}` : a.destination}</span>
                  </div>
                  <div className="ct-cell">
                    <span className="ct-label">{tab === 'activities' ? 'Starts' : 'Dates'}</span>
                    <span>{fmt(tab === 'activities' ? a.startsAt : a.dateStart)}</span>
                  </div>
                  <div className="ct-cell">
                    <span className="ct-label">{tab === 'activities' ? 'Going' : 'Members'}</span>
                    {tab === 'activities' ? (
                      <span className="ct-going">
                        <span className="ct-bar" role="presentation">
                          <i style={{ width: `${pct}%` }} />
                        </span>
                        {a.going} / {a.capacity}
                      </span>
                    ) : (
                      <span>{a.members}</span>
                    )}
                  </div>
                  <div className="ct-host">
                    <Avatar name={x.host.displayName ?? x.host.id} size="sm" />
                    <span>{x.host.displayName ?? x.host.id}</span>
                  </div>
                  <span className={`ct-status ${x.status}`}>
                    <i aria-hidden="true" />
                    {x.status.replace(/_/g, ' ')}
                  </span>
                  <div className="ct-menu">{mod && x.status !== 'cancelled' && <RowMenu label={`Actions for ${x.title}`} items={[{ label: 'Remove', danger: true, onSelect: () => remove(x.id, x.title) }]} />}</div>
                </li>
              );
            })}
          </ul>
          <div className="ct-foot">
            <span>
              Showing {items.length} of {all.length} {tab}
            </span>
            {all.length > shown && (
              <button type="button" className="ct-more" onClick={() => setShown(shown + STEP)}>
                Load more
              </button>
            )}
            {more.hasMore && all.length <= shown && more.more}
          </div>
        </div>
      )}
    </Page>
  );
}
