import './Verifications.css';
import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { Avatar, Chip, Empty, ErrorBanner, fmt, Icon, Loading, Page, useAction, useLoad, useMore } from '../ui';

type V = { id: string; method?: string; providerRef: string; eligibility: string; createdAt: string; user: { id: string; email: string; displayName?: string; homeCity?: string } };
type Status = 'pending' | 'verified' | 'rejected';

const waitingFor = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return days < 1 ? 'Waiting today' : `Waiting ${days} ${days === 1 ? 'day' : 'days'}`;
};

export function VerificationsPage({ me }: { me: Session }) {
  const [status, setStatus] = useState<Status>('pending');
  const first = useLoad(() => get<{ items: V[]; nextCursor: string | null }>(`/v1/admin/verifications?status=${status}`), [status], 6000);
  const more = useMore(first.data, (c) => get(`/v1/admin/verifications?status=${status}&cursor=${c}`), status);
  const { error, loading } = first;
  const data = first.data && { items: more.items };
  const reload = () => (more.reset(), first.reload());
  const pending = useLoad(() => get<{ items: V[] }>('/v1/admin/verifications?status=pending'), [status], 6000);
  const act = useAction(() => (reload(), pending.reload()));
  const decide = (id: string, decision: 'verified' | 'rejected') => act.run(() => post(`/v1/admin/verifications/${id}/decision`, { decision }));
  const canDecide = can.trust(me.role);
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
  const filters: { id: Status; label: string; count?: number }[] = [
    { id: 'pending', label: 'Pending', count: pending.data?.items.length },
    { id: 'verified', label: 'Verified' },
    { id: 'rejected', label: 'Rejected' },
  ];

  return (
    <Page fill title="Identity verification" sub="Review adult identity checks from the verification provider.">
      <div className="vf-tools">
        <div className="vf-filters" role="group" aria-label="Status">
          {filters.map((f) => (
            <button key={f.id} type="button" className={status === f.id ? 'vf-pill on' : 'vf-pill'} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
              {f.label}
              {!!f.count && <span className="vf-count">{f.count}</span>}
            </button>
          ))}
        </div>
        <p className="vf-note">
          <Icon name="lock" />
          Only the provider reference and the outcome are stored. Identity documents are never shown here or to other users.
          {!canDecide && ' Deciding requires the trust lead or admin role.'}
        </p>
      </div>
      <ErrorBanner message={error ?? act.error} onRetry={reload} />
      {loading && !data && <Loading rows={5} />}
      {data?.items.length === 0 && <Empty title={`No ${status} checks`}>Nothing to review in this list.</Empty>}
      {!!data?.items.length && (
        <div className="vf-scroll">
          <ul className="vf-rows">
            {data.items.map((v) => (
              <li key={v.id} className="vf-row">
                <Avatar name={v.user.displayName ?? v.user.email} size="lg" />
                <div className="vf-person">
                  <b>{v.user.displayName ?? '(no name)'}</b>
                  <span>
                    {v.user.email}
                    {v.user.homeCity && ` · ${v.user.homeCity}`}
                  </span>
                </div>
                <div className="vf-ref">
                  <span className="vf-ref-label">Provider reference</span>
                  <span className="vf-ref-line">
                    <code>{v.providerRef}</code>
                    {v.method === 'document' && <Chip value="Document only" tone="info" />}
                    <button type="button" className="vf-round" aria-label="Copy provider reference" title="Copy" onClick={() => copy(v.providerRef)}>
                      <Icon name="copy" />
                    </button>
                  </span>
                </div>
                <div className="vf-when">
                  <span>{fmt(v.createdAt)}</span>
                  {v.eligibility === 'pending' && <em>{waitingFor(v.createdAt)}</em>}
                </div>
                <span className={`vf-status ${v.eligibility}`}>
                  <i aria-hidden="true" />
                  {v.eligibility.replace(/_/g, ' ')}
                </span>
                <div className="vf-actions">
                  {canDecide && v.eligibility === 'pending' && (
                    <>
                      <button type="button" className="vf-btn reject" onClick={() => decide(v.id, 'rejected')} disabled={act.busy}>
                        Reject
                      </button>
                      <button type="button" className="vf-btn verify" onClick={() => decide(v.id, 'verified')} disabled={act.busy}>
                        <Icon name="check" /> Verify adult
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {more.hasMore && <div className="vf-more">{more.more}</div>}
        </div>
      )}
    </Page>
  );
}
