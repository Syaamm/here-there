import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { API_ROOT } from '../src/docs/generate';
import { APP_TYPES_PATH, buildAppTypes, tsType } from '../scripts/gen-app-types';

describe('the app\'s request types come from the OpenAPI file', () => {
  it('turns validation rules into TypeScript types', () => {
    assert.equal(tsType({ type: 'string' }), 'string');
    assert.equal(tsType({ type: 'integer' }), 'number');
    assert.equal(tsType({ enum: ['a', 'b'] }), '"a" | "b"');
    assert.equal(tsType({ type: ['string', 'null'] }), 'string | null');
    assert.equal(tsType({ anyOf: [{ type: 'string' }, { type: 'null' }] }), 'string | null');
    assert.equal(tsType({ type: 'array', items: { type: 'number' } }), 'Array<number>');
    assert.equal(tsType({ type: 'object', properties: { a: { type: 'string' }, 'b-c': { type: 'boolean' } }, required: ['a'] }), '{ a: string; "b-c"?: boolean }');
  });

  it('is up to date: change a rule on the server and this fails until `npm run docs` is run, so the app and the server cannot drift apart', () => {
    const openapi = JSON.parse(readFileSync(path.join(API_ROOT, 'docs', 'openapi.json'), 'utf8'));
    assert.ok(existsSync(APP_TYPES_PATH), 'apps/mobile/src/lib/api-types.gen.ts is missing: run npm run docs in services/api');
    assert.equal(readFileSync(APP_TYPES_PATH, 'utf8').replace(/\r\n/g, '\n'), buildAppTypes(openapi), 'the app types are out of date: run npm run docs in services/api');
  });

  it('knows the error codes and the sign-up routes', () => {
    const text = readFileSync(APP_TYPES_PATH, 'utf8');
    assert.match(text, /"IDEMPOTENCY_KEY_REUSED"/);
    assert.match(text, /"POST \/v1\/auth\/register\/confirm": \{ body: \{ email: string; code: string; ticket: string \}/);
  });
});
