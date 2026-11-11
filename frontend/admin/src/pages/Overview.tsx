import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../api';
import { CardHead } from '../charts';
import { TrendChart } from '../trend';
import { RangeCalendar } from '../RangeCalendar';
import { Chip, CountUp, ErrorBanner, Loading, Page, RefreshButton, Segmented, useLoad, useRefresh } from '../ui';

type Overview = {
  users: number;
  pendingVerifications: number;
  verification?: { verified: number; unverified: number; rejected: number };
  openReports: number;
  activeActivities: number;
  activeTrips: number;
  members: number;
  verifiedMembers: number;
  approvalRate: number | null;
  reports: { open: number; in_review: number; resolved: number; dismissed: number };
  period: { from: string; to: string; days: string[] };
  series: { members: number[]; activities: number[]; trips: number[]; reports: number[] };
  previous: { members: number; activities: number; trips: number };
  reportsByCategory: { category: string; count: number }[];
};
type Report = {
  id: string;
  targetType: string;
  targetId: string;
  category: string;
  details: string | null;
  status: string;
  createdAt: string;
  priority?: 'urgent' | 'normal';
  ageHours?: number;
  overdue?: boolean;
  answerBy?: string | null;
  assignedName?: string | null;
  reporter: { id: string; profile?: { displayName: string } | null };
  subject?: { displayName: string | null } | null;
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const words = (s: string) => s.replace(/_/g, ' ');
const hrs = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
const CATEGORY_ROWS = 5;
/** The lines on the trend chart, in the console's own greens, forest and grey. */
const LINES = [
  { key: 'members', label: 'Sign-ups', color: '#36ad7a' },
  { key: 'activities', label: 'Activities', color: '#12302b' },
  { key: 'trips', label: 'Trips', color: '#8fc9ad' },
  { key: 'reports', label: 'Reports', color: '#9fb0a9' },
] as const;
type RangeId = 'today' | 'month' | 'custom';
const RANGES: { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** The first and last day (UTC, like the server) of a range. */
function rangeDays(id: RangeId, custom: { from: string; to: string }) {
  const today = new Date(iso(new Date()) + 'T00:00:00Z');
  if (id === 'today') return { from: iso(today), to: iso(today) };
  // the whole month: first day to last day (days still to come show as empty)
  if (id === 'month') return { from: iso(today).slice(0, 8) + '01', to: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))) };
  if (id === 'custom' && custom.from && custom.to) return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  return { from: iso(today), to: iso(today) };
}
/** "11 Nov 2026 – 14 Nov 2026", or one date when the range is a single day */
const fullRange = (r: { from: string; to: string }) => {
  const d = (v: string) => new Date(v + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return r.from === r.to ? d(r.from) : `${d(r.from)} – ${d(r.to)}`;
};
const rangeWords = (id: RangeId, r: { from: string; to: string }) => {
  if (id !== 'custom') return RANGES.find((x) => x.id === id)!.label.toLowerCase();
  const d = (v: string) => new Date(v + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${d(r.from)} – ${d(r.to)}`;
};

function leftOf(r: Report, now: number) {
  if (!r.answerBy) return null;
  const ms = +new Date(r.answerBy) - now;
  return { ms, late: ms < 0, text: ms < 0 ? `Overdue ${hrs(-ms / 3_600_000)}` : `${hrs(ms / 3_600_000)} left` };
}

export function OverviewPage({ go, openReport }: { go: (p: string) => void; openReport?: (id: string) => void }) {
  const [range, setRange] = useState<RangeId>('month');
  const segRef = useRef<HTMLSpanElement>(null);
  const [picking, setPicking] = useState(false);
  const [custom, setCustom] = useState(() => rangeDays('today', { from: '', to: '' }));
  const span = rangeDays(range, custom);
  const { data, error, loading, reload } = useLoad(() => get<Overview>(`/v1/admin/overview?from=${span.from}&to=${span.to}`), [span.from, span.to], 8000);
  // the five at the front of the queue (urgent first), and a small summary: not the whole list of reports
  const reports = useLoad(() => get<{ items: Report[] }>('/v1/admin/reports?status=waiting&limit=5&page=1'), [], 8000);
  const waitingSummary = useLoad(() => get<{ total: number; overdue: number }>('/v1/admin/reports/waiting'), [], 8000);
  // the days were just changed and their numbers are still on the way (the background refresh every few seconds never dims)
  const spanKey = span.from + '|' + span.to;
  const loadedFor = useRef(spanKey);
  useEffect(() => {
    if (!loading) loadedFor.current = spanKey;
  }, [loading, spanKey]);
  const changingDays = loading && !!data && loadedFor.current !== spanKey;
  const refresh = useRefresh(() => Promise.all([reload(), reports.reload(), waitingSummary.reload()]));
  const now = Date.now();
  const open1 = (id: string) => (openReport ? openReport(id) : go('reports'));

  const rep = data?.reports ?? { open: 0, in_review: 0, resolved: 0, dismissed: 0 };
  const s = data?.series;
  const members = data?.members ?? 0;

  const overdueCount = waitingSummary.data?.overdue ?? 0;
  const next = useMemo(() => reports.data?.items ?? [], [reports.data]); // already in queue order

  // The chart shows only the chosen days. A server that sends a longer span (an older one always sends 30 days) is cut down
  // here, so 7 days and this month are right either way.
  const allDays = data?.period.days ?? [];
  const inRange = allDays.map((d, i) => (d >= span.from && d <= span.to ? i : -1)).filter((i) => i >= 0);
  const shown = inRange.length ? inRange : allDays.map((_, i) => i);
  const exact = allDays[0] === span.from && allDays[allDays.length - 1] === span.to;

  const verifiedPct = members ? Math.round(((data?.verifiedMembers ?? 0) / members) * 100) : 0;
  const passPct = data?.approvalRate == null ? null : Math.round(data.approvalRate * 100);
  const newNow = s ? sum(s.members) : 0;
  const before = data?.previous.members ?? 0;
  const change = before ? Math.round(((newNow - before) / before) * 100) : null;

  const all = data?.reportsByCategory ?? [];
  const cats = all.length > CATEGORY_ROWS + 1 ? [...all.slice(0, CATEGORY_ROWS), { category: 'other', count: sum(all.slice(CATEGORY_ROWS).map((c) => c.count)) }] : all;
  const catMax = Math.max(1, ...cats.map((c) => c.count));

  return (
    <Page
      title="Dashboard"
      actions={
        // the days apply to the whole dashboard (the chart and the report categories), so they sit at the top of the page
        <div className="ov-controls">
          <span
            ref={segRef}
            className="ov-seg"
            onClickCapture={(e) => {
              // Custom opens the calendar every time it is pressed, also when it is already the chosen one
              if ((e.target as HTMLElement).closest('button')?.textContent?.trim().startsWith('Custom')) setPicking(true);
            }}
          >
            <Segmented label="Days shown" value={range} onChange={(r) => (setRange(r), r !== 'custom' && setPicking(false))} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
          </span>
          {picking && (
            <RangeCalendar
              anchor={segRef.current}
              from={custom.from}
              to={custom.to}
              onClose={() => setPicking(false)}
              onPick={(from, to) => {
                setCustom({ from, to });
                setRange('custom');
                setPicking(false);
              }}
            />
          )}
          <RefreshButton r={refresh} />
        </div>
      }
    >
      <ErrorBanner message={error} onRetry={reload} />
      {!data && !error && <Loading rows={8} />}
      {data && (
        // dimmed while a refresh runs, or while the newly chosen days load (the old numbers stay until the new ones are in)
        <div className={refresh.busy || changingDays ? 'stack refreshable refreshing' : 'stack refreshable'} aria-busy={refresh.busy || changingDays}>
          <div className="ov-top">
            <div className="ov-tiles">
              <button className={overdueCount ? 'stat hot' : 'stat'} onClick={() => go('reports')}>
                <span className="label">Reports</span>
                <span className="value">
                  <CountUp value={rep.in_review + rep.open} />
                </span>
                <span className="note">
                  {overdueCount ? `${overdueCount} overdue` : 'Waiting for a decision'}
                </span>
              </button>
              <button className="stat" onClick={() => go('verifications')}>
                <span className="label">Verification</span>
                <span className="ov-three">
                  {([['verified', 'Verified'], ['unverified', 'Not verified'], ['rejected', 'Rejected']] as const).map(([k, name]) => (
                    <span key={k}>
                      <b>
                        {data.verification ? <CountUp value={data.verification[k]} /> : '–'}
                      </b>
                      <small>{name}</small>
                    </span>
                  ))}
                </span>
              </button>
            </div>

            <section className="card" aria-labelledby="ov-trend">
              <CardHead id="ov-trend" title="Activity" right={<span className="ov-dates">{fullRange(span)}</span>} />
              {s ? (
                <TrendChart
                  title={`Activity, ${rangeWords(range, span)}`}
                  days={shown.map((i) => data.period.days[i])}
                  lines={LINES.map((l) => {
                    const values = shown.map((i) => s[l.key][i] ?? 0);
                    const total = sum(values);
                    // the change against the period before is only right when the server sent exactly the chosen days
                    const prev = l.key === 'reports' || !exact ? undefined : data.previous[l.key];
                    return { ...l, values, total, change: prev ? Math.round(((total - prev) / prev) * 100) : null };
                  })}
                />
              ) : (
                <Loading rows={4} />
              )}
            </section>
          </div>

          <div className="ov-bottom">
            <section className="card flat" aria-labelledby="ov-next">
              <div className="card-head" style={{ padding: '14px 16px 0', marginBottom: 0 }}>
                <h2 id="ov-next">Up next</h2>
                <button className="link small" onClick={() => go('reports')}>
                  All reports
                </button>
              </div>
              {next.length === 0 ? (
                <div className="state">All caught up.</div>
              ) : (
                <ul className="items">
                  {next.slice(0, 4).map((r) => {
                    const left = leftOf(r, now);
                    return (
                      <li key={r.id}>
                        <button className="list-item" onClick={() => open1(r.id)}>
                          <span className="body">
                            <span className="title">“{r.details || 'No details'}”</span>
                            <span className="meta">
                              {words(r.category)} · {r.subject?.displayName ?? r.targetType}
                            </span>
                          </span>
                          <span className="aside">{left && <Chip value={left.text} tone={left.late ? 'dark' : r.priority === 'urgent' ? 'line' : 'plain'} />}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="ov-cats">
              <CardHead id="ov-cats" title="Reports by category" right={<span className="ov-dates">{`${sum(all.map((c) => c.count))} ${sum(all.map((c) => c.count)) === 1 ? 'report' : 'reports'} · ${rangeWords(range, span)}`}</span>} />
              {cats.length === 0 ? (
                <p className="muted">None in {rangeWords(range, span)}.</p>
              ) : (
                <ul className="cat-list">
                  {cats.map((c) => {
                    const total = Math.max(1, sum(all.map((x) => x.count)));
                    return (
                      <li key={c.category}>
                        <div className="cat-top">
                          <span className="cat-name">{words(c.category)}</span>
                          <span className="cat-num">
                            <b>{c.count}</b>
                            <small>{Math.round((c.count / total) * 100)}%</small>
                          </span>
                        </div>
                        <span className="cat-bar" role="presentation">
                          <i style={{ width: `${Math.max(2, (c.count / catMax) * 100)}%` }} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </Page>
  );
}
