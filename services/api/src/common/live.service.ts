import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { PrismaService } from './prisma.service';

/** What the server tells a connected app. */
export type LiveEvent =
  | { type: 'message'; conversationId: string; message: { id: string; body: string; createdAt: Date; sender: { id: string; displayName: string; photoUrl: string | null } } }
  | { type: 'notification'; notification: { id: string; type: string; title: string; body: string; data: unknown; createdAt: Date } }
  // some alerts were taken away (their request was settled): lists and the badge should be asked again
  | { type: 'alerts-changed' }
  // an activity or trip was created, changed, filled or cancelled: open feeds should ask again (carries no data at all)
  | { type: 'feed-changed' };

/**
 * Live connection to the apps (a WebSocket at /v1/live), so a new message or alert arrives at once instead of waiting for
 * the next poll. The first thing an app sends is {"type":"auth","token":"..."}: the token is never put in the address.
 * Everything the app is allowed to see is decided by the server when it publishes (members only), not by the app.
 */
@Injectable()
export class LiveService implements OnModuleDestroy {
  private wss?: WebSocketServer;
  private readonly byUser = new Map<string, Set<WebSocket>>();
  private pinger?: NodeJS.Timeout;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  attach(server: Server) {
    if (this.wss) return;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    this.wss = wss;
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!(req.url ?? '').startsWith('/v1/live')) return;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (ws) => this.accept(ws));
    // drop connections that stopped answering (a phone that lost signal)
    this.pinger = setInterval(() => {
      for (const set of this.byUser.values())
        for (const ws of set) {
          if ((ws as WebSocket & { alive?: boolean }).alive === false) ws.terminate();
          else {
            (ws as WebSocket & { alive?: boolean }).alive = false;
            ws.ping();
          }
        }
    }, 30_000);
    this.pinger.unref();
  }

  private accept(ws: WebSocket) {
    const wait = setTimeout(() => ws.close(4001, 'auth timeout'), 10_000);
    let userId: string | null = null;
    ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true));
    ws.on('message', async (raw) => {
      if (userId) {
        // after sign-in the only thing an app tells us is whether it is on screen right now
        try {
          const m = JSON.parse(raw.toString()) as { type?: string; visible?: unknown };
          if (m.type === 'presence') (ws as WebSocket & { visible?: boolean }).visible = m.visible === true;
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; token?: string };
        if (msg.type !== 'auth' || !msg.token) throw new Error('auth expected');
        const sub = (await this.jwt.verifyAsync<{ sub: string }>(msg.token)).sub;
        const user = await this.prisma.user.findUnique({ where: { id: sub } });
        if (!user || user.state !== 'active') throw new Error('inactive');
        clearTimeout(wait);
        userId = user.id;
        (ws as WebSocket & { alive?: boolean }).alive = true;
        const set = this.byUser.get(userId) ?? new Set();
        set.add(ws);
        this.byUser.set(userId, set);
        ws.send(JSON.stringify({ type: 'ready' }));
      } catch {
        ws.close(4003, 'unauthorized');
      }
    });
    ws.on('close', () => {
      clearTimeout(wait);
      if (!userId) return;
      const set = this.byUser.get(userId);
      set?.delete(ws);
      if (set && set.size === 0) this.byUser.delete(userId);
    });
    ws.on('error', () => ws.terminate());
  }

  /**
   * Is this person looking at the app right now (so a push would only be a duplicate)? A connection that is open but
   * in a hidden tab, behind another window or in the background does not count: they still get the push.
   */
  isViewing(userId: string) {
    for (const ws of this.byUser.get(userId) ?? []) if ((ws as WebSocket & { visible?: boolean }).visible === true) return true;
    return false;
  }

  private feedTimer?: NodeJS.Timeout;
  /**
   * Tell every connected app the feeds have changed. It carries nothing, so nobody learns anything from it: each app
   * asks again with its own sign-in and sees only what it may. Several changes close together become one nudge.
   */
  feedChanged() {
    if (this.feedTimer) return;
    this.feedTimer = setTimeout(() => {
      this.feedTimer = undefined;
      const text = JSON.stringify({ type: 'feed-changed' } satisfies LiveEvent);
      for (const set of this.byUser.values()) for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(text);
    }, 400);
    this.feedTimer.unref();
  }

  send(userId: string, event: LiveEvent) {
    const set = this.byUser.get(userId);
    if (!set) return;
    const text = JSON.stringify(event);
    for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }

  onModuleDestroy() {
    if (this.pinger) clearInterval(this.pinger);
    for (const set of this.byUser.values()) for (const ws of set) ws.terminate();
    this.byUser.clear();
    this.wss?.close();
  }
}
