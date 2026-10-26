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
  assignedName: string | null;
  resolution: string | null;
  createdAt: string;
  priority: 'urgent' | 'normal';
  ageHours: number;
  overdue: boolean;
  escalated: boolean;
  reporter: { id: string; profile?: { displayName: string } | null };
  subject: { userId: string; displayName: string | null; state: string | null } | null;
  message: { id: string; body: string; moderationState: string } | null;
  repeatOffender: { flag: boolean; reasons: string[] } | null;
};
type Workload = {
  policy: { coverage: { text: string; onDutyNow: boolean }; answerWithin: { urgent: string; normal: string } };
  queue: { unassigned: number; urgent: number; overdue: number; oldestUnassignedHours: number | null };
  moderators: { id: string; name: string; role: string; assigned: number; overdue: number; oldestHours: number | null; resolvedLast7Days: number }[];
};
type Status = 'open' | 'in_review' | 'resolved' | 'dismissed';

const CATEGORIES = ['immediate_danger', 'harassment', 'fraud', 'inappropriate_content', 'underage', 'physical_safety', 'spam', 'financial_solicitation'];
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

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
  const work = useLoad(() => get<Workload>('/v1/admin/reports/workload'), [status], 15000);
  const act = useAction(() => (reload(), open.reload(), work.reload()));
  const mod = can.moderate(me.role);

  const resolve = async (r: R, s: 'resolved' | 'dismissed') => {
    const resolution = await askText(s === 'resolved' ? 'Resolve report' : 'Dismiss report', {
      label: 'What was decided? (kept in the audit log)',
      confirm: s === 'resolved' ? 'Resolve' : 'Dismiss',
    });
    if (resolution) act.run(() => post(`/v1/admin/reports/${r.id}/resolve`, { status: s, resolution }));
  };
  const removeMessage = async (r: R) => {
    const reason = await askText('Hide this message?', { label: 'Why? The sender is told this reason, and can ask for a review.', confirm: 'Hide message' });
    if (reason) act.run(() => post(`/v1/admin/messages/${r.message!.id}/remove`, { reason }));
  };
  const restoreMessage = (r: R) => act.run(() => post(`/v1/admin/messages/${r.message!.id}/restore`));
  const warn = async (r: R) => {
    const reason = await askText(`Warn ${r.subject?.displayName ?? 'this person'}?`, { label: 'What is the warning about? The person reads this and can ask for a review.', confirm: 'Send warning' });
    if (reason) act.run(() => post(`/v1/admin/users/${r.subject!.userId}/warn`, { reason, reportId: r.id }));
  };

  const w = work.data;
  return (
    <Page title="Reports queue" sub="Urgent reports come first, then the ones that have waited too long.">
      {w && !focusId && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="row between wrap">
            <strong>Queue health</strong>
            <span className="muted small">
              {w.policy.coverage.text} {w.policy.coverage.onDutyNow ? 'Moderators are on duty now.' : 'Outside coverage hours: urgent reports still alert every moderator.'} Answer times: urgent {w.policy.answerWithin.urgent}, others {w.policy.answerWithin.normal}.
            </span>
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            <span><strong>{w.queue.unassigned}</strong> <span className="muted">unassigned{w.queue.oldestUnassignedHours != null ? `, oldest ${hours(w.queue.oldestUnassignedHours)}` : ''}</span></span>
            <span><strong style={{ color: w.queue.urgent ? 'var(--orange)' : undefined }}>{w.queue.urgent}</strong> <span className="muted">urgent</span></span>
            <span><strong style={{ color: w.queue.overdue ? 'var(--orange)' : undefined }}>{w.queue.overdue}</strong> <span className="muted">overdue</span></span>
          </div>
          {w.moderators.length > 0 && (
            <table className="table">
              <thead>
                <tr><th>Moderator</th><th>Assigned</th><th>Overdue</th><th>Oldest</th><th>Done in 7 days</th></tr>
              </thead>
              <tbody>
                {w.moderators.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name} <span className="muted small">{m.role.replace('_', ' ')}</span></td>
                    <td>{m.assigned}</td>
                    <td>{m.overdue || '–'}</td>
                    <td>{m.oldestHours != null ? hours(m.oldestHours) : '–'}</td>
                    <td>{m.resolvedLast7Days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

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
          const active = ['open', 'in_review'].includes(r.status);
          return (
            <li key={r.id} className="card report" style={r.priority === 'urgent' && active ? { borderColor: 'var(--orange)' } : undefined}>
              <div className="row between wrap">
                <div className="row wrap">
                  <Chip value={r.category} icon={r.priority === 'urgent' ? 'alert' : undefined} />
                  <Chip value={r.status} />
                  {r.priority === 'urgent' && <span className="small" style={{ color: 'var(--orange)', fontWeight: 700 }}>Urgent</span>}
                  {active && r.escalated && <Chip value="escalated" tone="bad" />}
                  {active && r.overdue && !r.escalated && <Chip value="overdue" tone="warn" />}
                  {r.repeatOffender?.flag && <Chip value="repeat offender" tone="bad" icon="alert" />}
                </div>
                <span className="muted small">{fmt(r.createdAt)}{active ? ` · waiting ${hours(r.ageHours)}` : ''}</span>
              </div>
              <h3>“{r.details || 'No details given'}”</h3>
              {r.message && (
                <p className="note" style={{ margin: 0 }}>
                  <strong>The message{r.message.moderationState === 'removed' ? ' (hidden)' : ''}:</strong> {r.message.body}
                </p>
              )}
              {r.repeatOffender?.flag && <p className="small" style={{ margin: 0, color: 'var(--orange)' }}>Earlier: {r.repeatOffender.reasons.join('; ')}.</p>}
              <dl className="meta">
                <div>
                  <dt>Reported {r.targetType}</dt>
                  <dd>
                    {r.subject?.displayName ? <>{r.subject.displayName} </> : null}
                    <span className="mono">{shortId(r.targetId)}</span>{' '}
                    {(r.targetType === 'user' || r.subject) && openUser && (
                      <button className="link" onClick={() => openUser(r.subject?.userId ?? r.targetId)}>
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
                  <dd>{r.assignedName ?? 'Unassigned'}</dd>
                </div>
                {mod && active && (
                  <div className="cell-actions">
                    {r.status === 'open' && (
                      <button className="btn" onClick={() => act.run(() => post(`/v1/admin/reports/${r.id}/assign`))} disabled={act.busy}>
                        Assign to me
                      </button>
                    )}
                    {r.message && r.message.moderationState !== 'removed' && (
                      <button className="btn danger" onClick={() => removeMessage(r)} disabled={act.busy}>
                        Hide message
                      </button>
                    )}
                    {r.subject && (
                      <button className="btn" onClick={() => warn(r)} disabled={act.busy}>
                        Warn {r.subject.displayName ?? 'user'}
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
                {mod && !active && r.message?.moderationState === 'removed' && (
                  <div className="cell-actions">
                    <button className="btn" onClick={() => restoreMessage(r)} disabled={act.busy}>
                      Put the message back
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
