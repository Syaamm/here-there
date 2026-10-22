import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { AppModule } from './app.module';
import { LiveService } from './common/live.service';

export async function createApp() {
  // rawBody: provider webhooks are authenticated by a signature over the exact bytes they sent
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: process.env.NODE_ENV === 'test' ? false : ['log', 'error', 'warn'] });
  // the profile picture arrives as raw image bytes
  app.use('/v1/me/photo', raw({ type: 'image/*', limit: '6mb' }));
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8082').split(',') });
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
