import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Page, useAction, useLoad } from '../ui';

type A = { id: string; title: string; status: string; city: string; venueName: string; startsAt: string; capacity: number; going: number; host: { id: string; displayName?: string } };
type T = { id: string; title: string; status: string; destination: string; dateStart: string; members: number; host: { id: string; displayName?: string } };

export function ContentPage({ me }: { me: Session }) {
  const [tab, setTab] = useState<'activities' | 'trips'>('activities');
  const [status, setStatus] = useState('');
  const list = useLoad(() => get<{ items: (A | T)[] }>(`/v1/admin/${tab}${status ? `?status=${status}` : ''}`), [tab, status]);
  const act = useAction(list.reload);
  const mod = can.moderate(me.role);

  const remove = async (id: string, title: string) => {
    const reason = await askText(`Remove "${title}"?`, { label: 'Reason (members are notified it was cancelled; kept in the audit log)', confirm: 'Remove' });
    if (reason) act.run(() => post(`/v1/admin/${tab}/${id}/remove`, { reason }));
  };

  const items = list.data?.items ?? [];
  return (
    <Page
      title="Content moderation"
      actions={
        <label>
          <span className="sr">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['published', 'full', 'planning', 'confirmed', 'completed', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div className="tabs" role="tablist">
        {(['activities', 'trips'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => (setTab(t), setStatus(''))}>
            {t === 'activities' ? 'HERE activities' : 'THERE trips'}
          </button>
        ))}
      </div>
      <ErrorBanner message={list.error ?? act.error} />
      {list.loading && !list.data && <p className="muted">Loading…</p>}
      {list.data && items.length === 0 && <Empty>Nothing here.</Empty>}
      {items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>{tab === 'activities' ? 'Venue' : 'Destination'}</th>
                <th>Starts</th>
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
                    <td>{x.title}</td>
                    <td>{tab === 'activities' ? `${a.venueName}, ${a.city}` : a.destination}</td>
                    <td className="nowrap">{fmt(tab === 'activities' ? a.startsAt : a.dateStart)}</td>
                    <td>{tab === 'activities' ? `${a.going}/${a.capacity}` : a.members}</td>
                    <td>{x.host.displayName ?? x.host.id}</td>
                    <td>
                      <Chip value={x.status} />
                    </td>
                    <td className="end">
                      {mod && x.status !== 'cancelled' && (
                        <button className="btn danger" onClick={() => remove(x.id, x.title)} disabled={act.busy}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
