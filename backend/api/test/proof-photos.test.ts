import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('proofs' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
});

const upload = (token: string | undefined, body: Buffer, type = 'image/png') =>
  fetch(`${h.base}/v1/me/proofs`, { method: 'PUT', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': type }, body: new Uint8Array(body) });
const open = (token: string | undefined, id: string) => fetch(`${h.base}/v1/proofs/${id}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
/** A big, noisy picture, like a phone screenshot. */
const screenshot = () => sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 0, g: 0, b: 0 }, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer();
const send = async (token: string) => {
  const r = await upload(token, await screenshot());
  assert.equal(r.status, 200, await r.clone().text());
  return ((await r.json()) as { id: string }).id;
};

describe('proof photos with an appeal', () => {
  it('shrinks them to small webp, keeps them private, attaches up to three, and refuses re-use', async () => {
    const me = await h.verified('ProofMaker');
    const other = await h.verified('ProofNosy');
    const warning = await h.prisma.userWarning.create({ data: { userId: me.id, reason: 'You did not show up', createdById: me.id } });

    // stored small: webp, longest side 1280, a fraction of the original
    const original = await screenshot();
    const first = await send(me.token);
    const mine = await open(me.token, first);
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get('content-type'), 'image/webp');
    assert.match(mine.headers.get('cache-control') ?? '', /no-store/);
    const bytes = Buffer.from(await mine.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(Math.max(meta.width ?? 0, meta.height ?? 0), 1280);
    assert.ok(bytes.length < original.length / 2, `${bytes.length} bytes is smaller than the original ${original.length}`);

    // private: nobody else, not even signed-in members, and not without a sign-in; staff can
    assert.equal((await open(other.token, first)).status, 404);
    assert.equal((await open(undefined, first)).status, 401);
    assert.equal((await open(h.adminToken, first)).status, 200);

    // only real pictures, in a known format
    assert.equal((await upload(me.token, Buffer.from('not a picture'))).status, 400);
    assert.equal((await upload(me.token, Buffer.alloc(0))).status, 400);

    // up to three go with an appeal; four are refused, and so are photos that are not yours
    const [second, third, fourth] = [await send(me.token), await send(me.token), await send(me.token)];
    assert.equal((await h.post('/v1/me/appeals', me.token, { kind: 'warning', targetId: warning.id, message: 'I was there the whole time', proofIds: [first, second, third, fourth] })).status, 400);
    const strangers = await send(other.token);
    assert.equal((await h.post('/v1/me/appeals', me.token, { kind: 'warning', targetId: warning.id, message: 'I was there the whole time', proofIds: [first, strangers] })).status, 404);
    const made = await h.post('/v1/me/appeals', me.token, { kind: 'warning', targetId: warning.id, message: 'I was there the whole time', proofIds: [first, second, third] });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(made.body.proofs, [first, second, third]);

    // shown with the appeal to its owner and to staff; sent ones cannot be taken back or used again
    assert.deepEqual((await h.get('/v1/me/appeals', me.token)).body.items[0].proofs, [first, second, third]);
    const queued = (await h.get('/v1/admin/appeals?state=open', h.adminToken)).body.items.find((a: { id: string }) => a.id === made.body.id);
    assert.deepEqual(queued.proofs, [first, second, third]);
    assert.equal((await h.call('DELETE', `/v1/me/proofs/${first}`, me.token)).status, 404, 'a sent photo stays with the appeal');
    assert.equal((await h.call('DELETE', `/v1/me/proofs/${fourth}`, me.token)).status, 200, 'one not sent yet can be taken back');
    assert.equal((await open(me.token, fourth)).status, 404);

    // a month after the decision they are deleted (the appeal itself stays)
    await h.post(`/v1/admin/appeals/${made.body.id}/decision`, h.adminToken, { decision: 'reject', note: 'The decision stands.' });
    const { RetentionService } = await import('../src/retention/retention.service');
    const retention = h.app.get(RetentionService);
    await retention.runOnce();
    assert.equal((await open(me.token, first)).status, 200, 'kept for now');
    await h.prisma.appeal.update({ where: { id: made.body.id }, data: { decidedAt: new Date(Date.now() - 31 * 86400e3) } });
    await retention.runOnce();
    for (const id of [first, second, third]) assert.equal((await open(me.token, id)).status, 404, 'deleted 30 days after the decision');
  });

  it('goes with a dispute of a "did not come" note, and a photo never sent is cleared after a day', async () => {
    const member = await h.verified('ProofMember');
    const host = await h.verified('ProofHost');
    const mark = await h.prisma.attendanceMark.create({
      data: { kind: 'activity', targetId: 'plan-x', userId: member.id, markedById: host.id, title: 'Coffee', planEndsAt: new Date(Date.now() - 3600e3) },
    });
    const photo = await send(member.token);
    const disputed = await h.post(`/v1/no-shows/${mark.id}/dispute`, member.token, { note: 'I was at the cafe, see the chat', proofIds: [photo] });
    assert.equal(disputed.status, 201, JSON.stringify(disputed.body));
    assert.equal((await h.get('/v1/me/no-shows', member.token)).body.items[0].proofs[0], photo);
    const queued = (await h.get('/v1/admin/no-shows?state=disputed', h.adminToken)).body.items.find((i: { id: string }) => i.id === mark.id);
    assert.deepEqual(queued.proofs, [photo]);
    assert.equal((await open(h.adminToken, photo)).status, 200);
    assert.equal((await open(host.token, photo)).status, 404, 'the host who made the note cannot see it');

    // uploaded but never sent
    const unsent = await send(member.token);
    await h.prisma.proofImage.update({ where: { id: unsent }, data: { createdAt: new Date(Date.now() - 2 * 86400e3) } });
    const { RetentionService } = await import('../src/retention/retention.service');
    await h.app.get(RetentionService).runOnce();
    assert.equal((await open(member.token, unsent)).status, 404);
    assert.equal((await open(member.token, photo)).status, 200, 'the sent one stays until its case is decided');
  });
});
