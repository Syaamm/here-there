import { useMemo, useState } from 'react';
import './Audit.css';
import { DayCard, DayLog } from '../DayLog';
import { get, PERMISSIONS, roleLabel } from '../api';
import { Select } from '../controls';
import { Empty, ErrorBanner, Icon, Loading, Page, Search, Segmented, useLoad, type IconName, type Tone } from '../ui';

type Meta = Record<string, unknown> | null;
type E = { id: string; actorId: string | null; actorName?: string | null; actorRole?: string | null; objectName?: string | null; objectRole?: string | null; action: string; objectType: string; objectId: string; metadata: unknown; createdAt: string };
type Reply = { items: E[]; nextCursor: string | null; names?: Record<string, string> };

const STEP = 200;
const cap = (s: string) => s.replace(/[_.]/g, ' ').replace(/^./, (x) => x.toUpperCase());

/** "activity.cancel" as a short label and tone (for other pages that want it). */
export function actionLabel(action: string): { text: string; tone: Tone; icon: IconName } {
  const verb = action.split('.').pop() ?? action;
  if (/cancel|remove/.test(verb)) return { text: 'Cancelled', tone: 'dark', icon: 'x' };
  if (/suspend/.test(verb)) return { text: 'Suspended', tone: 'dark', icon: 'x' };
  if (/reject|decline/.test(verb)) return { text: 'Rejected', tone: 'dark', icon: 'x' };
  if (/dismiss/.test(verb)) return { text: 'Dismissed', tone: 'plain', icon: 'x' };
  if (/approve/.test(verb)) return { text: 'Approved', tone: 'ok', icon: 'check' };
  if (/verif/.test(verb)) return { text: 'Verified', tone: 'ok', icon: 'check' };
  if (/resolve/.test(verb)) return { text: 'Resolved', tone: 'ok', icon: 'check' };
  if (/restore/.test(verb)) return { text: 'Restored', tone: 'ok', icon: 'check' };
  return { text: cap(verb), tone: 'plain', icon: 'clock' };
}

// ---------------------------------------------------------------- groups (filter pills and dot colours)
type Kind = 'moderation' | 'accounts' | 'security' | 'signins' | 'other';
const FILTERS: { id: '' | Kind; label: string }[] = [
  { id: '', label: 'Everything' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'security', label: 'Security' },
  { id: 'signins', label: 'Sign-ins' },
];
// ---------------------------------------------------------------- how far back (the viewer's own days)
type When = 'today' | '7d' | 'month' | 'all';
const WHEN: { id: When; label: string; none: string }[] = [
  { id: 'today', label: 'Today', none: 'Nothing today yet.' },
  { id: '7d', label: 'Last 7 days', none: 'Nothing in the last 7 days.' },
  { id: 'month', label: 'This month', none: 'Nothing this month.' },
  { id: 'all', label: 'Everything', none: 'Nothing yet.' },
];
/** The local midnight a range starts at, as an ISO time for the server (none for Everything). */
function since(when: When): string | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (when === '7d') d.setDate(d.getDate() - 6);
  else if (when === 'month') d.setDate(1);
  else if (when === 'all') return null;
  return d.toISOString();
}

function kindOf(action: string): Kind {
  if (/^session\.|^login\.(?!lockout)|^social\./.test(action)) return 'signins';
  if (/^mfa\.|^password\.|^login\.lockout/.test(action)) return 'security';
  if (/^account\.|^email\.|^phone\.|^staff\.|^user\.role_change|^region\.|^draft\./.test(action)) return 'accounts';
  if (/^report\.|^user\.(warn|suspend|restore)|^message\.|^appeal\.|^attendance\.|^verification\.|^warning|^activity\.(remove|member_removed)|^trip\.(remove|member_removed)/.test(action)) return 'moderation';
  return 'other';
}

// ---------------------------------------------------------------- an entry as a sentence
/** A sentence is a list of pieces; names are bold. Kept as data so the same words are searched and exported. */
type Piece = string | { b: string };
type Said = { parts: Piece[]; facts: string[] };
const plain = (s: Said) => s.parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');

const permLabel = (p: unknown) => PERMISSIONS.find((x) => x.id === p)?.label ?? cap(String(p));
const list = (v: unknown) => (Array.isArray(v) ? v.map(permLabel).join(', ') || 'none' : '');
const months = (n: unknown) => (n == null ? 'inherited' : `${n} ${n === 1 ? 'month' : 'months'}`);
const day = (v: unknown) => (typeof v === 'string' && !isNaN(+new Date(v)) ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const words = (v: unknown) => (typeof v === 'string' && v ? cap(v) : '');

function say(e: E, names: Record<string, string>): Said {
  const m = (e.metadata && typeof e.metadata === 'object' ? e.metadata : null) as Meta;
  const str = (k: string) => (typeof m?.[k] === 'string' ? (m[k] as string) : '');
  const name = (id: unknown, fallback = 'someone') => (typeof id === 'string' && names[id]) || fallback;
  const who: Piece = { b: e.actorName ?? (e.actorId ? 'Someone' : 'The system') };
  const self = !!e.actorId && e.actorId === e.objectId;
  const obj: Piece = { b: e.objectName ?? (e.objectType === 'user' ? 'a member' : e.objectType === 'report' ? 'something' : ((t) => `${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}`)(e.objectType.replace(/_/g, ' '))) };
  const facts: string[] = [];
  const reason = str('reason') || str('note') || str('resolution');
  const add = (label: string, v: string) => v && facts.push(`${label}: ${v}`);
  const s = (...parts: Piece[]): Said => ({ parts, facts });
  const byWho = (rest: Piece[]) => s(who, ' ', ...rest);

  switch (e.action) {
    // sign-ins and security
    case 'session.login': return byWho(['signed in']);
    case 'session.logout': return byWho(['signed out']);
    case 'session.logout_all': return byWho(['signed out on every device']);
    case 'login.lockout': return s(self || !e.actorId ? obj : who, ' was locked out after too many wrong passwords');
    case 'social.linked': return byWho([`linked their ${words(m?.provider) || 'social'} account`]);
    case 'social.registered': return byWho([`signed up with ${words(m?.provider) || 'a social account'}`]);
    case 'mfa.enabled': return byWho(['turned on two-step sign-in']);
    case 'mfa.disabled': return byWho(['turned off two-step sign-in']);
    case 'mfa.skipped': return byWho(['put off two-step sign-in']);
    case 'mfa.failed': return byWho(['entered a wrong two-step code']);
    case 'mfa.recovery_used': return byWho(['used a recovery code']);
    case 'mfa.reset_by_admin': add('Reason', reason); return byWho(['reset two-step sign-in for ', obj]);
    case 'password.changed': return byWho(['changed their password']);
    case 'password.reset': return byWho(['reset their password']);
    case 'password.reset_requested': return s(obj, ' asked to reset their password');
    // accounts
    case 'account.exported': return byWho(['downloaded their data']);
    case 'account.deleted': return byWho(['deleted their account']);
    case 'email.changed': return byWho(['changed their email address']);
    case 'email.verified': return s(self || !e.actorId ? obj : who, ' confirmed their email address');
    case 'phone.verified': return s(self || !e.actorId ? obj : who, ' confirmed their phone number');
    case 'phone.removed': return byWho(['removed their phone number']);
    case 'phone.duplicate_cleared': return s('The phone number of ', obj, ' was cleared (another account confirmed it)');
    case 'staff.create':
      add('Area', name(m?.regionKey, ''));
      add('Can use', list(m?.permissions));
      return byWho(['added ', obj, ' as staff']);
    case 'staff.update': {
      const before = (m?.before ?? {}) as Record<string, unknown>;
      const after = (m?.after ?? {}) as Record<string, unknown>;
      const changed: string[] = [];
      if (after.adminRegionKey !== undefined && after.adminRegionKey !== before.regionKey) {
        changed.push('area');
        add('Area', `${name(before.regionKey, 'none')} → ${name(after.adminRegionKey, 'none')}`);
      }
      if (Array.isArray(after.staffPermissions)) {
        const was = Array.isArray(before.permissions) ? (before.permissions as string[]) : [];
        const now = after.staffPermissions as string[];
        const plus = now.filter((p) => !was.includes(p));
        const minus = was.filter((p) => !now.includes(p));
        if (plus.length || minus.length) changed.push('permissions');
        if (plus.length) add('Added', list(plus));
        if (minus.length) add('Removed', list(minus));
      }
      return byWho([`changed the ${changed.join(' and ') || 'settings'} of `, obj]);
    }
    case 'user.role_change':
      if (m?.regionKey) add('Area', name(m.regionKey, ''));
      if (Array.isArray(m?.permissions) && m.role === 'staff') add('Can use', list(m.permissions));
      return byWho(['made ', obj, ` ${m?.role === 'user' ? 'a member' : m?.role === 'admin' ? 'an admin' : roleLabel(String(m?.role ?? '')).toLowerCase()}`]);
    // moderation: people
    case 'user.warn':
    case 'user.warned': add('Reason', reason); return byWho(['warned ', obj]);
    case 'user.suspend':
      add('Reason', reason);
      facts.push(m?.days ? `For ${m.days} ${m.days === 1 ? 'day' : 'days'}` : 'Until restored');
      return byWho(['suspended ', obj]);
    case 'user.restore': add('Reason', reason); return byWho(['restored ', obj]);
    case 'attendance.host_flagged':
      if (Array.isArray(m?.reasons)) facts.push(...(m.reasons as string[]).map((r) => cap(r)));
      return s(obj, ' was flagged for marking many people as no-shows');
    // moderation: reports and messages
    case 'report.assign': return byWho(['took the report about ', obj]);
    case 'report.resolved':
    case 'report.dismissed':
      add('Outcome', words(str('resolution')));
      return m?.automatic ? s('The report about ', obj, ` was ${e.action === 'report.dismissed' ? 'dismissed' : 'resolved'} automatically`) : byWho([e.action === 'report.dismissed' ? 'dismissed' : 'resolved', ' the report about ', obj]);
    case 'report.reopened': return byWho(['reopened the report about ', obj]);
    case 'report.urgent_alerted':
      if (typeof m?.staff === 'number') facts.push(`${m.staff} ${m.staff === 1 ? 'person' : 'people'} alerted`);
      return s('Urgent report about ', obj, ': staff were alerted');
    case 'report.escalated':
      return m?.level === 2 ? s('Nobody took the urgent report about ', obj, ' in 2 hours: every admin was alerted') : s('The report about ', obj, ' passed its answer time: staff were told');
    case 'message.removed': add('Reason', reason); return byWho(['hid ', obj]);
    case 'message.restored': return byWho(['put back ', obj]);
    // appeals
    case 'appeal.create': return byWho([`asked for a review of a ${words(m?.kind).toLowerCase() || 'decision'}`]);
    case 'appeal.upheld':
    case 'appeal.accepted':
    case 'appeal.rejected':
      add('Note', str('note'));
      return byWho([e.action === 'appeal.rejected' ? 'rejected ' : 'accepted ', { b: name(m?.userId) }, `'s ${words(m?.kind).toLowerCase() || ''} appeal`.replace("'s  appeal", "'s appeal")]);
    // identity checks
    case 'verification.verified': return byWho(['approved the identity check of ', obj]);
    case 'verification.rejected': add('Reason', words(reason)); return byWho(['rejected the identity check of ', obj]);
    case 'verification.consent_given': return s(self || !e.actorId ? obj : who, ' started an identity check');
    case 'verification.cancelled': return s(self || !e.actorId ? obj : who, ' cancelled their identity check');
    case 'verification.expired': return s('The identity check of ', obj, ' expired');
    case 'verification.reset': add('Note', str('note')); return byWho(['reopened the identity check of ', obj]);
    case 'verification.rejection_overturned': add('Note', str('note')); return byWho(['approved ', obj, ' after a rejected check']);
    case 'verification.reverification_required': add('Reason', words(str('reason'))); add('Note', str('note')); return byWho(['asked ', obj, ' to verify again']);
    case 'verification.underage_detected': return s('The identity check of ', obj, ' showed they are under 18');
    // activities and trips
    case 'activity.create': return byWho(['created ', obj]);
    case 'activity.join_instant': return byWho(['joined ', obj]);
    case 'activity.material_change': return byWho([`changed the ${[m?.venueChanged && 'place', m?.timeChanged && 'time'].filter(Boolean).join(' and ') || 'details'} of `, obj]);
    case 'activity.member_removed': return byWho(['removed ', { b: name(m?.userId) }, ' from ', obj]);
    case 'activity.remove_reason': add('Reason', reason); return byWho(['removed the activity ', obj]);
    case 'activity.handover_offered': return byWho(['offered to hand ', obj, ' over to ', { b: name(m?.userId) }]);
    case 'activity.handover_accepted': return byWho(['took over hosting ', obj]);
    case 'activity.waitlist_promoted': return s({ b: name(m?.applicantId) }, ' moved from the waiting list into ', { b: name(m?.activityId, 'an activity') });
    case 'trip.create': return byWho(['created the trip ', obj]);
    case 'trip.material_change': return byWho(['changed the details of ', obj]);
    case 'trip.member_left': return byWho(['left ', obj]);
    case 'trip.member_removed': return byWho(['removed ', { b: name(m?.userId) }, ' from ', obj]);
    case 'trip.plan_added': return byWho([`added a ${words(m?.kind).toLowerCase() || 'plan item'} to `, obj]);
    case 'trip.poll_created': return byWho(['started a poll in ', obj]);
    case 'trip.dates_proposed': add('Dates', [day(m?.from), day(m?.to)].filter(Boolean).join(' – ')); return byWho(['proposed dates for ', obj]);
    case 'trip.remove_reason': add('Reason', reason); return byWho(['removed the trip ', obj]);
    // travel matching
    case 'match.opt_in': return byWho(['turned on travel matching']);
    case 'match.opt_out': return byWho(['turned off travel matching']);
    case 'match.connected': return s('Two travellers matched');
    case 'match.ended': return byWho(['ended a travel match chat']);
    // places and limits
    case 'region.created': return byWho(['added the place ', { b: str('name') || name(e.objectId, 'a place') }]);
    case 'region.removed': return byWho(['removed the place ', { b: str('name') || name(e.objectId, 'a place') }]);
    case 'region.updated': {
      const b = (m?.before ?? {}) as Record<string, unknown>;
      const a = (m?.after ?? {}) as Record<string, unknown>;
      if ('hereMonths' in a && a.hereMonths !== b.hereMonths) add('HERE', `${months(b.hereMonths)} → ${months(a.hereMonths)}`);
      if ('thereMonths' in a && a.thereMonths !== b.thereMonths) add('THERE', `${months(b.thereMonths)} → ${months(a.thereMonths)}`);
      if (typeof a.name === 'string' && a.name !== b.name) add('Name', `${b.name ?? ''} → ${a.name}`);
      return byWho(['changed the limits of ', { b: name(e.objectId, String(b.name ?? 'a place')) }]);
    }
    case 'retention.purged': return s('Old data was cleared on schedule');
    case 'oncall.shift_added': return byWho(['added an on-call shift (no longer used)']);
    case 'oncall.shift_removed': return byWho(['removed an on-call shift (no longer used)']);
  }
  // requests and applications: activity.request.approved, trip.application.declined, ...
  const req = /^(activity\.request|trip\.application)\.(\w+)$/.exec(e.action);
  if (req) return byWho([`${req[2]} `, { b: name(m?.applicantId) }, req[1] === 'trip.application' ? "'s application to " : "'s request to join ", { b: name(m?.activityId ?? m?.tripId, req[1] === 'trip.application' ? 'a trip' : 'an activity') }]);
  if (/^report\.\w+$/.test(e.action)) { add('Outcome', words(str('resolution'))); return byWho([`${e.action.split('.')[1]} the report about `, obj]); }
  if (/^verification\.\w+$/.test(e.action)) { add('Reason', words(reason)); return byWho([`${cap(e.action.split('.')[1]).toLowerCase()} the identity check of `, obj]); }
  // anything new: the action in words, and what it was about
  add('Reason', reason);
  return byWho([cap(e.action).toLowerCase(), ...(e.objectName && !self ? [' · ', obj] : [])]);
}

const Words = ({ parts }: { parts: Piece[] }) => (
  <>
    {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <b key={i}>{p.b}</b>))}
  </>
);

// ---------------------------------------------------------------- the page
type Row = { first: E; said: Said; n: number };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
const looksLikeId = (s: string) => /^[a-z0-9]{20,}$/i.test(s);

export function AuditPage({ openReport }: { openReport?: (id: string) => void }) {
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<'' | Kind>('');
  const [when, setWhen] = useState<When>('today');
  const from = since(when);
  const [open, setOpen] = useState<string | null>(null);
  // a pasted id still finds its entries on the server; words search what is loaded
  const idSearch = looksLikeId(term.trim()) ? term.trim() : '';
  // a pasted id looks through everything; otherwise the chosen range
  const query = new URLSearchParams({ limit: String(STEP), ...(idSearch ? { objectId: idSearch } : from && { from }) });
  // The whole range at once (page after page), so there is no "Load more": days stack newest first and Expand all opens them all.
  const first = useLoad(async () => {
    const items: E[] = [];
    const names: Record<string, string> = {};
    let cursor: string | null = null;
    do {
      const r: Reply = await get<Reply>(`/v1/admin/audit?${query}${cursor ? `&cursor=${cursor}` : ''}`);
      items.push(...r.items);
      Object.assign(names, r.names ?? {});
      cursor = r.nextCursor;
    } while (cursor);
    return { items, names };
  }, [idSearch, from]);
  const paged = { items: first.data?.items ?? [] };
  const names = first.data?.names ?? {};
  const { error, loading, reload } = first;

  const words = !idSearch ? term.trim().toLowerCase() : '';
  const days = useMemo(() => {
    const out: { key: string; at: string; rows: Row[]; events: number }[] = [];
    for (const e of paged.items) {
      if (kind && kindOf(e.action) !== kind) continue;
      const said = say(e, names);
      if (words && !`${plain(said)} ${said.facts.join(' ')}`.toLowerCase().includes(words)) continue;
      const key = new Date(e.createdAt).toDateString();
      let d = out[out.length - 1];
      if (d?.key !== key) out.push((d = { key, at: e.createdAt, rows: [], events: 0 }));
      d.events++;
      const prev = d.rows[d.rows.length - 1];
      if (prev && prev.first.action === e.action && prev.first.actorId === e.actorId && prev.first.objectId === e.objectId) prev.n++;
      else d.rows.push({ first: e, said, n: 1 });
    }
    return out;
  }, [paged.items, kind, words, names]);
  const shown = days.reduce((n, d) => n + d.events, 0);

  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['time', 'who', 'what happened', 'details'].join(',')].concat(
      paged.items.map((e) => {
        const said = say(e, names);
        return [new Date(e.createdAt).toLocaleString('en-GB'), e.actorName ?? (e.actorId ? 'Someone' : 'The system'), plain(said), said.facts.join('; ')].map(q).join(',');
      }),
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
      title="Audit log"
      actions={
        <>
          <Segmented label="How far back" value={when} onChange={setWhen} options={WHEN.map((w) => ({ id: w.id, label: w.label }))} />
          <button type="button" className="btn" onClick={exportCsv} disabled={paged.items.length === 0}>
            Export CSV
          </button>
        </>
      }
    >
      <div className="toolbar">
        <div className="grow">
          <Search label="Search the audit log" placeholder="Search names or actions" value={term} onChange={setTerm} />
        </div>
        <Select aria-label="What to show" value={kind} onChange={(v) => setKind(v as typeof kind)}>
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <ErrorBanner message={error} onRetry={reload} />
      {loading && !first.data && <Loading rows={6} />}
      {first.data && days.length === 0 && <Empty>{paged.items.length || idSearch ? 'Nothing matches.' : WHEN.find((w) => w.id === when)!.none}</Empty>}
      {days.length > 0 && (
        <DayLog label="Audit log" title={idSearch ? 'Search' : [WHEN.find((w) => w.id === when)!.label, kind && FILTERS.find((f) => f.id === kind)?.label].filter(Boolean).join(' · ')} count={shown}>
          {days.map((d) => (
            <DayCard
              key={d.key}
              id={d.key}
              at={d.at}
              count={d.events}
              unit={['event', 'events']}
              rows={d.rows.map((r) => {
                const e = r.first;
                const isOpen = open === e.id;
                const report = e.objectType === 'report' && openReport;
                const hasMore = r.said.facts.length > 0 || !!report;
                return (
                  <li key={e.id}>
                    <div className="au-row">
                      <span className="au-time">{clock(e.createdAt)}</span>
                      <span className={`au-dot ${kindOf(e.action)}`} aria-hidden="true" />
                      <span className="au-sentence">
                        <Words parts={r.said.parts} />
                        {r.n > 1 && <span className="au-times"> · {r.n === 2 ? 'twice' : `${r.n} times`}</span>}
                      </span>
                      {hasMore ? (
                        <button type="button" className={isOpen ? 'au-chev open' : 'au-chev'} aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} onClick={() => setOpen(isOpen ? null : e.id)}>
                          <Icon name="chevron" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                    {isOpen && (
                      <div className="au-detail">
                        {r.said.facts.map((fact, i) => (
                          <p key={i}>{fact}</p>
                        ))}
                        {report && (
                          <button type="button" className="au-open" onClick={() => openReport(e.objectId)}>
                            Open report →
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            />
          ))}
        </DayLog>
      )}
    </Page>
  );
}

