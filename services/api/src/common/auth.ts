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

/** What the person sees when they are locked out: for how long, if it is timed. */
export const suspendedMessage = (until: Date | null) => (until ? `This account is suspended until ${until.toUTCString().slice(5, 16)}` : 'This account is suspended');

/**
 * A sign-in carries the password version it was made under (`pv`: when the password last changed, 0 if never). If the
 * password has been changed since, the versions differ and the sign-in is no longer valid.
 */
export const sessionRevoked = (pv: number | undefined, changedAt: Date | null) => (pv ?? 0) !== (changedAt ? +changedAt : 0);
export const passwordVersion = (changedAt: Date | null) => (changedAt ? +changedAt : 0);

/** Staff must use two-step sign-in in production; in development it is optional so the demo accounts keep working. */
export const staffMfaRequired = () => process.env.STAFF_MFA_REQUIRED === 'true' || (process.env.NODE_ENV === 'production' && process.env.STAFF_MFA_REQUIRED !== 'false');

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
    let pv: number | undefined;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; pv?: number; purpose?: string }>(token);
      if (payload.purpose) throw new Error('not a sign-in'); // the pass from the first half of a two-step sign-in is not a sign-in
      sub = payload.sub;
      pv = payload.pv;
    } catch {
      if (isPublic) return true;
      throw E.unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }

    const row = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!row || row.state === 'deleted' || sessionRevoked(pv, row.passwordChangedAt)) {
      if (isPublic) return true;
      throw E.unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }
    if (row.state === 'suspended') {
      // a timed suspension that has run out ends here, on the person's next request
      if (row.suspendedUntil && row.suspendedUntil <= new Date()) {
        await this.prisma.user.update({ where: { id: row.id }, data: { state: 'active', suspendedUntil: null } });
        row.state = 'active';
        row.suspendedUntil = null;
      } else throw E.forbidden('ACCOUNT_SUSPENDED', suspendedMessage(row.suspendedUntil));
    }
    // "Explore demo" guests may only read. Everything that writes needs a real account.
    if (row.role === 'guest' && req.method !== 'GET')
      throw E.forbidden('GUEST_READ_ONLY', 'You are exploring as a guest. Create an account to do that.');
    // A lapsed verification is enforced on this very request, not only at the next hourly sweep.
    const user = await this.verification.expireIfDue(row);

    if (staff && !staff.includes(user.role)) throw E.forbidden('FORBIDDEN', 'Insufficient role');
    // staff reach the admin console only with two-step sign-in on (they can still open the page that sets it up)
    if (staff && staffMfaRequired() && !user.mfaEnabledAt) throw E.forbidden('MFA_REQUIRED', 'Set up two-step sign-in to use the admin console.');
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
