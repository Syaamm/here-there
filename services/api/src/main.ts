import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export async function createApp() {
  // rawBody: provider webhooks are authenticated by a signature over the exact bytes they sent
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: process.env.NODE_ENV === 'test' ? false : ['log', 'error', 'warn'] });
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8081,http://localhost:8082').split(',') });
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
