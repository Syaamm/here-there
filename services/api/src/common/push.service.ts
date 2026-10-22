import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as webpush from 'web-push';
import { LiveService } from './live.service';
import { PrismaService } from './prisma.service';

export type PushMessage = { title: string; body: string; /** where tapping it should go in the app, e.g. /chat/abc */ url?: string };

/**
 * Push notifications to people who are not in the app: Web Push for browsers (VAPID) and Expo's push service for phones.
 * Nothing here ever throws into the caller: a failed push must never fail a message or a request.
 */
@Injectable()
export class PushService {
  private keys?: { publicKey: string; privateKey: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
  ) {}

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

  /** Send to every device of this person, unless they are looking at the app right now (they see it live). */
  async send(userId: string, msg: PushMessage) {
    try {
      if (this.live.isViewing(userId)) return;
      const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
      if (subs.length === 0) return;
      await Promise.all(subs.map((s) => (s.kind === 'expo' ? this.sendExpo(s.token, msg) : this.sendWeb(s.token, msg))));
    } catch {
      /* push is best effort */
    }
  }

  private async sendExpo(token: string, msg: PushMessage) {
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ to: token, title: msg.title, body: msg.body, sound: 'default', data: { url: msg.url } }),
      });
      const json = (await res.json().catch(() => null)) as { data?: { status?: string; details?: { error?: string } } } | null;
      if (json?.data?.status === 'error' && json.data.details?.error === 'DeviceNotRegistered') await this.prisma.pushSubscription.deleteMany({ where: { token } });
    } catch {
      /* try again with the next message */
    }
  }

  private async sendWeb(subscription: string, msg: PushMessage) {
    try {
      const { publicKey, privateKey } = this.vapid();
      await webpush.sendNotification(JSON.parse(subscription), JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? '/' }), {
        vapidDetails: { subject: process.env.VAPID_SUBJECT ?? 'mailto:admin@herethere.local', publicKey, privateKey },
        TTL: 60 * 60,
      });
    } catch (e) {
      // 404 / 410: the browser says this subscription is gone for good
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await this.prisma.pushSubscription.deleteMany({ where: { token: subscription } });
    }
  }
}
