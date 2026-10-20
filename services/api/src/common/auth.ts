import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { VerificationService } from '../verification/verification.service';
import { E } from './errors';
import { PrismaService } from './prisma.service';

const IS_PUBLIC = 'isPublic';
const STAFF = 'staffRoles';

export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Restrict a route to staff roles (admin console). */
export const Staff = (...roles: string[]) => SetMetadata(STAFF, roles);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  return ctx.switchToHttp().getRequest().user;
});

/**
 * Global guard. The user row is re-read on EVERY request so suspension, role changes and
 * verification state take effect immediately (never trust claims cached in the token).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly verification: VerificationService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const staff = this.reflector.getAllAndOverride<string[] | undefined>(STAFF, targets);
    const req = ctx.switchToHttp().getRequest();

    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      if (isPublic) return true;
      throw E.unauthorized();
    }

    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      if (isPublic) return true;
      throw E.unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }

    const row = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!row) {
      if (isPublic) return true;
      throw E.unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }
    if (row.state === 'suspended') throw E.forbidden('ACCOUNT_SUSPENDED', 'This account is suspended');
    // "Explore demo" guests may only read. Everything that writes needs a real account.
    if (row.role === 'guest' && req.method !== 'GET')
      throw E.forbidden('GUEST_READ_ONLY', 'You are exploring as a guest. Create an account to do that.');
    // A lapsed verification is enforced on this very request, not only at the next hourly sweep.
    const user = await this.verification.expireIfDue(row);

    if (staff && !staff.includes(user.role)) throw E.forbidden('FORBIDDEN', 'Insufficient role');
    req.user = user;
    return true;
  }
}

const NEEDS_CHECK_MESSAGE: Record<string, string> = {
  expired: 'Your identity verification has expired. Please verify again.',
  reverification_required: 'We need you to verify your identity again.',
  pending: 'Your identity verification is still being reviewed.',
  rejected: 'Your last identity verification was not approved. Please try again.',
};

/**
 * The single backend gate for anything that puts people in contact: creating or joining an activity or trip,
 * applying, and chatting. Frontends only mirror this; they are never trusted to enforce it.
 * Needs: self-declared adult + a current (not expired) identity verification. Email and mobile are separate
 * statuses and are NOT checked here.
 */
export function requireVerified(user: User) {
  if (!user.adultConfirmed) throw E.forbidden('ADULT_REQUIRED', 'You must confirm you are 18 or older');
  const lapsed = user.eligibility === 'verified' && !!user.verifiedUntil && user.verifiedUntil < new Date();
  if (user.eligibility !== 'verified' || lapsed) {
    const eligibility = lapsed ? 'expired' : user.eligibility;
    throw E.forbidden('VERIFICATION_REQUIRED', NEEDS_CHECK_MESSAGE[eligibility] ?? 'Complete identity verification before hosting, joining or chatting', {
      eligibility,
      reason: lapsed ? 'expired' : user.reverifyReason,
    });
  }
}
