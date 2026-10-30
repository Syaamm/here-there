import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { TtlCache } from '../common/ttl-cache';
import { parse } from '../common/validate';

/**
 * Which alerts may push to a person's phone, and when. The product rules, in one place:
 *  - Every alert is always kept in the Alerts list. These settings only decide whether it also PUSHES.
 *  - People can switch off the groups below. Safety and account alerts ("important") can never be switched off or silenced:
 *    a warning, a removal, a cancelled plan, an identity result, a report answer or a note about attendance must reach the person.
 *  - Quiet hours silence pushes of the switchable groups (in the person's own time zone). They are not saved for later:
 *    the alert is in the list when the person looks.
 *  - Repeats are grouped: many messages in one chat are ONE alert with a count, and at most one push a minute per chat.
 */
export const ALERT_GROUPS = {
  messages: { label: 'Chat messages', text: 'New messages in your plans and trips.', types: ['chat_message'] },
  requests: {
    label: 'Requests and answers',
    text: 'People asking to join, and answers to your requests.',
    types: ['join_request', 'trip_application', 'request_approved', 'request_declined', 'application_approved', 'application_declined', 'member_joined', 'waitlist_promoted', 'host_handover_offer', 'host_handover_accepted', 'host_handover_declined'],
  },
  reminders: {
    label: 'Reminders and changes',
    text: 'Plans starting soon, confirmed, or changed.',
    types: ['starting_soon', 'activity_confirmed', 'activity_changed', 'trip_changed', 'trip_dates_proposed', 'trip_dates_confirmed'],
  },
  saved: { label: 'Plans you saved', text: 'A place opened up, or a saved plan changed or was cancelled.', types: ['spot_opened'] },
  people: { label: 'People', text: 'New followers and travel matches.', types: ['follow', 'travel_match'] },
} as const;
export type AlertGroup = keyof typeof ALERT_GROUPS;
export const GROUP_KEYS = Object.keys(ALERT_GROUPS) as AlertGroup[];
export const IMPORTANT = { label: 'Safety and account', text: 'Warnings, removals, cancelled plans, identity and report answers. These always reach you, even in quiet hours.' };

/** Which group an alert belongs to, or null when it is important (the default for any type not listed here). */
export function groupOf(type: string, data?: Record<string, unknown> | null): AlertGroup | null {
  if (data?.saved === true) return 'saved';
  for (const k of GROUP_KEYS) if ((ALERT_GROUPS[k].types as readonly string[]).includes(type)) return k;
  return null;
}

export const DEFAULT_ZONE = 'Europe/Rome';
const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 22:00');
const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const toText = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const notificationSettingsSchema = z.object({
  groups: z.partialRecord(z.enum(GROUP_KEYS as [AlertGroup, ...AlertGroup[]]), z.boolean()).optional(),
  quietHours: z
    .object({ enabled: z.boolean(), start: hhmm.optional(), end: hhmm.optional(), timezone: z.string().max(64).optional() })
    .optional(),
});

/** Is this minute of the day inside the quiet window (which may run past midnight)? */
export function inQuietHours(minuteOfDay: number, start: number | null, end: number | null) {
  if (start === null || end === null || start === end) return false;
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

export function minuteOfDayIn(zone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: validZone(zone) ? zone : DEFAULT_ZONE }).formatToParts(now);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return n('hour') * 60 + n('minute');
}

type Pref = { muted: Set<string>; start: number | null; end: number | null; timezone: string };

@Injectable()
export class NotificationPrefsService {
  // read on every push, changed rarely: a short cache, forgotten the moment the person saves
  private readonly cache = new TtlCache<Pref>(Number(process.env.PREF_CACHE_MS ?? 30_000), 5000);
  constructor(private readonly prisma: PrismaService) {}

  private async load(userId: string): Promise<Pref> {
    return this.cache.get(userId, async () => {
      const row = await this.prisma.notificationPref.findUnique({ where: { userId } });
      return { muted: new Set((row?.muted ?? '').split(',').filter(Boolean)), start: row?.quietStart ?? null, end: row?.quietEnd ?? null, timezone: row?.timezone ?? DEFAULT_ZONE };
    });
  }

  /** May this alert push to the person's devices right now? */
  async allowsPush(userId: string, type: string, data?: Record<string, unknown> | null, now = new Date()) {
    const g = groupOf(type, data);
    if (!g) return true; // important
    const p = await this.load(userId);
    if (p.muted.has(g)) return false;
    return !inQuietHours(minuteOfDayIn(p.timezone, now), p.start, p.end);
  }

  async get(userId: string) {
    const p = await this.load(userId);
    return {
      groups: GROUP_KEYS.map((key) => ({ key, label: ALERT_GROUPS[key].label, text: ALERT_GROUPS[key].text, push: !p.muted.has(key) })),
      important: IMPORTANT,
      quietHours: { enabled: p.start !== null && p.end !== null && p.start !== p.end, start: toText(p.start ?? 22 * 60), end: toText(p.end ?? 8 * 60), timezone: p.timezone },
      note: 'Alerts are always kept in your Alerts list. These settings only decide when your phone is pushed.',
    };
  }

  async save(userId: string, body: unknown) {
    const dto = parse(notificationSettingsSchema, body);
    const row = await this.prisma.notificationPref.findUnique({ where: { userId } });
    const muted = new Set((row?.muted ?? '').split(',').filter(Boolean));
    for (const [k, on] of Object.entries(dto.groups ?? {})) {
      if (on === undefined) continue;
      if (on) muted.delete(k);
      else muted.add(k);
    }
    let quietStart = row?.quietStart ?? null;
    let quietEnd = row?.quietEnd ?? null;
    let timezone = row?.timezone ?? DEFAULT_ZONE;
    const q = dto.quietHours;
    if (q) {
      if (q.timezone !== undefined) {
        if (!validZone(q.timezone)) throw E.badRequest('INVALID_TIMEZONE', 'That time zone is not known');
        timezone = q.timezone;
      }
      if (!q.enabled) {
        quietStart = null;
        quietEnd = null;
      } else {
        const start = q.start ?? (quietStart !== null ? toText(quietStart) : '22:00');
        const end = q.end ?? (quietEnd !== null ? toText(quietEnd) : '08:00');
        if (start === end) throw E.badRequest('INVALID_QUIET_HOURS', 'Quiet hours cannot start and end at the same time');
        quietStart = toMinutes(start);
        quietEnd = toMinutes(end);
      }
    }
    const data = { muted: [...muted].join(','), quietStart, quietEnd, timezone };
    await this.prisma.notificationPref.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    this.cache.forget(userId);
    return this.get(userId);
  }
}
