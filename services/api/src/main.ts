import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/exception.filter';
import { LiveService } from './common/live.service';
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
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`HERE/THERE API listening on http://localhost:${port}`);
}

if (require.main === module) void bootstrap();
