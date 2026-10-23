import { get } from '../api';
import { Chip, ErrorBanner, fmt, Icon, Page, shortId, useLoad, type IconName } from '../ui';
import { actionLabel } from './Audit';

type Overview = { users: number; pendingVerifications: number; openReports: number; activeActivities: number; activeTrips: number };
type Report = { id: string; category: string; details: string | null; createdAt: string; reporter: { id: string; profile?: { displayName: string } | null } };
type Check = { id: string; createdAt: string; user: { email: string; displayName?: string; homeCity?: string } };
type Event = { id: string; actorId: string | null; action: string; objectType: string; objectId: string; createdAt: string };

const CARDS: { key: keyof Overview; label: string; hint: string; go: string; icon: IconName; tone?: 'warn' | 'info'; tag?: boolean }[] = [
  { key: 'pendingVerifications', label: 'Pending verifications', hint: 'Identity checks waiting for a decision', go: 'verifications', icon: 'shield', tone: 'warn', tag: true },
  { key: 'openReports', label: 'Open reports', hint: 'Open or in review', go: 'reports', icon: 'flag', tone: 'warn', tag: true },
  { key: 'activeActivities', label: 'Active HERE activities', hint: 'Published, not yet ended', go: 'content', icon: 'layers' },
  { key: 'activeTrips', label: 'Active THERE trips', hint: 'Published, full, planning or confirmed', go: 'content', icon: 'plane', tone: 'info' },
  { key: 'users', label: 'Users', hint: 'All registered accounts', go: 'users', icon: 'users' },
];

export function OverviewPage({ go }: { go: (p: string) => void }) {
  const { data, error, loading, reload } = useLoad(() => get<Overview>('/v1/admin/overview'), []);
  const reports = useLoad(() => get<{ items: Report[] }>('/v1/admin/reports?status=open'), []);
  const checks = useLoad(() => get<{ items: Check[] }>('/v1/admin/verifications?status=pending'), []);
  const events = useLoad(() => get<{ items: Event[] }>('/v1/admin/audit').catch(() => ({ items: [] as Event[] })), []);
  const refresh = () => (reload(), reports.reload(), checks.reload(), events.reload());

  // safety first, then oldest: the order a reviewer should work in
  const urgent = (c: string) => (c === 'physical_safety' || c === 'underage' ? 0 : 1);
  const needs = [
    ...(reports.data?.items ?? []).map((r) => ({ kind: 'report' as const, at: r.createdAt, r, rank: urgent(r.category) })),
    ...(checks.data?.items ?? []).map((v) => ({ kind: 'check' as const, at: v.createdAt, v, rank: 1 })),
  ].sort((a, b) => a.rank - b.rank || +new Date(a.at) - +new Date(b.at));
  const waiting = (data?.pendingVerifications ?? 0) + (data?.openReports ?? 0);

  return (
    <Page
      title="Overview"
      sub={`${new Date().toLocaleDateString(undefined, { dateStyle: 'full' })} · ${waiting === 0 ? 'nothing needs a decision' : `${waiting} ${waiting === 1 ? 'item needs' : 'items need'} a decision`}`}
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
      <div className="cards">
        {CARDS.map((c) => (
          <button key={c.key} className="card stat" onClick={() => go(c.go)}>
            <span className="stat-top">
              <span className={`stat-icon ${c.tone ?? ''}`}>
                <Icon name={c.icon} />
              </span>
              {c.tag && !!data?.[c.key] && <span className="tag">Needs review</span>}
            </span>
            <span className="stat-value">{data ? data[c.key] : '–'}</span>
            <span className="stat-label">{c.label}</span>
            <span className="muted small">{c.hint}</span>
          </button>
        ))}
      </div>

      <div className="panels">
        <section className="card panel" aria-labelledby="attn">
          <div className="panel-head">
            <h2 id="attn">Needs attention</h2>
            <span className="muted small">Safety first, then oldest</span>
          </div>
          {needs.length === 0 && <p className="empty" style={{ margin: '0 20px 20px' }}>Nothing is waiting.</p>}
          {needs.slice(0, 6).map((n) =>
            n.kind === 'report' ? (
              <div className="attn" key={n.r.id}>
                <div>
                  <div className="row wrap">
                    <Chip value={n.r.category} />
                    <span className="muted small">Reported {fmt(n.r.createdAt)}</span>
                  </div>
                  <div className="attn-title">“{n.r.details || 'No details given'}”</div>
                  <div className="muted small">Report · Reported by {n.r.reporter.profile?.displayName ?? shortId(n.r.reporter.id)}</div>
                </div>
                <button className="btn" onClick={() => go('reports')}>
                  Review <Icon name="arrow" />
                </button>
              </div>
            ) : (
              <div className="attn" key={n.v.id}>
                <div>
                  <div className="row wrap">
                    <Chip value="Verification" tone="warn" />
                    <span className="muted small">Requested {fmt(n.v.createdAt)}</span>
                  </div>
                  <div className="attn-title">{n.v.user.displayName ?? 'Someone'} is waiting for an adult identity check</div>
                  <div className="muted small">
                    {n.v.user.email}
                    {n.v.user.homeCity && ` · ${n.v.user.homeCity}`}
                  </div>
                </div>
                <button className="btn" onClick={() => go('verifications')}>
                  Review <Icon name="arrow" />
                </button>
              </div>
            ),
          )}
        </section>

        <section className="card panel" aria-labelledby="recent">
          <div className="panel-head">
            <h2 id="recent">Recent activity</h2>
            <button className="link" onClick={() => go('audit')}>
              Audit log →
            </button>
          </div>
          <ul className="feed">
            {(events.data?.items ?? []).slice(0, 5).map((e) => {
              const l = actionLabel(e.action);
              return (
                <li key={e.id}>
                  <span className={`dot ${l.tone === 'ok' ? 'ok' : l.tone === 'bad' ? '' : 'info'}`} />
                  <div>
                    <div>
                      <b>
                        {e.objectType.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())} {l.text.toLowerCase()}
                      </b>{' '}
                      <span className="mono muted small">{shortId(e.objectId)}</span>
                    </div>
                    <div className="muted small">
                      by <span className="mono">{shortId(e.actorId)}</span> · {new Date(e.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}
                    </div>
                  </div>
                </li>
              );
            })}
            {events.data && events.data.items.length === 0 && <li className="muted">Nothing yet.</li>}
          </ul>
        </section>
      </div>
    </Page>
  );
}
