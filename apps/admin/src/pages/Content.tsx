import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Avatar, Chip, Empty, ErrorBanner, fmt, Page, RowMenu, Search, useAction, useLoad, useMore } from '../ui';

type A = { id: string; title: string; status: string; city: string; venueName: string; startsAt: string; capacity: number; going: number; host: { id: string; displayName?: string } };
type T = { id: string; title: string; status: string; destination: string; dateStart: string; members: number; host: { id: string; displayName?: string } };

const STEP = 25;

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
    <Page title="Content moderation" sub="HERE activities and THERE trips published by members.">
      <div className="tabs" role="tablist">
        {(['activities', 'trips'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => (setTab(t), setStatus(''), setShown(STEP))}>
            {t === 'activities' ? 'HERE activities' : 'THERE trips'}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <Search label="Search content" placeholder="Search title, venue or host" value={q} onChange={(v) => (setQ(v), setShown(STEP))} />
        <label>
          <span className="sr">Status</span>
          <select value={status} onChange={(e) => (setStatus(e.target.value), setShown(STEP))}>
            <option value="">All statuses</option>
            {['published', 'full', 'planning', 'confirmed', 'completed', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr">Order</span>
          <select value={newest ? 'new' : 'old'} onChange={(e) => setNewest(e.target.value === 'new')}>
            <option value="new">Newest start first</option>
            <option value="old">Oldest start first</option>
          </select>
        </label>
      </div>
      <ErrorBanner message={list.error ?? act.error} />
      {list.loading && !list.data && <p className="muted">Loading…</p>}
      {list.data && all.length === 0 && <Empty>Nothing here.</Empty>}
      {items.length > 0 && (
        <div className="table-wrap">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{tab === 'activities' ? 'Activity' : 'Trip'}</th>
                  <th>{tab === 'activities' ? 'Starts' : 'Dates'}</th>
                  <th>{tab === 'activities' ? 'Going' : 'Members'}</th>
                  <th>Host</th>
                  <th>Status</th>
                  <th>
                    <span className="sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const a = x as A & T;
                  return (
                    <tr key={x.id}>
                      <td>
                        <div className="name" style={{ fontWeight: 700 }}>{x.title}</div>
                        <div className="muted small">{tab === 'activities' ? `${a.venueName}, ${a.city}` : a.destination}</div>
                      </td>
                      <td className="nowrap">{fmt(tab === 'activities' ? a.startsAt : a.dateStart)}</td>
                      <td>
                        {tab === 'activities' ? (
                          <div className="going">
                            <span className="progress" role="presentation">
                              <i style={{ width: `${Math.min(100, (a.going / Math.max(1, a.capacity)) * 100)}%` }} />
                            </span>
                            {a.going} / {a.capacity}
                          </div>
                        ) : (
                          a.members
                        )}
                      </td>
                      <td>
                        <div className="person">
                          <Avatar name={x.host.displayName ?? x.host.id} size="sm" />
                          <span style={{ fontWeight: 600 }}>{x.host.displayName ?? x.host.id}</span>
                        </div>
                      </td>
                      <td>
                        <Chip value={x.status} />
                      </td>
                      <td className="end">
                        {mod && x.status !== 'cancelled' && <RowMenu label={`Actions for ${x.title}`} items={[{ label: 'Remove', danger: true, onSelect: () => remove(x.id, x.title) }]} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span className="muted small">
              Showing {items.length} of {all.length} {tab}
            </span>
            {all.length > shown && (
              <button className="btn" onClick={() => setShown(shown + STEP)}>
                Load more
              </button>
            )}
          </div>
        </div>
      )}
      {more.more}
    </Page>
  );
}
