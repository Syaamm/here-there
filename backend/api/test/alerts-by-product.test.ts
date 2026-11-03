import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('alerts');
});
after(async () => {
  await h?.stop();
});
const get = (u: string, t?: string) => h.get(u, t);
const post = (u: string, t?: string, b?: unknown) => h.post(u, t, b);
const verified = (n: string) => h.verified(n);
const activityBody = (o?: Record<string, unknown>) => h.activityBody(o);
const prisma = new Proxy({}, { get: (_t, k) => (h.prisma as any)[k] }) as any;

describe('alerts and chats are split by product (HERE | THERE)', () => {
  it('tags each alert, filters inbox and chats by product, and counts the other one', async () => {
    const me = await verified('Dual');
    const nina = await verified('Nina');
    // as a HERE host: someone asks to join -> a HERE alert
    const act = (await post('/v1/activities', me.token, activityBody())).body.id as string;
    await post(`/v1/activities/${act}/requests`, nina.token, { intro: 'Hi' });
    // as a THERE organizer: someone applies -> a THERE alert
    const t = await post('/v1/trips', me.token, { title: 'Split trip', destination: 'Lisbon, Portugal', originCity: 'Milan', dateStart: new Date(Date.now() + 40 * 864e5).toISOString(), dateEnd: new Date(Date.now() + 46 * 864e5).toISOString(), dateFlexibility: 'exact', budgetMin: 500, budgetMax: 900, budgetIncludesTransport: false, tags: ['food'], groupSize: '2-3' });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    await post(`/v1/trips/${t.body.id}/applications`, nina.token, { intro: 'Count me in.', confirmBudget: true, confirmDates: true, confirmGuidelines: true });

    const types = async (product?: string) => (await get(`/v1/notifications${product ? `?product=${product}` : ''}`, me.token)).body.items.map((n: { type: string }) => n.type).filter((x: string) => x !== 'verification_result'); // that one is for both products, by design
    assert.deepEqual((await types('here')).sort(), ['join_request']);
    assert.deepEqual((await types('there')).sort(), ['trip_application']);
    assert.equal((await types()).length, 2, 'no filter: everything');

    // the live/inbox record says which product it is, and the unread count is split
    const all = (await get('/v1/notifications?product=here', me.token)).body;
    assert.equal(all.items[0].data.product, 'here');
    assert.deepEqual(all.unreadByProduct, { here: 1, there: 1 });
    assert.equal(all.unreadCount, 3, 'the tab badge still counts everything (both products and the shared "verified" alert), so nothing is missed');
    assert.ok((await get('/v1/notifications?product=there', me.token)).body.items.some((x: { type: string }) => x.type === 'verification_result'), 'shared alerts show in both');

    // reading HERE alerts leaves THERE ones unread
    await post('/v1/notifications/read-all?scope=alerts&product=here', me.token);
    const after = (await get('/v1/notifications?product=there', me.token)).body;
    assert.deepEqual(after.unreadByProduct, { here: 0, there: 1 });

    // chats: the activity group is HERE, the trip group is THERE
    const reqs = (await get(`/v1/activities/${act}/requests`, me.token)).body.items;
    await post(`/v1/activities/${act}/requests/${reqs[0].id}/decision`, me.token, { decision: 'approve' });
    const chats = async (product: string) => (await get(`/v1/me/conversations?product=${product}`, me.token)).body.items.map((c: { scope: string }) => c.scope);
    assert.deepEqual(await chats('here'), ['activity']);
    assert.deepEqual(await chats('there'), ['trip'], 'the trip group is THERE, the activity group is not');
    const conv = await prisma.conversation.findUnique({ where: { activityId: act } });
    await post(`/v1/conversations/${conv.id}/messages`, nina.token, { body: 'See you there' });
    const chatAlert = (await get('/v1/notifications?product=here', me.token)).body.items.find((n: { type: string }) => n.type === 'chat_message');
    assert.equal(chatAlert?.data.product, 'here');
    assert.equal((await get('/v1/notifications?product=there', me.token)).body.items.some((n: { type: string }) => n.type === 'chat_message'), false);
  });
});
