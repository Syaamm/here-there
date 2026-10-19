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

    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user) {
      if (isPublic) return true;
      throw E.unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    }
    if (user.state === 'suspended') throw E.forbidden('ACCOUNT_SUSPENDED', 'This account is suspended');

    if (staff && !staff.includes(user.role)) throw E.forbidden('FORBIDDEN', 'Insufficient role');
    req.user = user;
    return true;
  }
}

/** Joining/hosting in-person experiences needs completed adult identity verification (spec 3.1). */
export function requireVerified(user: User) {
  if (!user.adultConfirmed) throw E.forbidden('ADULT_REQUIRED', 'You must confirm you are 18 or older');
  if (user.eligibility !== 'verified')
    throw E.forbidden('VERIFICATION_REQUIRED', 'Complete identity verification before hosting or joining', {
      eligibility: user.eligibility,
    });
}
