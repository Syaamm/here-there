import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { E } from '../common/errors';
import { log } from '../common/observability';
import { PrismaService } from '../common/prisma.service';
import { tokenVersions } from '../common/auth';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
/**
 * An old refresh token shown again soon after it was swapped is not theft: the phone asked, the server answered, and the answer
 * never arrived (the app was put to sleep, the network changed), so the phone still holds the old token. The server cannot see whether
 * the answer arrived, so the forgiveness is a time window; a replay after it ends the sign-in.
 */
const graceMs = () => Math.max(1, Number(process.env.REFRESH_GRACE_MINUTES ?? 60)) * 60_000;

export const accessMinutes = () => Math.max(1, Number(process.env.ACCESS_TOKEN_MINUTES ?? 15));
export const refreshDays = () => Math.max(1, Number(process.env.REFRESH_TOKEN_DAYS ?? 30));

export type Tokens = { token: string; refreshToken: string; expiresIn: number };
type Versioned = Pick<User, 'id' | 'passwordChangedAt' | 'sessionsRevokedAt'>;

/**
 * Sign-ins that can be ended. The app holds two things: a short-lived ACCESS token (15 minutes, sent with every request)
 * and a long-lived REFRESH token (30 days, sent only to swap for a new pair). Only a hash of the refresh token is kept here.
 *
 * - A stolen access token stops working within minutes; "log out everywhere" ends it at once (every token carries the
 *   account's sign-out version, so one change cancels all of them).
 * - Each refresh replaces the refresh token. If an OLD one is used again within the grace window (an hour), the answer was
 *   probably lost on the way to the phone and it gets a new pair; after the window it was copied: that whole sign-in is
 *   ended and the person has to sign in again.
 * - A password change or "log out everywhere" removes every session.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private access(user: Versioned, sid: string) {
    return this.jwt.signAsync({ sub: user.id, sid, ...tokenVersions(user) }, { expiresIn: accessMinutes() * 60 });
  }

  /** A new sign-in on one device: an access token and a refresh token. */
  async issue(user: Versioned, device?: string | null): Promise<Tokens> {
    const refreshToken = 'rt_' + randomBytes(32).toString('base64url');
    const s = await this.prisma.session.create({
      data: { userId: user.id, refreshHash: hash(refreshToken), device: device?.slice(0, 80) ?? null, expiresAt: new Date(Date.now() + refreshDays() * 86_400_000) },
    });
    return { token: await this.access(user, s.id), refreshToken, expiresIn: accessMinutes() * 60 };
  }

  /** Swap a refresh token for a new pair. The old refresh token stops working. */
  async refresh(presented: unknown): Promise<Tokens> {
    // every refusal is logged with its reason: the request line alone only says 401
    const bad = (why = 'not found') => {
      log('warn', 'refresh refused', { code: 'INVALID_REFRESH_TOKEN', why });
      return E.unauthorized('INVALID_REFRESH_TOKEN', 'Please sign in again.');
    };
    if (typeof presented !== 'string' || !presented.startsWith('rt_') || presented.length > 100) throw bad('malformed');
    const h = hash(presented);
    let s = await this.prisma.session.findUnique({ where: { refreshHash: h }, include: { user: true } });
    let fromGrace = false;
    if (!s) {
      const old = await this.prisma.session.findUnique({ where: { previousHash: h }, include: { user: true } });
      if (!old) throw bad('unknown or signed out');
      if (Date.now() - +old.lastUsedAt > graceMs()) {
        await this.prisma.session.deleteMany({ where: { id: old.id } }); // a used refresh token came back later: copied. End this sign-in.
        log('warn', 'refresh refused', { code: 'REFRESH_TOKEN_REUSED', idleMinutes: Math.round((Date.now() - +old.lastUsedAt) / 60_000) });
        throw E.unauthorized('REFRESH_TOKEN_REUSED', 'For your safety you were signed out. Please sign in again.');
      }
      s = old;
      fromGrace = true;
    }
    const u = s.user;
    if (s.expiresAt < new Date() || u.state !== 'active') {
      await this.prisma.session.deleteMany({ where: { id: s.id } });
      throw bad(s.expiresAt < new Date() ? 'sign-in expired' : 'account not active');
    }
    // a password change or "log out everywhere" after this sign-in began ends it
    if (+s.createdAt < (u.passwordChangedAt ? +u.passwordChangedAt : 0) || +s.createdAt < (u.sessionsRevokedAt ? +u.sessionsRevokedAt : 0)) {
      await this.prisma.session.deleteMany({ where: { id: s.id } });
      throw bad('password changed or signed out everywhere');
    }
    const refreshToken = 'rt_' + randomBytes(32).toString('base64url');
    // rotate only if nobody else did in the meantime (two refreshes at once: the loser is told to try again)
    const moved = await this.prisma.session.updateMany({
      where: { id: s.id, refreshHash: s.refreshHash },
      data: { refreshHash: hash(refreshToken), previousHash: fromGrace ? s.previousHash : h, lastUsedAt: new Date(), expiresAt: new Date(Date.now() + refreshDays() * 86_400_000) },
    });
    if (moved.count !== 1) throw E.conflict('REFRESH_IN_PROGRESS', 'Try again in a moment.');
    return { token: await this.access(u, s.id), refreshToken, expiresIn: accessMinutes() * 60 };
  }

  /** End one sign-in (this device). Its access token stays valid until it expires, at most a few minutes. */
  async end(userId: string, sessionId: string | undefined, presented?: unknown) {
    if (sessionId) await this.prisma.session.deleteMany({ where: { id: sessionId, userId } });
    else if (typeof presented === 'string') await this.prisma.session.deleteMany({ where: { userId, refreshHash: hash(presented) } });
  }

  /** "Log out everywhere": every sign-in of this person, on every device, stops working now. */
  async endAll(userId: string) {
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { userId } }),
      this.prisma.user.update({ where: { id: userId }, data: { sessionsRevokedAt: new Date() } }),
    ]);
  }

  /** The person's sign-ins, newest first (which device, when it was last used). */
  async list(userId: string, currentId?: string) {
    const rows = await this.prisma.session.findMany({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' }, take: 50 });
    return { items: rows.map((s) => ({ id: s.id, device: s.device, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, current: s.id === currentId })) };
  }
}
