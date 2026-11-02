import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

// a small stand-in for the built website (npm run build:web makes the real one in build/site)
const dir = mkdtempSync(path.join(os.tmpdir(), 'here-there-site-'));
mkdirSync(path.join(dir, 'admin', 'assets'), { recursive: true });
mkdirSync(path.join(dir, '_expo', 'static', 'js'), { recursive: true });
writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>THE APP</title>');
writeFileSync(path.join(dir, 'admin', 'index.html'), '<!doctype html><title>THE ADMIN CONSOLE</title>');
writeFileSync(path.join(dir, 'admin', 'assets', 'index-abc123.js'), 'console.log("admin")');
writeFileSync(path.join(dir, '_expo', 'static', 'js', 'entry-abc123.js'), 'console.log("app")');
process.env.SITE_DIR = dir;

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('site');
});
after(async () => {
  await h?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const page = async (p: string, init?: RequestInit) => {
  const r = await fetch(h.base + p, init);
  return { status: r.status, type: r.headers.get('content-type') ?? '', cache: r.headers.get('cache-control') ?? '', text: await r.text() };
};

describe('the API serves the website it finds in build/site', () => {
  it('shows the app at / and the admin console at /admin/, however the visitor got there', async () => {
    assert.match((await page('/')).text, /THE APP/);
    assert.match((await page('/admin/')).text, /THE ADMIN CONSOLE/);
    assert.match((await page('/admin')).text, /THE ADMIN CONSOLE/, 'without the slash it still ends up on the console');
    // a screen of the app, or of the console, opened straight from a link or after a reload
    assert.match((await page('/activity/abc123', { headers: { accept: 'text/html' } })).text, /THE APP/);
    assert.match((await page('/admin/users', { headers: { accept: 'text/html' } })).text, /THE ADMIN CONSOLE/);
  });

  it('keeps the pages fresh and the fingerprinted files for a year', async () => {
    assert.match((await page('/')).cache, /no-cache/);
    assert.match((await page('/admin/')).cache, /no-cache/);
    const js = await page('/admin/assets/index-abc123.js');
    assert.equal(js.status, 200);
    assert.match(js.type, /javascript/);
    assert.match(js.cache, /immutable/);
    assert.match((await page('/_expo/static/js/entry-abc123.js')).cache, /immutable/);
  });

  it('never hides the API: its own addresses and a missing file are answered by the API, not by a page', async () => {
    const me = await page('/v1/me');
    assert.equal(me.status, 401);
    assert.match(me.type, /json/);
    assert.doesNotMatch(me.text, /THE APP/);
    const missing = await page('/nothing-here.js');
    assert.equal(missing.status, 404, 'a missing file is a 404, not the app page');
    assert.doesNotMatch(missing.text, /THE APP/);
    const share = await page('/a/no-such-plan', { headers: { accept: 'text/html' } });
    assert.doesNotMatch(share.text, /THE APP/, 'a shared-link address belongs to the API');
    assert.equal((await page('/', { method: 'POST' })).status, 404, 'only reading is served as a page');
  });
});
