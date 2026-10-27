import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../common/auth';
import { beforeKeyset, decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { REPORT_CATEGORIES, REPORT_TARGETS } from '../common/constants';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ModerationService, reportPolicy } from '../moderation/moderation.controller';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1),
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().trim().max(1000).optional(),
});
export const blockSchema = z.object({ userId: z.string().min(1) });

@Controller('v1')
export class SafetyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
    private readonly moderation: ModerationService,
  ) {}

  @Post('reports')
  async report(@CurrentUser() me: User, @Body() body: unknown) {
    const dto = parse(reportSchema, body);
    this.limiter.hit(`report:${me.id}`, 20, 24 * 3600 * 1000); // abusive repeat reporters
    const urgent = this.moderation.isUrgent(dto.category);
    const r = await this.prisma.report.create({ data: { reporterId: me.id, ...dto, priority: urgent ? 'urgent' : 'normal' } });
    await this.moderation.onReport(r);
    // what happens next, in plain words, and the emergency number: shown to the person right after they report
    const policy = reportPolicy();
    return { id: r.id, status: r.status, priority: r.priority, expectedWithin: urgent ? policy.answerWithin.urgent : policy.answerWithin.normal, coverage: policy.coverage.text, emergency: policy.emergency };
  }

  @Post('blocks')
  async block(@CurrentUser() me: User, @Body() body: unknown) {
    const { userId } = parse(blockSchema, body);
    if (userId === me.id) throw E.badRequest('INVALID_TARGET', 'You cannot block yourself');
    if (!(await this.prisma.user.findUnique({ where: { id: userId } }))) throw E.notFound('User');
    await this.prisma.follow.deleteMany({ where: { OR: [{ followerId: me.id, followingId: userId }, { followerId: userId, followingId: me.id }] } }); // blocking ends any follow, both ways
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } },
      create: { blockerId: me.id, blockedId: userId },
      update: {},
    });
    return { blocked: true };
  }

  @Delete('blocks/:userId')
  async unblock(@CurrentUser() me: User, @Param('userId') userId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId: me.id, blockedId: userId } });
    return { blocked: false };
  }

  @Get('blocks')
  async blocks(@CurrentUser() me: User, @Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string) {
    const limit = pageLimit(limitRaw, 20);
    const found = await this.prisma.block.findMany({
      where: { blockerId: me.id, ...beforeKeyset(decodeKeyset(cursorRaw)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { blocked: { select: { id: true, profile: { select: { displayName: true } } } } },
      take: limit + 1,
    });
    const page = sliceKeyset(found, limit, (b) => b.createdAt);
    return { items: page.items.map((b) => ({ userId: b.blockedId, displayName: b.blocked.profile?.displayName })), nextCursor: page.nextCursor };
  }
}
