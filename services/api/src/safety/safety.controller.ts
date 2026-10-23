import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../common/auth';
import { REPORT_CATEGORIES, REPORT_TARGETS } from '../common/constants';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';

const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1),
  category: z.enum(REPORT_CATEGORIES),
  details: z.string().trim().max(1000).optional(),
});
const blockSchema = z.object({ userId: z.string().min(1) });

@Controller('v1')
export class SafetyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
  ) {}

  @Post('reports')
  async report(@CurrentUser() me: User, @Body() body: unknown) {
    const dto = parse(reportSchema, body);
    this.limiter.hit(`report:${me.id}`, 20, 24 * 3600 * 1000); // abusive repeat reporters
    const r = await this.prisma.report.create({ data: { reporterId: me.id, ...dto } });
    return { id: r.id, status: r.status };
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
  async blocks(@CurrentUser() me: User) {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: me.id },
      include: { blocked: { select: { id: true, profile: { select: { displayName: true } } } } },
    });
    return { items: rows.map((b) => ({ userId: b.blockedId, displayName: b.blocked.profile?.displayName })) };
  }
}
