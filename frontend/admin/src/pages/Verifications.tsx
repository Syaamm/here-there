import { useEffect, useRef, useState } from 'react';
import { get, post, type Session } from '../api';
import { askChoiceText, askConfirm, Avatar, Chip, ErrorBanner, FilterBar, fmt, Loading, Page, PageBar, Search, Segmented, useAction, useLoad } from '../ui';

type V = { id: string; provider?: string | null; method?: string | null; providerRef: string | null; eligibility: string; createdAt: string; user: { id: string; email: string; displayName?: string; homeCity?: string } };
type Status = 'pending' | 'verified' | 'rejected' | 'unverified';
type Row = { name: string; email: string; city: string; verified: boolean; identityCheck: string; accountState: string; joined: string; verifiedUntil: string | null };
const WORD: Record<string, string> = { verified: 'Verified', rejected: 'Rejected', unverified: 'Not verified', pending: 'Waiting', expired: 'Expired', reverification_required: 'Re-check needed' };

/** A spreadsheet file Excel opens (comma separated, with the mark Excel needs to read accents correctly). */
function download(rows: Row[], name: string) {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  const head = ['Name', 'Email', 'City', 'ID verified', 'ID check', 'Account', 'Joined', 'Verified until'];
  const body = rows.map((r) => [r.name, r.email, r.city, r.verified ? 'Yes' : 'No', WORD[r.identityCheck] ?? r.identityCheck, r.accountState, day(r.joined), day(r.verifiedUntil)].map(cell).join(','));
  const url = URL.createObjectURL(new Blob(['﻿' + [head.map(cell).join(','), ...body].join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Waiting: applications for Manual Review, which the admin approves or rejects here. A check run by an identity provider (Persona, Veriff,
// iDenfy) is decided by the provider, so it only shows as waiting. The other tabs are a record.
export function VerificationsPage({ me: _me }: { me: Session }) {
  const [status, setStatus] = useState<Status>('pending');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const [pageNo, setPageNo] = useState(1);
  useEffect(() => setPageNo(1), [status, term]);
  const list = useLoad(() => get<{ items: V[]; page?: number; pages?: number; total?: number }>(`/v1/admin/verifications?status=${status}&page=${pageNo}&pageSize=20${term ? `&q=${encodeURIComponent(term)}` : ''}`), [status, pageNo, term], 6000);
  const file = useAction(() => {});
  const decide = useAction(list.reload);
  const approve = async (v: V) => {
    if (await askConfirm(`Approve ${v.user.displayName ?? v.user.email}?`, 'This confirms they are 18 or older and that their ID is genuine.', 'Approve')) decide.run(() => post(`/v1/admin/verifications/${v.id}/decision`, { decision: 'verified' }));
  };
  const reject = async (v: V) => {
    const r = await askChoiceText(`Reject ${v.user.displayName ?? v.user.email}?`, [['document', 'Problem with the ID'], ['liveness', 'Photo or selfie problem'], ['underage', 'Under 18'], ['other', 'Other']], { confirm: 'Reject', choiceLabel: 'Reason', label: 'Note (optional)', required: false });
    if (r) decide.run(() => post(`/v1/admin/verifications/${v.id}/decision`, { decision: 'rejected', reason: r.choice }));
  };
  const menu = useRef<HTMLDetailsElement>(null);
  const save = (which: 'all' | 'verified' | 'unverified') =>
    file.run(async () => {
      if (menu.current) menu.current.open = false;
      const r = await get<{ items: Row[] }>(`/v1/admin/verifications/export?status=${which}`);
      download(r.items, `people-${which}-${new Date().toISOString().slice(0, 10)}.csv`);
    });
  const items = list.data?.items ?? [];

  return (
    <Page
      fill
      title="Verification"
      actions={
        <details className="dl-menu" ref={menu}>
          <summary className="btn primary">{file.busy ? 'Preparing…' : 'Download spreadsheet'}</summary>
          <div className="dl-list">
            <button type="button" disabled={file.busy} onClick={() => save('verified')}>Verified people</button>
            <button type="button" disabled={file.busy} onClick={() => save('unverified')}>Not verified people</button>
            <button type="button" disabled={file.busy} onClick={() => save('all')}>Everyone</button>
          </div>
        </details>
      }
    >
      <FilterBar search={<Search label="Search people" onEnter={() => setTerm(q.trim())} placeholder="Search by name or email" value={q} onChange={setQ} />}>
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { id: 'pending', label: 'Waiting' },
            { id: 'verified', label: 'Verified' },
            { id: 'unverified', label: 'Not verified' },
            { id: 'rejected', label: 'Rejected' },
          ]}
        />
      </FilterBar>
      <ErrorBanner message={list.error ?? file.error ?? decide.error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading rows={5} />}
      {list.data && (
        <div className="scroll-card">
          <div className="list-scroll">
            {items.length === 0 ? (
              <div className="state">{term ? `No one matches “${term}”.` : status === 'pending' ? 'No one is waiting for verification.' : 'Nothing here.'}</div>
            ) : (
              <ul className="rows">
                {items.map((v) => (
                  <li key={v.id}>
                    <Avatar name={v.user.displayName ?? v.user.email} />
                    <div className="grow person" style={{ display: 'grid', gap: 2 }}>
                      <span className="name">{v.user.displayName ?? '(no name)'}</span>
                      <span className="sub">
                        {v.user.email}
                        {v.user.homeCity && ` · ${v.user.homeCity}`}
                      </span>
                    </div>
                    {v.providerRef && v.method === 'document' && <Chip value="Document" tone="plain" />}
                    <span className="small muted nowrap" title={fmt(v.createdAt)}>
                      {v.eligibility === 'pending' ? 'Applied' : 'Joined'}{' '}
                      {fmt(v.createdAt)}
                    </span>
                    {v.eligibility === 'pending' && v.provider === 'manual' ? (
                      <span className="row" style={{ gap: 8 }}>
                        <button className="btn small primary" disabled={decide.busy} onClick={() => approve(v)}>
                          Approve
                        </button>
                        <button className="btn small danger" disabled={decide.busy} onClick={() => reject(v)}>
                          Reject
                        </button>
                      </span>
                    ) : (
                      <Chip value={v.eligibility === 'pending' ? 'Waiting for provider' : (WORD[v.eligibility] ?? v.eligibility)} tone={v.eligibility === 'verified' ? 'ok' : v.eligibility === 'pending' ? 'line' : v.eligibility === 'rejected' ? 'bad' : 'plain'} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <PageBar page={list.data.page ?? 1} pages={list.data.pages ?? 1} total={list.data.total ?? items.length} noun={['person', 'people']} onPage={setPageNo} busy={list.loading} />
        </div>
      )}
    </Page>
  );
}
