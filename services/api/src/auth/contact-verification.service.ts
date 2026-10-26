import { Injectable, OnModuleInit } from '@nestjs/common';
import { User } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { EmailService } from '../common/email.service';
import { E } from '../common/errors';
import { isBanned } from '../common/identity';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { SmsService } from '../common/sms.service';
import { parse } from '../common/validate';
import { blindIndex, decryptField, encryptField, isEncrypted } from '../common/vault';

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
type Channel = 'email' | 'phone' | 'password' | 'email_change';

export const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
// International format only (E.164): "+" country code and number, 8 to 15 digits, e.g. +393331234567
export const phoneSchema = z.object({ phone: z.string().trim().transform((s) => s.replace(/[\s().-]/g, '')).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the number with its country code, e.g. +393331234567')) });

/**
 * Proves a user controls an email address (required before identity verification) or a mobile number (optional).
 * Codes are 6 digits, expire after 15 minutes, allow 5 wrong tries, and only a keyed hash is stored.
 */
@Injectable()
export class ContactVerificationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * Older accounts kept the number as plain text. Each one is encrypted once, here, when the API starts. Two accounts that
   * had somehow confirmed the same number keep it only on the first: the other has to confirm again.
   */
  async onModuleInit() {
    const rows = await this.prisma.user.findMany({ where: { phoneNumber: { not: null } }, select: { id: true, phoneNumber: true, phoneHash: true } });
    for (const r of rows) {
      if (isEncrypted(r.phoneNumber) && r.phoneHash) continue;
      const plain = decryptField(r.phoneNumber!);
      try {
        await this.prisma.user.update({ where: { id: r.id }, data: { phoneNumber: encryptField(plain), phoneHash: blindIndex('phone', plain) } });
      } catch {
        await this.prisma.user.update({ where: { id: r.id }, data: { phoneNumber: null, phoneHash: null, phoneVerifiedAt: null } });
        await this.audit.log(null, 'phone.duplicate_cleared', 'user', r.id);
      }
    }
  }

  /** One number, one account: refuses a number another account has already confirmed. */
  private async assertPhoneFree(phone: string, userId: string) {
    const taken = await this.prisma.user.findFirst({ where: { phoneHash: blindIndex('phone', phone), id: { not: userId } }, select: { id: true } });
    if (taken) throw E.conflict('PHONE_IN_USE', 'This number is already linked to another account');
    if (await isBanned(this.prisma, [{ kind: 'phone', hash: blindIndex('phone', phone) }])) throw E.forbidden('PHONE_BLOCKED', 'This number cannot be used. Contact support if you think this is a mistake.');
  }

  private hash(userId: string, channel: Channel, code: string) {
    const secret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
    return createHmac('sha256', secret).update(`${userId}:${channel}:${code}`).digest('hex');
  }

  /** Issues a new code (replacing any earlier one) and hands it to `deliver`. */
  private async issue(user: User, channel: Channel, target: string | null, deliver: (code: string) => Promise<void>, limits = true) {
    if (limits) {
      this.limiter.hit(`${channel}-cooldown:${user.id}`, 1, 30_000); // one code every 30 s
      this.limiter.hit(`${channel}-hourly:${user.id}`, 5, 60 * 60 * 1000); // and five per hour
    }

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

  // ---------------------------------------------------------------- changing the email address
  /** Emails a code to the NEW address. Only when it is entered does the account's email change. */
  async sendEmailChangeCode(user: User, newEmail: string): Promise<{ devCode?: string }> {
    return this.issue(user, 'email_change', newEmail, (code) =>
      this.email.send(newEmail, 'Confirm your new HERE & THERE email', `Your confirmation code is ${code}.\n\nIt expires in 15 minutes. If you did not ask to use this address for HERE & THERE, you can ignore this email.`),
    );
  }

  checkEmailChangeCode(user: User, code: string) {
    return this.consume(user, 'email_change', { code });
  }

  // ---------------------------------------------------------------- forgotten password
  /** Emails a reset code. The caller has already applied the rate limits (they are keyed by the address, not the account). */
  async sendPasswordResetCode(user: User): Promise<{ devCode?: string }> {
    return this.issue(
      user,
      'password',
      null,
      (code) =>
        this.email.send(
          user.email,
          'Reset your HERE & THERE password',
          `Your password reset code is ${code}.\n\nIt expires in 15 minutes. If you did not ask to reset your password, you can ignore this email: your password has not changed.`,
        ),
      false,
    );
  }

  /** Checks a reset code (wrong tries are counted). Returns the row; the caller marks it used once the password is changed. */
  checkPasswordResetCode(user: User, code: string) {
    return this.consume(user, 'password', { code });
  }

  /** Every unused reset code of this account stops working. */
  async dropPasswordResetCodes(userId: string) {
    await this.prisma.contactCode.updateMany({ where: { userId, channel: 'password', usedAt: null }, data: { usedAt: new Date() } });
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
    await this.assertPhoneFree(phone, user.id);
    // the number waits next to the code, so it is stored encrypted like everywhere else
    return this.issue(user, 'phone', encryptField(phone), (code) => this.sms.send(phone, `Your HERE & THERE code is ${code}. It expires in 15 minutes.`));
  }

  async verifyPhone(user: User, body: unknown) {
    const row = await this.consume(user, 'phone', body);
    if (!row.target) throw E.badRequest('CODE_EXPIRED', 'Request a new code for your number.');
    const phone = decryptField(row.target);
    await this.assertPhoneFree(phone, user.id);
    try {
      await this.prisma.$transaction([
        this.prisma.contactCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
        this.prisma.user.update({ where: { id: user.id }, data: { phoneNumber: encryptField(phone), phoneHash: blindIndex('phone', phone), phoneVerifiedAt: new Date() } }),
      ]);
    } catch {
      throw E.conflict('PHONE_IN_USE', 'This number is already linked to another account'); // someone confirmed it a moment earlier
    }
    await this.audit.log(user.id, 'phone.verified', 'user', user.id);
    return { phoneVerified: true };
  }

  async removePhone(user: User) {
    await this.prisma.user.update({ where: { id: user.id }, data: { phoneNumber: null, phoneHash: null, phoneVerifiedAt: null } });
    await this.audit.log(user.id, 'phone.removed', 'user', user.id);
    return { phoneVerified: false };
  }
}
