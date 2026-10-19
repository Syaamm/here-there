import { get, post, type Activity } from '../api';
import { Chip, Empty, ErrorBanner, Spinner, TopBar, ago, useAction, useLoad, when } from '../ui';

type Req = {
  id: string;
  state: string;
  intro: string | null;
  createdAt: string;
  applicant: { id: string; displayName?: string; verifiedAdult: boolean; languages: string[]; interests: string[] };
};

const ORDER: Record<string, number> = { requested: 0, approved: 1, declined: 2, withdrawn: 3 };

/** Screen 11: host reviews applicants. The server creates membership only on approval. */
export function HostReview({ id }: { id: string }) {
  const act = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id]);
  const reqs = useLoad(() => get<{ items: Req[] }>(`/v1/activities/${id}/requests`), [id]);
  const refresh = () => (act.reload(), reqs.reload());
  const mutate = useAction(refresh);

  const a = act.data;
  if (act.loading && !a) return <><TopBar title="Manage join requests" /><Spinner /></>;
  if (reqs.error?.message && !reqs.data)
    return (
      <>
        <TopBar title="Manage join requests" />
        <Empty title="Only the host can review requests">{reqs.error.message}</Empty>
      </>
    );

  const items = [...(reqs.data?.items ?? [])].sort((x, y) => ORDER[x.state] - ORDER[y.state] || +new Date(x.createdAt) - +new Date(y.createdAt));
  const pending = items.filter((r) => r.state === 'requested').length;
  const full = !!a && a.going >= a.capacity;

  const decide = (r: Req, decision: 'approve' | 'decline') => mutate.run(() => post(`/v1/activities/${id}/requests/${r.id}/decision`, { decision }));

  return (
    <>
      <TopBar title="Manage join requests" />
      {a && (
        <div className="card">
          <strong>{a.title}</strong>
          <div className="muted small">
            {when(a.startsAt)} · {a.going} of {a.capacity} approved
          </div>
          {full && <p className="banner warn small">This activity is full. Reverse an approval to free a place.</p>}
        </div>
      )}
      <ErrorBanner message={mutate.error} />
      <h3>Pending requests · {pending}</h3>
      {reqs.data && items.length === 0 && <Empty title="No requests yet">When people ask to join, you'll see them here.</Empty>}

      <div className="stack">
        {items.map((r) => (
          <article key={r.id} className="card stack tight">
            <div className="row between">
              <div className="row">
                <span className="avatar" aria-hidden="true">{r.applicant.displayName?.[0]?.toUpperCase() ?? '?'}</span>
                <div>
                  <strong>
                    {r.applicant.displayName ?? 'Member'} {r.applicant.verifiedAdult && <span title="Verified adult">✓</span>}
                  </strong>
                  <div className="muted small">
                    {r.applicant.verifiedAdult ? 'Verified adult' : 'Not verified'}
                    {r.applicant.languages.length > 0 && ` · ${r.applicant.languages.join(', ')}`}
                  </div>
                </div>
              </div>
              <span className="muted small">{ago(r.createdAt)}</span>
            </div>
            {r.applicant.interests.length > 0 && (
              <div className="chips">
                {r.applicant.interests.slice(0, 5).map((i) => (
                  <Chip key={i}>{i}</Chip>
                ))}
              </div>
            )}
            <p className="pre">{r.intro || <span className="muted">No introduction.</span>}</p>

            {r.state === 'requested' && (
              <div className="row">
                <button className="btn grow" disabled={mutate.busy} onClick={() => decide(r, 'decline')}>
                  Decline
                </button>
                <button className="btn primary grow" disabled={mutate.busy || full} onClick={() => decide(r, 'approve')}>
                  Approve
                </button>
              </div>
            )}
            {r.state === 'approved' && (
              <div className="row between">
                <Chip tone="ok">Approved · in the group chat</Chip>
                <button className="btn small danger" disabled={mutate.busy} onClick={() => confirm(`Reverse approval for ${r.applicant.displayName}? They lose chat access immediately.`) && decide(r, 'decline')}>
                  Reverse
                </button>
              </div>
            )}
            {r.state === 'declined' && (
              <div className="row between">
                <Chip tone="bad">Declined</Chip>
                <button className="btn small" disabled={mutate.busy || full} onClick={() => decide(r, 'approve')}>
                  Approve instead
                </button>
              </div>
            )}
            {r.state === 'withdrawn' && <Chip>Withdrawn by the applicant</Chip>}
          </article>
        ))}
      </div>
      <p className="banner info small">Chat access is granted only after a real server-side approval, and removed the moment you reverse it.</p>
    </>
  );
}
