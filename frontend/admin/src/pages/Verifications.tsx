import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { Avatar, Chip, ErrorBanner, fmt, Icon, Loading, Page, Segmented, useAction, useLoad, useMore } from '../ui';

type V = { id: string; method?: string; providerRef: string; eligibility: string; createdAt: string; user: { id: string; email: string; displayName?: string; homeCity?: string } };
type Status = 'pending' | 'verified' | 'rejected';

const waited = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return days < 1 ? 'Today' : `${days}d`;
};

export function VerificationsPage({ me }: { me: Session }) {
  const [status, setStatus] = useState<Status>('pending');
  const first = useLoad(() => get<{ items: V[]; nextCursor: string | null }>(`/v1/admin/verifications?status=${status}`), [status], 6000);
  const more = useMore(first.data, (c) => get(`/v1/admin/verifications?status=${status}&cursor=${c}`), status);
  const reload = () => (more.reset(), first.reload());
  const pending = useLoad(() => get<{ items: V[] }>('/v1/admin/verifications?status=pending'), [status], 6000);
  const act = useAction(() => (reload(), pending.reload()));
  const decide = (id: string, decision: 'verified' | 'rejected') => act.run(() => post(`/v1/admin/verifications/${id}/decision`, { decision }));
  const canDecide = can.verify(me.role);
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});

  return (
    <Page
      fill
      title="Verification"
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
      <ErrorBanner message={first.error ?? act.error} onRetry={reload} />
      {first.loading && !first.data && <Loading rows={5} />}
      {first.data && (
        <div className="scroll-card">
          <div className="list-scroll">
            {more.items.length === 0 ? (
              <div className="state">Nothing here.</div>
            ) : (
              <ul className="rows">
                {more.items.map((v) => (
                  <li key={v.id}>
                    <Avatar name={v.user.displayName ?? v.user.email} />
                    <div className="grow person" style={{ display: 'grid', gap: 2 }}>
                      <span className="name">{v.user.displayName ?? '(no name)'}</span>
                      <span className="sub">
                        {v.user.email}
                        {v.user.homeCity && ` · ${v.user.homeCity}`}
                      </span>
                    </div>
                    <div className="row" style={{ minWidth: 0 }}>
                      <code className="mono clip" style={{ maxWidth: 180 }}>{v.providerRef}</code>
                      <button type="button" className="icon-btn" aria-label="Copy reference" onClick={() => copy(v.providerRef)}>
                        <Icon name="copy" />
                      </button>
                      {v.method === 'document' && <Chip value="Document" tone="plain" />}
                    </div>
                    <span className="small muted nowrap" title={fmt(v.createdAt)}>
                      {v.eligibility === 'pending' ? waited(v.createdAt) : fmt(v.createdAt)}
                    </span>
                    {v.eligibility !== 'pending' && <Chip value={v.eligibility} />}
                    {canDecide && v.eligibility === 'pending' && (
                      <div className="cell-actions">
                        <button type="button" className="btn small" onClick={() => decide(v.id, 'rejected')} disabled={act.busy}>
                          Reject
                        </button>
                        <button type="button" className="btn small primary" onClick={() => decide(v.id, 'verified')} disabled={act.busy}>
                          Approve
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {more.hasMore && <div style={{ padding: '0 16px 12px' }}>{more.more}</div>}
          </div>
        </div>
      )}
    </Page>
  );
}
