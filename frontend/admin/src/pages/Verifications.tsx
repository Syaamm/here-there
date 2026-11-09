import { useState } from 'react';
import { get, type Session } from '../api';
import { Avatar, Chip, ErrorBanner, fmt, Icon, Loading, Page, Segmented, useLoad, useMore } from '../ui';

type V = { id: string; method?: string; providerRef: string; eligibility: string; createdAt: string; user: { id: string; email: string; displayName?: string; homeCity?: string } };
// the identity provider decides every check, so there is no "pending" list and nothing here is approved by hand: this page is a record
type Status = 'verified' | 'rejected';

export function VerificationsPage({ me: _me }: { me: Session }) {
  const [status, setStatus] = useState<Status>('verified');
  const first = useLoad(() => get<{ items: V[]; nextCursor: string | null }>(`/v1/admin/verifications?status=${status}`), [status], 6000);
  const more = useMore(first.data, (c) => get(`/v1/admin/verifications?status=${status}&cursor=${c}`), status);
  const reload = () => (more.reset(), first.reload());
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
            { id: 'verified', label: 'Verified' },
            { id: 'rejected', label: 'Rejected' },
          ]}
        />
      }
    >
      <ErrorBanner message={first.error} onRetry={reload} />
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
                      {fmt(v.createdAt)}
                    </span>
                    <Chip value={v.eligibility} />
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
