import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { JobsService } from '../common/jobs.service';
import { PrismaService } from '../common/prisma.service';

export const GUEST_TTL_MS = 24 * 3600 * 1000;

/**
 * "Explore demo": browse HERE and THERE with no account (spec 3.1 step 1).
 * A guest is a temporary, read-only account: it can look at the feed, the map, trips and public profiles, and
 * nothing else. The auth guard rejects every non-GET request from a guest. Guests expire after 24 hours and are
 * deleted by an hourly sweep, so no personal data is ever collected for them.
 */
@Injectable()
export class GuestService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.every('guests.purge', 3600 * 1000, () => this.purge());
  }
  onModuleDestroy() {}

  create() {
    return this.prisma.user.create({
      data: {
        email: `guest-${randomUUID()}@guest.invalid`, // never a real address, can never receive mail or log in
        passwordHash: '!', // not a valid hash: no password can ever match
        role: 'guest',
        profile: { create: { displayName: 'Guest' } },
      },
      include: { profile: true },
    });
  }

  /** Deletes expired guests. Their rows cascade (profile, notifications, favourites). */
  async purge() {
    const r = await this.prisma.user.deleteMany({ where: { role: 'guest', createdAt: { lt: new Date(Date.now() - GUEST_TTL_MS) } } });
    return r.count;
  }
}
