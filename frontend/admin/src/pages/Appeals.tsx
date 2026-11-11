import { useEffect, useState } from 'react';
import { can, get, post, type Session } from '../api';
import { askText, Avatar, Chip, Empty, ErrorBanner, fmt, Icon, Loading, Page, PageBar, ProofImages, Segmented, useAction, useLoad, type Tone } from '../ui';

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
  thread?: { id: string; fromStaff: boolean; body: string; createdAt: string }[];
  user: { id: string; email: string; displayName: string | null; state: string; eligibility: string };
  target: {
    reason?: string | null;
    method?: string | null;
    type?: string | null;
    title?: string | null;
    suspendedUntil?: string | null;
    reportCategory?: string;
    reportAbout?: string;
    decidedWith?: string | null;
    reportDetails?: string | null;
    reportStatus?: string;
    reportedAt?: string;
    reportDecidedAt?: string | null;
    warning?: string;
    at?: string;
    message?: string;
    removedBecause?: string | null;
  } | null;
};
type View = 'open' | 'upheld' | 'rejected';
const TONE: Record<string, Tone> = { open: 'line', upheld: 'ok', rejected: 'plain' };
const STATE: Record<string, string> = { open: 'Waiting', upheld: 'Accepted', rejected: 'Rejected' };
const KIND: Record<string, string> = {
  verification: 'ID check was rejected',
  suspension: 'Account was suspended',
  removal: 'Their plan was removed',
  report: 'A report about them was acted on',
  warning: 'They were sent a warning',
  message: 'Their message was hidden',
};
const REPORT_STATUS: Record<string, string> = { open: 'Waiting', in_review: 'Waiting', resolved: 'Action taken', dismissed: 'No action needed' };
const plain = (v?: string | null) => (v ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** What the appeal is about, as short labelled lines. */
function lines(a: Appeal): [string, string][] {
  const t = a.target;
  if (!t) return [];
  const out: [string, string | null | undefined][] = [];
  if (a.kind === 'suspension') out.push(['Suspended', t.suspendedUntil ? `until ${fmt(t.suspendedUntil)}` : 'with no end date']);
  if (a.kind === 'verification') out.push(['Why the ID check failed', t.reason], ['How they were checked', t.method ? plain(t.method) : null]);
  if (a.kind === 'removal') out.push(['Plan removed', [t.type ? plain(t.type) : '', t.title].filter(Boolean).join(': ')]);
  if (a.kind === 'warning') out.push(['Warning they got', t.warning], ['Sent', t.at ? fmt(t.at) : null]);
  if (a.kind === 'message') out.push(['Their message', t.message ? `“${t.message}”` : null], ['Why it was hidden', t.removedBecause]);
  if (a.kind === 'report') {
    out.push(['Report was about', t.reportCategory ? plain(t.reportCategory) : null], ['What the reporter wrote', t.reportDetails], ['Report filed', t.reportedAt ? fmt(t.reportedAt) : null], ['Report outcome', t.reportStatus ? (REPORT_STATUS[t.reportStatus] ?? t.reportStatus) : null], ['Reason given by staff', t.decidedWith]);
  }
  return out.filter((x): x is [string, string] => !!x[1]);
}

export function AppealsPage({ me, openUser }: { me: Session; openUser?: (id: string, from?: string) => void }) {
  const [view, setView] = useState<View>('open');
  const [pageNo, setPageNo] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [pane, setPane] = useState<'list' | 'detail'>('list');
  useEffect(() => {
    setPageNo(1);
    setSel(null);
    setPane('list');
  }, [view]);
  const first = useLoad(() => get<{ items: Appeal[]; page?: number; pages?: number; total?: number }>(`/v1/admin/appeals?page=${pageNo}&limit=20&state=${view}`), [view, pageNo], 6000);
  const act = useAction(first.reload);
  const items = first.data?.items ?? [];
  const selected = items.find((a) => a.id === sel) ?? items[0] ?? null;
  // the appeal on screen was just decided and left this list: back to the list
  useEffect(() => {
    if (pane === 'detail' && first.data && sel && !items.some((a) => a.id === sel)) {
      setPane('list');
      setSel(null);
    }
  }, [pane, first.data, sel, items]);

  const decide = async (a: Appeal, decision: 'uphold' | 'reject') => {
    const note = await askText(decision === 'uphold' ? 'Accept appeal' : 'Reject appeal', { label: 'Note (shown to the person)', confirm: decision === 'uphold' ? 'Accept' : 'Reject' });
    if (note) act.run(() => post(`/v1/admin/appeals/${a.id}/decision`, { decision, note }));
  };
  const reply = async (a: Appeal) => {
    const message = await askText(`Reply to ${a.user.displayName ?? a.user.email}`, { label: 'Your message (they will be told)', confirm: 'Send reply' });
    if (message) act.run(() => post(`/v1/admin/appeals/${a.id}/reply`, { message }));
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
            { id: 'open', label: 'Waiting' },
            { id: 'upheld', label: 'Accepted' },
            { id: 'rejected', label: 'Rejected' },
          ]}
        />
      </div>
      <ErrorBanner message={first.error ?? act.error} onRetry={first.reload} />
      {first.loading && !first.data && <Loading rows={5} />}
      {first.data && items.length === 0 && <Empty>No appeals.</Empty>}
      {items.length > 0 && (
        <div className="split" data-pane={pane}>
          <section className="split-list" aria-label="Appeals">
            <div className="list-scroll">
              <ul className="items">
                {items.map((a) => {
                  const name = a.user.displayName ?? a.user.email;
                  return (
                    <li key={a.id}>
                      <button className={a.id === selected?.id ? 'list-item active' : 'list-item'} aria-current={a.id === selected?.id} onClick={() => (setSel(a.id), setPane('detail'))}>
                        <span className="body">
                          <span className="title">{name}</span>
                          <span className="meta">
                            {KIND[a.kind] ?? a.what} · {fmt(a.createdAt)}
                          </span>
                        </span>
                        <span className="aside">
                          <Chip value={STATE[a.state] ?? a.state} tone={TONE[a.state] ?? 'plain'} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <PageBar page={first.data?.page ?? 1} pages={first.data?.pages ?? 1} total={first.data?.total ?? items.length} noun={['appeal', 'appeals']} onPage={setPageNo} busy={first.loading} />
          </section>
          <section className="split-detail" aria-label="Appeal">
            <button type="button" className="btn small split-back" onClick={() => (setPane('list'), setSel(null))}>
              <Icon name="back" />
              All appeals
            </button>
            {selected && (
              <div className="detail-scroll" key={selected.id}>
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row wrap">
                    <Chip value={STATE[selected.state] ?? selected.state} tone={TONE[selected.state] ?? 'plain'} />
                    <Chip value={KIND[selected.kind] ?? selected.what} tone="plain" />
                  </div>
                  <div className="person">
                    <Avatar name={selected.user.displayName ?? selected.user.email} />
                    <span style={{ minWidth: 0 }}>
                      <button className="link" onClick={() => openUser?.(selected.user.id, 'appeals')}>
                        {selected.user.displayName ?? selected.user.email}
                      </button>
                      <span className="sub" style={{ display: 'block' }}>
                        {selected.user.email} · account {selected.user.state}
                      </span>
                    </span>
                  </div>
                  <p className="small muted">
                    Sent {fmt(selected.createdAt)}
                    {selected.decidedAt ? ` · decided ${fmt(selected.decidedAt)}` : ''}
                  </p>
                </div>

                <div className="box">
                  <span className="label">What they say</span>
                  <p className="quote">{selected.message}</p>
                  <ProofImages ids={selected.proofs} />
                </div>

                {lines(selected).length > 0 && (
                  <div className="box">
                    <span className="label">What happened before</span>
                    <dl className="facts" style={{ marginTop: 8 }}>
                      {lines(selected).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {(selected.thread?.length ?? 0) > 0 && (
                  <div className="box">
                    <span className="label">Messages</span>
                    <ul className="timeline" style={{ marginTop: 8 }}>
                      {selected.thread!.map((m) => (
                        <li key={m.id}>
                          <span className="muted">{fmt(m.createdAt)}</span>
                          <span>
                            <b>{m.fromStaff ? 'You' : selected.user.displayName ?? 'They'}:</b> {m.body}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <span className="small muted">{selected.thread![selected.thread!.length - 1].fromStaff ? 'Waiting for their answer.' : 'They answered. You can reply again or decide.'}</span>
                  </div>
                )}

                {selected.decision && (
                  <div className="box">
                    <span className="label">Our decision</span>
                    <p>{selected.decision}</p>
                  </div>
                )}

                {selected.state === 'open' && canDecide(selected) && (
                  <div className="actions-bar" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                    <button className="btn" onClick={() => reply(selected)} disabled={act.busy}>
                      Reply
                    </button>
                    <span style={{ flex: 1 }} />
                    <button className="btn primary" onClick={() => decide(selected, 'uphold')} disabled={act.busy}>
                      Accept appeal
                    </button>
                    <button className="btn" onClick={() => decide(selected, 'reject')} disabled={act.busy}>
                      Reject appeal
                    </button>
                  </div>
                )}
                {selected.state === 'open' && !canDecide(selected) && <Chip value="Only an admin can decide" tone="line" />}
              </div>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
