import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';

type Handler = (payload: any) => Promise<unknown> | unknown;

/** How long a server may hold a job before another may take it over (it crashed or hung). */
const LOCK_MS = 60_000;
/** How often a server looks for due work. */
const TICK_MS = 2_000;
const JOB_KEEP_DAYS = 7;

/**
 * Background work with retries, kept in the database so it survives a restart and works with several API servers (no Redis
 * needed). Two kinds:
 *
 * - **Jobs** (`enqueue`): something that must happen once, and be tried again if it fails, such as sending a push. A job is
 *   taken by one server at a time (`lockedUntil`), retried with a growing wait (10 s, 20 s, 40 s ...) up to `maxAttempts`,
 *   and then kept as `dead` with the last error so it can be looked at.
 * - **Schedules** (`every`): something that repeats, such as expiring old requests. Every server asks to run it, but only the
 *   one that moves `nextRunAt` forward first does, so it runs once per round however many servers there are.
 *
 * Other services register what they can do (`handle`, `every`) when they start; the worker loop only runs outside tests
 * (a test calls `tick()` itself).
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly handlers = new Map<string, Handler>();
  private readonly schedules = new Map<string, { everyMs: number; fn: Handler; localNext: number }>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private again = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.every('jobs.purge', 6 * 3600_000, () => this.purge());
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick().catch(() => undefined), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Say how a kind of job is done. */
  handle(type: string, fn: Handler) {
    this.handlers.set(type, fn);
  }

  /** Run `fn` every `everyMs`, on one server at a time. The first run is soon after start (within a minute). */
  every(name: string, everyMs: number, fn: Handler) {
    this.schedules.set(name, { everyMs, fn, localNext: 0 });
  }

  /** Queue a job. With `key`, a job already waiting under that key is not queued twice. */
  async enqueue(type: string, payload: unknown = {}, opts: { delayMs?: number; maxAttempts?: number; key?: string } = {}) {
    try {
      await this.prisma.job.create({
        data: { type, payload: JSON.stringify(payload), runAt: new Date(Date.now() + (opts.delayMs ?? 0)), maxAttempts: opts.maxAttempts ?? 5, uniqueKey: opts.key },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return; // already queued under this key
      throw e;
    }
    if (!opts.delayMs) void this.tick().catch(() => undefined); // do it now rather than at the next tick
  }

  /** One round: the schedules that are due, then the jobs that are due. Safe to call from several servers at once. */
  async tick(now = new Date()) {
    if (this.ticking) {
      this.again = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.again = false;
        await this.runSchedules(new Date());
        await this.runJobs(new Date());
      } while (this.again);
    } finally {
      this.ticking = false;
    }
  }

  private async runSchedules(now: Date) {
    for (const [name, s] of this.schedules) {
      if (+now < s.localNext) continue;
      try {
        const claimed = await this.prisma.jobSchedule.updateMany({ where: { name, nextRunAt: { lte: now } }, data: { nextRunAt: new Date(+now + s.everyMs), lastRunAt: now } });
        if (claimed.count === 1) {
          s.localNext = +now + s.everyMs;
          await Promise.resolve(s.fn({})).catch((e) => console.error(`Scheduled job ${name} failed:`, e?.message ?? e));
          continue;
        }
        const row = await this.prisma.jobSchedule.findUnique({ where: { name } });
        if (!row) {
          // first time anyone has run it: it is due soon, not instantly (so a restart loop does not run everything every time)
          await this.prisma.jobSchedule.create({ data: { name, nextRunAt: new Date(+now + Math.min(s.everyMs, 60_000)) } }).catch(() => undefined);
          s.localNext = +now + 1_000;
        } else s.localNext = +row.nextRunAt;
      } catch {
        s.localNext = +now + TICK_MS; // the database is busy: try again at the next round
      }
    }
  }

  private async runJobs(now: Date) {
    const due = await this.prisma.job.findMany({
      where: { state: 'queued', runAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      orderBy: { runAt: 'asc' },
      take: 20,
    });
    for (const job of due) {
      const taken = await this.prisma.job.updateMany({
        where: { id: job.id, state: 'queued', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        data: { lockedUntil: new Date(+now + LOCK_MS), attempts: { increment: 1 } },
      });
      if (taken.count !== 1) continue; // another server took it
      const attempts = job.attempts + 1;
      try {
        const handler = this.handlers.get(job.type);
        if (!handler) throw new Error(`no handler for "${job.type}"`);
        await handler(JSON.parse(job.payload));
        await this.prisma.job.update({ where: { id: job.id }, data: { state: 'done', lockedUntil: null, finishedAt: new Date(), lastError: null } });
      } catch (e) {
        const message = String((e as Error)?.message ?? e).slice(0, 500);
        if (attempts >= job.maxAttempts) await this.prisma.job.update({ where: { id: job.id }, data: { state: 'dead', lockedUntil: null, finishedAt: new Date(), lastError: message } });
        else await this.prisma.job.update({ where: { id: job.id }, data: { lockedUntil: null, runAt: new Date(Date.now() + 5_000 * 2 ** attempts), lastError: message } });
      }
    }
  }

  /** Housekeeping, run as a schedule: finished jobs and used-up keys do not pile up. */
  async purge(now = new Date()) {
    const old = new Date(+now - JOB_KEEP_DAYS * 86_400_000);
    const jobs = await this.prisma.job.deleteMany({ where: { state: { in: ['done', 'dead'] }, finishedAt: { lt: old } } });
    const keys = await this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
    const sessions = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    return { jobs: jobs.count, keys: keys.count, sessions: sessions.count };
  }
}
