import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { EmailService } from '../common/email.service';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { SmsService } from '../common/sms.service';
import { parse } from '../common/validate';

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
type Channel = 'email' | 'phone';

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
// International format only (E.164): "+" country code and number, 8 to 15 digits, e.g. +393331234567
const phoneSchema = z.object({ phone: z.string().trim().transform((s) => s.replace(/[\s().-]/g, '')).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the number with its country code, e.g. +393331234567')) });

/**
 * Proves a user controls an email address (required before identity verification) or a mobile number (optional).
 * Codes are 6 digits, expire after 15 minutes, allow 5 wrong tries, and only a keyed hash is stored.
 */
@Injectable()
export class ContactVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  private hash(userId: string, channel: Channel, code: string) {
    const secret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
    return createHmac('sha256', secret).update(`${userId}:${channel}:${code}`).digest('hex');
  }

  /** Issues a new code (replacing any earlier one) and hands it to `deliver`. */
  private async issue(user: User, channel: Channel, target: string | null, deliver: (code: string) => Promise<void>) {
    this.limiter.hit(`${channel}-cooldown:${user.id}`, 1, 30_000); // one code every 30 s
    this.limiter.hit(`${channel}-hourly:${user.id}`, 5, 60 * 60 * 1000); // and five per hour

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.contactCode.updateMany({ where: { userId: user.id, channel, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.contactCode.create({
      data: { userId: user.id, channel, target, codeHash: this.hash(user.id, channel, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    await deliver(code);
    return this.email.devEcho ? { devCode: code } : {};
  }

  /** Validates the submitted code and, if right, returns the stored row so the caller can apply the result. */
  private async consume(user: User, channel: Channel, body: unknown) {
    const { code } = parse(codeSchema, body);
    const row = await this.prisma.contactCode.findFirst({
      where: { userId: user.id, channel, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw E.badRequest('CODE_EXPIRED', 'This code has expired. Request a new one.');
    if (row.attempts >= MAX_ATTEMPTS) {
      await this.prisma.contactCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      throw E.badRequest('TOO_MANY_ATTEMPTS', 'Too many wrong codes. Request a new one.');
    }
    const given = Buffer.from(this.hash(user.id, channel, code));
    const wanted = Buffer.from(row.codeHash);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      await this.prisma.contactCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw E.badRequest('INVALID_CODE', 'That code is not correct', { attemptsLeft: MAX_ATTEMPTS - row.attempts - 1 });
    }
    return row;
  }

  // ---------------------------------------------------------------- email (required before identity verification)
  async sendEmailCode(user: User): Promise<{ devCode?: string }> {
    if (user.emailVerifiedAt) return {};
    return this.issue(user, 'email', null, (code) =>
      this.email.send(
        user.email,
        'Your HERE & THERE verification code',
        `Your verification code is ${code}.\n\nIt expires in 15 minutes. If you did not create a HERE & THERE account, you can ignore this email.`,
      ),
    );
  }

  async verifyEmail(user: User, body: unknown) {
    if (user.emailVerifiedAt) return { emailVerified: true };
    const row = await this.consume(user, 'email', body);
    await this.prisma.$transaction([
      this.prisma.contactCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
    ]);
    await this.audit.log(user.id, 'email.verified', 'user', user.id);
    return { emailVerified: true };
  }

  // ---------------------------------------------------------------- mobile number (optional, gates nothing)
  async sendPhoneCode(user: User, body: unknown): Promise<{ devCode?: string }> {
    const { phone } = parse(phoneSchema, body);
    return this.issue(user, 'phone', phone, (code) => this.sms.send(phone, `Your HERE & THERE code is ${code}. It expires in 15 minutes.`));
  }

  async verifyPhone(user: User, body: unknown) {
    const row = await this.consume(user, 'phone', body);
    if (!row.target) throw E.badRequest('CODE_EXPIRED', 'Request a new code for your number.');
    await this.prisma.$transaction([
      this.prisma.contactCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { phoneNumber: row.target, phoneVerifiedAt: new Date() } }),
    ]);
    await this.audit.log(user.id, 'phone.verified', 'user', user.id);
    return { phoneVerified: true };
  }

  async removePhone(user: User) {
    await this.prisma.user.update({ where: { id: user.id }, data: { phoneNumber: null, phoneVerifiedAt: null } });
    await this.audit.log(user.id, 'phone.removed', 'user', user.id);
    return { phoneVerified: false };
  }
}
