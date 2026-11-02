/**
 * One command that gets a copy of the code ready to run, in the same development mode the project is worked on in
 * (no production keys or settings): `npm run deploy` from the repository folder. Safe to run again after every `git pull`.
 *
 *   1. checks Node is new enough and that services/api/.env exists (it never reads it)
 *   2. builds the database client, the API, and the website (the app + the admin console, into build/site)
 *   3. creates or updates the database tables (npm run db:push)
 *   4. adds the first admin and the sample people and plans, only if the database has no accounts yet
 *
 * Then start (or restart) the API: `npm start -w @here-there/api`. The API serves the website itself. See DEPLOY.md.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 7)) {
  console.error(`Node ${process.versions.node} is too old: this project needs Node 24.7 or newer (password hashing uses Node's built-in Argon2).`);
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'services', 'api', '.env'))) {
  console.error('services/api/.env is missing. Create it with at least one line, the PostgreSQL address:\n\n  DATABASE_URL="postgresql://user:password@localhost:5432/herethere"\n\n(see DEPLOY.md for the other lines worth adding)');
  process.exit(1);
}

function step(label, command) {
  console.log(`\n=== ${label}`);
  const r = spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nStopped at: ${label}`);
    process.exit(r.status ?? 1);
  }
}

step('Build: database client, API, website', 'npm run build:all');
step('Database tables', 'npm run db:push -w @here-there/api');
step('First admin and sample data (only if the database is empty)', 'node services/api/dist/scripts/seed-if-empty.js');

console.log('\nReady. Start or restart the API: npm start -w @here-there/api   (the app is at /, the admin console at /admin/)');
