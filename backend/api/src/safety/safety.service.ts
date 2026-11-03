import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  /** IDs the user has blocked or who have blocked the user. Blocking is symmetric for discovery and contact. */
  async blockedWith(userId: string): Promise<string[]> {
    const rows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    });
    return [...new Set(rows.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)))];
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    const n = await this.prisma.block.count({
      where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    });
    return n > 0;
  }
}
