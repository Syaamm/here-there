import { useMemo, useState } from 'react';
import './Audit.css';
import { get } from '../api';
import { Empty, ErrorBanner, Icon, Loading, Page, shortId, useLoad, useMore, type IconName } from '../ui';

type E = { id: string; actorId: string | null; actorName?: string | null; actorRole?: string | null; objectName?: string | null; action: string; objectType: string; objectId: string; metadata: unknown; createdAt: string };

const STEP = 50;
const SHOWN = 6; // rows of a day shown before "Show N more"
const cap = (s: string) => s.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());

/** "activity.cancel" becomes a plain label and colour. Kept for other pages that import it. */
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

type Kind = 'moderation' | 'accounts' | 'security' | 'signins' | 'other';
const FILTERS: { id: '' | Kind; label: string }[] = [
  { id: '', label: 'Everything' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'security', label: 'Security' },
  { id: 'signins', label: 'Sign-ins' },
];
/** Which of the five groups an action belongs to (decides the dot colour and the filter pills). */
function kindOf(action: string): Kind {
  if (/^session\.|^login\.(?!lockout)/.test(action)) return 'signins';
  if (/^mfa\.|^password\.|^login\.lockout/.test(action)) return 'security';
  if (/^account\.|^email\.|^phone\.|^staff\.|^user\.role_change|^draft\./.test(action)) return 'accounts';
  if (/^report\.|^user\.(warn|suspend|restore)|^message\.|^appeal\.|^attendance\.|^verification\.|^warning|^activity\.(cancel|remove)|^trip\.(cancel|remove)/.test(action)) return 'moderation';
  return 'other';
}

/** What happened, in words: [verb, how the thing acted on is named]. */
const VERBS: Record<string, [string, 'none' | 'name' | 'type' | 'a-report']> = {
  'session.logout': ['signed out', 'none'],
  'session.login': ['signed in', 'none'],
  'mfa.enabled': ['turned on two-step sign-in', 'none'],
  'mfa.disabled': ['turned off two-step sign-in', 'none'],
  'mfa.skipped': ['put two-step sign-in off for now', 'none'],
  'mfa.failed': ['typed a wrong two-step code', 'none'],
  'mfa.recovery_used': ['used a recovery code', 'none'],
  'mfa.reset_by_admin': ['reset two-step sign-in for', 'name'],
  'account.exported': ['exported their account data', 'none'],
  'account.deleted': ['deleted their account', 'none'],
  'password.changed': ['changed their password', 'none'],
  'password.reset': ['reset their password', 'none'],
  'email.changed': ['changed their email address', 'none'],
  'login.lockout': ['was locked out after too many sign-in tries', 'none'],
  'report.resolved': ['resolved', 'a-report'],
  'report.dismissed': ['dismissed', 'a-report'],
  'report.assign': ['took', 'a-report'],
  'report.escalated': ['escalated', 'a-report'],
  'user.warned': ['warned', 'name'],
  'user.warn': ['warned', 'name'],
  'user.suspend': ['suspended', 'name'],
  'user.restore': ['restored', 'name'],
  'user.role_change': ['changed the role of', 'name'],
  'staff.create': ['created a staff account for', 'name'],
  'message.removed': ['hid a message from', 'name'],
  'message.restored': ['put a message back for', 'name'],
  'appeal.upheld': ['accepted an appeal from', 'name'],
  'appeal.rejected': ['rejected an appeal from', 'name'],
  'appeal.create': ['asked for a review', 'none'],
  'oncall.shift_added': ['added an on-call shift', 'none'],
  'oncall.shift_removed': ['removed an on-call shift', 'none'],
  'region.created': ['added the place', 'name'],
  'region.updated': ['changed the limits of', 'name'],
  'region.removed': ['removed the place', 'name'],
};
const times = (n: number) => (n === 2 ? 'twice' : `${n} times`);

type Group = { first: E; n: number; ids: string[] };
const who = (e: E) => e.actorName ?? (e.actorId ? 'Someone' : 'System');

function Sentence({ g, openReport }: { g: Group; openReport?: (id: string) => void }) {
  const e = g.first;
  const [verb, how] = VERBS[e.action] ?? [`· ${cap(e.action.replace(/\./g, ' '))}`, 'none'];
  const subject = e.objectName ?? cap(e.objectType);
  return (
    <span className="au-sentence">
      <b>{who(e)}</b> {verb}
      {how === 'name' && (
        <>
          {' '}
          <b>{subject}</b>
        </>
      )}
      {how === 'a-report' && (
        <>
          {' '}
          <b>a report</b>
        </>
      )}
      {how === 'none' && e.objectName && e.objectName !== e.actorName && e.actorId !== e.objectId ? (
        <>
          {' '}
          · <b>{e.objectName}</b>
        </>
      ) : null}
      {g.n > 1 ? <span className="au-times"> · {times(g.n)}</span> : null}
      {e.objectType === 'report' && openReport ? (
        <>
          {' '}
          <button type="button" className="au-open" onClick={() => openReport(e.objectId)}>
            · open report →
          </button>
        </>
      ) : null}
    </span>
  );
}

const dayTitle = (iso: string) => {
  const d = new Date(iso);
  const long = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (d.toDateString() === new Date().toDateString()) return `Today · ${long}`;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return `Yesterday · ${long}`;
  return `${long} ${d.getFullYear()}`;
};

const noteOf = (m: unknown) => {
  if (m == null || m === '') return '–';
  let v: unknown = m;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return v as string;
    }
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const text = o.note ?? o.reason ?? o.resolution ?? o.decision;
    return typeof text === 'string' ? text : JSON.stringify(o);
  }
  return String(v);
};

export function AuditPage({ openReport }: { openReport?: (id: string) => void }) {
  const [term, setTerm] = useState('');
  const [applied, setApplied] = useState('');
  const [kind, setKind] = useState<'' | Kind>('');
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const query = new URLSearchParams({ limit: String(STEP), ...(applied && { objectId: applied }) });
  const first = useLoad(() => get<{ items: E[]; nextCursor: string | null }>(`/v1/admin/audit?${query}`), [applied]);
  const more = useMore(first.data, (c) => get(`/v1/admin/audit?${query}&cursor=${c}`), applied);
  const { error, loading } = first;
  const reload = () => (more.reset(), first.reload());

  const days = useMemo(() => {
    const out: { key: string; title: string; at: string; rows: Group[]; events: number }[] = [];
    for (const e of more.items.filter((x) => !kind || kindOf(x.action) === kind)) {
      const key = new Date(e.createdAt).toDateString();
      let day = out[out.length - 1];
      if (day?.key !== key) out.push((day = { key, title: dayTitle(e.createdAt), at: e.createdAt, rows: [], events: 0 }));
      day.events++;
      const prev = day.rows[day.rows.length - 1];
      if (prev && prev.first.action === e.action && prev.first.actorId === e.actorId && prev.first.objectId === e.objectId) {
        prev.n++;
        prev.ids.push(e.id);
      } else day.rows.push({ first: e, n: 1, ids: [e.id] });
    }
    return out;
  }, [more.items, kind]);

  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['time', 'who', 'role', 'action', 'about type', 'about', 'about id', 'note'].join(',')].concat(
      more.items.map((e) => [e.createdAt, e.actorName ?? e.actorId ?? 'system', e.actorRole ?? '', e.action, e.objectType, e.objectName ?? '', e.objectId, noteOf(e.metadata)].map(q).join(',')),
    );
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page
      fill
      title="Who did what"
      sub="Every staff and moderation decision, newest first. Read-only."
      actions={
        <button type="button" className="au-export" onClick={exportCsv} disabled={more.items.length === 0}>
          Export CSV
        </button>
      }
    >
      <div className="au-tools">
        <form
          className="au-search"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(term.trim());
          }}
        >
          <Icon name="search" />
          <input type="search" placeholder="Person, report or user ID" aria-label="Person, report or user ID" value={term} onChange={(e) => setTerm(e.target.value)} />
        </form>
        <div className="au-filters" role="group" aria-label="What to show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={kind === f.id ? 'au-pill on' : 'au-pill'} aria-pressed={kind === f.id} onClick={() => setKind(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <ErrorBanner message={error} onRetry={reload} />
      {loading && !first.data && <Loading rows={6} />}
      {first.data && days.length === 0 && <Empty title="No events">Nothing matches. Try another filter or search.</Empty>}
      <div className="au-scroll">
      {days.map((d) => {
        const all = expanded.has(d.key);
        const rows = all ? d.rows : d.rows.slice(0, SHOWN);
        return (
          <section key={d.key} className="au-card" aria-label={d.title}>
            <header className="au-date">
              <span className="au-rel">{d.title.includes(' · ') ? d.title.split(' · ')[0] : new Date(d.at).toLocaleDateString('en-GB', { weekday: 'long' })}</span>
              <strong className="au-num">{new Date(d.at).getDate()}</strong>
              <span className="au-mon">{new Date(d.at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
              <span className="au-count">{d.events} {d.events === 1 ? 'event' : 'events'}</span>
            </header>
            <div className="au-body">
            <ul className="au-rows">
              {rows.map((g) => {
                const e = g.first;
                const isOpen = open === e.id;
                return (
                  <li key={e.id}>
                    <div className="au-row">
                      <span className="au-time">{new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}</span>
                      <span className={`au-dot ${kindOf(e.action)}`} aria-hidden="true" />
                      <Sentence g={g} openReport={openReport} />
                      <code className="au-code">
                        {e.action}
                        {g.n > 1 ? ` ×${g.n}` : ''}
                      </code>
                      <button type="button" className={isOpen ? 'au-chev open' : 'au-chev'} aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} onClick={() => setOpen(isOpen ? null : e.id)}>
                        <Icon name="chevron" />
                      </button>
                    </div>
                    {isOpen && (
                      <dl className="au-detail">
                        <div>
                          <dt>Action</dt>
                          <dd>
                            <code>{e.action}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Who</dt>
                          <dd>
                            <b>{who(e)}</b>
                            {e.actorRole ? ` (${e.actorRole === 'user' ? 'member' : 'staff'})` : ''}
                            <span className="au-id"> · {shortId(e.actorId)}</span>
                          </dd>
                        </div>
                        <div>
                          <dt>About</dt>
                          <dd>
                            <b>{e.objectName ?? cap(e.objectType)}</b>
                            <span className="au-id"> · {shortId(e.objectId)}</span>
                          </dd>
                        </div>
                        <div>
                          <dt>Note</dt>
                          <dd>{noteOf(e.metadata)}</dd>
                        </div>
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
            {d.rows.length > SHOWN && (
              <div className="au-more">
                <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); if (all) n.delete(d.key); else n.add(d.key); return n; })}>
                  {all ? 'Show fewer' : `Show ${d.rows.length - SHOWN} more from ${d.title.split(' · ')[0].toLowerCase()}`}
                </button>
              </div>
            )}
            </div>
          </section>
        );
      })}
      {more.more}
      </div>
    </Page>
  );
}
