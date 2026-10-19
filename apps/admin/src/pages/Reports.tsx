import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Chip, Empty, ErrorBanner, fmt, Page, useAction, useLoad } from '../ui';

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

const CATEGORIES = ['harassment', 'fraud', 'inappropriate_content', 'underage', 'physical_safety', 'spam', 'financial_solicitation'];

export function ReportsPage({ me }: { me: Session }) {
  const [status, setStatus] = useState('open');
  const [category, setCategory] = useState('');
  const { data, error, loading, reload } = useLoad(
    () => get<{ items: R[] }>(`/v1/admin/reports?${new URLSearchParams({ ...(status && { status }), ...(category && { category }) })}`),
    [status, category],
  );
  const act = useAction(reload);
  const mod = can.moderate(me.role);

  const resolve = async (r: R, s: 'resolved' | 'dismissed') => {
    const resolution = await askText(s === 'resolved' ? 'Resolve report' : 'Dismiss report', {
      label: 'What was decided? (kept in the audit log)',
      confirm: s === 'resolved' ? 'Resolve' : 'Dismiss',
    });
    if (resolution) act.run(() => post(`/v1/admin/reports/${r.id}/resolve`, { status: s, resolution }));
  };

  return (
    <Page
      title="Reports queue"
      actions={
        <>
          <label>
            <span className="sr">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="in_review">In review</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>
          <label>
            <span className="sr">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      <p className="muted">Physical-safety and underage reports are always listed first.</p>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data?.items.length === 0 && <Empty>No reports for this filter.</Empty>}
      <ul className="stack">
        {data?.items.map((r) => (
          <li key={r.id} className="card">
            <div className="row between wrap">
              <div className="row wrap">
                <Chip value={r.category} />
                <Chip value={r.status} />
                <span className="muted small">
                  {r.targetType} <span className="mono">{r.targetId}</span>
                </span>
              </div>
              <span className="muted small">{fmt(r.createdAt)}</span>
            </div>
            <p className="report-details">{r.details || <span className="muted">No details given.</span>}</p>
            <div className="row between wrap">
              <span className="muted small">
                Reported by {r.reporter.profile?.displayName ?? r.reporter.id}
                {r.assignedTo && ' · assigned'}
              </span>
              {r.resolution && <span className="small">Resolution: {r.resolution}</span>}
              {mod && ['open', 'in_review'].includes(r.status) && (
                <div className="row">
                  {r.status === 'open' && (
                    <button className="btn" onClick={() => act.run(() => post(`/v1/admin/reports/${r.id}/assign`))} disabled={act.busy}>
                      Assign to me
                    </button>
                  )}
                  <button className="btn" onClick={() => resolve(r, 'dismissed')} disabled={act.busy}>
                    Dismiss
                  </button>
                  <button className="btn primary" onClick={() => resolve(r, 'resolved')} disabled={act.busy}>
                    Resolve
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Page>
  );
}
