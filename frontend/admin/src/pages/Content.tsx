import { useEffect, useMemo, useRef, useState } from 'react';
import { can, get, post, type Session } from '../api';
import { DayCard, dayKey, DayLog } from '../DayLog';
import { askText, Chip, Empty, ErrorBanner, Loading, Page, RowMenu, Search, Segmented, useAction, useLoad, useMore, Icon } from '../ui';

type A = { id: string; title: string; status: string; city: string; venueName: string; startsAt: string; capacity: number; going: number; host: { id: string; displayName?: string } };
type T = { id: string; title: string; status: string; destination: string; dateStart: string; members: number; host: { id: string; displayName?: string } };

const STATUSES = ['published', 'full', 'planning', 'confirmed', 'completed', 'cancelled'];
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

/** Activities and trips by the day they happen: each day shows a few, "Show all" opens the rest. */
export function ContentPage({ me }: { me: Session }) {
  const [tab, setTab] = useState<'activities' | 'trips'>('activities');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  // which calendar month: 0 = this month, -1 = last month, 1 = next month...
  const [month, setMonth] = useState(0);
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + month, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + month + 1, 1);
  const monthName = from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const qs = new URLSearchParams({ ...(status && { status }), from: from.toISOString(), to: to.toISOString() }).toString();
  const base = `/v1/admin/${tab}?${qs}`;
  const list = useLoad(() => get<{ items: (A | T)[]; nextCursor: string | null }>(base), [tab, status, month]);
  const more = useMore(list.data, (c) => get(`${base}&cursor=${c}`), `${tab}|${status}|${month}`);
  const act = useAction(() => (more.reset(), list.reload()));
  const mod = can.moderate(me.role);
  const isAct = tab === 'activities';

  const remove = async (id: string, title: string) => {
    const reason = await askText(`Remove "${title}"?`, { confirm: 'Remove' });
    if (reason) act.run(() => post(`/v1/admin/${tab}/${id}/remove`, { reason }));
  };

  const at = (x: A | T) => (isAct ? (x as A).startsAt : (x as T).dateStart);
  const needle = q.trim().toLowerCase();
  const items = more.items.filter((x) => !needle || [x.title, (x as A).venueName, (x as A).city, (x as T).destination, x.host.displayName].some((f) => f?.toLowerCase().includes(needle)));
  const days = useMemo(() => {
    const sorted = [...items].sort((a, b) => +new Date(at(a)) - +new Date(at(b)));
    const out: { key: string; at: string; items: (A | T)[] }[] = [];
    for (const x of sorted) {
      const k = dayKey(at(x));
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(x);
      else out.push({ key: k, at: at(x), items: [x] });
    }
    return out;
  }, [items, isAct]);

  // this month opens at today (or the next day with something on): earlier days are a scroll up
  const scrolled = useRef('');
  useEffect(() => {
    const key = `${tab}|${status}|${month}`;
    if (month !== 0 || days.length === 0 || scrolled.current === key) return;
    scrolled.current = key;
    const today = dayKey(new Date().toISOString());
    const target = days.find((d) => d.key >= today);
    const el = target && document.querySelector<HTMLElement>(`.au-card[data-day="${target.key}"]`);
    const box = el?.closest<HTMLElement>('.au-scroll');
    if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 62;
  }, [days, month, tab, status]);

  return (
    <Page
      fill
      title="Content"
      actions={
        <Segmented
          label="Type"
          value={tab}
          onChange={(t) => (setTab(t), setStatus(''))}
          options={[
            { id: 'activities', label: 'Activities' },
            { id: 'trips', label: 'Trips' },
          ]}
        />
      }
    >
      <div className="toolbar">
        <div className="grow">
          <Search label="Search" placeholder="Search titles, places or hosts" value={q} onChange={setQ} />
        </div>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="toolbar" role="group" aria-label="Month">
        <button type="button" className="btn small" onClick={() => setMonth((m) => m - 1)} aria-label="Previous month">
          <span style={{ display: 'grid', transform: 'rotate(90deg)' }}>
            <Icon name="chevron" />
          </span>
        </button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthName}</strong>
        <button type="button" className="btn small" onClick={() => setMonth((m) => m + 1)} aria-label="Next month">
          <span style={{ display: 'grid', transform: 'rotate(-90deg)' }}>
            <Icon name="chevron" />
          </span>
        </button>
        {month !== 0 && (
          <button type="button" className="btn small ghost" onClick={() => setMonth(0)}>
            This month
          </button>
        )}
      </div>
      <ErrorBanner message={list.error ?? act.error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading rows={5} />}
      {list.data && days.length === 0 && <Empty>Nothing in {monthName}.</Empty>}
      {days.length > 0 && (
        <DayLog key={`${tab}|${status}|${month}`} label={isAct ? 'Activities' : 'Trips'} title={isAct ? 'Activities' : 'Trips'} count={`${items.length}${more.hasMore ? '+' : ''}`} footer={more.more}>
          {days.map((d) => (
            <DayCard
              key={d.key}
              id={d.key}
              at={d.at}
              count={d.items.length}
              unit={isAct ? ['activity', 'activities'] : ['trip', 'trips']}
              rows={d.items.map((x) => {
                const a = x as A & T;
                return (
                  <li key={x.id}>
                    <div className="ct-row">
                      <span className="ct-time">{isAct ? clock(a.startsAt) : 'Starts'}</span>
                      <span className="ct-main">
                        <span className="ct-title">{x.title}</span>
                        <span className="ct-meta">
                          {isAct ? `${a.venueName}, ${a.city}` : a.destination} · hosted by {x.host.displayName ?? 'someone'}
                        </span>
                      </span>
                      <span className="ct-side">
                        <span className="ct-going">
                          {isAct ? (
                            <>
                              <span className="bar" style={{ width: 56 }}>
                                <i style={{ width: `${Math.min(100, (a.going / Math.max(1, a.capacity)) * 100)}%` }} />
                              </span>
                              {a.going}/{a.capacity}
                            </>
                          ) : (
                            `${a.members} going`
                          )}
                        </span>
                        <Chip value={x.status} />
                        {mod && x.status !== 'cancelled' ? <RowMenu label={`Actions for ${x.title}`} items={[{ label: 'Remove', danger: true, onSelect: () => remove(x.id, x.title) }]} /> : <span style={{ width: 38 }} />}
                      </span>
                    </div>
                  </li>
                );
              })}
            />
          ))}
        </DayLog>
      )}
    </Page>
  );
}
