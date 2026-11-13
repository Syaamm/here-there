import { useEffect, useRef, useState } from 'react';
import { get, type Session } from '../api';
import { Avatar, Chip, ErrorBanner, fmt, Icon, Loading, Page, PageBar, Segmented, useAction, useLoad } from '../ui';

type V = { id: string; method?: string | null; providerRef: string | null; eligibility: string; createdAt: string; user: { id: string; email: string; displayName?: string; homeCity?: string } };
type Status = 'verified' | 'rejected' | 'unverified';
type Row = { name: string; email: string; city: string; verified: boolean; identityCheck: string; accountState: string; joined: string; verifiedUntil: string | null };
const WORD: Record<string, string> = { verified: 'Verified', rejected: 'Rejected', unverified: 'Not verified', pending: 'Waiting', expired: 'Expired' };

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

// the identity provider decides every check, so nothing here is approved by hand: this page is a record
export function VerificationsPage({ me: _me }: { me: Session }) {
  const [status, setStatus] = useState<Status>('verified');
  const [pageNo, setPageNo] = useState(1);
  useEffect(() => setPageNo(1), [status]);
  const list = useLoad(() => get<{ items: V[]; page?: number; pages?: number; total?: number }>(`/v1/admin/verifications?status=${status}&page=${pageNo}&pageSize=20`), [status, pageNo], 6000);
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
  const file = useAction(() => {});
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
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { id: 'verified', label: 'Verified' },
            { id: 'unverified', label: 'Not verified' },
            { id: 'rejected', label: 'Rejected' },
          ]}
        />
      }
    >
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <details className="dl-menu" ref={menu}>
          <summary className="btn small primary">{file.busy ? 'Preparing…' : 'Download spreadsheet'}</summary>
          <div className="dl-list">
            <button type="button" disabled={file.busy} onClick={() => save('verified')}>Verified people</button>
            <button type="button" disabled={file.busy} onClick={() => save('unverified')}>Not verified people</button>
            <button type="button" disabled={file.busy} onClick={() => save('all')}>Everyone</button>
          </div>
        </details>
      </div>
      <ErrorBanner message={list.error ?? file.error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading rows={5} />}
      {list.data && (
        <div className="scroll-card">
          <div className="list-scroll">
            {items.length === 0 ? (
              <div className="state">Nothing here.</div>
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
                    {v.providerRef && (
                      <div className="row" style={{ minWidth: 0 }}>
                        <code className="mono clip" style={{ maxWidth: 180 }}>{v.providerRef}</code>
                        <button type="button" className="icon-btn" aria-label="Copy reference" onClick={() => copy(v.providerRef!)}>
                          <Icon name="copy" />
                        </button>
                        {v.method === 'document' && <Chip value="Document" tone="plain" />}
                      </div>
                    )}
                    <span className="small muted nowrap" title={fmt(v.createdAt)}>
                      Joined{' '}
                      {fmt(v.createdAt)}
                    </span>
                    <Chip value={WORD[v.eligibility] ?? v.eligibility} tone={v.eligibility === 'verified' ? 'ok' : v.eligibility === 'pending' ? 'line' : v.eligibility === 'rejected' ? 'bad' : 'plain'} />
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
