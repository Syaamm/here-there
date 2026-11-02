/**
 * The test database. Every test file gets its own PostgreSQL schema (`test_<name>`) inside one database, so files run side by side
 * and never see each other's rows. The address comes from TEST_DATABASE_URL, or else DATABASE_URL, taken from the environment or
 * from services/api/.env. Any `?schema=` on it is ignored: the schema is always `test_<name>`, and only schemas with that prefix
 * are ever dropped, so the development data in the `public` schema is never touched.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

function baseUrl(): URL {
  if (!/^postgres(ql)?:/.test(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '')) {
    try {
      process.loadEnvFile(path.join(root, '.env'));
    } catch {
      /* no .env: the error below says what is missing */
    }
  }
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:/.test(raw)) throw new Error('The tests need a PostgreSQL address: set TEST_DATABASE_URL (or DATABASE_URL) to postgresql://user:password@localhost:5432/database');
  const url = new URL(raw);
  url.search = '';
  return url;
}

const schemaOf = (name: string) => `test_${name.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}`;

/** The address one test file puts in DATABASE_URL before the app starts. */
export function testDatabaseUrl(name: string): string {
  const url = baseUrl();
  url.searchParams.set('schema', schemaOf(name));
  return url.href;
}

async function onDatabase(run: (db: { $executeRawUnsafe(sql: string): Promise<unknown> }) => Promise<unknown>) {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: baseUrl().href } }, log: [] });
  try {
    await run(db);
  } finally {
    await db.$disconnect();
  }
}

/** An empty schema with the current tables, ready for a test file. */
export async function resetTestDatabase(name: string) {
  const schema = schemaOf(name);
  await onDatabase((db) => db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
  execFileSync(process.execPath, [path.join(root, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(name) },
    stdio: 'ignore',
  });
}

/** Removes the test file's schema when it is done (KEEP_TEST_DB=1 leaves it, to look at the rows after a failure). */
export async function dropTestDatabase(name: string) {
  if (process.env.KEEP_TEST_DB === '1') return;
  const schema = schemaOf(name);
  await onDatabase((db) => db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
}
