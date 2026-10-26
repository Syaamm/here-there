import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { Avatar, Chip, Empty, ErrorBanner, fmt, Icon, Page, Segmented, useAction, useLoad } from '../ui';

type V = { id: string; method?: string; providerRef: string; eligibility: string; createdAt: string; user: { id: string; email: string; displayName?: string; homeCity?: string } };
type Status = 'pending' | 'verified' | 'rejected';

const waitingFor = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return days < 1 ? 'Waiting today' : `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;
};

export function VerificationsPage({ me }: { me: Session }) {
  const [status, setStatus] = useState<Status>('pending');
  const { data, error, loading, reload } = useLoad(() => get<{ items: V[] }>(`/v1/admin/verifications?status=${status}`), [status], 6000);
  const pending = useLoad(() => get<{ items: V[] }>('/v1/admin/verifications?status=pending'), [status], 6000);
  const act = useAction(() => (reload(), pending.reload()));
  const decide = (id: string, decision: 'verified' | 'rejected') => act.run(() => post(`/v1/admin/verifications/${id}/decision`, { decision }));
  const canDecide = can.trust(me.role);
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

  return (
    <Page
      title="Identity verification"
      sub="Review adult identity checks from the verification provider."
      actions={
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { id: 'pending', label: 'Pending', count: pending.data?.items.length },
            { id: 'verified', label: 'Verified' },
            { id: 'rejected', label: 'Rejected' },
          ]}
        />
      }
    >
      <p className="note">
        <Icon name="lock" />
        Only the provider reference and the outcome are stored. Identity documents are never shown here or to other users.
        {!canDecide && ' Deciding requires the trust lead or admin role.'}
      </p>
      <ErrorBanner message={error ?? act.error} />
      {loading && !data && <p className="muted">Loading…</p>}
      {data?.items.length === 0 && <Empty>No {status} checks.</Empty>}
      {!!data?.items.length && (
        <div className="table-wrap">
          <div className="table-scroll">
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
                      <div className="person">
                        <Avatar name={v.user.displayName ?? v.user.email} size="lg" />
                        <div>
                          <div className="name">{v.user.displayName ?? '(no name)'}</div>
                          <div className="sub">
                            {v.user.email}
                            {v.user.homeCity && ` · ${v.user.homeCity}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="row">
                        <span className="mono small">{v.providerRef}</span>
                        {v.method === 'document' && <Chip value="Document only" tone="info" />}
                        <button className="icon-btn" aria-label="Copy provider reference" title="Copy" onClick={() => copy(v.providerRef)}>
                          <Icon name="copy" />
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="nowrap">{fmt(v.createdAt)}</div>
                      {v.eligibility === 'pending' && <div className="small" style={{ color: 'var(--warn-fg)' }}>{waitingFor(v.createdAt)}</div>}
                    </td>
                    <td>
                      <Chip value={v.eligibility} />
                    </td>
                    <td>
                      {canDecide && v.eligibility === 'pending' && (
                        <div className="cell-actions">
                          <button className="btn danger" onClick={() => decide(v.id, 'rejected')} disabled={act.busy}>
                            Reject
                          </button>
                          <button className="btn primary" onClick={() => decide(v.id, 'verified')} disabled={act.busy}>
                            <Icon name="check" /> Verify adult
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}
