import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('race', { queueWrites: true });
});
after(async () => {
  await h?.stop();
});

// signing people up one at a time: the act under test is what they do TOGETHER afterwards
const signUp = async (n: number, name: string) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await h.verified(`${name}${i}`));
  return out;
};

describe('places are never over-filled when people act at the same moment', () => {
  it('instant join: ten people ask for the last three places at once, three get in, seven wait', async () => {
    const host = await h.verified('RaceHost');
    const id = (await h.post('/v1/activities', host.token, h.activityBody({ capacity: 4, joinPolicy: 'instant' }))).body.id;
    const people = await signUp(10, 'Racer');
    const answers = await Promise.all(people.map((p) => h.post(`/v1/activities/${id}/requests`, p.token, {})));
    assert.ok(answers.every((r) => r.status === 201), JSON.stringify(answers.map((r) => r.body)));
    const states = answers.map((r) => r.body.state);
    assert.equal(states.filter((s) => s === 'approved').length, 3, 'host + 3 = capacity 4');
    assert.equal(states.filter((s) => s === 'waitlisted').length, 7);
    assert.equal(await h.prisma.activityMembership.count({ where: { activityId: id, state: 'approved' } }), 4);
    assert.equal((await h.prisma.activity.findUnique({ where: { id } })).status, 'full');
  });

  it('host approval: approving more requests than there are places at once fills it exactly, the rest are told it is full', async () => {
    const host = await h.verified('ApproveHost');
    const id = (await h.post('/v1/activities', host.token, h.activityBody({ capacity: 3 }))).body.id;
    const people = await signUp(6, 'Asker');
    const reqs = await Promise.all(people.map((p) => h.post(`/v1/activities/${id}/requests`, p.token, {})));
    const done = await Promise.all(reqs.map((r) => h.post(`/v1/activities/${id}/requests/${r.body.id}/decision`, host.token, { decision: 'approve' })));
    assert.equal(done.filter((r) => r.status === 201).length, 2, 'host + 2 = capacity 3');
    assert.ok(done.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.code === 'ACTIVITY_FULL'), JSON.stringify(done.map((r) => [r.status, r.body.code])));
    assert.equal(await h.prisma.activityMembership.count({ where: { activityId: id, state: 'approved' } }), 3);
  });

  it('one person tapping "ask to join" twice at once gets one request and a clear answer, never a server error', async () => {
    const host = await h.verified('TapHost');
    const id = (await h.post('/v1/activities', host.token, h.activityBody({ capacity: 5 }))).body.id;
    const p = await h.verified('Tapper');
    const both = await Promise.all([h.post(`/v1/activities/${id}/requests`, p.token, {}), h.post(`/v1/activities/${id}/requests`, p.token, {}), h.post(`/v1/activities/${id}/requests`, p.token, {})]);
    assert.equal(both.filter((r) => r.status === 201).length, 1);
    assert.ok(both.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.code === 'ALREADY_REQUESTED'), JSON.stringify(both.map((r) => [r.status, r.body.code])));
    assert.equal(await h.prisma.activityRequest.count({ where: { activityId: id, applicantId: p.id } }), 1);
  });

  it('trips: approving more applications than there are places at once fills it exactly', async () => {
    const org = await h.verified('TripOrg');
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
    const t = await h.post('/v1/trips', org.token, {
      title: 'Race trip', destination: 'Lisbon, Portugal', originCity: 'Milan', dateStart: day(40), dateEnd: day(48), dateFlexibility: 'plus_minus_3',
      budgetMin: 1200, budgetMax: 1800, budgetIncludesTransport: true, tags: ['culture', 'food'], groupSize: '2-3', visibility: 'public',
    });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    const max = (await h.prisma.trip.findUnique({ where: { id: t.body.id } })).maxCapacity;
    const people = await signUp(max + 3, 'Trav');
    const apps = await Promise.all(people.map((p) => h.post(`/v1/trips/${t.body.id}/applications`, p.token, { intro: 'Hello, I would love to join this trip', confirmBudget: true, confirmDates: true, confirmGuidelines: true })));
    const ok = apps.filter((r) => r.status === 201);
    assert.ok(ok.length > 0, JSON.stringify(apps.slice(0, 2).map((r) => [r.status, r.body])));
    const done = await Promise.all(ok.map((r) => h.post(`/v1/trips/${t.body.id}/applications/${r.body.id}/decision`, org.token, { decision: 'approve' })));
    assert.equal(await h.prisma.tripMembership.count({ where: { tripId: t.body.id, state: 'approved' } }), max, JSON.stringify(done.map((r) => [r.status, r.body.code])));
  });
});
