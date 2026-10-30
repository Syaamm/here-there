import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { E } from '../common/errors';
import { JobsService } from '../common/jobs.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { NotificationsService } from '../notifications/notifications.service';
import { ManualProvider } from './providers/manual.provider';
import { IdenfyProvider } from './providers/idenfy.provider';
import { PersonaProvider } from './providers/persona.provider';
import { allowsSimulated, isDemo } from '../common/demo';
import { SandboxProvider } from './providers/sandbox.provider';
import type { IdentityProvider, ProviderOutcome, WebhookHeaders } from './providers/types';

const DAY = 24 * 3600 * 1000;
/** One-time verification: valid for a year by default, then a fresh check is needed. */
const validForMs = () => Number(process.env.VERIFICATION_VALID_DAYS ?? 365) * DAY;

export type ReverifyReason = 'expired' | 'security' | 'fraud_suspected' | 'provider_required' | 'other';

/**
 * Identity verification (spec 3.1 / 9.2). One shared status per user, used by HERE and THERE alike.
 *
 *  - Browsing needs no verification. Creating, joining, applying and chatting do (enforced in requireVerified()).
 *  - It is ONE-TIME. A verified, unexpired user is never asked for a selfie again, however many activities or
 *    trips they create or join. A new check is only needed when the verification expires, staff require it for
 *    a security or fraud concern, or the provider revokes it.
 *  - Email verification, adult (18+) eligibility and identity verification are three separate statuses.
 *  - Data minimisation: we store the outcome, a provider reference and timestamps. Documents, selfies, face data,
 *    names and birth dates stay with the provider, which is asked to erase them once we hold the outcome.
 *
 * VERIFICATION_MODE: manual (default: staff decide in the admin console) | auto (instant, dev) | sandbox (local
 * simulated provider with signed webhooks, dev) | persona (Persona's hosted flow: needs the PERSONA_* settings, see
 * providers/persona.provider.ts; works with Persona's sandbox key in development and the live key in production) |
 * idenfy (iDenfy's hosted flow, EU data centres: needs the IDENFY_* settings, see providers/idenfy.provider.ts).
 * Another vendor registers as another provider below.
 */
@Injectable()
export class VerificationService implements OnModuleInit, OnModuleDestroy {
  private readonly providers: Record<string, IdentityProvider> = {
    manual: new ManualProvider('manual'),
    auto: new ManualProvider('auto'),
    sandbox: new SandboxProvider(),
    persona: new PersonaProvider(),
    idenfy: new IdenfyProvider(),
    // veriff: new VeriffProvider(...), sumsub: new SumsubProvider(...)
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly limiter: RateLimiter,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    if (!allowsSimulated() && ['auto', 'sandbox'].includes(this.mode))
      throw new Error(`VERIFICATION_MODE=${this.mode} is for development only and is refused in production (a demo server may set DEMO_MODE=true)`);
    if (!this.providers[this.mode]) throw new Error(`Unknown VERIFICATION_MODE "${this.mode}"`);
    if (this.mode === 'persona') (this.providers.persona as PersonaProvider).assertReady(); // a half-set-up provider is refused at start-up
    if (this.mode === 'idenfy') (this.providers.idenfy as IdenfyProvider).assertReady();
    this.jobs.every('verification.expire-due', 3600 * 1000, () => this.expireDue());
  }
  onModuleDestroy() {}

  get mode() {
    return process.env.VERIFICATION_MODE ?? (isDemo() ? 'sandbox' : 'manual');
  }
  private get provider() {
    return this.providers[this.mode];
  }

  // ---------------------------------------------------------------- reading
  async status(user: User, baseUrl: string) {
    let latest = await this.prisma.verificationCheck.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    // a webhook that never arrived must not leave someone pending for ever: ask the provider (at most every few seconds per check)
    if (user.eligibility === 'pending' && latest?.eligibility === 'pending') {
      const decided = await this.reconcile(latest);
      if (decided) {
        user = (await this.prisma.user.findUnique({ where: { id: user.id } })) ?? user;
        latest = await this.prisma.verificationCheck.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      }
    }
    const pending = user.eligibility === 'pending' && latest?.eligibility === 'pending' ? latest : null;
    return {
      eligibility: user.eligibility,
      emailVerified: !!user.emailVerifiedAt,
      adultVerified: !!user.adultVerifiedAt,
      phoneVerified: !!user.phoneVerifiedAt,
      mode: this.mode,
      requestedAt: latest?.createdAt ?? null,
      verifiedUntil: user.eligibility === 'verified' ? user.verifiedUntil : null,
      reverifyReason: user.reverifyReason,
      lastRejectionReason: user.eligibility === 'rejected' ? (latest?.rejectionReason ?? null) : null,
      // which kind of check the latest one was: face (document + selfie match) or document (no face match)
      method: latest?.method ?? null,
      // lets a user who closed the browser continue the same provider session
      resumeUrl: pending ? await this.providers[pending.provider]?.resumeUrl?.(pending.providerRef, baseUrl) : undefined,
    };
  }

  private lastLookup = new Map<string, number>();
  /** True when the provider's own answer settled this pending check. Never throws: a provider outage just leaves it pending. */
  private async reconcile(check: { id: string; provider: string; providerRef: string }) {
    const provider = this.providers[check.provider];
    if (!provider?.lookup || check.providerRef.startsWith('pending_')) return false;
    const now = Date.now();
    if (now - (this.lastLookup.get(check.id) ?? 0) < 5000) return false;
    this.lastLookup.set(check.id, now);
    if (this.lastLookup.size > 1000) this.lastLookup.clear();
    try {
      const outcome = await provider.lookup(check.providerRef);
      if (!outcome) return false;
      await this.applyOutcome(provider.name, outcome);
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- starting a check
  async start(user: User, consent: unknown, baseUrl: string, methodRaw?: unknown) {
    // `document` = the ID document only, no selfie and no face match (nothing biometric); `face` is the default
    const method: 'face' | 'document' = methodRaw === 'document' ? 'document' : 'face';
    if (!user.adultConfirmed) throw E.forbidden('ADULT_REQUIRED', 'You must confirm you are 18 or older first');
    // Already verified (and not expired): never open a new session. This is what makes verification one-time.
    if (user.eligibility === 'verified') return { eligibility: 'verified' };
    if (user.eligibility === 'pending') return { eligibility: 'pending', url: (await this.status(user, baseUrl)).resumeUrl };

    // Spec 3.1 order: confirm the email address first, then identity verification.
    if (!user.emailVerifiedAt) throw E.forbidden('EMAIL_NOT_VERIFIED', 'Verify your email address before starting identity verification');
    // Facial matching is biometric data (GDPR Art. 9): it needs explicit, recorded consent before anything starts.
    // The document-only check has no biometric step, but still needs the person's agreement to the check.
    if (consent !== true) throw E.badRequest('CONSENT_REQUIRED', method === 'face' ? 'You must agree to the identity document and facial check before starting' : 'You must agree to the identity document check before starting');

    // A failed age check is not something to retry until it passes: only staff can reopen it (reset / overturn).
    if (user.eligibility === 'rejected') {
      const last = await this.prisma.verificationCheck.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      if (last?.rejectionReason === 'underage')
        throw E.forbidden('VERIFICATION_BLOCKED', 'This account could not be verified. If you think this is a mistake, please contact support.');
    }
    // Anyone may try again after a rejection, but not endlessly: five attempts a day.
    this.limiter.hit(`verification-start:${user.id}`, 5, DAY);

    const provider = this.provider;
    const check = await this.prisma.verificationCheck.create({
      data: { userId: user.id, provider: provider.name, method, providerRef: `pending_${randomUUID()}`, eligibility: 'pending', consentAt: new Date() },
    });
    let session: { providerRef: string; url?: string };
    try {
      session = await provider.createSession({ id: user.id, email: user.email }, { checkId: check.id, baseUrl, method });
    } catch (e) {
      await this.prisma.verificationCheck.delete({ where: { id: check.id } });
      throw e;
    }
    await this.prisma.verificationCheck.update({ where: { id: check.id }, data: { providerRef: session.providerRef } });
    await this.prisma.user.update({ where: { id: user.id }, data: { eligibility: 'pending' } });
    await this.audit.log(user.id, 'verification.consent_given', 'user', user.id, { checkId: check.id, provider: provider.name, method });

    if (this.mode === 'auto') {
      await this.decide(check.id, 'verified', null, { adult: true });
      return { eligibility: 'verified' };
    }
    return { eligibility: 'pending', url: session.url };
  }

  /** The user abandoned an in-progress check (closed the provider page, changed their mind): start over. */
  async cancel(user: User) {
    if (user.eligibility !== 'pending') throw E.conflict('NOT_PENDING', 'There is no identity check in progress');
    await this.prisma.$transaction([
      // closed, so a late provider message for this session is ignored
      this.prisma.verificationCheck.updateMany({ where: { userId: user.id, eligibility: 'pending' }, data: { eligibility: 'rejected', rejectionReason: 'cancelled', decidedAt: new Date() } }),
      this.prisma.user.update({ where: { id: user.id }, data: { eligibility: 'unverified' } }),
    ]);
    await this.audit.log(user.id, 'verification.cancelled', 'user', user.id);
    return { eligibility: 'unverified' };
  }

  // ---------------------------------------------------------------- staff overrides (trust lead / admin)
  /**
   * Let someone try again: for a rejection that should not stand (poor photo, a stuck check, a reviewed under-18
   * flag). Closes any open check and returns the person to "not verified yet".
   */
  async resetVerification(actorId: string, userId: string, note: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw E.notFound('User');
    if (user.eligibility === 'verified') throw E.conflict('ALREADY_VERIFIED', 'This person is verified. Use "require re-verification" instead.');
    await this.prisma.$transaction([
      this.prisma.verificationCheck.updateMany({ where: { userId, eligibility: 'pending' }, data: { eligibility: 'rejected', rejectionReason: 'superseded', decidedAt: new Date() } }),
      this.prisma.user.update({ where: { id: userId }, data: { eligibility: 'unverified', reverifyReason: null } }),
    ]);
    await this.audit.log(actorId, 'verification.reset', 'user', userId, { note, from: user.eligibility });
    await this.notifications.notify(userId, 'verification_result', 'You can verify again', 'Our team reopened your identity verification. You can start it again whenever you are ready.');
    return { eligibility: 'unverified' };
  }

  /**
   * A human reviewer decides a rejection was wrong and approves the person (an appeal). Only a genuine rejection can
   * be overturned, and an under-18 rejection needs an admin.
   */
  async overturnRejection(actor: { id: string; role: string }, userId: string, note: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw E.notFound('User');
    if (user.eligibility !== 'rejected') throw E.conflict('NOT_REJECTED', 'Only a rejected verification can be overturned');
    const check = await this.prisma.verificationCheck.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (!check || check.eligibility !== 'rejected' || ['superseded', 'cancelled'].includes(check.rejectionReason ?? ''))
      throw E.conflict('NOT_REJECTED', 'There is no rejected check to overturn. Use "Allow another attempt" instead.');
    if (check.rejectionReason === 'underage' && actor.role !== 'admin') throw E.forbidden('ADMIN_ONLY', 'Only an admin can overturn an under-18 rejection');

    const now = new Date();
    const until = new Date(+now + validForMs());
    await this.prisma.$transaction([
      this.prisma.verificationCheck.update({ where: { id: check.id }, data: { eligibility: 'verified', reviewedBy: actor.id, decidedAt: now, expiresAt: until, rejectionReason: null } }),
      // a human reviewer confirmed the person is an adult
      this.prisma.user.update({ where: { id: userId }, data: { eligibility: 'verified', verifiedUntil: until, adultVerifiedAt: now, reverifyReason: null } }),
    ]);
    await this.audit.log(actor.id, 'verification.rejection_overturned', 'user', userId, { checkId: check.id, previousReason: check.rejectionReason, note });
    await this.notifications.notify(userId, 'verification_result', 'You are verified', 'After a review by our team, your verification was approved. You can now host, join and chat.');
    return { eligibility: 'verified' };
  }

  // ---------------------------------------------------------------- deciding
  /** Called by staff in the admin console or by the provider webhook (via applyOutcome). */
  async decide(checkId: string, decision: 'verified' | 'rejected', reviewerId: string | null, opts: { adult?: boolean; reason?: string } = {}) {
    const check = await this.prisma.verificationCheck.findUnique({ where: { id: checkId } });
    if (!check) throw E.notFound('Verification check');
    if (check.eligibility !== 'pending') throw E.conflict('ALREADY_DECIDED', 'This check was already decided');

    // A "verified" outcome only counts if the provider (or staff) also confirmed the person is an adult.
    let result = decision;
    let reason = opts.reason;
    if (decision === 'verified' && opts.adult === false) {
      result = 'rejected';
      reason = 'underage';
    }

    const now = new Date();
    const until = new Date(+now + validForMs());
    await this.prisma.$transaction([
      this.prisma.verificationCheck.update({
        where: { id: checkId },
        data: { eligibility: result, reviewedBy: reviewerId, decidedAt: now, expiresAt: result === 'verified' ? until : null, rejectionReason: result === 'rejected' ? (reason ?? 'other') : null },
      }),
      this.prisma.user.update({
        where: { id: check.userId },
        data: result === 'verified' ? { eligibility: 'verified', verifiedUntil: until, adultVerifiedAt: now, reverifyReason: null } : { eligibility: 'rejected' },
      }),
    ]);
    await this.audit.log(reviewerId, `verification.${result}`, 'user', check.userId, { checkId, ...(reason ? { reason } : {}) });
    if (reason === 'underage') await this.audit.log(reviewerId, 'verification.underage_detected', 'user', check.userId, { checkId });

    await this.notifications.notify(
      check.userId,
      'verification_result',
      result === 'verified' ? 'You are verified' : 'Verification not approved',
      result === 'verified'
        ? 'You can now host, join and chat in activities and trips. You will not need to do this again until it expires.'
        : reason === 'underage'
          ? 'HERE & THERE is for adults aged 18 and over, so we could not verify this account.'
          : 'We could not verify your identity. You can try again.',
    );

    // Data minimisation: ask the provider to erase the personal data it holds for this session.
    void this.providers[check.provider]?.eraseSession?.(check.providerRef).catch((e) => console.error('Provider data erasure failed:', e?.message ?? e));
    return { eligibility: result };
  }

  /** Asks each identity provider to erase whatever it still holds for this person's unfinished checks. */
  async eraseProviderSessions(userId: string) {
    const open = await this.prisma.verificationCheck.findMany({ where: { userId, decidedAt: null } });
    await Promise.all(open.map((c) => this.providers[c.provider]?.eraseSession?.(c.providerRef)));
  }

  // ---------------------------------------------------------------- provider webhook
  async handleWebhook(providerName: string, rawBody: Buffer, headers: WebhookHeaders) {
    const provider = this.providers[providerName];
    if (!provider || providerName === 'manual' || providerName === 'auto') throw E.notFound('Provider');
    if (providerName === 'sandbox' && (!allowsSimulated() || this.mode !== 'sandbox')) throw E.notFound('Provider');

    const outcome: ProviderOutcome | null = provider.parseWebhook(rawBody, headers); // throws 401 on a bad signature
    if (!outcome) return { ok: true, ignored: true }; // an event that decides nothing (a check started, a review opened...)
    return this.applyOutcome(provider.name, outcome);
  }

  private async applyOutcome(providerName: string, outcome: ProviderOutcome) {
    const check = await this.prisma.verificationCheck.findFirst({ where: { providerRef: outcome.providerRef, provider: providerName } });
    if (!check) throw E.notFound('Verification');

    // the provider withdrew an earlier approval (fraud signal, regulatory change...)
    if (outcome.result === 'revoked') {
      await this.requireReverification(null, check.userId, 'provider_required', 'Revoked by the identity provider');
      return { ok: true };
    }
    if (check.eligibility !== 'pending') return { ok: true, ignored: true }; // duplicates / late retries are harmless

    if (outcome.result === 'approved') await this.decide(check.id, 'verified', null, { adult: outcome.adult });
    else if (outcome.result === 'declined') await this.decide(check.id, 'rejected', null, { reason: outcome.reason ?? 'document' });
    else await this.decide(check.id, 'rejected', null, { reason: 'resubmission' });
    return { ok: true };
  }

  // ---------------------------------------------------------------- when a NEW check is required
  /** Staff (security concern, suspected fraud) or the provider can force a new check. Takes effect immediately. */
  async requireReverification(actorId: string | null, userId: string, reason: ReverifyReason, note?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw E.notFound('User');
    if (['expired', 'reverification_required'].includes(user.eligibility)) return { eligibility: user.eligibility };

    await this.prisma.$transaction([
      // an in-flight check cannot undo this: it is closed, so a late "approved" webhook is ignored
      this.prisma.verificationCheck.updateMany({ where: { userId, eligibility: 'pending' }, data: { eligibility: 'rejected', rejectionReason: 'superseded', decidedAt: new Date() } }),
      this.prisma.user.update({ where: { id: userId }, data: { eligibility: 'reverification_required', reverifyReason: reason } }),
    ]);
    await this.audit.log(actorId, 'verification.reverification_required', 'user', userId, { reason, ...(note ? { note } : {}) });
    await this.notifications.notify(userId, 'verification_result', 'Please verify again', 'For the safety of our community we need you to complete identity verification again before you can join, host or chat.');
    return { eligibility: 'reverification_required' };
  }

  /** Verification is one-time but not forever. */
  async expireUserById(id: string) {
    const r = await this.prisma.user.updateMany({
      where: { id, eligibility: 'verified', verifiedUntil: { lt: new Date() } },
      data: { eligibility: 'expired', reverifyReason: 'expired' },
    });
    if (!r.count) return false;
    await this.audit.log(null, 'verification.expired', 'user', id);
    await this.notifications.notify(id, 'verification_result', 'Your verification has expired', 'Please verify again to keep joining, hosting and chatting. It only takes a couple of minutes.');
    return true;
  }

  /** Used by the auth guard so a lapsed verification is enforced on the very next request. */
  async expireIfDue(user: User): Promise<User> {
    if (user.eligibility === 'verified' && user.verifiedUntil && user.verifiedUntil < new Date() && (await this.expireUserById(user.id)))
      return { ...user, eligibility: 'expired', reverifyReason: 'expired' };
    return user;
  }

  /** Hourly sweep, so other people's badges also lapse even if that user is not active. */
  async expireDue() {
    const due = await this.prisma.user.findMany({ where: { eligibility: 'verified', verifiedUntil: { lt: new Date() } }, select: { id: true } });
    let n = 0;
    for (const u of due) if (await this.expireUserById(u.id)) n++;
    return n;
  }
}
