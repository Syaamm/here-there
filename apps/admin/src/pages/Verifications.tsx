import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { Chip, Empty, ErrorBanner, fmt, Page, useAction, useLoad } from '../ui';

type V = { id: string; providerRef: string; eligibility: string; createdAt: string; user: { id: string; email: string; displayName?: string; homeCity?: string } };

export function VerificationsPage({ me }: { me: Session }) {
  const [status, setStatus] = useState('pending');
  const { data, error, loading, reload } = useLoad(() => get<{ items: V[] }>(`/v1/admin/verifications?status=${status}`), [status]);
  const act = useAction(reload);
  const decide = (id: string, decision: 'verified' | 'rejected') => act.run(() => post(`/v1/admin/verifications/${id}/decision`, { decision }));
  const canDecide = can.trust(me.role);

  return (
    <Page
      title="Identity verification"
      actions={
        <label>
          <span className="sr">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      }
    >
      <p className="muted">
        Only the provider reference and the outcome are stored. Identity documents are never shown here or to other users.
        {!canDecide && ' Deciding requires the trust lead or admin role.'}
      </p>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data?.items.length === 0 && <Empty>No {status} checks.</Empty>}
      {!!data?.items.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Provider reference</th>
                <th>Requested</th>
                <th>Status</th>
                <th>
                  <span className="sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.user.displayName ?? '(no name)'}
                    <div className="muted small">
                      {v.user.email}
                      {v.user.homeCity && ` · ${v.user.homeCity}`}
                    </div>
                  </td>
                  <td className="mono small">{v.providerRef}</td>
                  <td className="nowrap">{fmt(v.createdAt)}</td>
                  <td>
                    <Chip value={v.eligibility} />
                  </td>
                  <td className="end nowrap">
                    {canDecide && v.eligibility === 'pending' && (
                      <>
                        <button className="btn" onClick={() => decide(v.id, 'rejected')} disabled={act.busy}>
                          Reject
                        </button>{' '}
                        <button className="btn primary" onClick={() => decide(v.id, 'verified')} disabled={act.busy}>
                          Verify adult
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
