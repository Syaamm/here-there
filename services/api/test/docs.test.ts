process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./docs-test.db'; // its own file, so the other test file's database is never touched
process.env.VERIFICATION_MODE = 'manual';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ApiError } from '../src/common/errors';
import { ApiExceptionFilter } from '../src/common/exception.filter';
import { generateDocs, API_ROOT } from '../src/docs/generate';
import { ERROR_GUIDE, FRAMEWORK_ERROR_CODES } from '../src/docs/error-guide';
import { ROUTE_DOCS } from '../src/docs/routes';
import { createApp } from '../src/main';

let app: Awaited<ReturnType<typeof createApp>>;
let docs: ReturnType<typeof generateDocs>;
let base = '';

const dbFiles = ['docs-test.db', 'docs-test.db-journal'].map((f) => path.join(API_ROOT, 'prisma', f));

before(async () => {
  // the app reads the database when it starts, so it gets a real (empty) one of its own
  for (const f of dbFiles) rmSync(f, { force: true });
  execFileSync(process.execPath, [path.join(API_ROOT, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], { cwd: API_ROOT, env: { ...process.env }, stdio: 'ignore' });
  app = await createApp();
  docs = generateDocs(app);
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
after(async () => {
  await app.close();
  for (const f of dbFiles) rmSync(f, { force: true });
});

describe('API documentation', () => {
  it('describes every route, and only routes that exist', () => {
    const real = new Set(docs.routes.map((r) => r.key));
    const missing = [...real].filter((k) => !ROUTE_DOCS[k]);
    const stale = Object.keys(ROUTE_DOCS).filter((k) => !real.has(k));
    assert.deepEqual(missing, [], `Add these routes to src/docs/routes.ts: ${missing.join(', ')}`);
    assert.deepEqual(stale, [], `These documented routes no longer exist: ${stale.join(', ')}`);
  });

  it('explains every error code the code can raise, and nothing that is not raised', () => {
    const raised = new Set([...docs.scan.codes.map((c) => c.code), ...FRAMEWORK_ERROR_CODES.map((c) => c.code)]);
    const unexplained = [...raised].filter((c) => !ERROR_GUIDE[c]);
    const stale = Object.keys(ERROR_GUIDE).filter((c) => !raised.has(c));
    assert.deepEqual(unexplained, [], `Explain these codes in src/docs/error-guide.ts: ${unexplained.join(', ')}`);
    assert.deepEqual(stale, [], `These documented codes are never raised: ${stale.join(', ')}`);
  });

  it('keeps one status per error code', () => {
    const seen = new Map<string, number>();
    const clash: string[] = [];
    for (const c of docs.scan.codes) {
      if (seen.has(c.code) && seen.get(c.code) !== c.status) clash.push(c.code);
      seen.set(c.code, c.status);
    }
    assert.deepEqual(clash, []);
  });

  it('has the generated files up to date (run: npm run docs)', () => {
    const onDisk = (f: string) => readFileSync(path.join(API_ROOT, 'docs', f), 'utf8');
    assert.equal(onDisk('openapi.json'), docs.openapi, 'docs/openapi.json is out of date: run `npm run docs` in services/api');
    assert.equal(onDisk('ERROR-CODES.md'), docs.errorTable, 'docs/ERROR-CODES.md is out of date: run `npm run docs` in services/api');
  });

  it('produces a structurally sound OpenAPI 3.1 document', () => {
    const doc = JSON.parse(docs.openapi);
    assert.equal(doc.openapi, '3.1.0');
    const ids = new Set<string>();
    let operations = 0;
    for (const [p, item] of Object.entries<Record<string, any>>(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        operations++;
        assert.ok(!ids.has(op.operationId), `duplicate operationId ${op.operationId}`);
        ids.add(op.operationId);
        for (const name of [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
          assert.ok(op.parameters?.some((x: any) => x.name === name && x.in === 'path'), `${method} ${p} lacks path parameter ${name}`);
        assert.ok(op.responses['200'] && op.responses['500']);
      }
    }
    assert.equal(operations, docs.routes.length);
    // a body or query that the server validates shows the real limits
    const create = doc.paths['/v1/activities'].post.requestBody.content['application/json'].schema;
    assert.deepEqual(create.properties.capacity, { type: 'integer', minimum: 2, maximum: 20 });
    assert.ok(create.required.includes('title') && !create.required.includes('tags'), 'fields with a default are optional');
    assert.equal(doc.paths['/v1/auth/login'].post.security.length, 0, 'public routes need no token');
    assert.ok(doc.paths['/v1/admin/audit'].get['x-staff-roles'].includes('trust_lead'));
    assert.ok(doc.paths['/v1/conversations/{id}/messages'].post.description.includes('verified adult'));
  });
});

describe('error shape', () => {
  it('keeps our own errors exactly as raised', async () => {
    const sent: { status?: number; body?: unknown } = {};
    const res = { headersSent: false, status: (s: number) => ((sent.status = s), res), json: (b: unknown) => ((sent.body = b), res) };
    new ApiExceptionFilter().catch(new ApiError(409, 'ACTIVITY_FULL', 'This activity is full', { x: 1 }), { switchToHttp: () => ({ getResponse: () => res }) } as never);
    assert.equal(sent.status, 409);
    assert.deepEqual(sent.body, { statusCode: 409, code: 'ACTIVITY_FULL', message: 'This activity is full', details: { x: 1 } });
  });

  it('gives an unknown URL, bad JSON and a crash a code, and never leaks internals', async () => {
    const unknown = await fetch(`${base}/v1/nothing-here`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).code, 'ROUTE_NOT_FOUND');

    const badJson = await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' });
    assert.equal(badJson.status, 400);
    const bj = await badJson.json();
    assert.equal(bj.code, 'BAD_REQUEST');
    assert.equal(bj.statusCode, 400);

    const sent: { status?: number; body?: any } = {};
    const res = { headersSent: false, status: (s: number) => ((sent.status = s), res), json: (b: unknown) => ((sent.body = b), res) };
    new ApiExceptionFilter().catch(new Error('SELECT secret FROM users failed at /srv/api/db.ts'), { switchToHttp: () => ({ getResponse: () => res }) } as never);
    assert.equal(sent.status, 500);
    assert.equal(sent.body.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(sent.body).includes('secret'));
  });

  it('serves the OpenAPI document to anyone', async () => {
    const r = await fetch(`${base}/v1/openapi.json`);
    assert.equal(r.status, 200);
    const doc = await r.json();
    assert.equal(doc.openapi, '3.1.0');
    assert.ok(doc.paths['/v1/activities'] && doc['x-error-codes'].length > 50);
  });
});
