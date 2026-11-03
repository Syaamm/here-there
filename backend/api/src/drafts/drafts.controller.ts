import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { ActivitiesService } from '../activities/activities.service';
import { beforeKeyset, decodeKeyset, pageLimit, sliceKeyset, pageOf } from '../common/paging';
import { AuditService } from '../common/audit.service';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { TripsService } from '../trips/trips.service';

/** Most unfinished listings one person can keep, per kind. */
export const MAX_DRAFTS = 10;
const MAX_BYTES = 20_000;

const saveSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(['activity', 'trip']),
  data: z.record(z.string(), z.unknown()),
});

const dto = (d: { id: string; kind: string; data: string; updatedAt: Date }) => {
  const data = JSON.parse(d.data) as Record<string, unknown>;
  // an activity is named by its title; a trip has none, so it is named by where it goes
  const name = typeof data.title === 'string' && data.title.trim() ? data.title : typeof data.destination === 'string' ? data.destination : '';
  const title = name.trim() ? name.trim().slice(0, 80) : null;
  return { id: d.id, kind: d.kind, title, data, updatedAt: d.updatedAt };
};

/**
 * Save-for-later for the create forms. A draft is the form as the person left it, possibly half empty. It is only ever
 * visible to its owner, is not a listing, and is checked in full (the same rules as any new activity or trip) when it is
 * published.
 */
@Controller('v1/me/drafts')
export class DraftsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivitiesService,
    private readonly trips: TripsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() me: User, @Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string) {
    const page = await pageOf((a) => this.prisma.draft.findMany(a), { limit: pageLimit(limitRaw, 20), cursor: cursorRaw, where: { userId: me.id }, sortBy: 'updatedAt' });
    return { items: page.items.map(dto), nextCursor: page.nextCursor };
  }

  /** Creates a draft, or replaces the one named by `id`. */
  @Put()
  async save(@CurrentUser() me: User, @Body() body: unknown) {
    const { id, kind, data } = parse(saveSchema, body);
    const json = JSON.stringify(data);
    if (json.length > MAX_BYTES) throw E.badRequest('DRAFT_TOO_LARGE', 'This draft is too long to save');
    if (id) {
      const own = await this.prisma.draft.findFirst({ where: { id, userId: me.id } });
      if (!own) throw E.notFound('Draft');
      return dto(await this.prisma.draft.update({ where: { id }, data: { data: json, kind } }));
    }
    if ((await this.prisma.draft.count({ where: { userId: me.id, kind } })) >= MAX_DRAFTS)
      throw E.conflict('TOO_MANY_DRAFTS', `You can keep up to ${MAX_DRAFTS} drafts. Delete one to save another.`);
    return dto(await this.prisma.draft.create({ data: { userId: me.id, kind, data: json } }));
  }

  @Delete(':id')
  async remove(@CurrentUser() me: User, @Param('id') id: string) {
    const gone = await this.prisma.draft.deleteMany({ where: { id, userId: me.id } });
    if (gone.count === 0) throw E.notFound('Draft');
    return { ok: true };
  }

  /** Posts the draft as a real activity or trip. It is checked like any other; if something is wrong, the draft stays. */
  @Post(':id/publish')
  async publish(@CurrentUser() me: User, @Param('id') id: string) {
    const d = await this.prisma.draft.findFirst({ where: { id, userId: me.id } });
    if (!d) throw E.notFound('Draft');
    const data = JSON.parse(d.data);
    const created = d.kind === 'trip' ? await this.trips.create(me, data) : await this.activities.create(me, data);
    await this.prisma.draft.deleteMany({ where: { id } });
    await this.audit.log(me.id, 'draft.publish', d.kind, (created as { id: string }).id);
    return created;
  }
}
