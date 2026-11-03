import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable, from, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { E } from './errors';
import { PrismaService } from './prisma.service';

const DAY_MS = 24 * 3600 * 1000;
/** An answer bigger than this is not kept (the request is then simply not protected, never refused). */
const MAX_KEPT_BYTES = 64 * 1024;
const KEY_SHAPE = /^[A-Za-z0-9_.:-]{8,100}$/;
/** A request that has been "running" for longer than this is assumed to have died with its server; the same key may run again. */
const RUNNING_STALE_MS = 2 * 60 * 1000;

/**
 * Safe retries. A phone that loses its connection after sending "create this plan" cannot know whether the plan was made,
 * so it asks again, and without protection there are two plans. If the app sends an `Idempotency-Key` header (any unique
 * string, kept the same for a retry of the same action), the first answer is kept for 24 hours and a repeat with the same
 * key gets that same answer back (header `Idempotent-Replayed: true`) without doing the thing again.
 *
 * - The key belongs to the signed-in person; nobody else can replay it. Requests with no key behave exactly as before.
 * - Same key, different request (another address or body): refused with IDEMPOTENCY_KEY_REUSED, so a key cannot be misused.
 * - Same key while the first is still running: REQUEST_IN_PROGRESS (409); try again in a moment.
 * - Only successful answers are kept. A failed request leaves nothing behind, so fixing the problem and retrying works.
 * - Applies to every write (POST, PUT, PATCH, DELETE) that has a signed-in person and a JSON body; uploads are skipped.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const raw = req.headers?.['idempotency-key'];
    if (!raw || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.user) return next.handle();
    const type = String(req.headers['content-type'] ?? '');
    if (type && !type.includes('json')) return next.handle();
    const key = Array.isArray(raw) ? raw[0] : String(raw);
    if (!KEY_SHAPE.test(key)) throw E.badRequest('INVALID_IDEMPOTENCY_KEY', 'The Idempotency-Key must be 8 to 100 letters, digits, "-", "_", "." or ":".');
    const userId: string = req.user.id;
    const fingerprint = createHash('sha256').update(`${req.method} ${String(req.originalUrl ?? req.url).split('?')[0]} ${JSON.stringify(req.body ?? null)}`).digest('hex');

    return from(this.begin(userId, key, fingerprint)).pipe(
      mergeMap((seen) => {
        if (seen) {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(seen.status);
          return of(seen.body);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.finish(userId, key, Reflect.getMetadata('__httpCode__', ctx.getHandler()) ?? (req.method === 'POST' ? 201 : 200), body)).pipe(mergeMap(() => of(body)))),
          catchError((e) =>
            // nothing is kept for a failure, so the same key can be tried again once the cause is fixed
            from(this.prisma.idempotencyKey.deleteMany({ where: { userId, key } }).catch(() => undefined)).pipe(
              mergeMap(() => {
                throw e;
              }),
            ),
          ),
        );
      }),
    );
  }

  /** Claim the key, or return the answer already kept for it. */
  private async begin(userId: string, key: string, fingerprint: string): Promise<{ status: number; body: unknown } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.prisma.idempotencyKey.create({ data: { userId, key, fingerprint, expiresAt: new Date(Date.now() + DAY_MS) } });
        return null; // first time: go ahead
      } catch (e) {
        if ((e as { code?: string })?.code !== 'P2002') throw e;
      }
      const row = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (!row) continue; // it was just removed: claim it
      if (row.expiresAt < new Date()) {
        await this.prisma.idempotencyKey.deleteMany({ where: { id: row.id } });
        continue;
      }
      if (row.fingerprint !== fingerprint) throw E.unprocessable('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request. Use a new key for a new action.');
      if (row.state === 'done') return { status: row.status ?? 200, body: row.body ? JSON.parse(row.body) : null };
      if (Date.now() - +row.createdAt > RUNNING_STALE_MS) {
        await this.prisma.idempotencyKey.deleteMany({ where: { id: row.id } }); // its server died mid-request
        continue;
      }
      throw E.conflict('REQUEST_IN_PROGRESS', 'The first try of this request is still being handled. Wait a moment and try again.');
    }
    throw E.conflict('REQUEST_IN_PROGRESS', 'The first try of this request is still being handled. Wait a moment and try again.');
  }

  private async finish(userId: string, key: string, status: number, body: unknown) {
    const text = JSON.stringify(body ?? null);
    if (text.length > MAX_KEPT_BYTES) {
      await this.prisma.idempotencyKey.deleteMany({ where: { userId, key } });
      return;
    }
    await this.prisma.idempotencyKey.updateMany({ where: { userId, key }, data: { state: 'done', status, body: text } });
  }
}
