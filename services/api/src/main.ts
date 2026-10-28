import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/exception.filter';
import { LiveService } from './common/live.service';
import { isDemo } from './common/demo';
import { assertVaultReady } from './common/vault';

export async function createApp() {
  assertVaultReady(); // in production, refuses to start without the encryption keys
  // rawBody: provider webhooks are authenticated by a signature over the exact bytes they sent
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: process.env.NODE_ENV === 'test' ? false : ['log', 'error', 'warn'] });
  // the profile picture arrives as raw image bytes
  app.use('/v1/me/photo', raw({ type: 'image/*', limit: '6mb' }));
  // one error shape everywhere: { statusCode, code, message, details? }
  app.useGlobalFilters(new ApiExceptionFilter());
  // ETag is readable by the browser app, so it can ask "has this changed?" and get a bodyless 304 when it has not
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8082').split(','), exposedHeaders: ['ETag'] });
  // A browser adds "Cache-Control: no-cache" to any request that carries If-None-Match, and Express then never answers 304.
  // Every answer here is per person and always revalidated, so the app's "has this changed?" question must be honoured.
  app.use((req: { method: string; headers: Record<string, unknown> }, _res: unknown, next: () => void) => {
    if (req.method === 'GET' && req.headers['if-none-match']) {
      delete req.headers['cache-control'];
      delete req.headers['pragma'];
    }
    next();
  });
  // the live connection (WebSocket at /v1/live) shares the API's port
  app.get(LiveService).attach(app.getHttpServer());
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy(process.env.TRUST_PROXY));
  return app;
}

/**
 * Which hops in front of the API (a load balancer, Cloudflare) may say who the visitor is. The rate limits go by that address:
 * with no setting, every visitor behind a proxy looks like the proxy and shares one limit; trusting the wrong thing lets a
 * visitor invent their own address. So it is off unless set: TRUST_PROXY=<number of proxies in front, e.g. 1>, or
 * loopback / linklocal / uniquelocal / addresses. "true" is refused because it believes whatever the visitor sends.
 */
export function trustProxy(v: string | undefined): number | string | false {
  const s = (v ?? '').trim();
  if (!s || s === 'false' || s === '0') return false;
  if (s === 'true') throw new Error('TRUST_PROXY=true trusts any address a visitor claims. Use the number of proxies in front (e.g. 1) or their addresses.');
  return /^\d+$/.test(s) ? Number(s) : s;
}

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  if (isDemo()) console.warn('\n*** DEMO_MODE is on: codes are shown in the app and the ID check is simulated. Use made-up data only. ***\n');
  console.log(`HERE/THERE API listening on http://localhost:${port}`);
}

if (require.main === module) void bootstrap();
