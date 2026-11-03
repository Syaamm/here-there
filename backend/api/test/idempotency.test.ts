import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('idem');
});
after(async () => {
  await h?.stop();
});

const withKey = (token: string, key: string, path: string, body: unknown, method = 'POST') =>
  fetch(h.base + path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, replayed: r.headers.get('idempotent-replayed'), body: await r.json() }));

describe('a retried request does not do the thing twice', () => {
  it('creating a plan twice with one key makes one plan and gives the same answer back', async () => {
    const host = await h.verified('IdemHost');
    const body = h.activityBody({ title: 'Retry me' });
    const first = await withKey(host.token, 'create-plan-0001', '/v1/activities', body);
    assert.equal(first.status, 201);
    assert.equal(first.replayed, null);
    const second = await withKey(host.token, 'create-plan-0001', '/v1/activities', body);
    assert.equal(second.status, 201, 'same status as the first answer');
    assert.equal(second.replayed, 'true');
    assert.equal(second.body.id, first.body.id, 'the same plan, not a second one');
    assert.equal(await h.prisma.activity.count({ where: { hostId: host.id, title: 'Retry me' } }), 1);
  });

  it('two at once: one does it, the other is told to wait or gets the same answer', async () => {
    const host = await h.verified('IdemBoth');
    const body = h.activityBody({ title: 'At once' });
    const both = await Promise.all([withKey(host.token, 'create-plan-0002', '/v1/activities', body), withKey(host.token, 'create-plan-0002', '/v1/activities', body)]);
    assert.ok(both.some((r) => r.status === 201 && r.replayed === null));
    assert.ok(both.every((r) => r.status === 201 || (r.status === 409 && r.body.code === 'REQUEST_IN_PROGRESS')), JSON.stringify(both.map((r) => [r.status, r.body.code])));
    assert.equal(await h.prisma.activity.count({ where: { hostId: host.id, title: 'At once' } }), 1);
  });

  it('the same key for a different request is refused, and another person cannot replay it', async () => {
    const host = await h.verified('IdemOther');
    const other = await h.verified('IdemStranger');
    assert.equal((await withKey(host.token, 'create-plan-0003', '/v1/activities', h.activityBody({ title: 'One' }))).status, 201);
    const diff = await withKey(host.token, 'create-plan-0003', '/v1/activities', h.activityBody({ title: 'Two' }));
    assert.equal(diff.status, 422);
    assert.equal(diff.body.code, 'IDEMPOTENCY_KEY_REUSED');
    const stolen = await withKey(other.token, 'create-plan-0003', '/v1/activities', h.activityBody({ title: 'One' }));
    assert.equal(stolen.replayed, null, 'a key belongs to the person who used it');
    assert.equal(stolen.status, 201);
  });

  it('a failed request leaves nothing behind, so the same key works once the problem is fixed', async () => {
    const host = await h.verified('IdemFail');
    const bad = await withKey(host.token, 'create-plan-0004', '/v1/activities', { ...h.activityBody(), capacity: 0 });
    assert.equal(bad.status, 400);
    const ok = await withKey(host.token, 'create-plan-0004', '/v1/activities', h.activityBody({ title: 'Fixed' }));
    assert.equal(ok.status, 201);
    assert.equal(ok.replayed, null);
  });

  it('a request with no key behaves as before, and a badly shaped key is refused', async () => {
    const host = await h.verified('IdemNone');
    const plain = await h.post('/v1/activities', host.token, h.activityBody({ title: 'No key a' }));
    assert.equal(plain.status, 201);
    const again = await withKey(host.token, 'create-plan-0005', '/v1/activities', h.activityBody({ title: 'No key b', startsAt: h.hours(6), endsAt: h.hours(8) }));
    assert.equal(again.status, 201);
    assert.equal(again.replayed, null, 'a key used for the first time is never a replay');
    const short = await withKey(host.token, 'x', '/v1/activities', h.activityBody());
    assert.equal(short.status, 400);
    assert.equal(short.body.code, 'INVALID_IDEMPOTENCY_KEY');
  });

  it('the clean-up removes old keys', async () => {
    const host = await h.verified('IdemPurge');
    await h.prisma.idempotencyKey.create({ data: { userId: host.id, key: 'old-key-000001', fingerprint: 'x', state: 'done', status: 201, body: '{}', expiresAt: new Date(Date.now() - 1000) } });
    const { JobsService } = await import('../src/common/jobs.service');
    assert.equal(await h.prisma.idempotencyKey.count({ where: { key: 'old-key-000001' } }), 1);
    await h.app.get(JobsService).purge();
    assert.equal(await h.prisma.idempotencyKey.count({ where: { key: 'old-key-000001' } }), 0);
  });
});
