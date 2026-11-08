import { useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Avatar, Chip, Empty, ErrorBanner, fmt, Loading, Page, ProofImages, Segmented, useAction, useLoad, useMore, type Tone } from '../ui';

type Appeal = {
  id: string;
  kind: 'verification' | 'suspension' | 'removal' | 'report' | 'warning' | 'message';
  what: string;
  state: 'open' | 'upheld' | 'rejected';
  message: string;
  decision: string | null;
  createdAt: string;
  decidedAt: string | null;
  proofs?: string[];
  user: { id: string; email: string; displayName: string | null; state: string; eligibility: string };
  target: { reason?: string | null; method?: string | null; type?: string | null; title?: string | null; suspendedUntil?: string | null; reportCategory?: string; reportAbout?: string; decidedWith?: string | null; warning?: string; message?: string; removedBecause?: string | null } | null;
};
type View = 'open' | 'upheld' | 'rejected';
const TONE: Record<string, Tone> = { open: 'line', upheld: 'ok', rejected: 'plain' };
const STATE: Record<string, string> = { open: 'Waiting', upheld: 'Accepted', rejected: 'Rejected' };

/** What the appeal is about, in one short line. */
function about(a: Appeal) {
  const t = a.target;
  if (a.kind === 'suspension') return t?.suspendedUntil ? `Suspended until ${fmt(t.suspendedUntil)}` : 'Suspended';
  if (t?.reason) return `Rejected: ${t.reason}`;
  if (t?.title) return `${t.type}: ${t.title}`;
  if (t?.warning) return `Warning: ${t.warning}`;
  if (t?.message) return `Message: “${t.message}”${t.removedBecause ? ` (${t.removedBecause})` : ''}`;
  if (t?.reportCategory) return `${t.reportCategory.replace(/_/g, ' ')} report${t.decidedWith ? ` · ${t.decidedWith}` : ''}`;
  return null;
}

export function AppealsPage({ me, openUser }: { me: Session; openUser?: (id: string) => void }) {
  const [view, setView] = useState<View>('open');
  const first = useLoad(() => get<{ items: Appeal[]; nextCursor: string | null }>(`/v1/admin/appeals?state=${view}`), [view], 6000);
  const more = useMore(first.data, (c) => get(`/v1/admin/appeals?state=${view}&cursor=${c}`), view);
  const reload = () => (more.reset(), first.reload());
  const act = useAction(reload);
  const items = more.items;

  const decide = async (a: Appeal, decision: 'uphold' | 'reject') => {
    const note = await askText(decision === 'uphold' ? 'Accept appeal' : 'Reject appeal', { label: 'Note (shown to the person)', confirm: decision === 'uphold' ? 'Accept' : 'Reject' });
    if (note) act.run(() => post(`/v1/admin/appeals/${a.id}/decision`, { decision, note }));
  };
  const canDecide = (a: Appeal) => (a.kind === 'verification' ? can.trust(me.role) : can.moderate(me.role));

  return (
    <Page fill title="Appeals">
      <div className="toolbar">
        <Segmented
          label="Appeals"
          value={view}
          onChange={setView}
          options={[
            { id: 'open', label: 'Waiting', count: view === 'open' ? items.length : undefined },
            { id: 'upheld', label: 'Accepted' },
            { id: 'rejected', label: 'Rejected' },
          ]}
        />
      </div>
      <ErrorBanner message={first.error ?? act.error} />
      {first.loading && !first.data && <Loading rows={5} />}
      {first.data && items.length === 0 && <Empty>No appeals.</Empty>}
      {items.length > 0 && (
        <div className="scroll-card">
          <div className="list-scroll">
            <ul className="rows">
              {items.map((a) => {
                const name = a.user.displayName ?? a.user.email;
                const what = about(a);
                return (
                  <li key={a.id} className="stacked">
                    <div className="row between">
                      <div className="person">
                        <Avatar name={name} size="sm" />
                        <span style={{ minWidth: 0 }}>
                          <button className="link" onClick={() => openUser?.(a.user.id)}>
                            {name}
                          </button>
                          <span className="sub" style={{ display: 'block' }}>
                            {a.what} · {fmt(a.createdAt)}
                          </span>
                        </span>
                      </div>
                      <Chip value={STATE[a.state] ?? a.state} tone={TONE[a.state] ?? 'plain'} />
                    </div>
                    {what && <span className="small muted">{what}</span>}
                    <p className="quote">{a.message}</p>
                    <ProofImages ids={a.proofs} />
                    {a.decision && <span className="small muted">Decision: {a.decision}</span>}
                    {a.state === 'open' && canDecide(a) && (
                      <div className="actions-bar">
                        <button className="btn small primary" onClick={() => decide(a, 'uphold')} disabled={act.busy}>
                          Accept
                        </button>
                        <button className="btn small" onClick={() => decide(a, 'reject')} disabled={act.busy}>
                          Reject
                        </button>
                      </div>
                    )}
                    {a.state === 'open' && !canDecide(a) && <Chip value="Admin decides" tone="line" />}
                  </li>
                );
              })}
            </ul>
            {more.hasMore && <div style={{ padding: 12 }}>{more.more}</div>}
          </div>
        </div>
      )}
    </Page>
  );
}
