import { useEffect, useMemo, useRef, useState } from 'react';
import { can, get, post, type Session } from '../api';
import { DayCard, dayKey, DayLog } from '../DayLog';
import { DateField, Select } from '../controls';
import { askText, Chip, Empty, ErrorBanner, Loading, Page, PageBar, FilterBar, RowMenu, Search, Segmented, useAction, useLoad, Icon } from '../ui';

type A = { createdAt: string; id: string; title: string; status: string; category: string; city: string; venueName: string; startsAt: string; endsAt: string; capacity: number; joinPolicy: string; going: number; waiting: number; host: { id: string; displayName?: string } };
type T = { createdAt: string; id: string; title: string; status: string; destination: string; originCity: string; travelStyle: string; dateStart: string; dateEnd: string; budgetMin: number; budgetMax: number; budgetCurrency: string; maxCapacity: number; approvalMode: string; members: number; waiting: number; host: { id: string; displayName?: string } };

const STATUSES = [['published', 'Published'], ['cancelled', 'Cancelled'], ['completed', 'Completed']];
const words = (v?: string | null) => (v ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const money = (cur: string | undefined, n: number | undefined) => `${cur === 'EUR' ? '€' : (cur ?? '') + ' '}${(n ?? 0).toLocaleString('en-GB')}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

/** Activities and trips by the day they happen: each day shows a few, "Show all" opens the rest. */
export function ContentPage({ me }: { me: Session }) {
  const [tab, setTab] = useState<'activities' | 'trips'>('activities');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  // the search goes to the server (it covers every page, not only the one on screen), a moment after typing stops
  const [qNow, setQNow] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQNow(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  // which calendar month: 0 = this month, -1 = last month, 1 = next month...
  const [month, setMonth] = useState(0);
  const now = new Date();
  // one chosen day (from the calendar) replaces the month; the month arrows put the month back
  const [day, setDay] = useState('');
  const dayStart = day ? new Date(`${day}T00:00:00`) : null;
  // the month in UTC days, the same days the dashboard counts
  const from = dayStart ?? new Date(Date.UTC(now.getFullYear(), now.getMonth() + month, 1));
  const to = dayStart ? new Date(+dayStart + 86400000) : new Date(Date.UTC(now.getFullYear(), now.getMonth() + month + 1, 1));
  const monthName = dayStart ? dayStart.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  // activities sit on the day they take place, trips on the day they start (their travel date), not on the day they were added
  const [pageNo, setPageNo] = useState(1);
  useEffect(() => setPageNo(1), [tab, status, month, day, qNow]);
  const qs = new URLSearchParams({ limit: '50', page: String(pageNo), ...(status && { status }), ...(qNow && { q: qNow }), from: from.toISOString(), to: to.toISOString() }).toString();
  const base = `/v1/admin/${tab}?${qs}`;
  const list = useLoad(() => get<{ items: (A | T)[]; page?: number; pages?: number; total?: number }>(base), [tab, status, month, pageNo, day, qNow]);
  const act = useAction(() => list.reload());
  const mod = can.moderate(me.role);
  const isAct = tab === 'activities';

  const remove = async (id: string, title: string) => {
    const reason = await askText(`Remove "${title}"?`, { confirm: 'Remove' });
    if (reason) act.run(() => post(`/v1/admin/${tab}/${id}/remove`, { reason }));
  };

  const at = (x: A | T) => (isAct ? (x as A).startsAt : (x as T).dateStart);
  const items = list.data?.items ?? [];
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
    // this month opens at today (activities and trips alike); only once this tab's own list has arrived, and only once per tab / filter / month
    if (day || month !== 0 || list.loading || days.length === 0 || scrolled.current === key) return;
    const today = dayKey(new Date().toISOString());
    // today, else the next day with something on, else (everything is earlier this month) the latest day
    const target = days.find((d) => d.key >= today) ?? days[days.length - 1];
    let tries = 0;
    let frame = 0;
    const place = () => {
      const el = document.querySelector<HTMLElement>(`.au-card[data-day="${target.key}"]`);
      if (!el) {
        // the cards are not on screen yet: look again on the next frame (a few times)
        if (++tries < 20) frame = requestAnimationFrame(place);
        return;
      }
      scrolled.current = key;
      // scroll whatever holds the list (the list card, or the page itself on a small screen) so today's card is first, just under the day header
      el.style.scrollMarginTop = '62px';
      el.scrollIntoView({ block: 'start', inline: 'nearest' });
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [days, month, tab, status, day, list.loading]);

  return (
    <Page
      fill
      title="Content"
    >
      <FilterBar search={<Search label="Search" placeholder="Search titles, places or hosts" value={q} onChange={setQ} />}>
        <Segmented
          label="Type"
          value={tab}
          onChange={(t) => (setTab(t), setStatus(''))}
          options={[
            { id: 'activities', label: 'Activities' },
            { id: 'trips', label: 'Trips' },
          ]}
        />
        <Select aria-label="Status" value={status} onChange={setStatus}>
          <option value="">All</option>
          {STATUSES.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </FilterBar>
      <div className="toolbar" role="group" aria-label="Month">
        <button type="button" className="btn small" onClick={() => (setDay(''), setMonth((m) => m - 1))} aria-label="Previous month">
          <span style={{ display: 'grid', transform: 'rotate(90deg)' }}>
            <Icon name="chevron" />
          </span>
        </button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{monthName}</strong>
        <button type="button" className="btn small" onClick={() => (setDay(''), setMonth((m) => m + 1))} aria-label="Next month">
          <span style={{ display: 'grid', transform: 'rotate(-90deg)' }}>
            <Icon name="chevron" />
          </span>
        </button>
        <DateField aria-label="Pick a date" placeholder="Pick a date" value={day} onChange={setDay} compact />
      </div>
      <ErrorBanner message={list.error ?? act.error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading rows={5} />}
      {list.data && days.length === 0 && <Empty>Nothing in {monthName}.</Empty>}
      {days.length > 0 && (
        <DayLog key={`${tab}|${status}|${month}|${day}`} label={isAct ? 'Activities' : 'Trips'} title={isAct ? 'Activities' : 'Trips'} count={`${list.data?.total ?? items.length}`} footer={<PageBar page={list.data?.page ?? 1} pages={list.data?.pages ?? 1} total={list.data?.total ?? items.length} noun={isAct ? ['activity', 'activities'] : ['trip', 'trips']} onPage={setPageNo} busy={list.loading} />}>
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
                      <span className="ct-time">{isAct ? `${clock(a.startsAt)} – ${clock(a.endsAt)}` : `${shortDay(a.dateStart)} – ${shortDay(a.dateEnd)}`}</span>
                      <span className="ct-main">
                        <span className="ct-title">{x.title}</span>
                        <span className="ct-meta">
                          {isAct
                            ? `${words(a.category)} · ${a.venueName}, ${a.city} · hosted by ${x.host.displayName ?? 'someone'}`
                            : `${a.originCity ? `${a.originCity} → ` : ''}${a.destination} · ${words(a.travelStyle)} · ${money(a.budgetCurrency, a.budgetMin)}–${money(a.budgetCurrency, a.budgetMax)} · hosted by ${x.host.displayName ?? 'someone'}`}
                        </span>
                      </span>
                      <span className="ct-side">
                        <span>{a.waiting > 0 && x.status !== 'completed' && x.status !== 'cancelled' ? <Chip value={`${a.waiting} waiting`} tone="warn" /> : null}</span>
                        <span className="ct-going">
                          {isAct ? (
                            <>
                              <span className="bar">
                                <i style={{ width: `${Math.min(100, (a.going / Math.max(1, a.capacity)) * 100)}%` }} />
                              </span>
                              {a.going}/{a.capacity}
                            </>
                          ) : (
                            <>
                              <span className="bar">
                                <i style={{ width: `${Math.min(100, (a.members / Math.max(1, a.maxCapacity)) * 100)}%` }} />
                              </span>
                              {a.members}/{a.maxCapacity}
                            </>
                          )}
                        </span>
                        <Chip value={x.status === "completed" ? "Completed" : x.status} tone={x.status === "completed" ? "plain" : undefined} />
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
