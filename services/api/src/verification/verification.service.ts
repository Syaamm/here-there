import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Adapter boundary for the specialist identity provider (spec 3.1 / 9.2).
 * Only a provider reference + outcome is stored here, never identity documents.
 *
 * VERIFICATION_MODE:
 *   manual (default) - checks stay "pending" until staff approve them in the admin console
 *   auto             - mock provider approves instantly (local dev / demos only)
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private get mode() {
    return process.env.VERIFICATION_MODE ?? 'manual';
  }

  async start(user: User) {
    if (!user.adultConfirmed) throw E.forbidden('ADULT_REQUIRED', 'You must confirm you are 18 or older first');
    if (user.eligibility === 'verified') return { eligibility: 'verified' };
    if (user.eligibility === 'pending') return { eligibility: 'pending' };

    const check = await this.prisma.verificationCheck.create({
      data: { userId: user.id, providerRef: `mock_${randomUUID()}`, eligibility: 'pending' },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { eligibility: 'pending' } });
    if (this.mode === 'auto') {
      await this.decide(check.id, 'verified', null);
      return { eligibility: 'verified' };
    }
    return { eligibility: 'pending' };
  }

  /** Called by the provider webhook (later) or by staff in the admin console. */
  async decide(checkId: string, decision: 'verified' | 'rejected', reviewerId: string | null) {
    const check = await this.prisma.verificationCheck.findUnique({ where: { id: checkId } });
    if (!check) throw E.notFound('Verification check');
    if (check.eligibility !== 'pending') throw E.conflict('ALREADY_DECIDED', 'This check was already decided');

    await this.prisma.verificationCheck.update({
      where: { id: checkId },
      data: {
        eligibility: decision,
        reviewedBy: reviewerId,
        expiresAt: decision === 'verified' ? new Date(Date.now() + 365 * 24 * 3600 * 1000) : null,
      },
    });
    await this.prisma.user.update({ where: { id: check.userId }, data: { eligibility: decision } });
    await this.audit.log(reviewerId, `verification.${decision}`, 'user', check.userId, { checkId });
    await this.notifications.notify(
      check.userId,
      'verification_result',
      decision === 'verified' ? 'You are verified' : 'Verification not approved',
      decision === 'verified'
        ? 'You can now host and join activities and trips.'
        : 'We could not verify your identity. You can try again.',
    );
    return { eligibility: decision };
  }
}
