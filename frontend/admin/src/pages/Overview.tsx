import { useMemo, useState } from 'react';
import { get } from '../api';
import { CardHead } from '../charts';
import { TrendChart } from '../trend';
import { Chip, ErrorBanner, Icon, Loading, Page, Segmented, useLoad } from '../ui';

type Overview = {
  users: number;
  pendingVerifications: number;
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
type RangeId = '7d' | '30d' | 'month' | 'custom';
const RANGES: { id: RangeId; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** The first and last day (UTC, like the server) of a range. */
function rangeDays(id: RangeId, custom: { from: string; to: string }) {
  const today = new Date(iso(new Date()) + 'T00:00:00Z');
  const back = (n: number) => iso(new Date(+today - n * 864e5));
  if (id === '7d') return { from: back(6), to: iso(today) };
  if (id === 'month') return { from: iso(today).slice(0, 8) + '01', to: iso(today) };
  if (id === 'custom' && custom.from && custom.to) return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  return { from: back(29), to: iso(today) };
}
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
  const [range, setRange] = useState<RangeId>('30d');
  const [custom, setCustom] = useState(() => rangeDays('30d', { from: '', to: '' }));
  const span = rangeDays(range, custom);
  const { data, error, loading, reload } = useLoad(() => get<Overview>(`/v1/admin/overview?from=${span.from}&to=${span.to}`), [span.from, span.to], 8000);
  const reports = useLoad(() => get<{ items: Report[] }>('/v1/admin/reports'), [], 8000);
  const refresh = () => (reload(), reports.reload());
  const now = Date.now();
  const open1 = (id: string) => (openReport ? openReport(id) : go('reports'));

  const rep = data?.reports ?? { open: 0, in_review: 0, resolved: 0, dismissed: 0 };
  const s = data?.series;
  const members = data?.members ?? 0;

  const waiting = useMemo(() => (reports.data?.items ?? []).filter((r) => r.status === 'open' || r.status === 'in_review'), [reports.data]);
  const overdue = waiting.filter((r) => r.overdue || (r.answerBy && +new Date(r.answerBy) < now));
  const next = [...waiting].sort((a, b) => (a.answerBy ? +new Date(a.answerBy) : Infinity) - (b.answerBy ? +new Date(b.answerBy) : Infinity)).slice(0, 5);
  const top = next[0] ?? null;

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
        <>
          <button className="icon-btn" onClick={refresh} disabled={loading} aria-label="Refresh" title="Refresh">
            <Icon name="refresh" />
          </button>
          {top && (
            <button className="btn primary" onClick={() => open1(top.id)}>
              Open next report
            </button>
          )}
        </>
      }
    >
      <ErrorBanner message={error} onRetry={reload} />
      {!data && !error && <Loading rows={8} />}
      {data && (
        <>
          <div className="ov-top">
            <div className="ov-tiles">
              <button className={overdue.length ? 'stat hot' : 'stat'} onClick={() => go('reports')}>
                <span className="label">Reports</span>
                <span className="value">{rep.in_review + rep.open}</span>
                <span className="note">
                  {rep.in_review} in review · {rep.open} open{overdue.length ? ` · ${overdue.length} overdue` : ''}
                </span>
              </button>
              <button className={data.pendingVerifications ? 'stat hot' : 'stat'} onClick={() => go('verifications')}>
                <span className="label">Verification</span>
                <span className="value">{data.pendingVerifications}</span>
                <span className="note">Pending</span>
              </button>
            </div>

            <section className="card" aria-labelledby="ov-trend">
              <CardHead
                id="ov-trend"
                title={`Activity · ${rangeWords(range, span)}`}
                right={
                  <div className="trend-range">
                    <Segmented label="Range" value={range} onChange={setRange} options={RANGES.map((r) => ({ id: r.id, label: r.label }))} />
                    {range === 'custom' && (
                      <span className="trend-dates">
                        <input type="date" aria-label="From" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
                        to
                        <input type="date" aria-label="To" value={custom.to} min={custom.from || undefined} max={iso(new Date())} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
                      </span>
                    )}
                  </div>
                }
              />
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
              <CardHead id="ov-cats" title="Reports by category" right={<span className="muted small">{sum(all.map((c) => c.count))}</span>} />
              {cats.length === 0 ? (
                <p className="muted">None in {rangeWords(range, span)}.</p>
              ) : (
                <div className="stack" style={{ gap: 9 }}>
                  {cats.map((c) => (
                    <div key={c.category} className="row">
                      <span className="clip" style={{ width: 120, textTransform: 'capitalize' }}>
                        {words(c.category)}
                      </span>
                      <span className="bar grow">
                        <i style={{ width: `${(c.count / catMax) * 100}%` }} />
                      </span>
                      <b style={{ width: 28, textAlign: 'right' }}>{c.count}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </Page>
  );
}
