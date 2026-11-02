import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { logSlowQuery, metrics, slowQueryMs } from './observability';

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
              logSlowQuery(ms, what);
            }
          }
        },
      },
    });
    // Nest runs the start-up and shutdown hooks on what the constructor returns, so they are put on the timed client
    const hooks = timed as unknown as { onModuleInit(): Promise<void>; onModuleDestroy(): Promise<void> };
    hooks.onModuleInit = async () => {
      await base.$connect();
    };
    hooks.onModuleDestroy = () => base.$disconnect();
    return timed as unknown as this;
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
