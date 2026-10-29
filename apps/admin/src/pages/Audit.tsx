import { Fragment, useState } from 'react';
import { get } from '../api';
import { Chip, Empty, ErrorBanner, Icon, Page, shortId, useLoad, useMore, type IconName } from '../ui';

type E = { id: string; actorId: string | null; actorName?: string | null; actorRole?: string | null; objectName?: string | null; action: string; objectType: string; objectId: string; metadata: unknown; createdAt: string };

const STEP = 50;
const cap = (s: string) => s.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

/** "activity.cancel" becomes a plain label and colour, so the log reads at a glance. */
export function actionLabel(action: string): { text: string; tone: 'ok' | 'warn' | 'bad' | 'info'; icon: IconName } {
  const verb = action.split('.').pop() ?? action;
  if (/cancel|remove/.test(verb)) return { text: 'Cancelled', tone: 'bad', icon: 'x' };
  if (/suspend/.test(verb)) return { text: 'Suspended', tone: 'bad', icon: 'x' };
  if (/reject|decline/.test(verb)) return { text: 'Rejected', tone: 'bad', icon: 'x' };
  if (/dismiss/.test(verb)) return { text: 'Dismissed', tone: 'bad', icon: 'x' };
  if (/approve/.test(verb)) return { text: 'Approved', tone: 'ok', icon: 'check' };
  if (/verif/.test(verb)) return { text: 'Verified', tone: 'ok', icon: 'check' };
  if (/resolve/.test(verb)) return { text: 'Resolved', tone: 'ok', icon: 'check' };
  if (/restore/.test(verb)) return { text: 'Restored', tone: 'ok', icon: 'check' };
  return { text: cap(verb), tone: 'info', icon: 'clock' };
}

const dayTitle = (iso: string) => {
  const d = new Date(iso);
  const long = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (d.toDateString() === new Date().toDateString()) return `Today · ${long}`;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return `Yesterday · ${long}`;
  return long;
};

export function AuditPage({ openReport }: { openReport?: (id: string) => void }) {
  const [objectType, setObjectType] = useState('');
  const [objectId, setObjectId] = useState('');
  const [applied, setApplied] = useState({ objectType: '', objectId: '' });
  const [open, setOpen] = useState<string | null>(null);
  const query = new URLSearchParams({ limit: String(STEP), ...(applied.objectType && { objectType: applied.objectType }), ...(applied.objectId && { objectId: applied.objectId }) });
  const first = useLoad(() => get<{ items: E[]; nextCursor: string | null }>(`/v1/admin/audit?${query}`), [applied]);
  const more = useMore(first.data, (c) => get(`/v1/admin/audit?${query}&cursor=${c}`), `${applied.objectType}|${applied.objectId}`);
  const { error, loading } = first;
  const data = first.data && { items: more.items };
  const reload = () => (more.reset(), first.reload());

  const items = more.items;
  const days: { key: string; title: string; rows: E[] }[] = [];
  for (const e of items) {
    const key = new Date(e.createdAt).toDateString();
    const last = days[days.length - 1];
    if (last?.key === key) last.rows.push(e);
    else days.push({ key, title: dayTitle(e.createdAt), rows: [e] });
  }

  return (
    <Page title="Audit log" sub="Read-only history of admin, moderation and membership decisions. Newest first, 50 at a time.">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ objectType, objectId: objectId.trim() });
        }}
      >
        <label>
          <span className="sr">Object type</span>
          <select value={objectType} onChange={(e) => setObjectType(e.target.value)}>
            <option value="">All object types</option>
            {['user', 'activity', 'activity_request', 'trip', 'trip_application', 'report'].map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="search grow">
          <span className="sr">Object or actor ID</span>
          <Icon name="search" />
          <input className="mono" placeholder="Object or actor ID" value={objectId} onChange={(e) => setObjectId(e.target.value)} />
        </label>
        <button className="btn primary">Apply filters</button>
        <button type="button" className="icon-btn" onClick={reload} disabled={loading} aria-label="Refresh" title="Refresh">
          <Icon name="refresh" />
        </button>
      </form>
      <ErrorBanner message={error} />
      {data?.items.length === 0 && <Empty>No events.</Empty>}
      {days.map((d) => (
        <div className="table-wrap" key={d.key} style={{ marginBottom: 16 }}>
          <div className="day">
            <span>{d.title}</span>
            <span>{d.rows.length} events shown</span>
          </div>
          <div className="audit-row audit-head" aria-hidden="true">
            <span>Time</span>
            <span>Action</span>
            <span>Object</span>
            <span>Actor</span>
            <span />
          </div>
          {d.rows.map((e) => {
            const l = actionLabel(e.action);
            const isOpen = open === e.id;
            return (
              <Fragment key={e.id}>
                <div className="audit-row">
                  <span>{new Date(e.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}</span>
                  <span className="act">
                    <Chip value={l.text} tone={l.tone} icon={l.icon} />
                    <span className="mono">{e.action}</span>
                  </span>
                  <span className="obj">
                    <b>{e.objectName ? `${cap(e.objectType)} · ${e.objectName}` : cap(e.objectType)}</b>
                    <span className="mono" title={e.objectId}>
                      {shortId(e.objectId)}
                    </span>
                    {e.objectType === 'report' && openReport && (
                      <button className="link small" style={{ display: 'block', marginTop: 4 }} onClick={() => openReport(e.objectId)}>
                        Open report →
                      </button>
                    )}
                  </span>
                  <span className="who2">
                    <span className="avatar sm" aria-hidden="true">
                      <Icon name="users" />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <b style={{ display: 'block', fontSize: '0.9rem' }}>{e.actorName ?? (e.actorId ? 'Unknown user' : 'System')}</b>
                      <span className="small muted" style={{ display: 'block' }}>
                        {e.actorRole === 'user' ? 'Member' : e.actorRole ? e.actorRole.replace('_', ' ').replace(/^./, (x) => x.toUpperCase()) + ' (staff)' : 'Automatic'}
                      </span>
                      <span className="mono small muted" title={e.actorId ?? 'system'}>
                        {shortId(e.actorId)}
                      </span>
                    </span>
                  </span>
                  <button className="icon-btn" aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} onClick={() => setOpen(isOpen ? null : e.id)}>
                    <span className={isOpen ? 'rotate' : ''} style={{ display: 'grid' }}>
                      <Icon name="chevron" />
                    </span>
                  </button>
                </div>
                {isOpen && (
                  <div className="audit-meta">
                    <pre>{JSON.stringify({ object: e.objectId, actor: e.actorId, ...(e.actorName ? { actorName: e.actorName, actorRole: e.actorRole } : {}), ...(e.metadata ? { details: e.metadata } : {}) }, null, 2)}</pre>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      ))}
      {more.more}
    </Page>
  );
}
