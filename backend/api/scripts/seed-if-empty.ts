/**
 * Used by `npm run deploy`: adds the first admin and the sample people and plans (scripts/seed.ts) only when the database has
 * no accounts yet, so deploying again and again never duplicates the sample data or touches what people have made.
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function main() {
  const prisma = new PrismaClient();
  const accounts = await prisma.user.count();
  await prisma.$disconnect();
  if (accounts > 0) {
    console.log(`The database already has ${accounts} accounts: the sample data is not added again.`);
    return;
  }
  console.log('The database is empty: adding the first admin and the sample people and plans...');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
