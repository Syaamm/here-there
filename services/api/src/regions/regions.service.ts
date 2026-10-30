import { Body, Controller, Delete, Get, Injectable, OnModuleInit, Param, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentUser, RegionalOk, Staff } from '../common/auth';
import { STAFF_ROLES } from '../common/constants';
import { E } from '../common/errors';
import { log } from '../common/observability';
import { PrismaService } from '../common/prisma.service';
import { TtlCache } from '../common/ttl-cache';
import { parse } from '../common/validate';
import {
  DEFAULT_HERE_MONTHS, DEFAULT_THERE_MONTHS, GLOBAL_KEY, HERE_MONTHS_RANGE, THERE_MONTHS_RANGE,
  chainOf, cityKeyOf, effectiveMonths, inScope, latestStart, monthsWord, scopeFor, subtree,
  type RegionRow, type Scope,
} from './regions';

const ALL = [...STAFF_ROLES];
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const months = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max);
export const createRegionSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['country', 'region', 'city']),
  parentKey: z.string().trim().min(1).max(60).optional(),
  key: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes only').optional(),
  cityKey: z.string().trim().min(2).max(60).optional(), // cities: the name activities and trips are filed under (default: the name)
  hereMonths: months(HERE_MONTHS_RANGE).nullable().optional(),
  thereMonths: months(THERE_MONTHS_RANGE).nullable().optional(),
});
export const updateRegionSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  hereMonths: months(HERE_MONTHS_RANGE).nullable().optional(), // null: follow the place above
  thereMonths: months(THERE_MONTHS_RANGE).nullable().optional(),
});
export const limitsQuery = z.object({ city: z.string().trim().max(80).optional() });

const outOfScope = () => E.forbidden('OUT_OF_SCOPE', 'That is outside the area you look after');

@Injectable()
export class RegionsService implements OnModuleInit {
  // read on every create and every admin list, changed rarely: forgotten at once when an admin saves
  private readonly cache = new TtlCache<RegionRow[]>(Number(process.env.REGION_CACHE_MS ?? 15_000), 1);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    await this.ensureGlobal();
    // older rows have no city key yet: fill them in once (plain SQL that SQLite and PostgreSQL both read)
    try {
      await this.prisma.$executeRawUnsafe(`UPDATE "Trip" SET "originKey" = lower(trim("originCity")) WHERE "originKey" IS NULL`);
      await this.prisma.$executeRawUnsafe(`UPDATE "Profile" SET "homeCityKey" = lower(trim("homeCity")) WHERE "homeCityKey" IS NULL AND "homeCity" IS NOT NULL`);
    } catch (e) {
      log('warn', 'could not fill in city keys', { error: (e as Error).message });
    }
  }

  private async ensureGlobal() {
    await this.prisma.region.upsert({
      where: { key: GLOBAL_KEY },
      create: { key: GLOBAL_KEY, name: 'Whole service', kind: 'global', hereMonths: DEFAULT_HERE_MONTHS, thereMonths: DEFAULT_THERE_MONTHS },
      update: {},
    });
  }

  async all(): Promise<RegionRow[]> {
    return this.cache.get('all', async () => {
      let rows = await this.prisma.region.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
      if (!rows.some((r) => r.key === GLOBAL_KEY)) {
        await this.ensureGlobal();
        rows = await this.prisma.region.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
      }
      return rows;
    });
  }
  private changed() {
    this.cache.forget('all');
  }

  // ---------------------------------------------------------------- what people may plan
  /** How far ahead may a HERE activity (`here`) or a THERE trip (`there`) be planned for this city, and which place says so. */
  async limitFor(which: 'here' | 'there', cityName?: string | null, now = new Date()) {
    const rows = await this.all();
    const key = cityKeyOf(cityName);
    const city = key ? (rows.find((r) => r.cityKey === key) ?? null) : null;
    const chain = chainOf(rows, city ?? rows.find((r) => r.key === GLOBAL_KEY) ?? null);
    const e = effectiveMonths(chain, which);
    return { months: e.months, latest: latestStart(e.months, now), from: e.from, region: city ? { key: city.key, name: city.name } : null };
  }

  /** Refuses a start date that is further ahead than the place allows. */
  async assertWithinLimit(which: 'here' | 'there', cityName: string | null | undefined, when: Date, code: 'INVALID_SCHEDULE' | 'INVALID_DATES') {
    const l = await this.limitFor(which, cityName);
    if (when > l.latest) {
      // "in Lombardy" only when a place of its own set the limit; the whole service's setting needs no name
      const place = l.from && l.from.kind !== 'global' ? l.from.name : null;
      const text = which === 'here' ? `Activities${place ? ` in ${place}` : ''} can be planned up to ${monthsWord(l.months)} ahead` : `Trips${place ? ` from ${place}` : ''} can only be planned up to ${monthsWord(l.months)} ahead`;
      // (written out twice: the error codes must appear as plain text so the docs can list them)
      throw code === 'INVALID_SCHEDULE' ? E.badRequest('INVALID_SCHEDULE', text, { months: l.months, latest: l.latest }) : E.badRequest('INVALID_DATES', text, { months: l.months, latest: l.latest });
    }
    return l;
  }

  // ---------------------------------------------------------------- staff scope
  /**
   * What a staff member may reach. `place` is where they chose to work after signing in (header X-Admin-Place): it can only
   * NARROW what the account may reach, never widen it. A staff account for the whole service with a place chosen sees that
   * place; an account limited to an area may choose that area or a place inside it, and anything else is refused.
   */
  async scopeOf(user: { adminRegionKey?: string | null }, place?: string | null): Promise<Scope | null> {
    const rows = await this.all();
    const own = scopeFor(rows, user.adminRegionKey);
    const chosen = (place ?? '').trim();
    if (!chosen || chosen === 'all') return own;
    if (!rows.some((r) => r.key === chosen)) throw E.badRequest('INVALID_PLACE', 'That place does not exist');
    if (own && !own.regionKeys.has(chosen)) throw outOfScope();
    return scopeFor(rows, chosen);
  }
  /** Throws unless the staff member may touch something in this city. Staff of the whole service always may. */
  async assertCity(user: { adminRegionKey?: string | null }, cityKey: string | null | undefined) {
    const scope = await this.scopeOf(user);
    if (!inScope(scope, cityKey ? cityKey.trim().toLowerCase() : null)) throw outOfScope();
  }

  // ---------------------------------------------------------------- the admin's list
  async list(actor: User) {
    const rows = await this.all();
    const scope = scopeFor(rows, actor.adminRegionKey);
    const shown = scope ? rows.filter((r) => scope.regionKeys.has(r.key)) : rows;
    const kids = new Map<string, number>();
    for (const r of rows) if (r.parentKey) kids.set(r.parentKey, (kids.get(r.parentKey) ?? 0) + 1);
    const staff = await this.prisma.user.groupBy({ by: ['adminRegionKey'], where: { adminRegionKey: { not: null }, state: 'active' }, _count: { _all: true } });
    const staffBy = new Map(staff.map((s) => [s.adminRegionKey, s._count._all]));
    return {
      scope: scope && { key: scope.regionKey, name: scope.name, kind: scope.kind },
      defaults: { here: DEFAULT_HERE_MONTHS, there: DEFAULT_THERE_MONTHS },
      ranges: { here: HERE_MONTHS_RANGE, there: THERE_MONTHS_RANGE },
      items: shown.map((r) => {
        const chain = chainOf(rows, r);
        const here = effectiveMonths(chain, 'here');
        const there = effectiveMonths(chain, 'there');
        return {
          key: r.key, name: r.name, kind: r.kind, parentKey: scope && r.key === scope.regionKey ? null : r.parentKey, cityKey: r.cityKey,
          hereMonths: r.hereMonths, thereMonths: r.thereMonths,
          effective: { here: here.months, hereFrom: here.from?.name ?? null, there: there.months, thereFrom: there.from?.name ?? null },
          children: kids.get(r.key) ?? 0, staff: staffBy.get(r.key) ?? 0,
          canEdit: r.key === GLOBAL_KEY ? !scope : true,
          canDelete: r.key !== GLOBAL_KEY && !(scope && r.key === scope.regionKey) && (kids.get(r.key) ?? 0) === 0,
        };
      }),
    };
  }

  /** City names people have used that no place covers yet, most used first: for the whole-service admin to file under a country or region. */
  async unassigned() {
    const known = new Set((await this.all()).map((r) => r.cityKey).filter((k): k is string => !!k));
    const counts = new Map<string, number>();
    const add = (rows: { key: string | null; n: number }[]) => rows.forEach((r) => r.key && !known.has(r.key) && counts.set(r.key, (counts.get(r.key) ?? 0) + r.n));
    const [acts, trips] = await Promise.all([
      this.prisma.activity.groupBy({ by: ['cityKey'], _count: { _all: true } }),
      this.prisma.trip.groupBy({ by: ['originKey'], _count: { _all: true } }),
    ]);
    add(acts.map((a) => ({ key: a.cityKey, n: a._count._all })));
    add(trips.map((t) => ({ key: t.originKey, n: t._count._all })));
    return { items: [...counts].map(([cityKey, uses]) => ({ cityKey, uses })).sort((a, b) => b.uses - a.uses || a.cityKey.localeCompare(b.cityKey)).slice(0, 100) };
  }

  // ---------------------------------------------------------------- changes (administrators)
  private async mustBeInside(actor: User, key: string) {
    const rows = await this.all();
    const scope = scopeFor(rows, actor.adminRegionKey);
    const row = rows.find((r) => r.key === key);
    if (!row) throw E.notFound('Place');
    if (scope && !scope.regionKeys.has(key)) throw outOfScope();
    if (key === GLOBAL_KEY && scope) throw outOfScope();
    return { rows, scope, row };
  }

  async create(actor: User, body: unknown) {
    const dto = parse(createRegionSchema, body);
    const parentKey = dto.parentKey ?? GLOBAL_KEY;
    const { rows, row: parent } = await this.mustBeInside(actor, parentKey);
    if (parent.kind === 'city') throw E.badRequest('INVALID_PLACE', 'A city cannot have places under it');
    if (dto.kind === 'country' && parent.kind !== 'global') throw E.badRequest('INVALID_PLACE', 'A country sits directly under the whole service');
    if (dto.kind === 'region' && parent.kind === 'city') throw E.badRequest('INVALID_PLACE', 'A region cannot sit under a city');
    const cityKey = dto.kind === 'city' ? cityKeyOf(dto.cityKey ?? dto.name) : null;
    if (cityKey) {
      const taken = rows.find((r) => r.cityKey === cityKey);
      if (taken) throw E.conflict('CITY_ALREADY_ASSIGNED', `${cityKey} already belongs to ${taken.name}`);
    }
    let key = dto.key ?? (slug(dto.name) || 'place');
    if (key === GLOBAL_KEY) key = `${key}-1`;
    for (let n = 2; rows.some((r) => r.key === key); n++) key = `${dto.key ?? slug(dto.name)}-${n}`;
    const created = await this.prisma.region.create({
      data: { key, name: dto.name, kind: dto.kind, parentKey, cityKey, hereMonths: dto.hereMonths ?? null, thereMonths: dto.thereMonths ?? null, updatedById: actor.id },
    });
    this.changed();
    await this.audit.log(actor.id, 'region.created', 'region', created.key, { name: dto.name, kind: dto.kind, parentKey });
    return { key: created.key };
  }

  async update(actor: User, key: string, body: unknown) {
    const dto = parse(updateRegionSchema, body);
    const { row } = await this.mustBeInside(actor, key);
    const data = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.hereMonths !== undefined && { hereMonths: dto.hereMonths }),
      ...(dto.thereMonths !== undefined && { thereMonths: dto.thereMonths }),
    };
    if (Object.keys(data).length === 0) return { key: row.key };
    await this.prisma.region.update({ where: { key }, data: { ...data, updatedById: actor.id } });
    this.changed();
    await this.audit.log(actor.id, 'region.updated', 'region', key, { before: { hereMonths: row.hereMonths, thereMonths: row.thereMonths, name: row.name }, after: data });
    return { key };
  }

  async remove(actor: User, key: string) {
    const { rows, scope, row } = await this.mustBeInside(actor, key);
    if (key === GLOBAL_KEY) throw E.badRequest('INVALID_PLACE', 'The whole service cannot be removed');
    if (scope && key === scope.regionKey) throw outOfScope(); // your own place is removed by the staff above you
    if (rows.some((r) => r.parentKey === key)) throw E.conflict('PLACE_NOT_EMPTY', 'Remove the places under it first');
    if ((await this.prisma.user.count({ where: { adminRegionKey: key } })) > 0) throw E.conflict('PLACE_HAS_STAFF', 'Staff accounts are still assigned to it. Change their area first.');
    await this.prisma.region.delete({ where: { key } });
    this.changed();
    await this.audit.log(actor.id, 'region.removed', 'region', key, { name: row.name, kind: row.kind });
    return { ok: true };
  }

  /** Is `key` a place that exists (used when giving a staff account its area)? */
  async exists(key: string) {
    return (await this.all()).some((r) => r.key === key);
  }
  async cityKeysUnder(key: string) {
    return subtree(await this.all(), key).map((r) => r.cityKey).filter((k): k is string => !!k);
  }
}

@Controller('v1/regions')
export class RegionsPublicController {
  constructor(private readonly regions: RegionsService) {}

  /**
   * How far ahead a plan may be made from this city: `here` for an activity in it, `there` for a trip that starts from it.
   * The apps use it to stop the date pickers where the limit is. Without a city (or for a city no place covers) it is the
   * whole service's setting.
   */
  @Get('limits')
  async limits(@Query() query: unknown) {
    const { city } = parse(limitsQuery, query);
    const [here, there] = await Promise.all([this.regions.limitFor('here', city), this.regions.limitFor('there', city)]);
    const out = (l: typeof here) => ({ months: l.months, latest: l.latest, text: monthsWord(l.months), setBy: l.from?.name ?? null });
    return { city: city ?? null, region: here.region, here: out(here), there: out(there) };
  }
}

@Controller('v1/admin')
export class RegionsAdminController {
  constructor(private readonly regions: RegionsService) {}

  /** Which part of the service this staff account looks after: everything (`scope: null`) or one city, region or country. */
  @Staff(...ALL)
  @RegionalOk()
  @Get('scope')
  async scope(@CurrentUser() me: User) {
    const s = await this.regions.scopeOf(me);
    return { role: me.role, scope: s && { key: s.regionKey, name: s.name, kind: s.kind } };
  }

  @Staff(...ALL)
  @RegionalOk()
  @Get('regions')
  list(@CurrentUser() me: User) {
    return this.regions.list(me);
  }

  /** Whole-service staff only (a regional account has no business seeing places outside its own). */
  @Staff(...ALL)
  @Get('regions/unassigned')
  unassigned() {
    return this.regions.unassigned();
  }

  @Staff('admin')
  @RegionalOk()
  @Post('regions')
  create(@CurrentUser() me: User, @Body() body: unknown) {
    return this.regions.create(me, body);
  }

  @Staff('admin')
  @RegionalOk()
  @Patch('regions/:key')
  update(@CurrentUser() me: User, @Param('key') key: string, @Body() body: unknown) {
    return this.regions.update(me, key, body);
  }

  @Staff('admin')
  @RegionalOk()
  @Delete('regions/:key')
  remove(@CurrentUser() me: User, @Param('key') key: string) {
    return this.regions.remove(me, key);
  }
}
