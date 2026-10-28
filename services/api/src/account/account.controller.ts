import { Body, Controller, Get, Injectable, Post, Query, Req, Res } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ActivitiesService } from '../activities/activities.service';
import { ContactVerificationService } from '../auth/contact-verification.service';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Public } from '../common/auth';
import { EmailService } from '../common/email.service';
import { E } from '../common/errors';
import { LiveService } from '../common/live.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';
import { decryptField } from '../common/vault';
import { ReliabilityService } from '../reliability/reliability.controller';
import { TripsService } from '../trips/trips.service';
import { zipSync, strToU8 } from 'fflate';
import { VerificationService } from '../verification/verification.service';

const DAY = 24 * 3600 * 1000;
const MESSAGE_CAP = 5000; // the newest this many of your messages go in the export
const ZIP_LINK_SECONDS = 120; // the download link works for two minutes

export const deleteSchema = z.object({ password: z.string().min(1), confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }) });
export const changeEmailSchema = z.object({ newEmail: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(1) });
export const confirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

/**
 * Your data: a copy of it (export), correcting it (a new email address; the rest is Edit profile), and deleting the
 * account (erasure). Deleting keeps a bare tombstone row, so other people's plans, chats and safety reports that point at
 * this person stay intact, but nothing about them is kept: no name, email, photo, bio, messages or identity data.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivitiesService,
    private readonly trips: TripsService,
    private readonly contact: ContactVerificationService,
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly limiter: RateLimiter,
    private readonly live: LiveService,
    private readonly reliability: ReliabilityService,
  ) {}

  // ---------------------------------------------------------------- export
  /**
   * A copy of everything held about this person (GDPR access and portability), as a ZIP, behind a short-lived signed link (a phone
   * opens it in the browser, so it cannot send a login header). One copy a day.
   */
  zipLink(me: User, langRaw: unknown, baseUrl: string) {
    this.limiter.hit(`export:${me.id}`, 1, DAY);
    const lang = langRaw === 'it' ? 'it' : 'en';
    const exp = Math.floor(Date.now() / 1000) + ZIP_LINK_SECONDS;
    const body = `${me.id}.${exp}.${lang}`;
    return { url: `${baseUrl}/v1/export/zip?t=${body}.${this.zipSignature(body)}`, expiresInSeconds: ZIP_LINK_SECONDS };
  }

  private zipSignature(body: string) {
    return createHmac('sha256', process.env.JWT_SECRET ?? 'dev-only-secret-change-me').update(`export-zip:${body}`).digest('base64url');
  }

  /** Checks the link (signature and age), then builds the ZIP in memory: the complete JSON copy and a short note on it. */
  async zip(token: string) {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 4) throw E.badRequest('INVALID_LINK', 'This download link is not valid');
    const [uid, exp, lang, sig] = parts;
    const want = this.zipSignature(`${uid}.${exp}.${lang}`);
    const okSig = sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
    if (!okSig || (lang !== 'en' && lang !== 'it')) throw E.badRequest('INVALID_LINK', 'This download link is not valid');
    if (Number(exp) < Date.now() / 1000) throw E.badRequest('LINK_EXPIRED', 'This download link has expired. Ask for a new one.');
    const me = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!me || me.state !== 'active') throw E.notFound('Account');
    const data = await this.collect(me);
    await this.audit.log(me.id, 'account.exported', 'user', me.id);
    const note =
      lang === 'it'
        ? 'HERE & THERE: la tua copia dei dati\r\n\r\nmy-data.json contiene tutto ciò che conserviamo su di te: account, profilo, piani, messaggi, avvisi e cronologia. Non include la tua password né i dati privati di altre persone. Tienilo al sicuro.\r\n'
        : "HERE & THERE: your copy of your data\r\n\r\nmy-data.json holds everything we keep about you: account, profile, plans, messages, alerts and history. It does not include your password or other people's private details. Keep it safe.\r\n";
    return Buffer.from(zipSync({ 'my-data.json': strToU8(JSON.stringify(data, null, 2)), 'README.txt': strToU8(note) }, { level: 6 }));
  }

  private async collect(me: User) {
    const id = me.id;
    const [user, profile, hosted, memberships, requests, tripsHosted, tripMemberships, applications, favorites, tripFavorites, following, followers, blocks, messages, notifications, reports, checks, activity] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id } }),
        this.prisma.profile.findUnique({ where: { userId: id } }),
        this.prisma.activity.findMany({ where: { hostId: id }, orderBy: { startsAt: 'desc' } }),
        this.prisma.activityMembership.findMany({ where: { userId: id }, include: { activity: { select: { id: true, title: true, startsAt: true } } } }),
        this.prisma.activityRequest.findMany({ where: { applicantId: id }, include: { activity: { select: { id: true, title: true, startsAt: true } } } }),
        this.prisma.trip.findMany({ where: { hostId: id }, orderBy: { dateStart: 'desc' } }),
        this.prisma.tripMembership.findMany({ where: { userId: id }, include: { trip: { select: { id: true, title: true, dateStart: true } } } }),
        this.prisma.tripApplication.findMany({ where: { applicantId: id }, include: { trip: { select: { id: true, title: true, dateStart: true } } } }),
        this.prisma.favorite.findMany({ where: { userId: id }, include: { activity: { select: { id: true, title: true, startsAt: true } } } }),
        this.prisma.tripFavorite.findMany({ where: { userId: id }, include: { trip: { select: { id: true, title: true, dateStart: true } } } }),
        this.prisma.follow.findMany({ where: { followerId: id }, include: { following: { select: { id: true, profile: { select: { displayName: true } } } } } }),
        this.prisma.follow.findMany({ where: { followingId: id }, include: { follower: { select: { id: true, profile: { select: { displayName: true } } } } } }),
        this.prisma.block.findMany({ where: { blockerId: id }, include: { blocked: { select: { id: true, profile: { select: { displayName: true } } } } } }),
        this.prisma.message.findMany({ where: { senderId: id }, orderBy: { createdAt: 'desc' }, take: MESSAGE_CAP + 1, include: { conversation: { select: { id: true, scopeType: true, activity: { select: { title: true } }, trip: { select: { title: true } } } } } }),
        this.prisma.notification.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 1000 }),
        this.prisma.report.findMany({ where: { reporterId: id }, orderBy: { createdAt: 'desc' } }),
        this.prisma.verificationCheck.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
        this.prisma.auditEvent.findMany({ where: { actorId: id }, orderBy: { createdAt: 'desc' }, take: 1000 }),
      ]);
    const who = (u: { id: string; profile: { displayName: string } | null }) => ({ userId: u.id, displayName: u.profile?.displayName ?? null });
    return {
      format: 'herethere-export-v1',
      exportedAt: new Date().toISOString(),
      note: 'Everything HERE & THERE holds about you, except your password (we only keep a scrambled form of it) and other people\'s private details. Safety reports about you, and the records staff keep of their own decisions, are not included.',
      account: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        role: user.role,
        state: user.state,
        emailVerified: !!user.emailVerifiedAt,
        phoneNumber: user.phoneNumber ? decryptField(user.phoneNumber) : null,
        phoneVerified: !!user.phoneVerifiedAt,
        adultConfirmed: user.adultConfirmed,
        adultVerified: !!user.adultVerifiedAt,
        identityStatus: user.eligibility,
        identityValidUntil: user.verifiedUntil,
        passwordChangedAt: user.passwordChangedAt,
      },
      profile: profile && { displayName: profile.displayName, homeCity: profile.homeCity, languages: profile.languages ? profile.languages.split(',') : [], interests: profile.interests ? profile.interests.split(',') : [], bio: profile.bio, hasPhoto: !!profile.photoUrl },
      activities: {
        hosted: hosted.map((a) => ({ id: a.id, title: a.title, category: a.category, city: a.city, venue: a.venueName, startsAt: a.startsAt, endsAt: a.endsAt, capacity: a.capacity, status: a.status, description: a.description })),
        joined: memberships.map((m) => ({ activityId: m.activityId, title: m.activity.title, startsAt: m.activity.startsAt, role: m.role, state: m.state, attendance: m.attendance, since: m.createdAt })),
        requests: requests.map((r) => ({ activityId: r.activityId, title: r.activity.title, state: r.state, intro: r.intro, askedAt: r.createdAt, decidedAt: r.decidedAt })),
      },
      trips: {
        organised: tripsHosted.map((t) => ({ id: t.id, title: t.title, destination: t.destination, dateStart: t.dateStart, dateEnd: t.dateEnd, status: t.status, description: t.description })),
        joined: tripMemberships.map((m) => ({ tripId: m.tripId, title: m.trip.title, dateStart: m.trip.dateStart, role: m.role, state: m.state })),
        applications: applications.map((a) => ({ tripId: a.tripId, title: a.trip.title, state: a.state, intro: a.intro, appliedAt: a.createdAt })),
      },
      favourites: favorites.map((f) => ({ activityId: f.activityId, title: f.activity.title, savedAt: f.createdAt })),
      favouriteTrips: tripFavorites.map((f) => ({ tripId: f.tripId, title: f.trip.title, savedAt: f.createdAt })),
      following: following.map((f) => ({ ...who(f.following), since: f.createdAt })),
      followers: followers.map((f) => ({ ...who(f.follower), since: f.createdAt })),
      blocked: blocks.map((b) => ({ ...who(b.blocked), since: b.createdAt })),
      messages: {
        truncated: messages.length > MESSAGE_CAP,
        items: messages.slice(0, MESSAGE_CAP).map((m) => ({ sentAt: m.createdAt, in: m.conversation.activity?.title ?? m.conversation.trip?.title ?? null, kind: m.kind, body: m.body })),
      },
      notifications: notifications.map((n) => ({ at: n.createdAt, type: n.type, title: n.title, body: n.body, read: !!n.readAt })),
      reportsYouFiled: reports.map((r) => ({ at: r.createdAt, about: r.targetType, category: r.category, details: r.details, status: r.status })),
      // the level, and everything it is worked out from (the app only shows the level)
      reliability: await this.reliability.detailsFor(id),
      warnings: (await this.prisma.userWarning.findMany({ where: { userId: id } })).map((w) => ({ reason: w.reason, at: w.createdAt, withdrawn: !!w.withdrawnAt })),
      travelMatching: await this.prisma.travelMatchPref.findUnique({ where: { userId: id }, select: { destination: true, dateStart: true, dateEnd: true } }),
      tripPlanLines: (await this.prisma.tripItem.findMany({ where: { createdById: id } })).map((i) => ({ tripId: i.tripId, kind: i.kind, title: i.title, note: i.note, day: i.day, amount: i.amount })),
      drafts: (await this.prisma.draft.findMany({ where: { userId: id } })).map((d) => ({ kind: d.kind, data: JSON.parse(d.data), savedAt: d.updatedAt })),
      appeals: (await this.prisma.appeal.findMany({ where: { userId: id } })).map((a) => ({ kind: a.kind, message: a.message, state: a.state, decision: a.decision, createdAt: a.createdAt, decidedAt: a.decidedAt })),
      identityChecks: checks.map((c) => ({ provider: c.provider, outcome: c.eligibility, startedAt: c.createdAt, decidedAt: c.decidedAt, validUntil: c.expiresAt, consentGivenAt: c.consentAt })),
      accountActivity: activity.map((a) => ({ at: a.createdAt, action: a.action, about: a.objectType })),
    };
  }

  // ---------------------------------------------------------------- correct: a new email address
  async startEmailChange(me: User, body: unknown) {
    const dto = parse(changeEmailSchema, body);
    this.limiter.hit(`email-change:${me.id}`, 5, 15 * 60 * 1000);
    if (!(await bcrypt.compare(dto.password, me.passwordHash))) throw E.unauthorized('WRONG_PASSWORD', 'Your password is not correct');
    if (dto.newEmail === me.email) throw E.badRequest('SAME_EMAIL', 'That is already your email address');
    if (await this.prisma.user.findUnique({ where: { email: dto.newEmail } })) throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    return { ok: true, ...(await this.contact.sendEmailChangeCode(me, dto.newEmail)) };
  }

  async confirmEmailChange(me: User, body: unknown) {
    const { code } = parse(confirmSchema, body);
    const row = await this.contact.checkEmailChangeCode(me, code);
    if (!row.target) throw E.badRequest('CODE_EXPIRED', 'Start the change again.');
    const old = me.email;
    try {
      await this.prisma.$transaction([
        this.prisma.contactCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
        // the code went to the new address, so it is proven to be theirs
        this.prisma.user.update({ where: { id: me.id }, data: { email: row.target, emailVerifiedAt: new Date() } }),
      ]);
    } catch {
      throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }
    await this.audit.log(me.id, 'email.changed', 'user', me.id);
    // the old address is told, so a stranger who got in cannot quietly take the account over
    await this.email.send(old, 'Your HERE & THERE email address was changed', `The email address of your HERE & THERE account was changed to ${row.target}.\n\nIf this was not you, reset your password straight away and contact support.`).catch(() => undefined);
    return { ok: true, email: row.target };
  }

  // ---------------------------------------------------------------- erase
  async delete(me: User, body: unknown) {
    const dto = parse(deleteSchema, body);
    this.limiter.hit(`delete-account:${me.id}`, 5, 15 * 60 * 1000);
    if (!(await bcrypt.compare(dto.password, me.passwordHash))) throw E.unauthorized('WRONG_PASSWORD', 'Your password is not correct');
    if (me.role !== 'user') throw E.forbidden('STAFF_ACCOUNT', 'Staff accounts are closed by an administrator.');
    if (me.state === 'suspended') throw E.forbidden('ACCOUNT_SUSPENDED', 'This account is suspended, so it cannot be deleted from here. Contact support.');
    const id = me.id;
    const now = new Date();

    // 1. Let the people who were counting on you know, by using the normal ways of leaving, so alerts and waiting lists work.
    const open = { status: { notIn: ['cancelled', 'completed', 'archived'] }, endsAt: { gt: now } };
    for (const a of await this.prisma.activity.findMany({ where: { hostId: id, ...open }, select: { id: true } })) await this.activities.cancel(me, a.id).catch(() => undefined);
    for (const m of await this.prisma.activityMembership.findMany({ where: { userId: id, state: 'approved', activity: open }, select: { activityId: true } })) await this.activities.leave(me, m.activityId).catch(() => undefined);
    for (const r of await this.prisma.activityRequest.findMany({ where: { applicantId: id, state: { in: ['requested', 'waitlisted'] } }, select: { activityId: true } })) await this.activities.withdraw(me, r.activityId).catch(() => undefined);
    const tripOpen = { status: { notIn: ['cancelled', 'completed'] }, dateEnd: { gt: now } };
    for (const t of await this.prisma.trip.findMany({ where: { hostId: id, ...tripOpen }, select: { id: true } })) await this.trips.cancel(me, t.id).catch(() => undefined);
    for (const m of await this.prisma.tripMembership.findMany({ where: { userId: id, state: 'approved', trip: tripOpen }, select: { tripId: true } })) await this.trips.leave(me, m.tripId).catch(() => undefined);
    for (const a of await this.prisma.tripApplication.findMany({ where: { applicantId: id, state: 'pending' }, select: { tripId: true } })) await this.trips.withdraw(me, a.tripId).catch(() => undefined);

    // 2. Any identity check still open at the provider is erased there too.
    await this.verification.eraseProviderSessions(id).catch((e) => console.error('Provider erasure failed:', e?.message ?? e));

    // 3. Erase. Messages that a safety report points at stay, because staff may still need them.
    const reported = (await this.prisma.report.findMany({ where: { targetType: 'message' }, select: { targetId: true } })).map((r) => r.targetId);
    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { userId: id } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId: id } }),
      this.prisma.contactCode.deleteMany({ where: { userId: id } }),
      this.prisma.favorite.deleteMany({ where: { userId: id } }),
      this.prisma.tripFavorite.deleteMany({ where: { userId: id } }),
      this.prisma.follow.deleteMany({ where: { OR: [{ followerId: id }, { followingId: id }] } }),
      this.prisma.block.deleteMany({ where: { OR: [{ blockerId: id }, { blockedId: id }] } }),
      this.prisma.profilePhoto.deleteMany({ where: { userId: id } }),
      this.prisma.tripPollVote.deleteMany({ where: { userId: id } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId: id } }),
      this.prisma.draft.deleteMany({ where: { userId: id } }),
      this.prisma.userWarning.deleteMany({ where: { userId: id } }),
      this.prisma.travelMatchPref.deleteMany({ where: { userId: id } }),
      this.prisma.travelMatchChoice.deleteMany({ where: { OR: [{ fromId: id }, { toId: id }] } }),
      this.prisma.conversation.updateMany({ where: { scopeType: 'match', endedAt: null, OR: [{ userAId: id }, { userBId: id }] }, data: { endedAt: new Date() } }),
      this.prisma.tripItem.deleteMany({ where: { createdById: id } }),
      this.prisma.appeal.deleteMany({ where: { userId: id } }),
      this.prisma.socialIdentity.deleteMany({ where: { userId: id } }),
      this.prisma.message.deleteMany({ where: { senderId: id, id: { notIn: reported } } }),
      this.prisma.verificationCheck.deleteMany({ where: { userId: id } }),
      this.prisma.profile.updateMany({ where: { userId: id }, data: { displayName: 'Deleted user', homeCity: null, languages: '', interests: '', bio: null, photoUrl: null } }),
      this.prisma.user.update({
        where: { id },
        data: {
          email: `deleted-${id}@deleted.invalid`,
          passwordHash: '!', // not a valid hash: nothing can ever match it
          state: 'deleted',
          deletedAt: now,
          passwordChangedAt: now,
          phoneNumber: null,
          phoneHash: null,
          phoneVerifiedAt: null,
          mfaSecret: null,
          mfaEnabledAt: null,
          emailVerifiedAt: null,
          adultVerifiedAt: null,
          eligibility: 'unverified',
          verifiedUntil: null,
          reverifyReason: null,
          suspendedUntil: null,
        },
      }),
    ]);
    await this.audit.log(id, 'account.deleted', 'user', id);
    this.live.dropUser(id);
    this.live.feedChanged();
    // a last note to the address they used, so nobody can delete an account unnoticed
    await this.email.send(me.email, 'Your HERE & THERE account was deleted', 'Your HERE & THERE account has been deleted, and your personal details have been erased.\n\nIf this was not you, contact support right away.').catch(() => undefined);
    return { ok: true };
  }
}

@Controller('v1')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /** Body: { lang?: 'en' | 'it' }. Returns { url, expiresInSeconds }: a two-minute link that downloads the ZIP copy. One a day. */
  @Post('me/export/zip-link')
  zipLink(@CurrentUser() me: User, @Body() body: { lang?: unknown } | undefined, @Req() req: Request) {
    return this.account.zipLink(me, body?.lang, `${req.protocol}://${req.get('host')}`);
  }

  /** The ZIP itself. The signed link is the login: it names the person, the language and an expiry. */
  @Public()
  @Get('export/zip')
  async zip(@Query('t') token: string, @Res() res: Response) {
    const buf = await this.account.zip(token);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="herethere-my-data-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }

  @Post('me/email/change')
  startEmailChange(@CurrentUser() me: User, @Body() body: unknown) {
    return this.account.startEmailChange(me, body);
  }

  @Post('me/email/change/confirm')
  confirmEmailChange(@CurrentUser() me: User, @Body() body: unknown) {
    return this.account.confirmEmailChange(me, body);
  }

  @Post('me/delete')
  delete(@CurrentUser() me: User, @Body() body: unknown) {
    return this.account.delete(me, body);
  }
}
