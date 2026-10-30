import { Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as webpush from 'web-push';
import { JobsService } from './jobs.service';
import { NotificationPrefsService } from '../notifications/preference-rules';
import { LiveService } from './live.service';
import { PrismaService } from './prisma.service';

export type PushMessage = {
  title: string;
  body: string;
  /** where tapping it should go in the app, e.g. /chat/abc */
  url?: string;
  /** what kind of alert it is: decides whether this person's settings and quiet hours allow a push (no kind = always) */
  alert?: { type: string; data?: Record<string, unknown> | null };
  /** repeats of the same thing (messages in one chat) push at most once per PUSH_GROUP_SECONDS (default 60) */
  group?: string;
};

/**
 * Push notifications to people who are not in the app: Web Push for browsers (VAPID) and Expo's push service for phones.
 * Nothing here ever throws into the caller: a failed push must never fail a message or a request.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private keys?: { publicKey: string; privateKey: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
    private readonly jobs: JobsService,
    private readonly prefs: NotificationPrefsService,
  ) {}

  private readonly lastPush = new Map<string, number>();

  /** True when a push for this group went out less than the grouping window ago (and notes this one as sent otherwise). */
  private throttled(userId: string, group: string) {
    const windowMs = Number(process.env.PUSH_GROUP_SECONDS ?? 60) * 1000;
    if (windowMs <= 0) return false;
    const key = `${userId}:${group}`;
    const now = Date.now();
    if (now - (this.lastPush.get(key) ?? 0) < windowMs) return true;
    if (this.lastPush.size > 5000) for (const [k, t] of this.lastPush) if (now - t > windowMs) this.lastPush.delete(k);
    this.lastPush.set(key, now);
    return false;
  }

  /**
   * VAPID keys identify this server to the browsers' push services. Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in
   * production. In development they are created once and kept in a local file (never committed).
   */
  private vapid() {
    if (this.keys) return this.keys;
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (publicKey && privateKey) return (this.keys = { publicKey, privateKey });
    if (process.env.NODE_ENV === 'production') throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in production');
    const file = path.resolve(__dirname, '..', '..', '..', '.vapid-dev.json');
    if (process.env.NODE_ENV !== 'test' && existsSync(file)) {
      try {
        return (this.keys = JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        /* a damaged file: make new keys below */
      }
    }
    const fresh = webpush.generateVAPIDKeys();
    if (process.env.NODE_ENV !== 'test') writeFileSync(file, JSON.stringify(fresh));
    return (this.keys = fresh);
  }

  publicKey() {
    return this.vapid().publicKey;
  }

  async subscribe(userId: string, kind: 'web' | 'expo', token: string) {
    // one row per device token; if the same device signs in as someone else it moves to them
    await this.prisma.pushSubscription.upsert({
      where: { token },
      create: { userId, kind, token },
      update: { userId, kind, lastUsedAt: new Date() },
    });
  }

  async unsubscribe(userId: string, token: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, token } });
  }

  /**
   * Queue a push. It goes out from the job worker, so the request that caused it never waits for Expo or a browser's push
   * service, and a device that could not be reached is tried again a few times. Nothing here ever throws into the caller.
   */
  queue(userId: string, msg: PushMessage) {
    void this.jobs.enqueue('push.send', { userId, msg, round: 0 }, { maxAttempts: 3 }).catch(() => undefined);
  }

  onModuleInit() {
    this.jobs.handle('push.send', (p: { userId: string; msg: PushMessage; only?: string[]; round: number }) => this.deliver(p));
  }

  /** The worker's side of `queue`: send to every device, and queue the devices that failed for another go (up to 3 rounds). */
  private async deliver(p: { userId: string; msg: PushMessage; only?: string[]; round: number }) {
    if (this.live.isViewing(p.userId)) return; // looking at the app: they see it live
    if (!p.only) {
      // first attempt only (a retry for a device that failed was already allowed): the person's settings and quiet hours, then grouping
      if (p.msg.alert && !(await this.prefs.allowsPush(p.userId, p.msg.alert.type, p.msg.alert.data))) return;
      if (p.msg.group && this.throttled(p.userId, p.msg.group)) return;
    }
    const subs = (await this.prisma.pushSubscription.findMany({ where: { userId: p.userId } })).filter((s) => !p.only || p.only.includes(s.token));
    if (subs.length === 0) return;
    const results = await Promise.all(subs.map(async (s) => ((s.kind === 'expo' ? await this.sendExpo(s.token, p.msg) : await this.sendWeb(s.token, p.msg)) ? null : s.token)));
    const failed = results.filter((t): t is string => !!t);
    if (failed.length && p.round < 2) await this.jobs.enqueue('push.send', { ...p, only: failed, round: p.round + 1 }, { delayMs: 30_000 * 2 ** p.round, maxAttempts: 3 });
  }

  /** Send to every device of this person right now, unless they are looking at the app (best effort; used by tests and tools). */
  async send(userId: string, msg: PushMessage) {
    try {
      await this.deliver({ userId, msg, round: 2 });
    } catch {
      /* push is best effort */
    }
  }

  /** true = delivered, or nothing more can be done (the device is gone); false = worth trying again. */
  private async sendExpo(token: string, msg: PushMessage) {
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ to: token, title: msg.title, body: msg.body, sound: 'default', data: { url: msg.url } }),
      });
      if (res.status >= 500 || res.status === 429) return false;
      const json = (await res.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } } } | null;
      if (json?.data?.status === 'error' && json.data.details?.error === 'DeviceNotRegistered') await this.prisma.pushSubscription.deleteMany({ where: { token } });
      return true;
    } catch {
      return false; // no connection to Expo
    }
  }

  private async sendWeb(subscription: string, msg: PushMessage) {
    try {
      const { publicKey, privateKey } = this.vapid();
      await webpush.sendNotification(JSON.parse(subscription), JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? '/' }), {
        vapidDetails: { subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@herethere.local', publicKey, privateKey },
        TTL: 60 * 60,
      });
      return true;
    } catch (e) {
      // 404 / 410: the browser says this subscription is gone for good
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await this.prisma.pushSubscription.deleteMany({ where: { token: subscription } });
        return true;
      }
      return !(code === undefined || code === 429 || code >= 500); // a refusal we cannot fix is not retried; a network or server fault is
    }
  }
}
