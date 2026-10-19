import { useState } from 'react';
import { get } from '../api';
import { Empty, ErrorBanner, fmt, Page, useLoad } from '../ui';

type E = { id: string; actorId: string | null; action: string; objectType: string; objectId: string; metadata: unknown; createdAt: string };

export function AuditPage() {
  const [objectType, setObjectType] = useState('');
  const [objectId, setObjectId] = useState('');
  const [applied, setApplied] = useState({ objectType: '', objectId: '' });
  const { data, error, loading, reload } = useLoad(
    () => get<{ items: E[] }>(`/v1/admin/audit?${new URLSearchParams({ ...(applied.objectType && { objectType: applied.objectType }), ...(applied.objectId && { objectId: applied.objectId }) })}`),
    [applied],
  );

  return (
    <Page
      title="Audit log"
      actions={
        <button className="btn" onClick={reload} disabled={loading}>
          Refresh
        </button>
      }
    >
      <p className="muted">Read-only history of admin, moderation and membership decisions. Newest 200 events.</p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ objectType, objectId: objectId.trim() });
        }}
      >
        <label>
          <span className="sr">Object type</span>
          <select value={objectType} onChange={(e) => setObjectType(e.target.value)}>
            <option value="">All object types</option>
            {['user', 'activity', 'activity_request', 'trip', 'trip_application', 'report'].map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          <span className="sr">Object ID</span>
          <input placeholder="Object ID (optional)" value={objectId} onChange={(e) => setObjectId(e.target.value)} />
        </label>
        <button className="btn primary">Filter</button>
      </form>
      <ErrorBanner message={error} />
      {data?.items.length === 0 && <Empty>No events.</Empty>}
      {!!data?.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Object</th>
                <th>Actor</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{fmt(e.createdAt)}</td>
                  <td className="mono small">{e.action}</td>
                  <td className="small">
                    {e.objectType} <span className="mono muted">{e.objectId}</span>
                  </td>
                  <td className="mono small muted">{e.actorId ?? 'system'}</td>
                  <td className="mono small">{e.metadata ? JSON.stringify(e.metadata) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
