import './Overview.css';
import { useMemo } from 'react';
import { get, getPlace } from '../api';
import { CardHead, DayBars } from '../charts';
import { ServiceHealth } from './ServiceHealth';
import { ErrorBanner, Icon, Loading, Page, PageMeta, useLoad } from '../ui';

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
type OnCall = { now: { id: string; name: string }[]; shifts: { userId: string; name: string; startsAt: string; endsAt: string }[]; ownerContactSet: boolean; fallback: boolean };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const words = (s: string) => s.replace(/_/g, ' ');
const hrs = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayName = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const CAT_COLORS = ['#b4302a', '#8e9a94', '#4a7be0', '#4a7be0', '#b4302a', '#8e9a94'];
const CATEGORY_ROWS = 5;

/** Time left to answer, from the moment the server says an answer is due. */
function leftOf(r: Report, now: number) {
  if (!r.answerBy) return null;
  const ms = +new Date(r.answerBy) - now;
  return { ms, late: ms < 0, text: ms < 0 ? `Overdue ${hrs(-ms / 3_600_000)}` : `${hrs(ms / 3_600_000)} left` };
}

/** Today: what needs a decision, who is on call, who is new, what people report, and whether the service is healthy. */
export function OverviewPage({ go, openReport }: { go: (p: string) => void; openReport?: (id: string) => void }) {
  const { data, error, loading, reload } = useLoad(() => get<Overview>('/v1/admin/overview'), [], 8000);
  const reports = useLoad(() => get<{ items: Report[] }>('/v1/admin/reports'), [], 8000);
  const oncall = useLoad(() => get<OnCall>('/v1/admin/oncall').catch(() => null), [], 30000);
  const refresh = () => (reload(), reports.reload(), oncall.reload());
  const now = Date.now();

  const rep = data?.reports ?? { open: 0, in_review: 0, resolved: 0, dismissed: 0 };
  const waiting = (data?.pendingVerifications ?? 0) + rep.open;
  const s = data?.series;
  const members = data?.members ?? 0;

  const waitingReports = useMemo(() => (reports.data?.items ?? []).filter((r) => r.status === 'open' || r.status === 'in_review'), [reports.data]);
  const open = waitingReports.filter((r) => r.status === 'open');
  const inReview = waitingReports.filter((r) => r.status === 'in_review');
  const overdue = waitingReports.filter((r) => r.overdue || (r.answerBy && +new Date(r.answerBy) < now));
  const worst = overdue[0] ?? waitingReports[0] ?? null;
  const worstLeft = worst ? leftOf(worst, now) : null;
  const unassigned = open.filter((r) => !r.assignedName).length;
  const oldestOpen = open.length ? Math.max(...open.map((r) => r.ageHours ?? (now - +new Date(r.createdAt)) / 3_600_000)) : null;
  const oldestReview = inReview.length ? Math.max(...inReview.map((r) => r.ageHours ?? (now - +new Date(r.createdAt)) / 3_600_000)) : null;
  const reviewer = inReview.find((r) => r.assignedName)?.assignedName ?? null;

  // most pressing first: least time left to answer
  const start = [...waitingReports]
    .sort((a, b) => (a.answerBy ? +new Date(a.answerBy) : Infinity) - (b.answerBy ? +new Date(b.answerBy) : Infinity))
    .slice(0, 4);

  // who is on call now, until when, and who follows
  const onNow = oncall.data?.now[0] ?? null;
  const mine = (oncall.data?.shifts ?? []).filter((x) => onNow && x.userId === onNow.id && +new Date(x.startsAt) <= now && +new Date(x.endsAt) > now);
  const until = mine.length ? Math.max(...mine.map((x) => +new Date(x.endsAt))) : null;
  const next = until ? (oncall.data?.shifts ?? []).filter((x) => +new Date(x.startsAt) <= until + 60_000 && +new Date(x.endsAt) > until && x.userId !== onNow?.id)[0] : null;

  // people
  const verifiedPct = members ? Math.round(((data?.verifiedMembers ?? 0) / members) * 1000) / 10 : 0;
  const passPct = data?.approvalRate == null ? null : Math.round(data.approvalRate * 1000) / 10;
  const newNow = s ? sum(s.members) : 0;
  const before = data?.previous.members ?? 0;
  const change = before ? Math.round(((newNow - before) / before) * 100) : null;

  // sign-ups per day, and a note when the last day stands out
  const days = data?.period.days ?? [];
  const lastIdx = days.length - 1;
  const earlier = s ? s.members.slice(0, -1) : [];
  const avg = earlier.length ? sum(earlier) / earlier.length : 0;
  const lastN = s && lastIdx >= 0 ? s.members[lastIdx] : 0;
  const spike = !!s && lastN >= 5 && lastN >= Math.max(5, avg * 3);

  const all = data?.reportsByCategory ?? [];
  const cats = all.length > CATEGORY_ROWS + 1 ? [...all.slice(0, CATEGORY_ROWS), { category: 'other', count: sum(all.slice(CATEGORY_ROWS).map((c) => c.count)) }] : all;
  const catMax = Math.max(1, ...cats.map((c) => c.count));
  const place = getPlace();
  const eyebrow = `${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · ${place && place.key !== 'all' ? place.name : 'Whole service'}`.toUpperCase();

  const sub = worst
    ? worstLeft?.late
      ? `One ${words(worst.category)} report is ${worstLeft.text.toLowerCase()}. Start there.`
      : 'Nothing is overdue. The most pressing item is first below.'
    : 'You are all caught up.';

  return (
    <PageMeta.Provider value={{ eyebrow }}>
      <Page
        fill
        title={waiting === 0 ? 'Nothing needs a decision.' : `${waiting} ${waiting === 1 ? 'thing needs' : 'things need'} a decision.`}
        sub={sub}
        actions={
          <>
            <span className="muted small">{loading ? 'Updating…' : 'Updated just now'}</span>
            <button className="btn" onClick={refresh} disabled={loading} title="Refresh">
              Last 30 days
            </button>
            {worst && (
              <button className="btn primary" onClick={() => (openReport ? openReport(worst.id) : go('reports'))}>
                {worstLeft?.late ? 'Open overdue report' : 'Open top report'}
              </button>
            )}
          </>
        }
      >
        <ErrorBanner message={error} onRetry={reload} />
        {!data && !error && <Loading rows={8} />}
        {data && (
          <div className="ov">
            <div className="ov-stats">
              <button className={overdue.length ? 'ov-stat alert' : 'ov-stat'} onClick={() => go('reports')}>
                <span className="ov-stat-top">
                  <b>Open reports</b>
                  <Icon name="arrow" />
                </span>
                <span className="ov-big">{rep.open}</span>
                <span className="ov-note">
                  {overdue.length ? `${overdue.length} overdue · ` : ''}
                  {oldestOpen != null ? `oldest waiting ${hrs(oldestOpen)}` : 'nothing waiting'}
                  {unassigned && unassigned === open.length ? ' · all unassigned' : unassigned ? ` · ${unassigned} unassigned` : ''}
                </span>
              </button>
              <button className="ov-stat" onClick={() => go('verifications')}>
                <span className="ov-stat-top">
                  <b>Identity checks</b>
                  <Icon name="arrow" />
                </span>
                <span className="ov-big">{data.pendingVerifications}</span>
                <span className="ov-note">Waiting for a manual review</span>
              </button>
              <button className="ov-stat" onClick={() => go('reports')}>
                <span className="ov-stat-top">
                  <b>Reports in review</b>
                  <Icon name="arrow" />
                </span>
                <span className="ov-big">{rep.in_review}</span>
                <span className="ov-note">{rep.in_review ? `${reviewer ? `With ${reviewer} · ` : ''}oldest ${oldestReview != null ? hrs(oldestReview) : '–'}` : 'Nothing in review'}</span>
              </button>
              <button className="ov-stat dark" onClick={() => go('oncall')}>
                <span className="ov-stat-top">
                  <b>On call now</b>
                  <Icon name="arrow" />
                </span>
                {onNow ? (
                  <span className="ov-who">
                    <i className="ov-av">{onNow.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</i>
                    <span>
                      <b>{onNow.name}</b>
                      <small>
                        {until ? `until ${clock(until)}` : 'covering now'}
                        {next ? ` · then ${next.name}` : ''}
                      </small>
                    </span>
                  </span>
                ) : (
                  <span className="ov-note">{oncall.data?.fallback ? 'Trust leads and administrators cover.' : 'Nobody on call.'}</span>
                )}
                {oncall.data && !oncall.data.ownerContactSet && <span className="ov-warn">No owner contact for the last escalation step</span>}
              </button>
            </div>

            <div className="ov-row">
              <section className="card ov-card" aria-labelledby="ov-start">
                <div className="ov-head">
                  <h2 id="ov-start">Start here</h2>
                  <span className="muted small">Sorted by time left to answer · urgent 1 h, others 24 h</span>
                </div>
                {start.length === 0 ? (
                  <p className="muted ov-empty">Nothing is waiting for an answer.</p>
                ) : (
                  <ul className="ov-list">
                    {start.map((r) => {
                      const left = leftOf(r, now);
                      const window = (r.priority === 'urgent' ? 1 : 24) * 3_600_000;
                      const frac = left ? Math.max(0.04, Math.min(1, 1 - left.ms / window)) : 0.04;
                      const tone = !left ? 'ok' : left.late ? 'late' : left.ms < window * 0.3 ? 'soon' : 'ok';
                      return (
                        <li key={r.id}>
                          <button onClick={() => (openReport ? openReport(r.id) : go('reports'))}>
                            <span className="ov-li-main">
                              <small>
                                {words(r.category).toUpperCase()}
                                <span> · {r.subject?.displayName ?? `a ${r.targetType}`}, reported by {r.reporter.profile?.displayName ?? 'someone'}</span>
                              </small>
                              <b>“{r.details || 'No details given'}”</b>
                            </span>
                            <span className={`ov-left ${tone}`}>
                              <em>{left ? left.text : '–'}</em>
                              <i>
                                <u style={{ width: `${Math.round(frac * 100)}%` }} />
                              </i>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="card ov-card" aria-labelledby="ov-people">
                <div className="ov-head">
                  <h2 id="ov-people">People</h2>
                  <button className="link" onClick={() => go('users')}>
                    All users →
                  </button>
                </div>
                <div className="ov-meter">
                  <span>
                    Verified adults <b>{verifiedPct}%</b>
                  </span>
                  <i>
                    <u style={{ width: `${verifiedPct}%`, background: '#12302b' }} />
                  </i>
                </div>
                <div className="ov-meter">
                  <span>
                    Identity check pass rate <b>{passPct == null ? '–' : `${passPct}%`}</b>
                  </span>
                  <i>
                    <u style={{ width: `${passPct ?? 0}%`, background: '#4a7be0' }} />
                  </i>
                </div>
                <div className="ov-new">
                  <span className="muted">New members</span>
                  <div>
                    <b className="ov-big">{newNow}</b>
                    {change != null && (
                      <em className={change >= 0 ? 'up' : 'down'}>
                        {change >= 0 ? '+' : ''}
                        {change}% vs prior 30 days
                      </em>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <div className="ov-row">
              <section className="card ov-card" aria-labelledby="ov-signups">
                <CardHead
                  id="ov-signups"
                  title="Sign-ups per day"
                  right={
                    <span className="muted small">
                      <b className="ov-strong">{data.activeActivities}</b> active {data.activeActivities === 1 ? 'activity' : 'activities'} · <b className="ov-strong">{data.activeTrips}</b> active {data.activeTrips === 1 ? 'trip' : 'trips'}
                    </span>
                  }
                />
                <div className="ov-chart">
                  <div className="ov-chart-main">{s ? <DayBars days={days} values={s.members} label="Sign-ups" color="#cfdcd4" flag="#12302b" /> : <Loading rows={4} />}</div>
                  {spike && s && (
                    <aside className="ov-spike">
                      <b>{dayName(days[lastIdx])} spike</b>
                      <span>
                        {lastN} sign-ups, {s.activities[lastIdx]} {s.activities[lastIdx] === 1 ? 'activity' : 'activities'} and {s.trips[lastIdx]} {s.trips[lastIdx] === 1 ? 'trip' : 'trips'} posted in one day.
                      </span>
                    </aside>
                  )}
                </div>
              </section>

              <section className="card ov-card" aria-labelledby="ov-cats">
                <div className="ov-head">
                  <h2 id="ov-cats">What people report</h2>
                  <span className="muted small">{sum(all.map((c) => c.count))} in 30 days</span>
                </div>
                {cats.length === 0 ? (
                  <p className="muted ov-empty">No reports in the last 30 days.</p>
                ) : (
                  <ul className="ov-cats">
                    {cats.map((c, i) => (
                      <li key={c.category}>
                        <span className="cap">{words(c.category)}</span>
                        <i>
                          <u style={{ width: `${(c.count / catMax) * 100}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                        </i>
                        <b>{c.count}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <ServiceHealth />
          </div>
        )}
      </Page>
    </PageMeta.Provider>
  );
}
