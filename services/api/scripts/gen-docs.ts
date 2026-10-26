// Writes docs/openapi.json and docs/ERROR-CODES.md from the running code. Run with: npm run docs
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'file:./dev.db'; // the app is only assembled, never started, so nothing is read from it
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateDocs, API_ROOT } from '../src/docs/generate';
import { createApp } from '../src/main';

void (async () => {
  const app = await createApp();
  const d = generateDocs(app);
  const dir = path.join(API_ROOT, 'docs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'openapi.json'), d.openapi);
  writeFileSync(path.join(dir, 'ERROR-CODES.md'), d.errorTable);
  console.log(`docs/openapi.json: ${d.routes.length} routes, docs/ERROR-CODES.md: ${d.scan.codes.length} codes`);
  await app.close();
  process.exit(0);
})().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
