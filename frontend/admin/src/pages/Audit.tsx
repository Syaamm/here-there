import { Fragment, useEffect, useRef, useState } from 'react';
import './Audit.css';
import { get, PERMISSIONS, roleLabel } from '../api';
import { Select } from '../controls';
import { RangeCalendar } from '../RangeCalendar';
import { Chip, Empty, ErrorBanner, Icon, Loading, Page, PageBar, Search, useLoad, type IconName, type Tone } from '../ui';

type Meta = Record<string, unknown> | null;
export type E = { id: string; actorId: string | null; actorName?: string | null; actorRole?: string | null; objectName?: string | null; objectRole?: string | null; action: string; objectType: string; objectId: string; metadata: unknown; createdAt: string };
type Reply = { items: E[]; nextCursor: string | null; names?: Record<string, string>; page?: number; pages?: number; total?: number };

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
  { id: '', label: 'All' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'security', label: 'Security' },
  { id: 'signins', label: 'Sign-ins' },
];
const KIND_LABEL: Record<Kind, string> = { moderation: 'Moderation', accounts: 'Accounts', security: 'Security', signins: 'Sign-ins', other: 'Activity' };
const WHO = [
  { id: '', label: 'Everyone' },
  { id: 'staff', label: 'Admins and staff' },
  { id: 'members', label: 'Members' },
  { id: 'system', label: 'System' },
];
const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Choose dates' },
];
const ROLE = (r?: string | null, id?: string | null) => (!id ? 'System' : r === 'admin' ? 'Admin' : r === 'staff' ? 'Staff' : 'Member');
const ROLE_TONE = (r?: string | null, id?: string | null): Tone => (!id ? 'plain' : r === 'admin' ? 'dark' : r === 'staff' ? 'ok' : 'line');
/** The local midnight a preset starts at, as an ISO time for the server. */
function startOf(range: string): string | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === '7d') d.setDate(d.getDate() - 6);
  else if (range === '30d') d.setDate(d.getDate() - 29);
  else if (range !== 'today') return null;
  return d.toISOString();
}
const dayStart = (v: string) => (v ? new Date(v + 'T00:00:00').toISOString() : null);
const dayAfter = (v: string) => (v ? new Date(new Date(v + 'T00:00:00').getTime() + 86400000).toISOString() : null);
function kindOf(action: string): Kind {
  if (/^session\.|^login\.(?!lockout)|^social\./.test(action)) return 'signins';
  if (/^mfa\.|^password\.|^login\.lockout/.test(action)) return 'security';
  if (/^account\.|^email\.|^phone\.|^staff\.|^user\.role_change|^region\.|^draft\./.test(action)) return 'accounts';
  if (/^report\.|^user\.(warn|suspend|restore)|^message\.|^appeal\.|^attendance\.|^verification\.|^warning|^activity\.(remove|member_removed)|^trip\.(remove|member_removed)/.test(action)) return 'moderation';
  return 'other';
}

// ---------------------------------------------------------------- an entry as a sentence
/** A sentence is a list of pieces; names are bold. Kept as data so the same words are searched and exported. */
export type Piece = string | { b: string };
export type Said = { parts: Piece[]; facts: string[] };
export const plain = (s: Said) => s.parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');

const permLabel = (p: unknown) => PERMISSIONS.find((x) => x.id === p)?.label ?? cap(String(p));
const list = (v: unknown) => (Array.isArray(v) ? v.map(permLabel).join(', ') || 'none' : '');
const months = (n: unknown) => (n == null ? 'inherited' : `${n} ${n === 1 ? 'month' : 'months'}`);
const day = (v: unknown) => (typeof v === 'string' && !isNaN(+new Date(v)) ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const words = (v: unknown) => (typeof v === 'string' && v ? cap(v) : '');

export function say(e: E, names: Record<string, string>): Said {
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
    case 'verification.export': return byWho([`downloaded the spreadsheet of ${m?.status === 'verified' ? 'verified' : m?.status === 'unverified' ? 'not verified' : 'all'} people`]);
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
    case 'region.limits_reset': return byWho(['made ', { b: String(m?.cities ?? 0) }, ' cities follow the default limits again']);
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
const stamp = (iso: string) => {
  const d = new Date(iso);
  return { day: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), time: d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase() };
};
const PAGE = 25;
const shortDate = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const OBJECT: Record<string, string> = { user: 'A member', report: 'A report', activity: 'An activity', trip: 'A trip', message: 'A message', appeal: 'An appeal', region: 'A place' };

export function AuditPage({ openReport }: { openReport?: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<'' | Kind>('');
  const [who, setWho] = useState('');
  const [range, setRange] = useState('7d');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [picking, setPicking] = useState(false);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const [pageNo, setPageNo] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setPageNo(1);
    setOpen(null);
  }, [term, kind, who, range, fromDay, toDay]);

  const from = range === 'custom' ? dayStart(fromDay) : startOf(range);
  const to = range === 'custom' ? dayAfter(toDay) : null;
  const filters = () => new URLSearchParams({ ...(term && { q: term }), ...(kind && { group: kind }), ...(who && { who }), ...(from && { from }), ...(to && { to }) });
  const list = useLoad(async () => {
    const p = filters();
    p.set('page', String(pageNo));
    p.set('limit', String(PAGE));
    return get<Reply>(`/v1/admin/audit?${p}`);
  }, [term, kind, who, from, to, pageNo], 15000);
  const items = list.data?.items ?? [];
  const names = list.data?.names ?? {};
  const filtered = !!(term || kind || who || range !== '7d');

  const exportCsv = async () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows: E[] = [];
    const nm: Record<string, string> = {};
    for (let p = 1; p <= 50; p++) {
      const f = filters();
      f.set('page', String(p));
      f.set('limit', '100');
      const r = await get<Reply>(`/v1/admin/audit?${f}`);
      rows.push(...r.items);
      Object.assign(nm, r.names ?? {});
      if (p >= (r.pages ?? 1)) break;
    }
    const lines = [['Time', 'Who', 'Role', 'Category', 'What happened', 'Details', 'Entry id'].join(',')].concat(
      rows.map((e) => {
        const said = say(e, nm);
        return [new Date(e.createdAt).toLocaleString('en-GB'), e.actorName ?? (e.actorId ? 'Someone' : 'The system'), ROLE(e.actorRole, e.actorId), KIND_LABEL[kindOf(e.action)], plain(said), said.facts.join('; '), e.id].map(cell).join(',');
      }),
    );
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Page
      fill
      title="Audit log"
      actions={
        <button type="button" className="btn" disabled={exporting || items.length === 0} onClick={() => (setExporting(true), exportCsv().finally(() => setExporting(false)))}>
          {exporting ? 'Preparing…' : 'Export CSV'}
        </button>
      }
    >
      <div className="toolbar">
        <div className="grow">
          <Search label="Search the audit log" placeholder="Search a person, plan, action or id" value={q} onChange={setQ} />
        </div>
        <Select aria-label="Who did it" value={who} onChange={setWho}>
          {WHO.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </Select>
        <span ref={rangeRef} className="au-range">
          <Select aria-label="Time range" value={range} onChange={(v) => (setRange(v), setPicking(v === 'custom'))}>
            {RANGES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </span>
        {range === 'custom' && fromDay && toDay && (
          <button type="button" className="btn" onClick={() => setPicking(true)} aria-label="Change the dates">
            {fromDay === toDay ? shortDate(fromDay) : `${shortDate(fromDay)} – ${shortDate(toDay)}`}
          </button>
        )}
        {picking && (
          <RangeCalendar
            anchor={rangeRef.current}
            from={fromDay || new Date().toISOString().slice(0, 10)}
            to={toDay || new Date().toISOString().slice(0, 10)}
            onClose={() => {
              setPicking(false);
              if (!fromDay) setRange('7d'); // closed without choosing dates: back to the last 7 days
            }}
            onPick={(f, t) => {
              setFromDay(f);
              setToDay(t);
              setRange('custom');
              setPicking(false);
            }}
          />
        )}
        {filtered && (
          <button type="button" className="btn small ghost" onClick={() => (setQ(''), setKind(''), setWho(''), setRange('7d'), setFromDay(''), setToDay(''))}>
            Reset
          </button>
        )}
      </div>
      <div className="au-kinds" role="group" aria-label="Category">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`au-kind ${f.id || 'all'}${kind === f.id ? ' on' : ''}`} aria-pressed={kind === f.id} onClick={() => setKind(f.id)}>
            {f.id && <span className={`au-dot ${f.id}`} aria-hidden="true" />}
            {f.id ? f.label : 'All categories'}
          </button>
        ))}
      </div>
      <ErrorBanner message={list.error} onRetry={list.reload} />
      {list.loading && !list.data && <Loading rows={6} />}
      {list.data && items.length === 0 && <Empty>{filtered ? 'Nothing matches these filters.' : 'Nothing in the last 7 days.'}</Empty>}
      {items.length > 0 && (
        <div className="table-wrap audit-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Time</th>
                  <th style={{ width: 220 }}>Who</th>
                  <th>What happened</th>
                  <th style={{ width: 130 }}>Category</th>
                  <th aria-label="Details" style={{ width: 52 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((e) => {
                  const said = say(e, names);
                  const k = kindOf(e.action);
                  const t = stamp(e.createdAt);
                  const isOpen = open === e.id;
                  const report = e.objectType === 'report' && openReport;
                  return (
                    <Fragment key={e.id}>
                      <tr>
                        <td>
                          <span className="strong">{t.day}</span>
                          <span className="muted small" style={{ display: 'block' }}>
                            {t.time}
                          </span>
                        </td>
                        <td>
                          <span className="strong">{e.actorName ?? (e.actorId ? 'Someone' : 'The system')}</span>
                          <span style={{ display: 'block' }}>
                            <Chip value={ROLE(e.actorRole, e.actorId)} tone={ROLE_TONE(e.actorRole, e.actorId)} />
                          </span>
                        </td>
                        <td>
                          <Words parts={said.parts} />
                        </td>
                        <td>
                          <span className={`au-cat ${k}`}>
                            <span className={`au-dot ${k}`} aria-hidden="true" />
                            {KIND_LABEL[k]}
                          </span>
                        </td>
                        <td className="end">
                          <button type="button" className={isOpen ? 'au-chev open' : 'au-chev'} aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'} onClick={() => setOpen(isOpen ? null : e.id)}>
                            <Icon name="chevron" />
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="au-detail-row">
                          <td colSpan={5}>
                            <div className="au-detail" style={{ margin: 0 }}>
                              <dl className="au-facts">
                                <div>
                                  <dt>Done by</dt>
                                  <dd>
                                    {e.actorName ?? (e.actorId ? 'Someone' : 'The system')} · {ROLE(e.actorRole, e.actorId)}
                                  </dd>
                                </div>
                                <div>
                                  <dt>About</dt>
                                  <dd>{e.objectName ?? OBJECT[e.objectType] ?? cap(e.objectType)}</dd>
                                </div>
                                <div>
                                  <dt>Exact time</dt>
                                  <dd>{new Date(e.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })}</dd>
                                </div>
                                {said.facts.map((f, i) => {
                                  const at = f.indexOf(': ');
                                  return (
                                    <div key={i}>
                                      <dt>{at > 0 ? f.slice(0, at) : 'Detail'}</dt>
                                      <dd>{at > 0 ? f.slice(at + 2) : f}</dd>
                                    </div>
                                  );
                                })}
                                <div>
                                  <dt>Reference</dt>
                                  <dd>
                                    <code className="mono">{e.id.slice(-8)}</code>
                                    <button type="button" className="au-open" style={{ marginLeft: 8 }} onClick={() => navigator.clipboard?.writeText(e.id)}>
                                      Copy full id
                                    </button>
                                  </dd>
                                </div>
                              </dl>
                              {report && (
                                <button type="button" className="au-open" onClick={() => openReport(e.objectId)}>
                                  Open report →
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PageBar page={list.data?.page ?? 1} pages={list.data?.pages ?? 1} total={list.data?.total ?? items.length} noun={['entry', 'entries']} onPage={setPageNo} busy={list.loading} />
        </div>
      )}
    </Page>
  );
}
