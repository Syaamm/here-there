import { Body, Controller, Delete, Get, Injectable, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Public, passwordVersion, staffMfaRequired } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { checkTotp, newSecret, otpauthUri } from '../common/totp';
import { parse } from '../common/validate';
import { blindIndex, decryptField, encryptField } from '../common/vault';

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });
const disableSchema = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(20) });
const verifySchema = z.object({ mfaToken: z.string().min(10), code: z.string().trim().min(6).max(20) });

const RECOVERY_CODES = 8;
const normalizeRecovery = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '');
const recoveryHash = (c: string) => blindIndex('mfa-recovery', normalizeRecovery(c));
const newRecoveryCode = () => {
  const h = randomBytes(5).toString('hex'); // 10 characters
  return `${h.slice(0, 5)}-${h.slice(5)}`;
};

/**
 * Two-step sign-in for staff: after the password, a 6-digit code from an authenticator app (or one of eight one-time
 * recovery codes). The secret is stored encrypted, a code cannot be used twice, and wrong tries are rate-limited.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  private staffOnly(u: User) {
    if (u.role === 'user' || u.role === 'guest') throw E.forbidden('STAFF_ONLY', 'Two-step sign-in is for staff accounts.');
  }

  /** A short-lived pass that only proves the password was right. It cannot be used as a sign-in. */
  mfaToken(u: User) {
    return this.jwt.signAsync({ sub: u.id, purpose: 'mfa', pv: passwordVersion(u.passwordChangedAt) }, { expiresIn: '5m' });
  }

  /** Checks a code from the app or a recovery code. Returns what was used, or throws. Recovery codes are used up. */
  async check(u: User, code: string): Promise<'totp' | 'recovery'> {
    this.limiter.hit(`mfa-try:${u.id}`, 8, 5 * 60 * 1000);
    if (u.mfaSecret && u.mfaEnabledAt) {
      const step = checkTotp(decryptField(u.mfaSecret), code.replace(/\s/g, ''), u.mfaLastStep);
      if (step !== null) {
        await this.prisma.user.update({ where: { id: u.id }, data: { mfaLastStep: step } });
        return 'totp';
      }
    }
    const used = await this.prisma.mfaRecoveryCode.updateMany({ where: { userId: u.id, usedAt: null, codeHash: recoveryHash(code) }, data: { usedAt: new Date() } });
    if (used.count === 1) {
      await this.audit.log(u.id, 'mfa.recovery_used', 'user', u.id);
      return 'recovery';
    }
    await this.audit.log(u.id, 'mfa.failed', 'user', u.id);
    throw E.unauthorized('INVALID_MFA_CODE', 'That code is not correct');
  }

  async status(u: User) {
    return {
      enabled: !!u.mfaEnabledAt,
      required: u.role !== 'user' && staffMfaRequired(),
      recoveryCodesLeft: u.mfaEnabledAt ? await this.prisma.mfaRecoveryCode.count({ where: { userId: u.id, usedAt: null } }) : 0,
    };
  }

  /** Step 1: a new secret to put in the authenticator app. Nothing is switched on until a code from it is confirmed. */
  async setup(u: User) {
    this.staffOnly(u);
    if (u.mfaEnabledAt) throw E.conflict('MFA_ALREADY_ON', 'Two-step sign-in is already on. Turn it off first to set it up again.');
    this.limiter.hit(`mfa-setup:${u.id}`, 10, 60 * 60 * 1000);
    const secret = newSecret();
    await this.prisma.user.update({ where: { id: u.id }, data: { mfaSecret: encryptField(secret), mfaLastStep: null } });
    return { secret, otpauthUri: otpauthUri(u.email, secret) };
  }

  /** Step 2: the first code from the app switches it on, and the recovery codes are shown once. */
  async enable(u: User, body: unknown) {
    this.staffOnly(u);
    const { code } = parse(codeSchema, body);
    if (u.mfaEnabledAt) throw E.conflict('MFA_ALREADY_ON', 'Two-step sign-in is already on.');
    if (!u.mfaSecret) throw E.badRequest('MFA_NOT_STARTED', 'Start the setup first.');
    this.limiter.hit(`mfa-try:${u.id}`, 8, 5 * 60 * 1000);
    const step = checkTotp(decryptField(u.mfaSecret), code.replace(/\s/g, ''), null);
    if (step === null) throw E.badRequest('INVALID_SETUP_CODE', 'That code is not correct. Check the time on your phone and try the next code.');
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: u.id } }),
      this.prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId: u.id, codeHash: recoveryHash(c) })) }),
      this.prisma.user.update({ where: { id: u.id }, data: { mfaEnabledAt: new Date(), mfaLastStep: step } }),
    ]);
    await this.audit.log(u.id, 'mfa.enabled', 'user', u.id);
    return { enabled: true, recoveryCodes: codes };
  }

  async disable(u: User, body: unknown) {
    this.staffOnly(u);
    const dto = parse(disableSchema, body);
    if (!u.mfaEnabledAt) return { enabled: false };
    if (staffMfaRequired()) throw E.forbidden('MFA_REQUIRED', 'Staff accounts must keep two-step sign-in on.');
    if (!(await bcrypt.compare(dto.password, u.passwordHash))) throw E.unauthorized('WRONG_PASSWORD', 'Your password is not correct');
    await this.check(u, dto.code);
    await this.clear(u.id);
    await this.audit.log(u.id, 'mfa.disabled', 'user', u.id);
    return { enabled: false };
  }

  /** Switches it off and forgets everything (used by disable and by an administrator helping someone locked out). */
  async clear(userId: string) {
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null } }),
    ]);
  }

  /** Second half of signing in: the pass from the password step, plus a code. */
  async complete(body: unknown) {
    const dto = parse(verifySchema, body);
    let payload: { sub: string; purpose?: string; pv?: number };
    try {
      payload = await this.jwt.verifyAsync(dto.mfaToken);
    } catch {
      throw E.unauthorized('MFA_EXPIRED', 'That sign-in took too long. Start again.');
    }
    if (payload.purpose !== 'mfa') throw E.unauthorized('MFA_EXPIRED', 'That sign-in took too long. Start again.');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { profile: true } });
    if (!user || user.state !== 'active' || !user.mfaEnabledAt || (payload.pv ?? 0) !== passwordVersion(user.passwordChangedAt)) throw E.unauthorized('MFA_EXPIRED', 'That sign-in took too long. Start again.');
    const how = await this.check(user, dto.code);
    return { user, how };
  }
}

@Controller('v1')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly jwt: JwtService,
  ) {}

  @Get('me/mfa')
  status(@CurrentUser() u: User) {
    return this.mfa.status(u);
  }

  @Post('me/mfa/setup')
  setup(@CurrentUser() u: User) {
    return this.mfa.setup(u);
  }

  @Post('me/mfa/enable')
  enable(@CurrentUser() u: User, @Body() body: unknown) {
    return this.mfa.enable(u, body);
  }

  @Delete('me/mfa')
  disable(@CurrentUser() u: User, @Body() body: unknown) {
    return this.mfa.disable(u, body);
  }

  /** Completes a sign-in that asked for a code. Public: the pass from the password step is what authorises it. */
  @Public()
  @Post('auth/mfa/verify')
  async verify(@Body() body: unknown) {
    const { user, how } = await this.mfa.complete(body);
    const token = await this.jwt.signAsync({ sub: user.id, pv: passwordVersion(user.passwordChangedAt) });
    return { token, usedRecoveryCode: how === 'recovery', user: { id: user.id, email: user.email, role: user.role, profile: user.profile && { displayName: user.profile.displayName } } };
  }
}
