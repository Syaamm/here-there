import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * One person cannot be in two plans at the same time (owner's rule, 7 Nov 2026). It covers HERE and THERE together:
 *  - A plan HOLDS you when you host it or were accepted into it (an activity you host or joined, a trip you organise or are a
 *    member of), until it ends or is cancelled. Nothing can be joined, applied to, created or moved onto a time that overlaps
 *    a plan holding you: the server answers TIME_CLASH with the clashing plans.
 *  - A request still waiting for an answer (a join request, a waiting-list place, a trip application) does not hold you:
 *    several overlapping requests may be out at once. The first one you are accepted into wins, and the others that overlap
 *    it are withdrawn by themselves, with an alert saying why.
 * Times: an activity is [startsAt, endsAt). A trip covers whole days: [dateStart, dateEnd + 1 day), as everywhere else in the
 * trip code. A plan that has ended or was cancelled never clashes.
 */
const DAY = 24 * 3600 * 1000;
const CLOSED_ACTIVITY = ['cancelled', 'completed', 'archived', 'draft'];
const CLOSED_TRIP = ['cancelled', 'completed', 'draft'];

export type PlanRef = { kind: 'activity' | 'trip'; id: string };
export type ClashItem = {
  kind: 'activity' | 'trip';
  id: string;
  title: string;
  startsAt: Date;
  /** when it stops holding you: an activity's end, or the day after a trip's last day */
  endsAt: Date;
  /** trips only: the dates as shown on the trip */
  dateStart?: Date;
  dateEnd?: Date;
  /** host | going (activity) · organizer | member (trip) · requested | waitlisted (activity request) · applied | waitlisted (trip application) */
  role: string;
  /** true when the plan holds you (hosted or accepted); false for a request still waiting */
  firm: boolean;
  status: string;
};

export const tripWindow = (t: { dateStart: Date; dateEnd: Date }): [Date, Date] => [t.dateStart, new Date(+t.dateEnd + DAY)];

@Injectable()
export class ClashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every open plan of the person (holding or still requested) overlapping [from, to), soonest first, except `exclude`. */
  async find(userId: string, from: Date, to: Date, exclude?: PlanRef): Promise<ClashItem[]> {
    const lower = new Date(Math.max(+from, Date.now())); // a plan that already ended never clashes
    if (+to <= +lower) return [];
    const activity = { status: { notIn: CLOSED_ACTIVITY }, startsAt: { lt: to }, endsAt: { gt: lower }, ...(exclude?.kind === 'activity' ? { id: { not: exclude.id } } : {}) };
    const trip = { status: { notIn: CLOSED_TRIP }, dateStart: { lt: to }, dateEnd: { gt: new Date(+lower - DAY) }, ...(exclude?.kind === 'trip' ? { id: { not: exclude.id } } : {}) };
    const [memberships, requests, tripMemberships, applications] = await Promise.all([
      this.prisma.activityMembership.findMany({ where: { userId, state: 'approved', activity }, include: { activity: true }, take: 50 }),
      this.prisma.activityRequest.findMany({ where: { applicantId: userId, state: { in: ['requested', 'waitlisted'] }, activity }, include: { activity: true }, take: 50 }),
      this.prisma.tripMembership.findMany({ where: { userId, state: 'approved', trip }, include: { trip: true }, take: 50 }),
      this.prisma.tripApplication.findMany({ where: { applicantId: userId, state: { in: ['pending', 'waitlisted'] }, trip }, include: { trip: true }, take: 50 }),
    ]);
    const tripItem = (t: { id: string; title: string; dateStart: Date; dateEnd: Date; status: string }, role: string, firm: boolean): ClashItem => {
      const [s, e] = tripWindow(t);
      return { kind: 'trip', id: t.id, title: t.title, startsAt: s, endsAt: e, dateStart: t.dateStart, dateEnd: t.dateEnd, role, firm, status: t.status };
    };
    const items: ClashItem[] = [
      ...memberships.map((m) => ({ kind: 'activity' as const, id: m.activity.id, title: m.activity.title, startsAt: m.activity.startsAt, endsAt: m.activity.endsAt, role: m.role === 'host' ? 'host' : 'going', firm: true, status: m.activity.status })),
      ...requests.map((r) => ({ kind: 'activity' as const, id: r.activity.id, title: r.activity.title, startsAt: r.activity.startsAt, endsAt: r.activity.endsAt, role: r.state, firm: false, status: r.activity.status })),
      ...tripMemberships.map((m) => tripItem(m.trip, m.role === 'organizer' ? 'organizer' : 'member', true)),
      ...applications.map((a) => tripItem(a.trip, a.state === 'pending' ? 'applied' : 'waitlisted', false)),
    ];
    // a person can be both a member and (from an old row) a requester of the same plan: the holding row wins
    const seen = new Set<string>();
    return items
      .sort((x, y) => Number(y.firm) - Number(x.firm) || +x.startsAt - +y.startsAt)
      .filter((x) => (seen.has(`${x.kind}:${x.id}`) ? false : (seen.add(`${x.kind}:${x.id}`), true)))
      .sort((x, y) => +x.startsAt - +y.startsAt);
  }

  /** Refuses with 409 TIME_CLASH when a plan holding the person overlaps [from, to). */
  async assertFree(userId: string, from: Date, to: Date, exclude?: PlanRef) {
    const holding = (await this.find(userId, from, to, exclude)).filter((x) => x.firm);
    if (holding.length === 0) return;
    const first = holding[0];
    const message =
      holding.length === 1
        ? `You already have "${first.title}" at that time. You can join or create another plan once it has ended or is cancelled.`
        : `You already have ${holding.length} plans at that time. You can join or create another plan once they have ended or are cancelled.`;
    throw E.conflict('TIME_CLASH', message, { clashes: holding });
  }

  /**
   * Creating a new activity or trip (owner's change, 9 Nov 2026): only an ACTIVITY you host or joined blocks it (409 TIME_CLASH).
   * A trip you are on at that time does not: the app warns about it ("you are on a trip then, go on only if you can join or
   * host") and leaves the decision to the person. Joining, applying and moving still use assertFree (a trip blocks those).
   */
  async assertFreeToCreate(userId: string, from: Date, to: Date) {
    const holding = (await this.find(userId, from, to)).filter((x) => x.firm && x.kind === 'activity');
    if (holding.length === 0) return;
    const first = holding[0];
    const message =
      holding.length === 1
        ? `You already have "${first.title}" at that time. You can create another plan once it has ended or is cancelled.`
        : `You already have ${holding.length} activities at that time. You can create another plan once they have ended or are cancelled.`;
    throw E.conflict('TIME_CLASH', message, { clashes: holding });
  }

  /** The host's side of the same rule: the person asking is in another plan at that time by now (409 APPLICANT_BUSY). */
  async assertApplicantFree(userId: string, from: Date, to: Date, exclude: PlanRef) {
    const holding = (await this.find(userId, from, to, exclude)).filter((x) => x.firm);
    if (holding.length) throw E.conflict('APPLICANT_BUSY', 'This person is already in another plan at that time, so they cannot be approved.');
  }

  /**
   * First accepted wins: the person's other requests that overlap the plan they just got into are withdrawn, and they are told.
   * Returns what was withdrawn, so the screen the person is on can say so at once (`alert: false` when the caller tells
   * them some other way, e.g. inside the approval alert, instead of a separate alert).
   */
  async withdrawOverlappingPending(userId: string, from: Date, to: Date, winner: PlanRef & { title: string }, opts: { alert?: boolean } = {}): Promise<Withdrawn[]> {
    const alert = opts.alert ?? true;
    const waiting = (await this.find(userId, from, to, winner)).filter((x) => !x.firm);
    const withdrawn: Withdrawn[] = [];
    for (const x of waiting) {
      if (x.kind === 'activity') {
        const done = await this.prisma.activityRequest.updateMany({ where: { activityId: x.id, applicantId: userId, state: { in: ['requested', 'waitlisted'] } }, data: { state: 'withdrawn' } });
        if (done.count === 0) continue;
        withdrawn.push({ kind: 'activity', id: x.id, title: x.title });
        const a = await this.prisma.activity.findUnique({ where: { id: x.id }, select: { hostId: true } });
        if (a) await this.notifications.settleRequest(a.hostId, 'join_request', { activityId: x.id }, userId);
        if (alert) await this.notifications.notify(userId, 'request_auto_withdrawn', 'Request withdrawn', `"${x.title}" clashed with "${winner.title}".`, { activityId: x.id });
      } else {
        const done = await this.prisma.tripApplication.updateMany({ where: { tripId: x.id, applicantId: userId, state: { in: ['pending', 'waitlisted'] } }, data: { state: 'withdrawn' } });
        if (done.count === 0) continue;
        withdrawn.push({ kind: 'trip', id: x.id, title: x.title });
        const t = await this.prisma.trip.findUnique({ where: { id: x.id }, select: { hostId: true } });
        if (t) await this.notifications.settleRequest(t.hostId, 'trip_application', { tripId: x.id }, userId);
        if (alert) await this.notifications.notify(userId, 'request_auto_withdrawn', 'Application withdrawn', `"${x.title}" clashed with "${winner.title}".`, { tripId: x.id });
      }
    }
    return withdrawn;
  }
}

/** A request or application withdrawn because the person got into another plan at the same time. */
export type Withdrawn = { kind: 'activity' | 'trip'; id: string; title: string };

/** " Your request for "A" was withdrawn because it is at the same time." for the end of an approval alert ('' when none). */
export function withdrawnNote(w: Withdrawn[]) {
  if (w.length === 0) return '';
  const list = w.map((x) => `"${x.title}"`).join(', ');
  const what = w.every((x) => x.kind === 'trip') ? (w.length === 1 ? 'application' : 'applications') : w.length === 1 ? 'request' : 'requests';
  return ` Your ${what} for ${list} ${w.length === 1 ? 'was' : 'were'} withdrawn (same time).`;
}

@Controller('v1')
export class ClashController {
  constructor(private readonly clash: ClashService) {}

  /**
   * Your open plans (HERE and THERE, holding you or still requested) overlapping a time window. The app asks before joining,
   * applying or creating, so it can show what is in the way. `exclude` is the plan being looked at (activity:<id> or trip:<id>).
   */
  @Get('me/clashes')
  async clashes(@CurrentUser() me: User, @Query('from') fromRaw?: string, @Query('to') toRaw?: string, @Query('exclude') excludeRaw?: string) {
    const from = new Date(fromRaw ?? '');
    const to = new Date(toRaw ?? '');
    if (isNaN(+from) || isNaN(+to) || to <= from) throw E.badRequest('VALIDATION_FAILED', '"from" and "to" must be times, with "to" after "from"');
    const m = /^(activity|trip):(.+)$/.exec(excludeRaw ?? '');
    const exclude = m ? { kind: m[1] as 'activity' | 'trip', id: m[2] } : undefined;
    const items = await this.clash.find(me.id, from, to, exclude);
    return { items };
  }
}
