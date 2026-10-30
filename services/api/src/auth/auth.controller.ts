import { cityKeyOf } from '../regions/regions';
import { metrics } from '../common/observability';
import { Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { checkPassword, hashPassword } from '../common/password';
import { TtlCache } from '../common/ttl-cache';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, suspendedMessage } from '../common/auth';
import { AuditService } from '../common/audit.service';
import { EmailService } from '../common/email.service';
import { ApiError, E } from '../common/errors';
import { deviceFingerprint, deviceOverLimit, emailFingerprint, isBanned } from '../common/identity';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { decryptField, maskPhone } from '../common/vault';
import { VerificationService } from '../verification/verification.service';
import { ContactVerificationService } from './contact-verification.service';
import { GUEST_TTL_MS, GuestService } from './guest.service';
import { MfaService } from './mfa.controller';
import { SessionService } from './session.service';
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
export const confirmRegistrationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  ticket: z.string().min(10).max(100),
});
export const resendRegistrationSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), ticket: z.string().min(10).max(100) });
export const refreshSchema = z.object({ refreshToken: z.string().min(10).max(100) });
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

let dummy: Promise<string> | undefined;
/** A real password hash of nothing in particular, so a sign-in for an unknown address costs the same as one for a known address. */
const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

const profileStats = new TtlCache<[number, number]>(Number(process.env.PROFILE_STATS_CACHE_SECONDS ?? 30) * 1000);

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
    private readonly sessions: SessionService,
  ) {}

  /**
   * Proves that whoever asks to confirm a sign-up is the person who made it. It is worked out from the new account itself
   * (never stored), and only the original sign-up response carries it: someone who signs up again with an address that
   * already has an account gets a random value that matches nothing.
   */
  private ticketFor(u: { id: string; createdAt: Date }) {
    const secret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
    return createHmac('sha256', secret).update(`registration:${u.id}:${+u.createdAt}`).digest('base64url');
  }
  private ticketOk(u: { id: string; createdAt: Date }, given: string) {
    const want = Buffer.from(this.ticketFor(u));
    const got = Buffer.from(given);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  /**
   * Sign-up, step 1. The answer is the same whether or not the address already has an account, so nobody can use this to
   * find out who is a member: it always says "we sent a code" and hands back a ticket. A new address gets its account and a
   * real code; an address that already has one gets an email saying so (and a ticket that matches nothing).
   * Step 2 is `auth/register/confirm`, which signs the person in.
   */
  @Public()
  @Post('auth/register')
  async register(@Body() body: unknown, @Ip() ip: string, @Headers('x-device-id') deviceRaw?: string) {
    this.limiter.hit(`register:${ip}`, Number(process.env.REGISTER_LIMIT_PER_HOUR ?? 10), 60 * 60 * 1000);
    const dto = parse(registerSchema, body);
    // Starting over after being banned, or making accounts in bulk from one phone: one answer for both, no hints
    const device = deviceFingerprint(deviceRaw);
    if ((await isBanned(this.prisma, [{ kind: 'email', hash: emailFingerprint(dto.email) }, { kind: 'device', hash: device }])) || (await deviceOverLimit(this.prisma, device)))
      throw E.forbidden('REGISTRATION_BLOCKED', 'We cannot create an account for you right now. If you think this is a mistake, contact support.');
    const passwordHash = await hashPassword(dto.password); // the same work for a new address and a known one
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      await this.email
        .send(dto.email, 'Someone tried to sign up with your email', 'Someone tried to create a HERE & THERE account with this email address, but you already have one.\n\nIf it was you, sign in, or use "Forgot password" if you do not remember it. If it was not you, you can ignore this message; nothing was changed.')
        .catch(() => undefined);
      return { pending: true, email: dto.email, ticket: randomBytes(32).toString('base64url') };
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        adultConfirmed: true,
        registeredDevice: device,
        profile: { create: { displayName: dto.displayName, homeCity: dto.homeCity, homeCityKey: dto.homeCity ? cityKeyOf(dto.homeCity) : null } },
      },
      include: { profile: true },
    });
    metrics.count('signups');
    // Send the confirmation code right away. If delivery fails the account still exists and the person can ask for another.
    const sent = await this.contact.sendEmailCode(user).catch((e) => {
      console.error('Could not send verification email:', e?.message ?? e);
      return {} as { devCode?: string };
    });
    return { pending: true, email: dto.email, ticket: this.ticketFor(user), ...sent };
  }

  /** Sign-up, step 2: the 6-digit code from the email, with the ticket from step 1. Confirms the address and signs in. */
  @Public()
  @Post('auth/register/confirm')
  async confirmRegistration(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    const dto = parse(confirmRegistrationSchema, body);
    this.limiter.hit(`register-confirm:${ip}:${dto.email}`, 10, 15 * 60 * 1000);
    const bad = () => E.badRequest('INVALID_CODE', 'That code is not correct or has expired. Ask for a new one.');
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.role === 'guest' || user.emailVerifiedAt || !this.ticketOk(user, dto.ticket)) throw bad();
    try {
      await this.contact.verifyEmail(user, { code: dto.code });
    } catch (e) {
      if (e instanceof ApiError && e.getStatus() === 429) throw e;
      throw bad(); // wrong, expired or used up: one answer for all
    }
    const fresh = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } });
    return { ...(await this.sessions.issue(fresh, ua)), user: me(fresh) };
  }

  /** Sign-up: send the code again. The same quiet answer whatever the address or ticket. */
  @Public()
  @Post('auth/register/resend')
  async resendRegistration(@Body() body: unknown, @Ip() ip: string) {
    const dto = parse(resendRegistrationSchema, body);
    this.limiter.hit(`register-resend-cooldown:${dto.email}`, 1, 30_000);
    this.limiter.hit(`register-resend-ip:${ip}`, 20, 60 * 60 * 1000);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    let devCode: string | undefined;
    if (user && user.role !== 'guest' && !user.emailVerifiedAt && this.ticketOk(user, dto.ticket)) {
      const sent = await this.contact.sendEmailCode(user).catch(() => ({}) as { devCode?: string });
      devCode = sent.devCode;
    }
    return { ok: true, ...(devCode ? { devCode } : {}) };
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
  async login(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    const dto = parse(loginSchema, body);
    const window = 15 * 60 * 1000;
    this.limiter.hit(`login:${ip}:${dto.email}`, 10, window);
    // Wrong guesses are also counted for the account, whoever makes them and from wherever (so spreading a guessing attack
    // over many addresses does not help), and for the address, whichever accounts it aims at. A person whose account is
    // being attacked may be told to wait for up to 15 minutes; that is the price of not letting the guessing continue.
    this.limiter.check(`login-fail-account:${dto.email}`, 20, window);
    this.limiter.check(`login-fail-address:${ip}`, 100, window);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email }, include: { profile: true } });
    // an address with no account does the same amount of work, so the time taken does not give it away
    const ok = await checkPassword(dto.password, user?.passwordHash ?? (await dummyHash()));
    const accepted = !!user && ok;
    if (!user || !accepted) {
      this.limiter.record(`login-fail-account:${dto.email}`, window);
      this.limiter.record(`login-fail-address:${ip}`, window);
      throw E.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return this.openSession(user, ua);
  }

  /** The person has proved who they are (password or provider). Is their account open, and is a code needed too? */
  private async openSession(user: UserWithProfile, device?: string) {
    if (user.state === 'suspended') {
      if (user.suspendedUntil && user.suspendedUntil <= new Date()) {
        await this.prisma.user.update({ where: { id: user.id }, data: { state: 'active', suspendedUntil: null } });
        user.state = 'active';
      } else throw E.forbidden('ACCOUNT_SUSPENDED', suspendedMessage(user.suspendedUntil));
    }
    // two-step sign-in: the password was right, now ask for the code (no sign-in is issued yet)
    if (user.mfaEnabledAt) return { mfaRequired: true, mfaToken: await this.mfa.mfaToken(user) };
    return { ...(await this.sessions.issue(user, device)), user: me(user) };
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
  async socialLogin(@Body() body: unknown, @Ip() ip: string, @Headers('x-device-id') deviceRaw?: string, @Headers('user-agent') ua?: string) {
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
        metrics.count('signups');
        await this.audit.log(user.id, 'social.registered', 'user', user.id, { provider: who.provider });
      }
      await this.prisma.socialIdentity.create({ data: { userId: user.id, provider: who.provider, subject: who.subject } });
    }
    if (user.role !== 'user') throw E.forbidden('SOCIAL_NOT_FOR_STAFF', 'Staff accounts sign in with their password and a code.');
    return this.openSession(user, ua);
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
  async changePassword(@CurrentUser() u: User, @Body() body: unknown, @Headers('user-agent') ua?: string) {
    const dto = parse(changeSchema, body);
    this.limiter.hit(`pwchange:${u.id}`, 5, 15 * 60 * 1000);
    if (!(await checkPassword(dto.currentPassword, u.passwordHash))) throw E.unauthorized('WRONG_PASSWORD', 'Your current password is not correct');
    if (dto.currentPassword === dto.newPassword) throw E.badRequest('SAME_PASSWORD', 'Choose a password you have not used just now');
    const changedAt = await this.setPassword(u.id, dto.newPassword);
    await this.audit.log(u.id, 'password.changed', 'user', u.id);
    await this.tellPasswordChanged(u);
    return { ok: true, ...(await this.sessions.issue({ id: u.id, passwordChangedAt: changedAt, sessionsRevokedAt: u.sessionsRevokedAt }, ua)) };
  }

  private async setPassword(userId: string, password: string) {
    const changedAt = new Date();
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: changedAt } }),
      this.prisma.session.deleteMany({ where: { userId } }), // every other sign-in is over
    ]);
    return changedAt;
  }

  /** A notice to the address, so someone who did not do this finds out. A failed email never undoes the change. */
  private async tellPasswordChanged(user: User) {
    await this.email
      .send(user.email, 'Your HERE & THERE password was changed', 'The password for your HERE & THERE account was just changed, and any other device was signed out.\n\nIf this was not you, reset your password straight away and contact support.')
      .catch(() => undefined);
  }

  /** Swap a refresh token for a new pair of tokens. Public: the refresh token itself is the proof. */
  @Public()
  @Post('auth/refresh')
  async refresh(@Body() body: unknown, @Ip() ip: string) {
    const { refreshToken } = parse(refreshSchema, body);
    this.limiter.hit(`refresh:${ip}`, 120, 15 * 60 * 1000);
    return this.sessions.refresh(refreshToken);
  }

  /** Sign out of this device. Body (optional): { refreshToken }. */
  @Post('auth/logout')
  async logout(@CurrentUser() u: User, @Req() req: Request & { sessionId?: string }, @Body() body: { refreshToken?: unknown } | undefined) {
    await this.sessions.end(u.id, req.sessionId, body?.refreshToken);
    await this.audit.log(u.id, 'session.logout', 'user', u.id);
    return { ok: true };
  }

  /** Sign out of every device at once, this one included. Use it if a phone is lost or a sign-in may have been copied. */
  @Post('me/sessions/logout-all')
  async logoutAll(@CurrentUser() u: User) {
    this.limiter.hit(`logout-all:${u.id}`, 10, 60 * 60 * 1000);
    await this.sessions.endAll(u.id);
    await this.audit.log(u.id, 'session.logout_all', 'user', u.id);
    return { ok: true };
  }

  /** Where this account is signed in. */
  @Get('me/sessions')
  mySessions(@CurrentUser() u: User, @Req() req: Request & { sessionId?: string }) {
    return this.sessions.list(u.id, req.sessionId);
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
        ...(dto.homeCity !== undefined && { homeCity: dto.homeCity, homeCityKey: dto.homeCity ? cityKeyOf(dto.homeCity) : null }),
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
    // the two counts are the costly part of a profile and may be half a minute old; everything else is read fresh
    const [hosted, joined] = await profileStats.get(id, () =>
      Promise.all([
        this.prisma.activity.count({ where: { hostId: id, status: { notIn: ['cancelled', 'draft'] }, endsAt: { lt: new Date() } } }),
        this.prisma.activityMembership.count({ where: { userId: id, role: 'attendee', state: 'approved', activity: { endsAt: { lt: new Date() } } } }),
      ]),
    );
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
