import { get } from '../api';
import { CardHead, Kpi, SERIES, Sparkline } from '../charts';
import { Chip, ErrorBanner, useLoad } from '../ui';

type Health = {
  status: 'ok' | 'degraded';
  alarm: { text: string };
  errorRate5m: number;
  errorRate60m: number;
  totals: { requests: number; errors: number; signups: number; joins: number; messages: number; slowQueries: number };
  lastMinute: unknown;
  series: { at: string; requests: number; errors: number; clientErrors: number; slowRequests: number; slowQueries: number; signups: number; joins: number; messages: number; p95Ms: number | null }[];
  slowQueries: { at: string; ms: number; what: string; reqId?: string }[];
  slowQueryMs: number;
  database: { pingMs: number };
  errorTracking: { configured: boolean };
  uptimeSeconds: number;
  note: string;
};

const rate = (f: number) => `${(f * 100).toFixed(f > 0 && f < 0.001 ? 2 : 1)}%`;
const uptime = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);

/** The live health of the service over the last hour, one point per minute. Looks again every 30 seconds while the page is open. */
export function ServiceHealth() {
  const { data, error, loading } = useLoad(() => get<Health>('/v1/admin/health?minutes=60'), [], 30000);
  const s = data?.series ?? [];
  // the last minute is still filling up, so latency comes from the newest minute that had requests
  const p95 = [...s].reverse().find((m) => m.p95Ms != null)?.p95Ms ?? null;
  const per = (pick: (m: Health['series'][number]) => number) => s.map(pick);

  return (
    <section className="card health" aria-labelledby="health-h" aria-busy={loading && !data}>
      <CardHead
        id="health-h"
        title="Service health"
        right={<span className="muted small" aria-live="polite">{error && !data ? 'Not available' : 'Last hour · updates every 30 seconds'}</span>}
      />
      <ErrorBanner message={error} />
      {!data && !error && <p className="muted small">Loading…</p>}
      {data && (
        <>
          <div className="health-status">
            <Chip value={data.status === 'ok' ? 'Running normally' : 'Degraded'} tone={data.status === 'ok' ? 'ok' : 'warn'} icon={data.status === 'ok' ? 'check' : 'alert'} />
            <span className="small">{data.alarm.text}</span>
          </div>

          <div className="health-grid">
            <Kpi label="Sign-ups" value={data.totals.signups} note={<span className="kpi-pct">last hour</span>}>
              <Sparkline values={per((m) => m.signups)} label={`Sign-ups per minute, last hour: ${data.totals.signups} in total`} />
            </Kpi>
            <Kpi label="Joins" value={data.totals.joins} note={<span className="kpi-pct">last hour</span>}>
              <Sparkline values={per((m) => m.joins)} color={SERIES.blue} label={`Joins per minute, last hour: ${data.totals.joins} in total`} />
            </Kpi>
            <Kpi label="Messages" value={data.totals.messages} note={<span className="kpi-pct">last hour</span>}>
              <Sparkline values={per((m) => m.messages)} color={SERIES.mint} label={`Messages per minute, last hour: ${data.totals.messages} in total`} />
            </Kpi>
            <Kpi label="Errors" value={data.totals.errors} note={<span className="kpi-pct">of {data.totals.requests} requests</span>}>
              <Sparkline values={per((m) => m.errors)} color={SERIES.orange} label={`Server errors per minute, last hour: ${data.totals.errors} in total`} />
            </Kpi>
          </div>

          <dl className="health-stats">
            <div>
              <dt>Error rate, 5 min</dt>
              <dd>{rate(data.errorRate5m)}</dd>
            </div>
            <div>
              <dt>Error rate, 60 min</dt>
              <dd>{rate(data.errorRate60m)}</dd>
            </div>
            <div>
              <dt>Slowest 5% of requests</dt>
              <dd>{p95 == null ? '–' : `${Math.round(p95)} ms`}</dd>
            </div>
            <div>
              <dt>Database reply</dt>
              <dd>{Math.round(data.database.pingMs)} ms</dd>
            </div>
            <div>
              <dt>Running for</dt>
              <dd>{uptime(data.uptimeSeconds)}</dd>
            </div>
          </dl>

          {!data.errorTracking.configured && (
            <p className="note small" style={{ margin: '12px 0 0' }}>
              Error tracking (Sentry) is not set up. Errors are only counted here, not collected with details.
            </p>
          )}

          <details className="health-slow">
            <summary>
              Slowest recent database calls ({data.slowQueries.length})
            </summary>
            {data.slowQueries.length === 0 ? (
              <p className="muted small">None slower than {data.slowQueryMs} ms recently.</p>
            ) : (
              <div className="table-scroll">
                <table className="dash-table">
                  <caption className="sr">Database calls slower than {data.slowQueryMs} ms</caption>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Statement</th>
                      <th>Request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slowQueries.map((q, i) => (
                      <tr key={`${q.at}-${i}`}>
                        <td className="nowrap">{Math.round(q.ms)} ms</td>
                        <td>
                          <div className="mono small clip" title={q.what}>
                            {q.what}
                          </div>
                        </td>
                        <td className="mono small">{q.reqId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
          {data.note && <p className="muted small health-note">{data.note}</p>}
        </>
      )}
    </section>
  );
}
