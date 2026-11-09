import { Injectable, OnModuleInit } from '@nestjs/common';
import { STAFF_PERMISSIONS } from './constants';
import { log } from './observability';
import { hashPassword } from './password';
import { PrismaService } from './prisma.service';

/** The demo logins that existed before there were only two kinds of console account. */
const OLD_DEMO_STAFF = ['support@herethere.local', 'moderator@herethere.local', 'trustlead@herethere.local'];
/** The one demo staff login (development and demo servers only): it looks after Milan, where the demo people live. */
export const DEMO_STAFF = { email: 'staff@herethere.local', password: 'staff-demo-1', name: 'Staff' };

/**
 * Runs once at every start and does nothing when there is nothing to do:
 *  - accounts with an old staff role (support, moderator, trust lead) become staff, with every permission;
 *  - the old demo staff logins are retired;
 *  - outside production, where the default admin exists, the demo staff login is made if it is missing.
 */
@Injectable()
export class RoleMigration implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const moved = await this.prisma.user.updateMany({ where: { role: { in: ['support', 'moderator', 'trust_lead'] } }, data: { role: 'staff', staffPermissions: [...STAFF_PERMISSIONS] } });
      const retired = await this.prisma.user.updateMany({ where: { email: { in: OLD_DEMO_STAFF }, state: { not: 'deleted' } }, data: { state: 'deleted' } });
      if (moved.count || retired.count) log('info', 'staff roles updated', { movedToStaff: moved.count, oldDemoRetired: retired.count });
      if (process.env.NODE_ENV !== 'production') await this.demoStaff();
    } catch (e) {
      log('warn', 'staff role update failed', { error: (e as Error).message });
    }
  }

  private async demoStaff() {
    // only on a database made by the demo seed (the default admin is there), never in tests or on a real system
    if (!(await this.prisma.user.findUnique({ where: { email: 'admin@herethere.local' } }))) return;
    if (await this.prisma.user.findUnique({ where: { email: DEMO_STAFF.email } })) return;
    await this.prisma.region.upsert({ where: { key: 'global' }, update: {}, create: { key: 'global', name: 'Whole service', kind: 'global' } });
    await this.prisma.region.upsert({ where: { key: 'it' }, update: {}, create: { key: 'it', name: 'Italy', kind: 'country', parentKey: 'global' } });
    const milan = (await this.prisma.region.findUnique({ where: { cityKey: 'milan' } })) ?? (await this.prisma.region.create({ data: { key: 'it-milan', name: 'Milan', kind: 'city', parentKey: 'it', cityKey: 'milan' } }));
    await this.prisma.user.create({
      data: {
        email: DEMO_STAFF.email,
        passwordHash: await hashPassword(DEMO_STAFF.password),
        role: 'staff',
        adminRegionKey: milan.key,
        staffPermissions: [...STAFF_PERMISSIONS],
        adultConfirmed: true,
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: DEMO_STAFF.name, homeCity: 'Milan', homeCityKey: 'milan' } },
      },
    });
    log('info', 'demo staff login created', { email: DEMO_STAFF.email, area: milan.key });
  }
}
