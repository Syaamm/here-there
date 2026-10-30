import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { log, metrics, slowQueryMs } from './observability';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const base = this;
    // Slow-query log. Timing every database call here (rather than listening to the engine's own query events) keeps the
    // request id: the engine reports from outside the request, so its lines could not be tied to the request that caused them.
    // What is logged is the table and the action (User.findMany), never the filter or the values.
    const timed = this.$extends({
      query: {
        async $allOperations({ model, operation, args, query }) {
          const started = process.hrtime.bigint();
          try {
            return await query(args);
          } finally {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            if (ms >= slowQueryMs()) {
              const what = model ? `${model}.${operation}` : operation;
              metrics.slowQuery(ms, what);
              log('warn', 'slow query', { ms: Math.round(ms), what });
            }
          }
        },
      },
    });
    // Nest runs the start-up and shutdown hooks on what the constructor returns, so they are put on the timed client
    const hooks = timed as unknown as { onModuleInit(): Promise<void>; onModuleDestroy(): Promise<void> };
    hooks.onModuleInit = async () => {
      await base.$connect();
      await useWriteAheadLog(base);
    };
    hooks.onModuleDestroy = () => base.$disconnect();
    return timed as unknown as this;
  }

  async onModuleInit() {
    await this.$connect();
    await useWriteAheadLog(this);
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * A development database is one SQLite file. By default every write waits for the disk three times; on a slow disk (measured:
 * 130 ms a write on a laptop with antivirus scanning) every request feels slow. The write-ahead log waits once, about three
 * times faster, and stays on in the file. Not used in tests (they delete their file when done) or with another database, and
 * `SQLITE_WAL=off` turns it off.
 */
async function useWriteAheadLog(db: PrismaClient) {
  if (process.env.NODE_ENV === 'test' || process.env.SQLITE_WAL === 'off' || !/^file:/.test(process.env.DATABASE_URL ?? '')) return;
  try {
    await db.$queryRawUnsafe('PRAGMA journal_mode=WAL');
  } catch (e) {
    log('warn', 'could not switch the database to the write-ahead log', { error: (e as Error).message });
  }
}
