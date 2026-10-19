import { get } from '../api';
import { ErrorBanner, Page, useLoad } from '../ui';

type Overview = { users: number; pendingVerifications: number; openReports: number; activeActivities: number; activeTrips: number };

const CARDS: { key: keyof Overview; label: string; hint: string; go?: string }[] = [
  { key: 'pendingVerifications', label: 'Pending verifications', hint: 'Identity checks waiting for a decision', go: 'verifications' },
  { key: 'openReports', label: 'Open reports', hint: 'Open or in review', go: 'reports' },
  { key: 'activeActivities', label: 'Active HERE activities', hint: 'Published, not yet ended', go: 'content' },
  { key: 'activeTrips', label: 'Active THERE trips', hint: 'Published, full, planning or confirmed', go: 'content' },
  { key: 'users', label: 'Users', hint: 'All registered accounts', go: 'users' },
];

export function OverviewPage({ go }: { go: (p: string) => void }) {
  const { data, error, loading, reload } = useLoad(() => get<Overview>('/v1/admin/overview'), []);
  return (
    <Page
      title="Overview"
      actions={
        <button className="btn" onClick={reload} disabled={loading}>
          Refresh
        </button>
      }
    >
      <ErrorBanner message={error} />
      <div className="cards">
        {CARDS.map((c) => (
          <button key={c.key} className="card stat" onClick={() => c.go && go(c.go)}>
            <span className="stat-value">{data ? data[c.key] : '-'}</span>
            <span className="stat-label">{c.label}</span>
            <span className="muted small">{c.hint}</span>
          </button>
        ))}
      </div>
    </Page>
  );
}
