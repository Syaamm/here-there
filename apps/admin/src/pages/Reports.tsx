import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Icon, Page, Segmented, shortId, useAction, useLoad } from '../ui';

type R = {
  id: string;
  targetType: string;
  targetId: string;
  category: string;
  details: string | null;
  status: string;
  assignedTo: string | null;
  resolution: string | null;
  createdAt: string;
  reporter: { id: string; profile?: { displayName: string } | null };
};
type Status = 'open' | 'in_review' | 'resolved' | 'dismissed';

const CATEGORIES = ['harassment', 'fraud', 'inappropriate_content', 'underage', 'physical_safety', 'spam', 'financial_solicitation'];

export function ReportsPage({ me, openUser, focusId, onClearFocus }: { me: Session; openUser?: (id: string) => void; focusId?: string | null; onClearFocus?: () => void }) {
  const [status, setStatus] = useState<Status>('open');
  const [category, setCategory] = useState('');
  const { data, error, loading, reload } = useLoad(
    // opened from the audit log: look in every status so the report is found whatever state it is in
    () => get<{ items: R[] }>(`/v1/admin/reports?${new URLSearchParams({ ...(!focusId && { status }), ...(category && { category }) })}`),
    [status, category, focusId],
    6000,
  );
  const items = focusId ? (data?.items ?? []).filter((r) => r.id === focusId) : (data?.items ?? []);
  const open = useLoad(() => get<{ items: R[] }>('/v1/admin/reports?status=open'), [status], 6000);
  const act = useAction(() => (reload(), open.reload()));
  const mod = can.moderate(me.role);

  const resolve = async (r: R, s: 'resolved' | 'dismissed') => {
    const resolution = await askText(s === 'resolved' ? 'Resolve report' : 'Dismiss report', {
      label: 'What was decided? (kept in the audit log)',
      confirm: s === 'resolved' ? 'Resolve' : 'Dismiss',
    });
    if (resolution) act.run(() => post(`/v1/admin/reports/${r.id}/resolve`, { status: s, resolution }));
  };

  return (
    <Page title="Reports queue" sub="Physical-safety and underage reports are always listed first.">
      <div className="toolbar" style={{ justifyContent: 'space-between', ...(focusId && { display: 'none' }) }}>
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { id: 'open', label: 'Open', count: open.data?.items.length },
            { id: 'in_review', label: 'In review' },
            { id: 'resolved', label: 'Resolved' },
            { id: 'dismissed', label: 'Dismissed' },
          ]}
        />
        <label className="row">
          <span className="muted">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      {focusId && (
        <p className="note">
          <Icon name="flag" />
          Showing the one report you opened from the audit log.
          <button className="link" style={{ marginLeft: 'auto' }} onClick={onClearFocus}>
            Show the whole queue
          </button>
        </p>
      )}
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data && items.length === 0 && <Empty>{focusId ? 'That report could not be found.' : 'No reports for this filter.'}</Empty>}
      <ul className="stack">
        {items.map((r) => {
          const priority = r.category === 'physical_safety' || r.category === 'underage';
          return (
            <li key={r.id} className="card report">
              <div className="row between wrap">
                <div className="row wrap">
                  <Chip value={r.category} icon={priority ? 'alert' : undefined} />
                  <Chip value={r.status} />
                  {priority && <span className="small" style={{ color: 'var(--orange)', fontWeight: 700 }}>Priority</span>}
                </div>
                <span className="muted small">{fmt(r.createdAt)}</span>
              </div>
              <h3>“{r.details || 'No details given'}”</h3>
              <dl className="meta">
                <div>
                  <dt>Reported {r.targetType}</dt>
                  <dd>
                    <span className="mono">{shortId(r.targetId)}</span>{' '}
                    {r.targetType === 'user' && openUser && (
                      <button className="link" onClick={() => openUser(r.targetId)}>
                        View user
                      </button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Reported by</dt>
                  <dd>{r.reporter.profile?.displayName ?? shortId(r.reporter.id)}</dd>
                </div>
                <div>
                  <dt>Assignee</dt>
                  <dd>{r.assignedTo ? 'Assigned' : 'Unassigned'}</dd>
                </div>
                {mod && ['open', 'in_review'].includes(r.status) && (
                  <div className="cell-actions">
                    {r.status === 'open' && (
                      <button className="btn" onClick={() => act.run(() => post(`/v1/admin/reports/${r.id}/assign`))} disabled={act.busy}>
                        Assign to me
                      </button>
                    )}
                    <button className="btn" onClick={() => resolve(r, 'dismissed')} disabled={act.busy}>
                      Dismiss
                    </button>
                    <button className="btn primary" onClick={() => resolve(r, 'resolved')} disabled={act.busy}>
                      <Icon name="check" /> Resolve
                    </button>
                  </div>
                )}
              </dl>
              {r.resolution && <p className="small muted" style={{ margin: '12px 0 0' }}>Resolution: {r.resolution}</p>}
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
