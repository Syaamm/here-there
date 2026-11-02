/**
 * Builds the whole website in one go: the web version of the app (at /) and the admin console (at /admin/), and puts them
 * together in one folder: build/site.
 *
 *   npm run build:web
 *
 * With no address (the normal way) the builds find the API wherever the page came from ("same-origin"). The API serves
 * build/site itself when the folder exists (services/api/src/common/site.ts), so putting the code on a server, running this
 * and starting the API makes the app and the admin console live at the server's own address, whatever its domain. Nothing is
 * copied or uploaded by hand.
 *
 * If the website is to be served by something else (nginx from a folder) and the API lives at another address, give that
 * address (https, no slash at the end; it is baked into both builds):
 *
 *   npm run build:web -- https://api.example.com
 *
 * It can also be given as the PUBLIC_API_URL environment variable.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mobile = path.join(root, 'apps', 'mobile');
const admin = path.join(root, 'apps', 'admin');
const out = path.join(root, 'build', 'site');

const given = (process.argv[2] ?? process.env.PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
const raw = given || 'same-origin';
if (raw !== 'same-origin' && !/^https?:\/\/[^/\s]+$/.test(raw)) {
  console.error('The address of the API must look like https://api.example.com (or leave it out: the API then serves the site itself).');
  process.exit(1);
}
if (raw.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(raw)) {
  console.error(`"${raw}" is not https. A live site must use https (the phone app refuses anything else).`);
  process.exit(1);
}
console.log(raw === 'same-origin' ? 'Building for an API at the same address as the site.\n' : `Building for the API at ${raw}\n`);

function run(label, command, cwd, env) {
  console.log(`\n== ${label}`);
  const r = spawnSync(command, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\nFailed: ${label}`);
    process.exit(r.status ?? 1);
  }
}

// 1. the admin console: type-checked, then built to apps/admin/dist (it is made to live under /admin/)
run('Admin console', 'npm run build', admin, { VITE_API_URL: raw });

// 2. the web version of the app: apps/mobile/dist
fs.rmSync(path.join(mobile, 'dist'), { recursive: true, force: true });
run('Web version of the app', 'npx expo export --platform web --output-dir dist', mobile, { EXPO_PUBLIC_API_URL: raw, EXPO_OFFLINE: '1', CI: '1' });

// 3. one folder: the app at the top, the admin console in /admin
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(mobile, 'dist'), out, { recursive: true });
fs.cpSync(path.join(admin, 'dist'), path.join(out, 'admin'), { recursive: true });

const hasApp = fs.existsSync(path.join(out, 'index.html'));
const hasAdmin = fs.existsSync(path.join(out, 'admin', 'index.html'));
if (!hasApp || !hasAdmin) {
  console.error(`\nSomething is missing in ${out} (app page: ${hasApp}, admin page: ${hasAdmin}).`);
  process.exit(1);
}
console.log(`\nDone: ${out}\n\n  /        the app\n  /admin/  the admin console\n\n` + (raw === 'same-origin'
  ? 'The API serves this folder itself: start it (npm start in services/api) and both are live at the API\'s address.'
  : `Upload the CONTENTS of the folder to the web server; the API itself must be running at ${raw}. See docs/FOR_DEPLOYMENT.md.`));
