/**
 * One plan at a time (owner's rule, 7 Nov 2026), HERE and THERE together. Run just this file with:
 *
 *   cd backend/api
 *   npm run test:clash
 *
 * What it checks:
 *  - joining, creating or moving an activity onto a time you already host or joined is refused (TIME_CLASH, with the plans);
 *  - the plan stops blocking once it is cancelled, left, or has ended; back-to-back plans are fine;
 *  - several requests still waiting may overlap, and the first one you are accepted into wins: the others are withdrawn;
 *  - a host cannot approve someone who is busy by then (APPLICANT_BUSY), and the waiting list skips them;
 *  - trips: the same rules over whole days; an activity you host or joined blocks a trip, and a trip blocks joining and
 *    applying and moving, but CREATING a trip or an activity on days you are already on a trip is allowed (9 Nov 2026: the app
 *    only warns, "go on only if you can join or host");
 *  - GET /v1/me/clashes lists what is in the way.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('time-clash');
});
after(async () => {
  await h.stop();
});

const DAY = 24 * 3600 * 1000;
/** midnight UTC, `n` days from today (trip dates are whole days) */
const day = (n: number) => {
  const d = new Date(Date.now() + n * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
};
let titles = 0;
/** an activity with its own title and venue (so the duplicate check never fires), from `start` to `end` hours from now */
const act = (start: number, end: number, over: Record<string, unknown> = {}) =>
  h.activityBody({ title: `Plan ${++titles}`, venueName: `Venue ${titles}`, startsAt: h.hours(start), endsAt: h.hours(end), capacity: 6, ...over });
const tripBody = (startDay: number, endDay: number, over: Record<string, unknown> = {}) => ({
  title: `Trip ${++titles}`, destination: 'Lisbon, Portugal', originCity: 'Milan', dateStart: day(startDay), dateEnd: day(endDay), dateFlexibility: 'exact',
  budgetMin: 500, budgetMax: 900, budgetIncludesTransport: true, tags: ['food'], groupSize: '4-6', ...over,
});
const applyBody = { intro: 'I would love to come along.', confirmBudget: true, confirmDates: true, confirmGuidelines: true };
type U = { token: string; id: string };

async function create(host: U, body: Record<string, unknown>) {
  const r = await h.post('/v1/activities', host.token, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { id: string; title: string };
}
async function createTrip(host: U, body: Record<string, unknown>) {
  const r = await h.post('/v1/trips', host.token, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { id: string; title: string };
}
const join = (u: U, id: string) => h.post(`/v1/activities/${id}/requests`, u.token, {});
async function approve(host: U, activityId: string, applicantId: string) {
  const reqs = await h.get(`/v1/activities/${activityId}/requests`, host.token);
  const r = reqs.body.items.find((x: any) => x.applicant.id === applicantId);
  return h.post(`/v1/activities/${activityId}/requests/${r.id}/decision`, host.token, { decision: 'approve' });
}
async function requestState(activityId: string, userId: string) {
  return (await h.prisma.activityRequest.findUnique({ where: { activityId_applicantId: { activityId, applicantId: userId } } }))?.state;
}

describe('one plan at a time: joining activities', () => {
  it('refuses joining an activity that overlaps one you joined, and names it', async () => {
    const host = await h.verified('Host');
    const me = await h.verified('Me');
    const yoga = await create(host, act(2, 4, { joinPolicy: 'instant' }));
    const brunch = await create(await h.verified('Host2'), act(3, 5, { joinPolicy: 'instant' }));
    assert.equal((await join(me, yoga.id)).body.state, 'approved');
    const r = await join(me, brunch.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'TIME_CLASH');
    assert.equal(r.body.details.clashes.length, 1);
    assert.equal(r.body.details.clashes[0].id, yoga.id);
    assert.equal(r.body.details.clashes[0].role, 'going');
    assert.ok(r.body.details.clashes[0].endsAt, 'the clash says when it ends');
  });

  it('allows back-to-back plans and plans at other times', async () => {
    const host = await h.verified('Host');
    const other = await h.verified('Other');
    const me = await h.verified('Me');
    const a = await create(host, act(2, 4, { joinPolicy: 'instant' }));
    const b = await create(other, act(4, 6, { joinPolicy: 'instant' })); // starts the moment a ends
    assert.equal((await join(me, a.id)).body.state, 'approved');
    assert.equal((await join(me, b.id)).body.state, 'approved');
  });

  it('lists every clash when several plans overlap', async () => {
    const [h1, h2, h3] = [await h.verified('H1'), await h.verified('H2'), await h.verified('H3')];
    const me = await h.verified('Me');
    const a = await create(h1, act(2, 3, { joinPolicy: 'instant' }));
    const b = await create(h2, act(3, 4, { joinPolicy: 'instant' }));
    const long = await create(h3, act(2, 4, { joinPolicy: 'instant' }));
    await join(me, a.id);
    await join(me, b.id);
    const r = await join(me, long.id);
    assert.equal(r.body.code, 'TIME_CLASH');
    assert.deepEqual(r.body.details.clashes.map((x: any) => x.id), [a.id, b.id]);
  });

  it('frees the time once the clashing plan is cancelled by its host, or left', async () => {
    const [h1, h2, h3] = [await h.verified('H1'), await h.verified('H2'), await h.verified('H3')];
    const me = await h.verified('Me');
    const a = await create(h1, act(2, 4, { joinPolicy: 'instant' }));
    const b = await create(h2, act(2, 4, { joinPolicy: 'instant' }));
    const c = await create(h3, act(2, 4, { joinPolicy: 'instant' }));
    await join(me, a.id);
    assert.equal((await join(me, b.id)).body.code, 'TIME_CLASH');
    assert.equal((await h.post(`/v1/activities/${a.id}/cancel`, h1.token)).status, 201);
    assert.equal((await join(me, b.id)).body.state, 'approved', 'cancelled by the host: no longer in the way');
    assert.equal((await join(me, c.id)).body.code, 'TIME_CLASH');
    assert.equal((await h.post(`/v1/activities/${b.id}/leave`, me.token)).status, 201);
    assert.equal((await join(me, c.id)).body.state, 'approved', 'left: no longer in the way');
  });

  it('a plan that has ended never clashes', async () => {
    const [h1, h2] = [await h.verified('H1'), await h.verified('H2')];
    const me = await h.verified('Me');
    const a = await create(h1, act(2, 4, { joinPolicy: 'instant' }));
    await join(me, a.id);
    const b = await create(h2, act(3, 5, { joinPolicy: 'instant' }));
    // move a into the past (as if it ran this morning)
    await h.prisma.activity.update({ where: { id: a.id }, data: { startsAt: new Date(Date.now() - 3 * 3600e3), endsAt: new Date(Date.now() - 3600e3) } });
    const clashes = await h.get(`/v1/me/clashes?from=${encodeURIComponent(h.hours(3))}&to=${encodeURIComponent(h.hours(5))}&exclude=activity:${b.id}`, me.token);
    assert.equal(clashes.body.items.length, 0);
    assert.equal((await join(me, b.id)).body.state, 'approved');
  });
});

describe('one plan at a time: requests still waiting (first accepted wins)', () => {
  it('lets several overlapping requests wait, and withdraws the others when one is approved', async () => {
    const [h1, h2, h3] = [await h.verified('H1'), await h.verified('H2'), await h.verified('H3')];
    const me = await h.verified('Me');
    const a = await create(h1, act(2, 4));
    const b = await create(h2, act(3, 5));
    const later = await create(h3, act(6, 8));
    assert.equal((await join(me, a.id)).body.state, 'requested');
    assert.equal((await join(me, b.id)).body.state, 'requested', 'a waiting request does not block another');
    assert.equal((await join(me, later.id)).body.state, 'requested');
    const mine = await h.get(`/v1/me/clashes?from=${encodeURIComponent(h.hours(3))}&to=${encodeURIComponent(h.hours(5))}&exclude=activity:${b.id}`, me.token);
    assert.deepEqual(mine.body.items.map((x: any) => [x.id, x.firm, x.role]), [[a.id, false, 'requested']]);

    assert.equal((await approve(h2, b.id, me.id)).status, 201);
    assert.equal(await requestState(a.id, me.id), 'withdrawn', 'the overlapping request was withdrawn');
    assert.equal(await requestState(later.id, me.id), 'requested', 'a request at another time is left alone');
    // the person is not on screen when a host approves, so the approval alert itself says what was withdrawn (no second alert)
    const alerts = (await h.get('/v1/notifications', me.token)).body.items;
    const approved = alerts.find((n: any) => n.type === 'request_approved');
    assert.match(approved.body, new RegExp(`Your request for "${a.title}" was withdrawn \\(same time\\)`));
    assert.ok(!alerts.some((n: any) => n.type === 'request_auto_withdrawn'), 'one alert, not two');
    // and the host of a sees it as withdrawn: approving it now is refused
    const reqs = (await h.get(`/v1/activities/${a.id}/requests`, h1.token)).body.items;
    const r = reqs.find((x: any) => x.applicant.id === me.id);
    assert.equal((await h.post(`/v1/activities/${a.id}/requests/${r.id}/decision`, h1.token, { decision: 'approve' })).body.code, 'REQUEST_WITHDRAWN');
  });

  it('an instant join wins over requests still waiting', async () => {
    const [h1, h2] = [await h.verified('H1'), await h.verified('H2')];
    const me = await h.verified('Me');
    const waiting = await create(h1, act(2, 4));
    const instant = await create(h2, act(3, 5, { joinPolicy: 'instant' }));
    assert.equal((await join(me, waiting.id)).body.state, 'requested');
    const joined = await join(me, instant.id);
    assert.equal(joined.body.state, 'approved');
    assert.deepEqual(joined.body.withdrawn, [{ kind: 'activity', id: waiting.id, title: waiting.title }], 'the answer says what was withdrawn, for the screen');
    assert.equal(await requestState(waiting.id, me.id), 'withdrawn');
    const alerts = (await h.get('/v1/notifications', me.token)).body.items;
    assert.ok(alerts.some((n: any) => n.type === 'request_auto_withdrawn'), 'and it stays in the alerts list too');
  });

  it('refuses the host approving someone who is busy by then (APPLICANT_BUSY)', async () => {
    const [h1, h2] = [await h.verified('H1'), await h.verified('H2')];
    const me = await h.verified('Me');
    const a = await create(h1, act(2, 4));
    const b = await create(h2, act(3, 5));
    await join(me, a.id);
    // as if they had got into b by another way in the meantime (an old app, a race)
    await h.prisma.activityMembership.create({ data: { activityId: b.id, userId: me.id, role: 'attendee', state: 'approved' } });
    const r = await approve(h1, a.id, me.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'APPLICANT_BUSY');
  });

  it('the waiting list skips a person who is busy by then', async () => {
    const [h1, h2] = [await h.verified('H1'), await h.verified('H2')];
    const [busy, free, first] = [await h.verified('Busy'), await h.verified('Free'), await h.verified('First')];
    const full = await create(h1, act(2, 4, { joinPolicy: 'instant', capacity: 2 })); // host + 1
    assert.equal((await join(first, full.id)).body.state, 'approved');
    assert.equal((await join(busy, full.id)).body.state, 'waitlisted');
    assert.equal((await join(free, full.id)).body.state, 'waitlisted');
    const other = await create(h2, act(3, 5));
    await h.prisma.activityMembership.create({ data: { activityId: other.id, userId: busy.id, role: 'attendee', state: 'approved' } });
    assert.equal((await h.post(`/v1/activities/${full.id}/leave`, first.token)).status, 201);
    assert.equal(await requestState(full.id, free.id), 'approved', 'the next free person moved up');
    assert.equal(await requestState(full.id, busy.id), 'waitlisted', 'the busy one keeps their place');
  });
});

describe('one plan at a time: creating and moving activities', () => {
  it('refuses creating an activity that overlaps one you joined or host, and allows other times', async () => {
    const host = await h.verified('Host');
    const me = await h.verified('Me');
    const a = await create(host, act(2, 4, { joinPolicy: 'instant' }));
    await join(me, a.id);
    const r = await h.post('/v1/activities', me.token, act(3, 5));
    assert.equal(r.body.code, 'TIME_CLASH');
    assert.equal(r.body.details.clashes[0].id, a.id);
    const mine = await create(me, act(5, 6)); // after it ends
    assert.equal((await h.post('/v1/activities', me.token, act(5.5, 7))).body.code, 'TIME_CLASH', 'overlaps the one I host');
    assert.ok(mine.id);
  });

  it('creating an activity withdraws your overlapping requests still waiting', async () => {
    const host = await h.verified('Host');
    const me = await h.verified('Me');
    const a = await create(host, act(2, 4));
    await join(me, a.id);
    const mine = await create(me, act(3, 5));
    assert.deepEqual((mine as any).withdrawn, [{ kind: 'activity', id: a.id, title: a.title }]);
    assert.equal(await requestState(a.id, me.id), 'withdrawn');
  });

  it('refuses moving an activity you host onto a time you are busy', async () => {
    const host = await h.verified('Host');
    const me = await h.verified('Me');
    const a = await create(host, act(2, 4, { joinPolicy: 'instant' }));
    await join(me, a.id);
    const mine = await create(me, act(6, 8));
    const r = await h.call('PATCH', `/v1/activities/${mine.id}`, me.token, { startsAt: h.hours(3), endsAt: h.hours(5) });
    assert.equal(r.body.code, 'TIME_CLASH');
    const ok = await h.call('PATCH', `/v1/activities/${mine.id}`, me.token, { startsAt: h.hours(7), endsAt: h.hours(9) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});

describe('one plan at a time: trips, and trips with activities', () => {
  it('refuses applying to a trip on days you are already on a trip, and allows other dates', async () => {
    const [o1, o2, o3] = [await h.verified('O1'), await h.verified('O2'), await h.verified('O3')];
    const me = await h.verified('Me');
    const t1 = await createTrip(o1, tripBody(10, 14));
    const t2 = await createTrip(o2, tripBody(14, 18)); // shares day 14
    const t3 = await createTrip(o3, tripBody(15, 18));
    assert.equal((await h.post(`/v1/trips/${t1.id}/applications`, me.token, applyBody)).status, 201);
    const apps = (await h.get(`/v1/trips/${t1.id}/applications`, o1.token)).body.items;
    assert.equal((await h.post(`/v1/trips/${t1.id}/applications/${apps[0].id}/decision`, o1.token, { decision: 'approve' })).status, 201);
    const r = await h.post(`/v1/trips/${t2.id}/applications`, me.token, applyBody);
    assert.equal(r.body.code, 'TIME_CLASH');
    assert.equal(r.body.details.clashes[0].kind, 'trip');
    assert.equal(r.body.details.clashes[0].role, 'member');
    assert.equal((await h.post(`/v1/trips/${t3.id}/applications`, me.token, applyBody)).status, 201, 'the day after is free');
  });

  it('first approved trip application wins over the overlapping ones', async () => {
    const [o1, o2] = [await h.verified('O1'), await h.verified('O2')];
    const me = await h.verified('Me');
    const t1 = await createTrip(o1, tripBody(20, 24));
    const t2 = await createTrip(o2, tripBody(22, 26));
    await h.post(`/v1/trips/${t1.id}/applications`, me.token, applyBody);
    assert.equal((await h.post(`/v1/trips/${t2.id}/applications`, me.token, applyBody)).status, 201, 'waiting applications may overlap');
    const apps = (await h.get(`/v1/trips/${t2.id}/applications`, o2.token)).body.items;
    await h.post(`/v1/trips/${t2.id}/applications/${apps[0].id}/decision`, o2.token, { decision: 'approve' });
    const left = await h.prisma.tripApplication.findUnique({ where: { tripId_applicantId: { tripId: t1.id, applicantId: me.id } } });
    assert.equal(left.state, 'withdrawn');
    const approved = (await h.get('/v1/notifications', me.token)).body.items.find((n: any) => n.type === 'application_approved');
    assert.match(approved.body, new RegExp(`Your application for "${t1.title}" was withdrawn`));
  });

  it('allows creating a trip over a trip you are on (the app only warns), but refuses moving a trip there', async () => {
    const me = await h.verified('Me');
    await createTrip(me, tripBody(30, 33));
    assert.equal((await h.post('/v1/trips', me.token, tripBody(33, 35))).status, 201, 'a trip over a trip is only a warning in the app');
    const t = await createTrip(me, tripBody(40, 42));
    assert.equal((await h.call('PATCH', `/v1/trips/${t.id}`, me.token, { dateStart: day(31), dateEnd: day(41) })).body.code, 'TIME_CLASH');
  });

  it('a trip and an activity block each other', async () => {
    const host = await h.verified('Host');
    const me = await h.verified('Me');
    const a = await create(host, act(50, 52, { joinPolicy: 'instant' })); // about two days from now
    await join(me, a.id);
    const r = await h.post('/v1/trips', me.token, tripBody(1, 4));
    assert.equal(r.body.code, 'TIME_CLASH', 'a trip cannot cover the day of an activity you joined');
    assert.equal(r.body.details.clashes[0].kind, 'activity');
    await createTrip(me, tripBody(6, 8)); // later days are free
    // creating an activity on a day of a trip you are on is allowed (the app only warns: "you are on a trip then")
    await create(me, act(24 * 6 + 16, 24 * 6 + 18));
    const during = await create(host, act(24 * 6 + 12, 24 * 6 + 14, { joinPolicy: 'instant' })); // inside the trip
    const j = await join(me, during.id);
    assert.equal(j.body.code, 'TIME_CLASH', 'an activity cannot fall on a day of your trip');
    assert.equal(j.body.details.clashes[0].kind, 'trip');
  });

  it('a cancelled trip no longer blocks', async () => {
    const me = await h.verified('Me');
    const t = await createTrip(me, tripBody(60, 62));
    const other = await createTrip(me, tripBody(70, 72));
    const move = () => h.call('PATCH', `/v1/trips/${other.id}`, me.token, { dateStart: day(61), dateEnd: day(63) });
    assert.equal((await move()).body.code, 'TIME_CLASH');
    assert.equal((await h.post(`/v1/trips/${t.id}/cancel`, me.token)).status, 201);
    assert.equal((await move()).status, 200);
  });
});
