import { Body, Controller, Delete, Get, Injectable, Param, Patch, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentUser, requireVerified } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';

const DAY = 24 * 3600 * 1000;
/** Most lines one trip plan can hold, per kind. */
export const MAX_PLAN_ITEMS = 60;
const MAX_AMOUNT = 100_000;

export const itemSchema = z
  .object({
    kind: z.enum(['itinerary', 'budget']),
    title: z.string().trim().min(2).max(100),
    note: z.string().trim().max(500).optional(),
    day: z.coerce.date().optional(),
    amount: z.number().int().min(0).max(MAX_AMOUNT).optional(),
  })
  .refine((v) => v.kind === 'itinerary' || v.day === undefined, { message: 'Budget notes have no day', path: ['day'] })
  .refine((v) => v.kind === 'budget' || v.amount === undefined, { message: 'Only budget notes have an amount', path: ['amount'] });
export const itemUpdateSchema = z.object({
  title: z.string().trim().min(2).max(100).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  day: z.coerce.date().nullable().optional(),
  amount: z.number().int().min(0).max(MAX_AMOUNT).nullable().optional(),
});

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

  private checkText(...texts: (string | null | undefined)[]) {
    for (const t of texts) {
      const bad = contentProblem(t);
      if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    }
  }

  async get(me: User, tripId: string) {
    const trip = await this.member(me, tripId);
    const rows = await this.prisma.tripItem.findMany({ where: { tripId }, orderBy: [{ day: 'asc' }, { createdAt: 'asc' }] });
    const names = new Map(
      (await this.prisma.profile.findMany({ where: { userId: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { userId: true, displayName: true } })).map((p) => [p.userId, p.displayName]),
    );
    const open = !['cancelled', 'completed'].includes(trip.status) && trip.dateEnd.getTime() >= Date.now();
    const dto = (r: (typeof rows)[number]) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      note: r.note,
      day: r.day,
      amount: r.amount,
      addedBy: names.get(r.createdById) ?? 'A member',
      canEdit: open && (r.createdById === me.id || trip.hostId === me.id),
    });
    const itinerary = rows.filter((r) => r.kind === 'itinerary');
    const budget = rows.filter((r) => r.kind === 'budget');
    const perPerson = budget.reduce((n, r) => n + (r.amount ?? 0), 0);
    return {
      editable: open,
      itinerary: {
        // lines without a day go last, under "Not decided yet"
        days: [
          ...[...new Set(itinerary.filter((r) => r.day).map((r) => r.day!.toISOString().slice(0, 10)))].sort().map((d) => ({ day: d, items: itinerary.filter((r) => r.day?.toISOString().slice(0, 10) === d).map(dto) })),
          ...(itinerary.some((r) => !r.day) ? [{ day: null as string | null, items: itinerary.filter((r) => !r.day).map(dto) }] : []),
        ],
      },
      budget: {
        label: 'Estimated personal budget',
        currency: trip.budgetCurrency,
        items: budget.map(dto),
        perPersonTotal: perPerson,
        statedMin: trip.budgetMin,
        statedMax: trip.budgetMax,
        // plain words, no verdicts: how the notes compare with what the trip said it would cost
        comparison: budget.length === 0 ? null : perPerson > trip.budgetMax ? 'over' : perPerson < trip.budgetMin ? 'under' : 'within',
        note: BUDGET_NOTE,
      },
    };
  }

  async add(me: User, tripId: string, body: unknown) {
    requireVerified(me);
    const dto = parse(itemSchema, body);
    const trip = await this.member(me, tripId);
    if (['cancelled', 'completed'].includes(trip.status) || trip.dateEnd.getTime() < Date.now()) throw E.conflict('TRIP_CLOSED', 'This trip is closed');
    this.checkText(dto.title, dto.note);
    this.dayOk(trip, dto.day);
    this.limiter.hit(`trip-plan:${me.id}`, 60, DAY);
    if ((await this.prisma.tripItem.count({ where: { tripId, kind: dto.kind } })) >= MAX_PLAN_ITEMS) throw E.conflict('PLAN_FULL', `A plan can hold up to ${MAX_PLAN_ITEMS} lines of each kind`);
    const item = await this.prisma.tripItem.create({
      data: { tripId, kind: dto.kind, title: dto.title, note: dto.note || null, day: dto.day ?? null, amount: dto.amount ?? null, createdById: me.id },
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
    if (item.kind === 'budget' && dto.day) throw E.badRequest('VALIDATION_FAILED', 'Budget notes have no day');
    if (item.kind === 'itinerary' && dto.amount) throw E.badRequest('VALIDATION_FAILED', 'Only budget notes have an amount');
    await this.prisma.tripItem.update({
      where: { id: itemId },
      data: { ...(dto.title !== undefined && { title: dto.title }), ...(dto.note !== undefined && { note: dto.note || null }), ...(dto.day !== undefined && { day: dto.day }), ...(dto.amount !== undefined && { amount: dto.amount }) },
    });
    return { ok: true };
  }

  async remove(me: User, tripId: string, itemId: string) {
    await this.editable(me, tripId, itemId);
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
