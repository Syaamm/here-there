import { Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, passwordVersion, suspendedMessage } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { EmailService } from '../common/email.service';
import { E } from '../common/errors';
import { deviceFingerprint, deviceOverLimit, emailFingerprint, isBanned } from '../common/identity';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { decryptField, maskPhone } from '../common/vault';
import { VerificationService } from '../verification/verification.service';
import { ContactVerificationService } from './contact-verification.service';
import { GUEST_TTL_MS, GuestService } from './guest.service';
import { MfaService } from './mfa.controller';
import { SocialService } from './social.service';
import { ReliabilityService } from '../reliability/reliability.controller';

/** Where the app reached the API, so provider-hosted pages can link back to it. */
const baseUrlOf = (req: Request) => `${req.protocol}://${req.get('host')}`;

const csv = (a: string[]) => a.join(',');
const list = (s: string) => (s ? s.split(',') : []);

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(2).max(40),
  homeCity: z.string().trim().max(60).optional(),
  adultConfirmed: z.literal(true, { error: 'You must confirm you are 18 or older' }),
});

const newPassword = z.string().min(10, 'Use at least 10 characters').max(200);
export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });
export const resetSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword,
});
export const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword });

export const socialSchema = z.object({
  provider: z.enum(['apple', 'google']),
  idToken: z.string().min(20).max(6000),
  adultConfirmed: z.boolean().optional(), // needed the first time, when the account is created
  displayName: z.string().trim().min(2).max(40).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  homeCity: z.string().trim().max(60).nullable().optional(),
  languages: z.array(z.string().trim().min(2).max(20)).max(8).optional(),
  interests: z.array(z.string().trim().min(2).max(24)).max(15).optional(),
  bio: z.string().trim().max(300).nullable().optional(),
});

type UserWithProfile = User & { profile: { displayName: string; homeCity: string | null; languages: string; interests: string; bio: string | null; photoUrl: string | null } | null };

function me(u: UserWithProfile) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    // Three separate statuses. None of them implies another.
    emailVerified: !!u.emailVerifiedAt, // 1. email: the user controls this address
    adultConfirmed: u.adultConfirmed, // 2. adult: self-declared at sign-up ...
    adultVerified: !!u.adultVerifiedAt, //    ... and confirmed (18+) by the provider or staff. No birth date is kept.
    eligibility: u.eligibility, // 3. identity: unverified | pending | verified | rejected | expired | reverification_required
    verifiedUntil: u.eligibility === 'verified' ? u.verifiedUntil : null,
    reverifyReason: u.reverifyReason,
    phoneVerified: !!u.phoneVerifiedAt, // optional, gates nothing
    phone: u.phoneNumber && u.phoneVerifiedAt ? maskPhone(decryptField(u.phoneNumber)) : null,
    profile: u.profile && {
      displayName: u.profile.displayName,
      homeCity: u.profile.homeCity,
      languages: list(u.profile.languages),
      interests: list(u.profile.interests),
      bio: u.profile.bio,
      photoUrl: u.profile.photoUrl,
    },
  };
}

@Controller('v1')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly limiter: RateLimiter,
    private readonly verification: VerificationService,
    private readonly contact: ContactVerificationService,
    private readonly guests: GuestService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
    private readonly social: SocialService,
    private readonly reliability: ReliabilityService,
  ) {}

  /** A sign-in token. `pv` ties it to the current password, so changing the password signs every older sign-in out. */
  private token(user: Pick<User, 'id' | 'passwordChangedAt'>) {
    return this.jwt.signAsync({ sub: user.id, pv: passwordVersion(user.passwordChangedAt) });
  }

  @Public()
  @Post('auth/register')
  async register(@Body() body: unknown, @Ip() ip: string, @Headers('x-device-id') deviceRaw?: string) {
    this.limiter.hit(`register:${ip}`, Number(process.env.REGISTER_LIMIT_PER_HOUR ?? 10), 60 * 60 * 1000);
    const dto = parse(registerSchema, body);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } }))
      throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    // Starting over after being banned, or making accounts in bulk from one phone: one answer for both, no hints
    const device = deviceFingerprint(deviceRaw);
    if ((await isBanned(this.prisma, [{ kind: 'email', hash: emailFingerprint(dto.email) }, { kind: 'device', hash: device }])) || (await deviceOverLimit(this.prisma, device)))
      throw E.forbidden('REGISTRATION_BLOCKED', 'We cannot create an account for you right now. If you think this is a mistake, contact support.');
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, Number(process.env.BCRYPT_ROUNDS ?? 12)),
        adultConfirmed: true,
        registeredDevice: device,
        profile: { create: { displayName: dto.displayName, homeCity: dto.homeCity } },
      },
      include: { profile: true },
    });
    // Send the confirmation code right away. If delivery fails the account still exists and the user can re-send.
    const sent = await this.contact.sendEmailCode(user).catch((e) => {
      console.error('Could not send verification email:', e?.message ?? e);
      return {} as { devCode?: string };
    });
    return { token: await this.token(user), user: me(user), ...sent };
  }

  /** "Explore demo": a temporary read-only guest session, no sign-up. See GuestService. */
  @Public()
  @Post('auth/guest')
  async guest(@Ip() ip: string) {
    this.limiter.hit(`guest:${ip}`, Number(process.env.GUEST_LIMIT_PER_HOUR ?? 30), 60 * 60 * 1000);
    const user = await this.guests.create();
    const token = await this.jwt.signAsync({ sub: user.id }, { expiresIn: Math.floor(GUEST_TTL_MS / 1000) });
    return { token, user: me(user) };
  }

  @Public()
  @Post('auth/login')
  async login(@Body() body: unknown, @Ip() ip: string) {
    const dto = parse(loginSchema, body);
    const window = 15 * 60 * 1000;
    this.limiter.hit(`login:${ip}:${dto.email}`, 10, window);
    // Wrong guesses are also counted for the account, whoever makes them and from wherever (so spreading a guessing attack
    // over many addresses does not help), and for the address, whichever accounts it aims at. A person whose account is
    // being attacked may be told to wait for up to 15 minutes; that is the price of not letting the guessing continue.
    this.limiter.check(`login-fail-account:${dto.email}`, 20, window);
    this.limiter.check(`login-fail-address:${ip}`, 100, window);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email }, include: { profile: true } });
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) {
      this.limiter.record(`login-fail-account:${dto.email}`, window);
      this.limiter.record(`login-fail-address:${ip}`, window);
      throw E.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return this.openSession(user);
  }

  /** The person has proved who they are (password or provider). Is their account open, and is a code needed too? */
  private async openSession(user: UserWithProfile) {
    if (user.state === 'suspended') {
      if (user.suspendedUntil && user.suspendedUntil <= new Date()) {
        await this.prisma.user.update({ where: { id: user.id }, data: { state: 'active', suspendedUntil: null } });
        user.state = 'active';
      } else throw E.forbidden('ACCOUNT_SUSPENDED', suspendedMessage(user.suspendedUntil));
    }
    // two-step sign-in: the password was right, now ask for the code (no sign-in is issued yet)
    if (user.mfaEnabledAt) return { mfaRequired: true, mfaToken: await this.mfa.mfaToken(user) };
    return { token: await this.token(user), user: me(user) };
  }

  /** Which providers are switched on (they need the app ids from Apple and Google), so the app only shows working buttons. */
  @Public()
  @Get('auth/social/providers')
  socialProviders() {
    return this.social.enabled();
  }

  /**
   * "Sign in with Apple / Google". Body: { provider, idToken, adultConfirmed?, displayName? }. The token is checked against
   * the provider's keys. Someone who already signed in this way comes straight in; an existing account with the same
   * CONFIRMED email is linked; otherwise a new account is made (that needs the 18+ confirmation).
   */
  @Public()
  @Post('auth/social')
  async socialLogin(@Body() body: unknown, @Ip() ip: string, @Headers('x-device-id') deviceRaw?: string) {
    const dto = parse(socialSchema, body);
    this.limiter.hit(`social:${ip}`, 30, 60 * 60 * 1000);
    const who = await this.social.verifyIdToken(dto.provider, dto.idToken);

    const linked = await this.prisma.socialIdentity.findUnique({ where: { provider_subject: { provider: who.provider, subject: who.subject } }, include: { user: { include: { profile: true } } } });
    let user: UserWithProfile | null = linked?.user ?? null;
    if (!user) {
      if (!who.email || !who.emailVerified) throw E.badRequest('EMAIL_REQUIRED', 'We need a confirmed email address from your account to sign you in.');
      const existing = await this.prisma.user.findUnique({ where: { email: who.email }, include: { profile: true } });
      if (existing) {
        // never hand an account to whoever claims its email first: only an email its owner has confirmed can be linked
        if (!existing.emailVerifiedAt) throw E.conflict('ACCOUNT_EXISTS', 'An account with this email already exists. Log in with its password instead.');
        user = existing;
        await this.audit.log(user.id, 'social.linked', 'user', user.id, { provider: who.provider });
      } else {
        if (dto.adultConfirmed !== true) throw E.badRequest('ADULT_CONFIRMATION_REQUIRED', 'You must confirm you are 18 or older to create an account');
        const device = deviceFingerprint(deviceRaw);
        if ((await isBanned(this.prisma, [{ kind: 'email', hash: emailFingerprint(who.email) }, { kind: 'device', hash: device }])) || (await deviceOverLimit(this.prisma, device)))
          throw E.forbidden('REGISTRATION_BLOCKED', 'We cannot create an account for you right now. If you think this is a mistake, contact support.');
        const shown = (dto.displayName ?? who.name ?? who.email.split('@')[0]).trim().slice(0, 40);
        user = await this.prisma.user.create({
          data: {
            email: who.email,
            passwordHash: '!' + randomBytes(16).toString('hex'), // no password: signing in is by the provider (a password can be set with "Forgot password")
            adultConfirmed: true,
            emailVerifiedAt: new Date(),
            registeredDevice: device,
            profile: { create: { displayName: shown.length >= 2 ? shown : 'Member' } },
          },
          include: { profile: true },
        });
        await this.audit.log(user.id, 'social.registered', 'user', user.id, { provider: who.provider });
      }
      await this.prisma.socialIdentity.create({ data: { userId: user.id, provider: who.provider, subject: who.subject } });
    }
    if (user.role !== 'user') throw E.forbidden('SOCIAL_NOT_FOR_STAFF', 'Staff accounts sign in with their password and a code.');
    return this.openSession(user);
  }

  /**
   * Forgotten password, step 1: emails a 6-digit code to the address if an account has it. The answer is the same
   * whether or not the account exists, so this cannot be used to find out who has one.
   */
  @Public()
  @Post('auth/password/forgot')
  async forgotPassword(@Body() body: unknown, @Ip() ip: string) {
    const { email } = parse(forgotSchema, body);
    this.limiter.hit(`pwreset-cooldown:${email}`, 1, 30_000); // one code every 30 s, per address
    this.limiter.hit(`pwreset-hourly:${email}`, 5, 60 * 60 * 1000);
    this.limiter.hit(`pwreset-ip:${ip}`, 20, 60 * 60 * 1000);
    const user = await this.prisma.user.findUnique({ where: { email } });
    let devCode: string | undefined;
    if (user && user.role !== 'guest') {
      const sent = await this.contact.sendPasswordResetCode(user).catch((e) => {
        console.error('Could not send password reset email:', e?.message ?? e);
        return {} as { devCode?: string };
      });
      devCode = sent.devCode;
      await this.audit.log(user.id, 'password.reset_requested', 'user', user.id);
    }
    return { ok: true, ...(devCode ? { devCode } : {}) };
  }

  /** Forgotten password, step 2: the code from the email and a new password. Every earlier sign-in stops working. */
  @Public()
  @Post('auth/password/reset')
  async resetPassword(@Body() body: unknown, @Ip() ip: string) {
    const dto = parse(resetSchema, body);
    this.limiter.hit(`pwreset-try:${ip}:${dto.email}`, 10, 15 * 60 * 1000);
    const bad = () => E.badRequest('INVALID_CODE', 'That code is not correct or has expired. Ask for a new one.');
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.role === 'guest') throw bad();
    let row;
    try {
      row = await this.contact.checkPasswordResetCode(user, dto.code);
    } catch {
      throw bad(); // wrong, expired, used up or never asked for: one answer for all, so nothing is revealed
    }
    await this.setPassword(user.id, dto.newPassword);
    await this.prisma.contactCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await this.contact.dropPasswordResetCodes(user.id);
    await this.audit.log(user.id, 'password.reset', 'user', user.id);
    await this.tellPasswordChanged(user);
    return { ok: true };
  }

  /** Change the password while signed in. Other devices are signed out; this one gets a fresh sign-in. */
  @Post('me/password')
  async changePassword(@CurrentUser() u: User, @Body() body: unknown) {
    const dto = parse(changeSchema, body);
    this.limiter.hit(`pwchange:${u.id}`, 5, 15 * 60 * 1000);
    if (!(await bcrypt.compare(dto.currentPassword, u.passwordHash))) throw E.unauthorized('WRONG_PASSWORD', 'Your current password is not correct');
    if (dto.currentPassword === dto.newPassword) throw E.badRequest('SAME_PASSWORD', 'Choose a password you have not used just now');
    const changedAt = await this.setPassword(u.id, dto.newPassword);
    await this.audit.log(u.id, 'password.changed', 'user', u.id);
    await this.tellPasswordChanged(u);
    return { ok: true, token: await this.token({ id: u.id, passwordChangedAt: changedAt }) };
  }

  private async setPassword(userId: string, password: string) {
    const changedAt = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS ?? 12)), passwordChangedAt: changedAt },
    });
    return changedAt;
  }

  /** A notice to the address, so someone who did not do this finds out. A failed email never undoes the change. */
  private async tellPasswordChanged(user: User) {
    await this.email
      .send(user.email, 'Your HERE & THERE password was changed', 'The password for your HERE & THERE account was just changed, and any other device was signed out.\n\nIf this was not you, reset your password straight away and contact support.')
      .catch(() => undefined);
  }

  @Get('me')
  async getMe(@CurrentUser() u: User) {
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { profile: true } });
    return me(full);
  }

  @Patch('me/profile')
  async updateProfile(@CurrentUser() u: User, @Body() body: unknown) {
    const dto = parse(profileSchema, body);
    const bad = contentProblem(dto.bio) ?? contentProblem(dto.displayName);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    await this.prisma.profile.update({
      where: { userId: u.id },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.homeCity !== undefined && { homeCity: dto.homeCity }),
        ...(dto.languages && { languages: csv(dto.languages) }),
        ...(dto.interests && { interests: csv(dto.interests) }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
      },
    });
    return this.getMe(u);
  }

  /** Emails a fresh 6-digit code (also used for "resend"). */
  @Post('me/email/send-code')
  async sendEmailCode(@CurrentUser() u: User) {
    return { emailVerified: !!u.emailVerifiedAt, ...(await this.contact.sendEmailCode(u)) };
  }

  /** Body: { code: "123456" } */
  @Post('me/email/verify')
  verifyEmail(@CurrentUser() u: User, @Body() body: unknown) {
    return this.contact.verifyEmail(u, body);
  }

  /** Optional mobile number. Body: { phone: "+393331234567" }. Nothing in the app is gated on it. */
  @Post('me/phone/send-code')
  sendPhoneCode(@CurrentUser() u: User, @Body() body: unknown) {
    return this.contact.sendPhoneCode(u, body);
  }

  /** Body: { code: "123456" } */
  @Post('me/phone/verify')
  verifyPhone(@CurrentUser() u: User, @Body() body: unknown) {
    return this.contact.verifyPhone(u, body);
  }

  @Delete('me/phone')
  removePhone(@CurrentUser() u: User) {
    return this.contact.removePhone(u);
  }

  @Get('me/verification')
  verificationStatus(@CurrentUser() u: User, @Req() req: Request) {
    return this.verification.status(u, baseUrlOf(req));
  }

  /** Abandon an in-progress check and start over. */
  @Delete('me/verification')
  cancelVerification(@CurrentUser() u: User) {
    return this.verification.cancel(u);
  }

  /**
   * Body: { consent: true, method?: "face" | "document" }. Explicit consent is mandatory. `document` is the check with
   * no selfie and no face match, for people who cannot or will not do the facial one.
   * Returns { eligibility, url? }: url is the provider's hosted page (ID photo + selfie with liveness) to open.
   * A verified, unexpired user gets { eligibility: "verified" } and is never asked again.
   */
  @Post('me/verification')
  startVerification(@CurrentUser() u: User, @Body() body: { consent?: unknown; method?: unknown } | undefined, @Req() req: Request) {
    return this.verification.start(u, body?.consent, baseUrlOf(req), body?.method);
  }

  /** Public profile: no email, no internal fields, only the verified-adult badge. */
  @Get('users/:id')
  async publicProfile(@CurrentUser() me: User, @Param('id') id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { profile: true } });
    if (!u || u.state !== 'active' || !u.profile) throw E.notFound('User');
    const [hosted, joined] = await Promise.all([
      this.prisma.activity.count({ where: { hostId: id, status: { notIn: ['cancelled', 'draft'] }, endsAt: { lt: new Date() } } }),
      this.prisma.activityMembership.count({ where: { userId: id, role: 'attendee', state: 'approved', activity: { endsAt: { lt: new Date() } } } }),
    ]);
    const [iFollow, followsMe] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me.id, followingId: id } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: id, followingId: me.id } } }),
    ]);
    return {
      relation: { following: !!iFollow, followsYou: !!followsMe, buddy: !!iFollow && !!followsMe },
      id: u.id,
      displayName: u.profile.displayName,
      homeCity: u.profile.homeCity,
      languages: list(u.profile.languages),
      interests: list(u.profile.interests),
      bio: u.profile.bio,
      photoUrl: u.profile.photoUrl,
      verifiedAdult: u.eligibility === 'verified',
      // verified members see each other's level; anyone else sees nothing
      reliability: (await this.reliability.forViewer(me, [id])).get(id) ?? null,
      stats: { activitiesHosted: hosted, activitiesJoined: joined },
    };
  }
}
