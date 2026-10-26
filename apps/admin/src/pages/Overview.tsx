import { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../api';
import { CardHead, DayBars, Kpi, LineChart, Meter, MiniBars, SERIES, ShareBar, Sparkline } from '../charts';
import { Chip, ErrorBanner, Icon, Page, RowMenu, Search, Segmented, shortId, useLoad } from '../ui';

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
type Report = { id: string; targetType: string; targetId: string; category: string; details: string | null; status: string; createdAt: string; reporter: { id: string; profile?: { displayName: string } | null } };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : '0%');
const words = (s: string) => s.replace(/_/g, ' ');
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Bigger bars are brighter: one mint hue, stepped by rank (the label beside each bar says what it is). */
const rank = (i: number) => `color-mix(in srgb, ${SERIES.mint} ${100 - i * 14}%, #1f2d27)`;
const TAB_STATUS: Record<string, string[]> = { all: [], open: ['open'], in_review: ['in_review'], closed: ['resolved', 'dismissed'] };
const CATEGORY_ROWS = 4; // the biggest few are listed; the rest are added up as "Other", so the card never grows

/** "↑ 12.5%" against the 30 days before. Nothing when both periods are empty. */
function Delta({ now, before, what }: { now: number; before: number; what: string }) {
  if (!before && !now) return null;
  if (!before) return <span className="delta up" aria-label={`${what}: new in this period`}>new</span>;
  const d = ((now - before) / before) * 100;
  if (Math.abs(d) < 0.05) return <span className="delta">no change</span>;
  return (
    <span className={`delta ${d > 0 ? 'up' : 'down'}`} aria-label={`${what} ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)} percent on the 30 days before`}>
      {d > 0 ? '↑' : '↓'} {Math.abs(d).toFixed(1)}%
    </span>
  );
}

/**
 * The whole page fits the screen on a desktop (see .dash in styles.css): the cards share the height, the charts fill their
 * card, and the table shows as many rows as there is room for. Below 1200px wide it stacks and scrolls as usual.
 */
export function OverviewPage({ go, openReport }: { go: (p: string) => void; openReport?: (id: string) => void }) {
  const { data, error, loading, reload } = useLoad(() => get<Overview>('/v1/admin/overview'), [], 8000);
  const reports = useLoad(() => get<{ items: Report[] }>('/v1/admin/reports'), [], 8000);
  const refresh = () => (reload(), reports.reload());

  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  // how many table rows fit in the room the card gives the table
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(6);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 40;
      const row = el.querySelector('tbody tr')?.getBoundingClientRect().height || 58;
      const n = Math.max(3, Math.floor((el.clientHeight - head) / row));
      setSize((o) => (o === n ? o : n));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reports.data]);

  const rows = useMemo(() => {
    const all = reports.data?.items ?? [];
    const want = TAB_STATUS[tab];
    const needle = q.trim().toLowerCase();
    const open = (s: string) => s === 'open' || s === 'in_review';
    return all
      .filter((r) => (want.length === 0 || want.includes(r.status)) && (!needle || [r.category, r.details, r.targetType, r.targetId, r.reporter.profile?.displayName].some((v) => v?.toLowerCase().includes(needle))))
      // waiting items first, in the order the server gives them (safety first, oldest first); finished ones newest first
      .sort((a, b) => Number(open(b.status)) - Number(open(a.status)) || (open(a.status) ? 0 : +new Date(b.createdAt) - +new Date(a.createdAt)));
  }, [reports.data, tab, q]);
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  const p = Math.min(page, last);
  const shown = rows.slice(p * size, p * size + size);

  const members = data?.members ?? 0;
  const rep = data?.reports ?? { open: 0, in_review: 0, resolved: 0, dismissed: 0 };
  const closed = rep.resolved + rep.dismissed;
  const totalReports = rep.open + rep.in_review + closed;
  const waiting = (data?.pendingVerifications ?? 0) + (data?.openReports ?? 0);
  const s = data?.series;

  const all = data?.reportsByCategory ?? [];
  const catTotal = sum(all.map((c) => c.count));
  const cats = all.length > CATEGORY_ROWS + 1 ? [...all.slice(0, CATEGORY_ROWS), { category: 'other', count: sum(all.slice(CATEGORY_ROWS).map((c) => c.count)) }] : all;

  return (
    <Page
      title="Overview"
      sub={
        <>
          {data ? `Last 30 days (${dayLabel(data.period.from)} – ${dayLabel(data.period.to)})` : 'Last 30 days'} · {waiting === 0 ? 'nothing needs a decision' : `${waiting} ${waiting === 1 ? 'item needs' : 'items need'} a decision`}
        </>
      }
      actions={
        <>
          <span className="muted small">{loading ? 'Updating…' : 'Updated just now'}</span>
          <button className="btn" onClick={refresh} disabled={loading}>
            <Icon name="refresh" /> Refresh
          </button>
        </>
      }
    >
      <ErrorBanner message={error} />
      <div className="dash">
        {/* ------------------------------------------------------------ left column */}
        <div className="dash-col dash-left">
          <section className="card dash-card" aria-labelledby="ppl">
            <CardHead id="ppl" title="People" right={<button className="link" onClick={() => go('users')}>All users →</button>} />
            <div className="kpis">
              <Kpi label="Verified adults" value={data ? pct(data.verifiedMembers, members) : '–'}>
                <MiniBars value={members ? (data?.verifiedMembers ?? 0) / members : 0} label={`${data?.verifiedMembers ?? 0} of ${members} members are verified adults`} />
              </Kpi>
              <Kpi label="Identity check pass rate" value={data?.approvalRate == null ? '–' : `${(data.approvalRate * 100).toFixed(1)}%`}>
                <Meter value={data?.approvalRate ?? 0} label={data?.approvalRate == null ? 'No identity check has been decided yet' : `${(data.approvalRate * 100).toFixed(1)} percent of decided checks passed`} />
              </Kpi>
              <Kpi label="New members" value={s ? sum(s.members) : '–'} note={data && <Delta now={sum(data.series.members)} before={data.previous.members} what="New members" />}>
                {s && <Sparkline values={s.members} label="New members per day, last 30 days" />}
              </Kpi>
            </div>
          </section>

          <section className="card dash-card grow-card" aria-labelledby="growth">
            <CardHead id="growth" title="Growth" right={<span className="muted small">{data ? `${data.activeActivities} active activities · ${data.activeTrips} active trips` : ''}</span>} />
            {s && data ? (
              <LineChart
                title="Created per day, last 30 days"
                days={data.period.days}
                lines={[
                  { key: 'members', label: 'New members', color: SERIES.mint, values: s.members },
                  { key: 'activities', label: 'Activities posted', color: SERIES.orange, values: s.activities },
                  { key: 'trips', label: 'Trips posted', color: SERIES.blue, values: s.trips },
                ]}
              />
            ) : (
              <p className="empty">Loading…</p>
            )}
          </section>

          <div className="dash-pair">
            <section className="card dash-card grow-card" aria-labelledby="rpd">
              <CardHead id="rpd" title="Reports per day" right={<span className="muted small">{s ? `${sum(s.reports)} in 30 days` : ''}</span>} />
              {s && data ? <DayBars days={data.period.days} values={s.reports} label="Reports filed" /> : null}
            </section>

            <section className="card dash-card" aria-labelledby="cat">
              <CardHead id="cat" title="Reports by category" />
              <ShareBar label="Reports by category" parts={cats.map((c, i) => ({ key: c.category, label: words(c.category), value: c.count, color: rank(i) }))} />
              <ul className="catlist">
                {cats.map((c, i) => (
                  <li key={c.category}>
                    <i style={{ background: rank(i) }} />
                    <span className="cat-name">{words(c.category)}</span>
                    <b>{c.count}</b>
                    <span className="muted">{pct(c.count, catTotal)}</span>
                  </li>
                ))}
                {data && cats.length === 0 && <li className="muted">No reports in the last 30 days.</li>}
              </ul>
            </section>
          </div>
        </div>

        {/* ------------------------------------------------------------ right column */}
        <div className="dash-col">
          <section className="card dash-card reports-card" aria-labelledby="rep">
            <CardHead
              id="rep"
              title="Reports"
              right={
                !!data?.pendingVerifications && (
                  <button className="link" onClick={() => go('verifications')}>
                    {data.pendingVerifications} identity {data.pendingVerifications === 1 ? 'check' : 'checks'} waiting →
                  </button>
                )
              }
            />
            <div className="kpis">
              <Kpi label="Open" value={`${rep.open}`} note={<span className="kpi-pct">{pct(rep.open, totalReports)}</span>} />
              <Kpi label="In review" value={`${rep.in_review}`} note={<span className="kpi-pct">{pct(rep.in_review, totalReports)}</span>} />
              <Kpi label="Closed" value={`${closed}`} note={<span className="kpi-pct">{pct(closed, totalReports)}</span>} />
            </div>
            <ShareBar
              label="Reports by status"
              parts={[
                { key: 'open', label: 'Open', value: rep.open, color: SERIES.orange },
                { key: 'in_review', label: 'In review', value: rep.in_review, color: '#ecc468' },
                { key: 'closed', label: 'Closed', value: closed, color: SERIES.mint },
              ]}
            />

            <div className="dash-tools">
              <Segmented
                label="Show reports"
                value={tab}
                onChange={(v) => (setTab(v), setPage(0))}
                options={[
                  { id: 'all', label: 'All' },
                  { id: 'open', label: 'Open', count: rep.open },
                  { id: 'in_review', label: 'In review' },
                  { id: 'closed', label: 'Closed' },
                ]}
              />
              <Search value={q} onChange={(v) => (setQ(v), setPage(0))} placeholder="Search reports" label="Search reports" />
            </div>

            <div className="table-scroll dash-tablebox" ref={box}>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Filed</th>
                    <th className="col-by">Reported by</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button className="link rowlink" onClick={() => (openReport ? openReport(r.id) : go('reports'))}>
                          {words(r.category)}
                        </button>
                        <div className="muted small clip">{r.details || `About a ${r.targetType} · ${shortId(r.targetId)}`}</div>
                      </td>
                      <td className="nowrap">{new Date(r.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</td>
                      <td className="col-by">{r.reporter.profile?.displayName ?? shortId(r.reporter.id)}</td>
                      <td>
                        <Chip value={r.status} />
                      </td>
                      <td className="end">
                        <RowMenu label={`Actions for the ${words(r.category)} report`} items={[{ label: 'Review in the queue', onSelect: () => (openReport ? openReport(r.id) : go('reports')) }]} />
                      </td>
                    </tr>
                  ))}
                  {reports.data && rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                        {q || tab !== 'all' ? 'No reports match.' : 'No reports yet.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="dash-pager">
              <span className="muted small" aria-live="polite">
                {rows.length === 0 ? 'Nothing to show' : `Showing ${p * size + 1}–${p * size + shown.length} of ${rows.length}`}
              </span>
              <div className="row">
                <button className="icon-btn" aria-label="Previous page" disabled={p === 0} onClick={() => setPage(p - 1)}>
                  <span style={{ display: 'inline-grid', transform: 'rotate(180deg)' }}>
                    <Icon name="arrow" />
                  </span>
                </button>
                <span className="muted small">
                  {p + 1} / {last + 1}
                </span>
                <button className="icon-btn" aria-label="Next page" disabled={p === last} onClick={() => setPage(p + 1)}>
                  <Icon name="arrow" />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
