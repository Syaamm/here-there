import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { TripItem, User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentUser, requireVerified } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { contentProblem, parse } from '../common/validate';

const DAY = 24 * 3600 * 1000;
/** Most lines one trip plan can hold, per kind. */
export const MAX_PLAN_ITEMS = 60;
const MAX_AMOUNT = 100_000;
/** How many ideas and budget notes the plan itself carries; the rest is read with `GET .../plan/items`. */
const PREVIEW = 3;

/** A time of day as 24-hour "HH:MM". */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 09:30');

export const itemSchema = z
  .object({
    kind: z.enum(['itinerary', 'budget']),
    title: z.string().trim().min(2).max(100),
    note: z.string().trim().max(500).optional(),
    day: z.coerce.date().optional(),
    time: timeOfDay.optional(),
    amount: z.number().int().min(0).max(MAX_AMOUNT).optional(),
  })
  .refine((v) => v.kind === 'itinerary' || v.day === undefined, { message: 'Budget notes have no day', path: ['day'] })
  .refine((v) => v.kind === 'itinerary' || v.time === undefined, { message: 'Budget notes have no time', path: ['time'] })
  .refine((v) => v.kind === 'budget' || v.amount === undefined, { message: 'Only budget notes have an amount', path: ['amount'] });
export const itemUpdateSchema = z.object({
  title: z.string().trim().min(2).max(100).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  day: z.coerce.date().nullable().optional(),
  time: timeOfDay.nullable().optional(),
  amount: z.number().int().min(0).max(MAX_AMOUNT).nullable().optional(),
});

const DAY_PASSED = 'That day has already passed, so its plan can no longer be changed';
const BUDGET_NOTE =
  'Budget notes are estimates for planning together. HERE & THERE never collects or holds money: everyone books and pays suppliers directly.';

/**
 * The group's shared plan for a trip (spec 7.2): a day-by-day itinerary and a list of estimated costs. Only people approved
 * for the trip can see or change it. Any member can add a line; its author and the organizer can change or remove it.
 */
@Injectable()
export class TripPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  private async member(me: User, tripId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw E.notFound('Trip');
    const m = await this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId: me.id } } });
    if (!m || m.state !== 'approved') throw E.forbidden('NOT_A_MEMBER', 'The plan is only for people in the group');
    return trip;
  }

  private dayOk(trip: { dateStart: Date; dateEnd: Date }, day?: Date | null) {
    if (!day) return;
    if (+day < +trip.dateStart - 7 * DAY || +day > +trip.dateEnd + 7 * DAY) throw E.badRequest('DAY_OUT_OF_RANGE', 'That day is outside the dates of this trip');
  }

  /**
   * Once a trip has started, the itinerary can only be changed for today and the days to come: a day that has passed is
   * the record of what happened. A plan line's day is a calendar day kept as noon UTC; "today" is taken as the earliest
   * calendar day anywhere on earth (12 hours behind UTC), so nobody's own today is ever locked by the clock difference.
   */
  private passed(trip: { dateStart: Date }, day?: Date | null) {
    if (!day || Date.now() < +trip.dateStart) return false;
    return day.toISOString().slice(0, 10) < new Date(Date.now() - 12 * 3600 * 1000).toISOString().slice(0, 10);
  }

  private checkText(...texts: (string | null | undefined)[]) {
    for (const t of texts) {
      const bad = contentProblem(t);
      if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    }
  }

  /** The lines as the app shows them: who added each, and whether this person may still change it. */
  private async lines(me: User, trip: { hostId: string; status: string; dateStart: Date; dateEnd: Date }, rows: TripItem[]) {
    const names = new Map(
      (await this.prisma.profile.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { userId: true, displayName: true } })).map((p) => [p.userId, p.displayName]),
    );
    const open = !['cancelled', 'completed'].includes(trip.status) && trip.dateEnd.getTime() >= Date.now();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      note: r.note,
      day: r.day,
      time: r.startTime,
      amount: r.amount,
      addedBy: names.get(r.createdById) ?? 'A member',
      canEdit: open && (r.createdById === me.id || trip.hostId === me.id) && !(r.kind === 'itinerary' && this.passed(trip, r.day)),
    }));
  }

  /**
   * The plan. The days of the itinerary come in full (the calendar needs them all, and a plan holds a limited number of lines),
   * but the ideas (no day yet) and the budget notes only as a first few with their totals: the rest is read a page at a time
   * with `GET .../plan/items`, so opening the plan stays light however long those lists grow.
   */
  async get(me: User, tripId: string) {
    const trip = await this.member(me, tripId);
    const inOrder = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];
    const ideaWhere = { tripId, kind: 'itinerary', day: null };
    const budgetWhere = { tripId, kind: 'budget' };
    const [dated, ideas, ideasTotal, budget, sum] = await Promise.all([
      this.prisma.tripItem.findMany({ where: { tripId, kind: 'itinerary', day: { not: null } }, orderBy: [{ day: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.tripItem.findMany({ where: ideaWhere, orderBy: inOrder, take: PREVIEW }),
      this.prisma.tripItem.count({ where: ideaWhere }),
      this.prisma.tripItem.findMany({ where: budgetWhere, orderBy: inOrder, take: PREVIEW }),
      this.prisma.tripItem.aggregate({ where: budgetWhere, _sum: { amount: true }, _count: true }),
    ]);
    const open = !['cancelled', 'completed'].includes(trip.status) && trip.dateEnd.getTime() >= Date.now();
    // inside a day the lines run in the order of the day: anything with no time first, then by the clock (ties keep the order they were added)
    const keys = [...new Set(dated.map((r) => r.day!.toISOString().slice(0, 10)))].sort();
    const groups = keys.map((d) => ({ day: d, rows: dated.filter((r) => r.day!.toISOString().slice(0, 10) === d).sort((x, y) => (x.startTime ?? '').localeCompare(y.startTime ?? '')) }));
    const made = new Map((await this.lines(me, trip, [...groups.flatMap((g) => g.rows), ...ideas, ...budget])).map((l) => [l.id, l]));
    const some = (rows: TripItem[]) => rows.map((r) => made.get(r.id)!);
    const perPerson = sum._sum.amount ?? 0;
    return {
      editable: open,
      itinerary: {
        days: groups.map((g) => ({ day: g.day, locked: this.passed(trip, new Date(`${g.day}T12:00:00Z`)), items: some(g.rows) })),
        // lines without a day: the first few, and how many there are in all
        ideas: { items: some(ideas), total: ideasTotal },
      },
      budget: {
        label: 'Estimated personal budget',
        currency: trip.budgetCurrency,
        // what the trip's own range covers, so the notes are read against the right thing (travel in or out)
        includesTransport: trip.budgetIncludesTransport,
        items: some(budget),
        total: sum._count,
        perPersonTotal: perPerson,
        statedMin: trip.budgetMin,
        statedMax: trip.budgetMax,
        // plain words, no verdicts: how the notes compare with what the trip said it would cost
        comparison: sum._count === 0 ? null : perPerson > trip.budgetMax ? 'over' : perPerson < trip.budgetMin ? 'under' : 'within',
        note: BUDGET_NOTE,
      },
    };
  }

  /** Every idea (`kind=ideas`) or budget note (`kind=budget`), oldest first, a page at a time. */
  async page(me: User, tripId: string, kindRaw?: string, limitRaw?: string, cursorRaw?: string) {
    const trip = await this.member(me, tripId);
    if (kindRaw !== 'ideas' && kindRaw !== 'budget') throw E.badRequest('VALIDATION_FAILED', 'kind must be ideas or budget');
    const limit = pageLimit(limitRaw, 20);
    const cur = decodeKeyset(cursorRaw);
    const rows = await this.prisma.tripItem.findMany({
      where: { tripId, ...(kindRaw === 'budget' ? { kind: 'budget' } : { kind: 'itinerary', day: null }), ...(cur && { OR: [{ createdAt: { gt: cur.at } }, { createdAt: cur.at, id: { gt: cur.id } }] }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = sliceKeyset(rows, limit, (r) => r.createdAt);
    return { items: await this.lines(me, trip, page.items), nextCursor: page.nextCursor };
  }

  async add(me: User, tripId: string, body: unknown) {
    requireVerified(me);
    const dto = parse(itemSchema, body);
    const trip = await this.member(me, tripId);
    if (['cancelled', 'completed'].includes(trip.status) || trip.dateEnd.getTime() < Date.now()) throw E.conflict('TRIP_CLOSED', 'This trip is closed');
    this.checkText(dto.title, dto.note);
    this.dayOk(trip, dto.day);
    if (dto.kind === 'itinerary' && this.passed(trip, dto.day)) throw E.conflict('DAY_PASSED', DAY_PASSED);
    this.limiter.hit(`trip-plan:${me.id}`, 60, DAY);
    if ((await this.prisma.tripItem.count({ where: { tripId, kind: dto.kind } })) >= MAX_PLAN_ITEMS) throw E.conflict('PLAN_FULL', `A plan can hold up to ${MAX_PLAN_ITEMS} lines of each kind`);
    const item = await this.prisma.tripItem.create({
      data: { tripId, kind: dto.kind, title: dto.title, note: dto.note || null, day: dto.day ?? null, startTime: dto.time ?? null, amount: dto.amount ?? null, createdById: me.id },
    });
    await this.audit.log(me.id, 'trip.plan_added', 'trip', tripId, { itemId: item.id, kind: dto.kind });
    return { id: item.id };
  }

  private async editable(me: User, tripId: string, itemId: string) {
    const trip = await this.member(me, tripId);
    if (['cancelled', 'completed'].includes(trip.status) || trip.dateEnd.getTime() < Date.now()) throw E.conflict('TRIP_CLOSED', 'This trip is closed');
    const item = await this.prisma.tripItem.findFirst({ where: { id: itemId, tripId } });
    if (!item) throw E.notFound('Plan line');
    if (item.createdById !== me.id && trip.hostId !== me.id) throw E.forbidden('NOT_YOUR_LINE', 'Only the person who added this line, or the organizer, can change it');
    return { trip, item };
  }

  async update(me: User, tripId: string, itemId: string, body: unknown) {
    const dto = parse(itemUpdateSchema, body);
    const { trip, item } = await this.editable(me, tripId, itemId);
    this.checkText(dto.title, dto.note);
    this.dayOk(trip, dto.day);
    // a line on a day that has passed stays as it was, and nothing can be moved onto such a day
    if (item.kind === 'itinerary' && (this.passed(trip, item.day) || this.passed(trip, dto.day))) throw E.conflict('DAY_PASSED', DAY_PASSED);
    if (item.kind === 'budget' && dto.day) throw E.badRequest('VALIDATION_FAILED', 'Budget notes have no day');
    if (item.kind === 'budget' && dto.time) throw E.badRequest('VALIDATION_FAILED', 'Budget notes have no time');
    if (item.kind === 'itinerary' && dto.amount) throw E.badRequest('VALIDATION_FAILED', 'Only budget notes have an amount');
    await this.prisma.tripItem.update({
      where: { id: itemId },
      data: { ...(dto.title !== undefined && { title: dto.title }), ...(dto.note !== undefined && { note: dto.note || null }), ...(dto.day !== undefined && { day: dto.day }), ...(dto.time !== undefined && { startTime: dto.time }), ...(dto.amount !== undefined && { amount: dto.amount }) },
    });
    return { ok: true };
  }

  async remove(me: User, tripId: string, itemId: string) {
    const { trip, item } = await this.editable(me, tripId, itemId);
    if (item.kind === 'itinerary' && this.passed(trip, item.day)) throw E.conflict('DAY_PASSED', DAY_PASSED);
    await this.prisma.tripItem.delete({ where: { id: itemId } });
    return { ok: true };
  }
}

@Controller('v1/trips/:id/plan')
export class TripPlanController {
  constructor(private readonly plan: TripPlanService) {}

  @Get()
  get(@CurrentUser() me: User, @Param('id') id: string) {
    return this.plan.get(me, id);
  }

  @Get('items')
  page(@CurrentUser() me: User, @Param('id') id: string, @Query('kind') kind?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.plan.page(me, id, kind, limit, cursor);
  }

  @Post('items')
  add(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.plan.add(me, id, body);
  }

  @Patch('items/:itemId')
  update(@CurrentUser() me: User, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    return this.plan.update(me, id, itemId, body);
  }

  @Delete('items/:itemId')
  remove(@CurrentUser() me: User, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.plan.remove(me, id, itemId);
  }
}
