import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonths, chainOf, effectiveMonths, latestStart, monthsWord, scopeFor, subtree, type RegionRow } from '../src/regions/regions';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
let admin = '';
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  process.env.REGION_CACHE_MS = '0'; // a change by an admin shows at once in the tests
  h = await startHarness('regions' + (process.env.TEST_DB_TAG ?? ''), { queueWrites: true });
  admin = (await h.post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token;
});
after(async () => {
  await h?.stop();
});

const days = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
const hoursOut = (n: number) => new Date(Date.now() + n * 3600e3).toISOString();
type Person = { token: string; id: string };
let seq = 0;
/** An activity body in the given city, starting `d` days from now. */
const act = (city: string, d: number, over: Record<string, unknown> = {}) => h.activityBody({ city, title: `Plan ${++seq} in ${city}`, venueName: `Venue ${seq}`, startsAt: days(d), endsAt: new Date(Date.now() + (d * 24 + 2) * 3600e3).toISOString(), ...over });
const trip = (origin: string, startDays: number, over: Record<string, unknown> = {}) => ({
  title: `Trip ${++seq}`, destination: 'Lisbon', originCity: origin, dateStart: days(startDays), dateEnd: days(startDays + 5), budgetMin: 300, budgetMax: 600, budgetIncludesTransport: false, ...over,
});
const region = (token: string, body: unknown) => h.post('/v1/admin/regions', token, body);
const patchRegion = (token: string, key: string, body: unknown) => h.call('PATCH', `/v1/admin/regions/${key}`, token, body);
const staff = async (name: string, role: string, regionKey: string | null): Promise<Person> => {
  const u = await h.verified(name);
  const r = await h.post(`/v1/admin/users/${u.id}/role`, admin, { role, regionKey });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return u;
};

describe('planning limits: the rules', () => {
  it('counts whole calendar months and never skips into the next one', () => {
    assert.equal(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString().slice(0, 10), '2026-02-28');
    assert.equal(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString().slice(0, 10), '2028-02-29', 'a leap year');
    assert.equal(addMonths(new Date('2026-10-30T10:00:00Z'), 2).toISOString().slice(0, 10), '2026-12-30');
    assert.equal(addMonths(new Date('2026-11-30T10:00:00Z'), 3).toISOString().slice(0, 10), '2027-02-28');
    assert.equal(latestStart(1, new Date('2026-10-30T10:00:00Z')).toISOString(), '2026-11-30T23:59:59.999Z', 'the whole last day counts');
    assert.equal(monthsWord(1), 'one month');
    assert.equal(monthsWord(6), 'six months');
    assert.equal(monthsWord(18), '18 months');
  });

  const rows: RegionRow[] = [
    { key: 'global', name: 'Whole service', kind: 'global', parentKey: null, cityKey: null, hereMonths: 1, thereMonths: 6 },
    { key: 'it', name: 'Italy', kind: 'country', parentKey: 'global', cityKey: null, hereMonths: 2, thereMonths: null },
    { key: 'it-lom', name: 'Lombardy', kind: 'region', parentKey: 'it', cityKey: null, hereMonths: null, thereMonths: 3 },
    { key: 'milan', name: 'Milan', kind: 'city', parentKey: 'it-lom', cityKey: 'milan', hereMonths: null, thereMonths: null },
    { key: 'rome', name: 'Rome', kind: 'city', parentKey: 'it', cityKey: 'rome', hereMonths: 5, thereMonths: null },
    { key: 'fr', name: 'France', kind: 'country', parentKey: 'global', cityKey: null, hereMonths: null, thereMonths: null },
    { key: 'paris', name: 'Paris', kind: 'city', parentKey: 'fr', cityKey: 'paris', hereMonths: null, thereMonths: null },
  ];
  const at = (key: string) => rows.find((r) => r.key === key)!;

  it('uses the nearest place that sets a limit: city, then region, then country, then the whole service', () => {
    const m = (key: string, which: 'here' | 'there') => effectiveMonths(chainOf(rows, at(key)), which);
    assert.deepEqual([m('milan', 'here').months, m('milan', 'here').from?.name], [2, 'Italy'], 'Milan follows Italy for HERE');
    assert.deepEqual([m('milan', 'there').months, m('milan', 'there').from?.name], [3, 'Lombardy'], 'and Lombardy for THERE');
    assert.deepEqual([m('rome', 'here').months, m('rome', 'here').from?.name], [5, 'Rome'], 'a city can set its own');
    assert.deepEqual([m('rome', 'there').months, m('rome', 'there').from?.name], [6, 'Whole service']);
    assert.deepEqual([m('paris', 'here').months, m('paris', 'here').from?.name], [1, 'Whole service'], 'France set nothing: the whole service');
    assert.equal(effectiveMonths([], 'here').months, 1, 'nothing at all: the built-in default');
    assert.equal(effectiveMonths([], 'there').months, 6);
  });

  it('works out what a staff account may reach: its place and everything under it, and nothing if the place is gone', () => {
    assert.equal(scopeFor(rows, null), null, 'no area: the whole service');
    const italy = scopeFor(rows, 'it')!;
    assert.deepEqual([...italy.cityKeys].sort(), ['milan', 'rome']);
    assert.deepEqual([...italy.regionKeys].sort(), ['it', 'it-lom', 'milan', 'rome']);
    assert.deepEqual([...scopeFor(rows, 'milan')!.cityKeys], ['milan']);
    assert.deepEqual([...scopeFor(rows, 'it-lom')!.cityKeys], ['milan']);
    assert.equal(scopeFor(rows, 'ghost')!.cityKeys.size, 0, 'a place that no longer exists reaches nothing');
    assert.deepEqual(subtree(rows, 'fr').map((r) => r.key), ['fr', 'paris']);
    // a loop in the data cannot hang the lookup
    const loop: RegionRow[] = [{ ...at('it'), parentKey: 'it-lom' }, { ...at('it-lom'), parentKey: 'it' }];
    assert.ok(chainOf(loop, loop[0]).length <= 2);
    assert.ok(subtree(loop, 'it').length <= 2);
  });
});

describe('planning limits: HERE activities and THERE trips', () => {
  it('starts with one month for activities and six for trips, and says so', async () => {
    const host = await h.verified('LimHost');
    const l = (await h.get('/v1/regions/limits?city=Anywhere', host.token)).body;
    assert.deepEqual([l.here.months, l.there.months, l.here.text, l.there.text], [1, 6, 'one month', 'six months']);
    assert.equal(l.region, null, 'no place covers it');
    assert.ok(new Date(l.here.latest) > new Date(days(27)) && new Date(l.here.latest) < new Date(days(32)));
    assert.equal((await h.get('/v1/regions/limits')).status, 401);

    assert.equal((await h.post('/v1/activities', host.token, act('Anywhere', 20))).status, 201, 'three weeks ahead is fine');
    const far = await h.post('/v1/activities', host.token, act('Anywhere', 45));
    assert.equal(far.status, 400);
    assert.equal(far.body.code, 'INVALID_SCHEDULE');
    assert.match(far.body.message, /up to one month ahead/);
    assert.equal(far.body.details.months, 1);
    assert.equal((await h.post('/v1/activities', host.token, act('Anywhere', 0.5 / 24, { startsAt: hoursOut(0.05) }))).body.code, 'INVALID_SCHEDULE', 'the 10-minute minimum is unchanged');

    assert.equal((await h.post('/v1/trips', host.token, trip('Anywhere', 150))).status, 201, 'five months ahead');
    const tooFar = await h.post('/v1/trips', host.token, trip('Anywhere', 200));
    assert.equal(tooFar.body.code, 'INVALID_DATES');
    assert.match(tooFar.body.message, /up to six months ahead/);
  });

  it('lets the admin of a place change the limit for that place, and lets cities follow it', async () => {
    // Italy: 2 months for activities, 4 for trips. Milan follows Italy. Rome sets its own activities limit.
    const italy = await region(admin, { name: 'Italy', kind: 'country', hereMonths: 2, thereMonths: 4 });
    assert.equal(italy.status, 201, JSON.stringify(italy.body));
    assert.equal(italy.body.key, 'italy');
    assert.equal((await region(admin, { name: 'Milan', kind: 'city', parentKey: 'italy' })).status, 201);
    assert.equal((await region(admin, { name: 'Rome', kind: 'city', parentKey: 'italy', hereMonths: 5 })).status, 201);

    const host = await h.verified('LimItaly');
    const milan = (await h.get('/v1/regions/limits?city=Milan', host.token)).body;
    assert.deepEqual([milan.here.months, milan.here.setBy, milan.there.months, milan.region.name], [2, 'Italy', 4, 'Milan']);
    assert.equal((await h.get('/v1/regions/limits?city=ROME', host.token)).body.here.months, 5, 'the city name is matched in any letter case');
    assert.equal((await h.get('/v1/regions/limits?city=Paris', host.token)).body.here.months, 1, 'a city nobody covers follows the whole service');

    assert.equal((await h.post('/v1/activities', host.token, act('Milan', 50))).status, 201, 'seven weeks: inside two months');
    const tooFar = await h.post('/v1/activities', host.token, act('Milan', 70));
    assert.equal(tooFar.status, 400);
    assert.match(tooFar.body.message, /Activities in Italy can be planned up to two months ahead/);
    assert.equal((await h.post('/v1/activities', host.token, act('Rome', 140))).status, 201, 'Rome allows five months');
    assert.equal((await h.post('/v1/activities', host.token, act('Paris', 40))).body.code, 'INVALID_SCHEDULE', 'Paris: the whole service allows one');

    // trips follow the city they start from
    assert.equal((await h.post('/v1/trips', host.token, trip('Milan', 100))).status, 201, 'three and a half months, inside four');
    const tripFar = await h.post('/v1/trips', host.token, trip('Milan', 140));
    assert.equal(tripFar.body.code, 'INVALID_DATES');
    assert.match(tripFar.body.message, /Trips from Italy can only be planned up to four months ahead/);
    assert.equal((await h.prisma.trip.findFirst({ where: { originCity: 'Milan' } })).originKey, 'milan', 'the trip is filed under its city');
    assert.equal((await h.post('/v1/trips', host.token, trip('Paris', 150))).status, 201, 'from Paris the whole service allows six');

    // the admin lowers Italy: Milan follows at once, Rome (which sets its own) does not
    assert.equal((await patchRegion(admin, 'italy', { hereMonths: 1 })).status, 200);
    assert.equal((await h.post('/v1/activities', host.token, act('Milan', 50))).body.code, 'INVALID_SCHEDULE');
    assert.equal((await h.post('/v1/activities', host.token, act('Rome', 100))).status, 201);
    // a city that clears its own setting follows the country again
    assert.equal((await patchRegion(admin, 'rome', { hereMonths: null })).status, 200);
    assert.equal((await h.get('/v1/regions/limits?city=Rome', host.token)).body.here.months, 1);
    assert.equal((await patchRegion(admin, 'italy', { hereMonths: 2 })).status, 200);
  });

  it('applies the limit when a host moves an activity later, and when an organizer changes trip dates', async () => {
    const host = await h.verified('LimMover');
    const made = await h.post('/v1/activities', host.token, act('Milan', 10));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const later = (d: number) => ({ startsAt: days(d), endsAt: new Date(Date.now() + (d * 24 + 2) * 3600e3).toISOString() });
    assert.equal((await h.call('PATCH', `/v1/activities/${made.body.id}`, host.token, later(40))).status, 200, 'Milan allows two months');
    const tooLate = await h.call('PATCH', `/v1/activities/${made.body.id}`, host.token, later(80));
    assert.equal(tooLate.status, 400);
    assert.equal(tooLate.body.code, 'INVALID_SCHEDULE');

    const t = await h.post('/v1/trips', host.token, trip('Milan', 30));
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal((await h.call('PATCH', `/v1/trips/${t.body.id}`, host.token, { dateStart: days(60), dateEnd: days(65) })).status, 200);
    assert.equal((await h.call('PATCH', `/v1/trips/${t.body.id}`, host.token, { dateStart: days(150), dateEnd: days(155) })).body.code, 'INVALID_DATES');
  });

  it('checks the numbers an admin can set, and keeps places tidy', async () => {
    assert.equal((await patchRegion(admin, 'italy', { hereMonths: 0 })).status, 400);
    assert.equal((await patchRegion(admin, 'italy', { hereMonths: 13 })).status, 400, 'activities: 1 to 12 months');
    assert.equal((await patchRegion(admin, 'italy', { thereMonths: 25 })).status, 400, 'trips: 1 to 24 months');
    assert.equal((await patchRegion(admin, 'italy', { thereMonths: 24 })).status, 200);
    assert.equal((await patchRegion(admin, 'italy', { thereMonths: 4 })).status, 200);
    assert.equal((await patchRegion(admin, 'italy', { hereMonths: 1.5 })).status, 400, 'whole months');
    assert.equal((await patchRegion(admin, 'nowhere', { hereMonths: 2 })).status, 404);
    // places
    assert.equal((await region(admin, { name: 'Another Milan', kind: 'city', cityKey: 'milan', parentKey: 'italy' })).body.code, 'CITY_ALREADY_ASSIGNED', 'a city belongs to one place');
    assert.equal((await region(admin, { name: 'Lombardy', kind: 'region', parentKey: 'italy' })).status, 201);
    assert.equal((await region(admin, { name: 'Turin', kind: 'city', parentKey: 'milan' })).body.code, 'INVALID_PLACE', 'nothing sits under a city');
    assert.equal((await region(admin, { name: 'Spain', kind: 'country', parentKey: 'italy' })).body.code, 'INVALID_PLACE', 'a country sits directly under the whole service');
    assert.equal((await h.call('DELETE', '/v1/admin/regions/italy', admin)).body.code, 'PLACE_NOT_EMPTY');
    assert.equal((await h.call('DELETE', '/v1/admin/regions/global', admin)).body.code, 'INVALID_PLACE');
    const list = (await h.get('/v1/admin/regions', admin)).body;
    assert.deepEqual(list.defaults, { here: 1, there: 6 });
    const milan = list.items.find((i: { key: string }) => i.key === 'milan');
    assert.deepEqual([milan.effective.here, milan.effective.hereFrom, milan.hereMonths], [2, 'Italy', null]);
    assert.equal(list.items.find((i: { key: string }) => i.key === 'global').canEdit, true);
    // only administrators change places; a moderator can look
    const mod = await h.verified('RegionMod');
    await h.prisma.user.update({ where: { id: mod.id }, data: { role: 'moderator' } });
    assert.equal((await h.get('/v1/admin/regions', mod.token)).status, 200);
    assert.equal((await patchRegion(mod.token, 'italy', { hereMonths: 3 })).status, 403);
    // the cities people use that no place covers yet
    const unassigned = (await h.get('/v1/admin/regions/unassigned', admin)).body.items;
    assert.ok(unassigned.some((u: { cityKey: string }) => u.cityKey === 'anywhere'));
    assert.ok(!unassigned.some((u: { cityKey: string }) => u.cityKey === 'milan'), 'Milan is covered');
  });
});

describe('staff who look after one city, region or country', () => {
  let milanAdmin: Person;
  let italyAdmin: Person;
  let milanHost: Person;
  let romeHost: Person;
  let milanPlan = '';
  let romePlan = '';

  it('gives a staff account an area, and shows it when they sign in', async () => {
    milanHost = await h.verified('ScMilanHost'); // everyone in the tests lives in Milan unless changed
    romeHost = await h.verified('ScRomeHost');
    await h.prisma.profile.update({ where: { userId: romeHost.id }, data: { homeCity: 'Rome', homeCityKey: 'rome' } });
    milanPlan = (await h.post('/v1/activities', milanHost.token, act('Milan', 3))).body.id;
    romePlan = (await h.post('/v1/activities', romeHost.token, act('Rome', 3))).body.id;
    assert.ok(milanPlan && romePlan);

    const plain = await h.verified('ScPlain');
    assert.equal((await h.post(`/v1/admin/users/${plain.id}/role`, admin, { role: 'admin', regionKey: 'nowhere' })).body.code, 'INVALID_PLACE');
    milanAdmin = await staff('ScMilanAdmin', 'admin', 'milan');
    italyAdmin = await staff('ScItalyAdmin', 'admin', 'italy');
    const whole = await staff('ScWholeAdmin', 'admin', null);
    assert.deepEqual((await h.get('/v1/admin/scope', milanAdmin.token)).body, { role: 'admin', scope: { key: 'milan', name: 'Milan', kind: 'city' } });
    assert.equal((await h.get('/v1/admin/scope', italyAdmin.token)).body.scope.kind, 'country');
    assert.equal((await h.get('/v1/admin/scope', whole.token)).body.scope, null, 'no area: the whole service');
    // a person who is made an ordinary member again loses the area
    await h.post(`/v1/admin/users/${whole.id}/role`, admin, { role: 'user', regionKey: 'milan' });
    assert.equal((await h.prisma.user.findUnique({ where: { id: whole.id } })).adminRegionKey, null);
  });

  it('shows a city admin only the members, activities, trips and reports of that city, and a country admin all of its cities', async () => {
    const ids = async (path: string, token: string, key = 'id') => ((await h.get(path, token)).body.items as Record<string, string>[]).map((i) => i[key]);
    const acts = (t: string) => ids('/v1/admin/activities', t);
    assert.ok((await acts(milanAdmin.token)).includes(milanPlan));
    assert.ok(!(await acts(milanAdmin.token)).includes(romePlan), 'not Rome');
    assert.ok((await acts(italyAdmin.token)).includes(romePlan) && (await acts(italyAdmin.token)).includes(milanPlan), 'Italy has both');
    assert.ok((await acts(admin)).includes(romePlan), 'the whole service sees everything');

    const users = (t: string) => ids('/v1/admin/users', t);
    assert.ok((await users(milanAdmin.token)).includes(milanHost.id));
    assert.ok(!(await users(milanAdmin.token)).includes(romeHost.id));
    assert.ok(!(await users(milanAdmin.token)).includes(italyAdmin.id), 'never other staff');
    assert.ok((await users(italyAdmin.token)).includes(romeHost.id));

    // reports follow what they are about
    const reporter = await h.verified('ScReporter');
    const aboutMilan = (await h.post('/v1/reports', reporter.token, { targetType: 'user', targetId: milanHost.id, category: 'spam' })).body.id;
    const aboutRome = (await h.post('/v1/reports', reporter.token, { targetType: 'activity', targetId: romePlan, category: 'spam' })).body.id;
    const queue = (t: string) => ids('/v1/admin/reports?status=open', t);
    assert.ok((await queue(milanAdmin.token)).includes(aboutMilan));
    assert.ok(!(await queue(milanAdmin.token)).includes(aboutRome));
    assert.ok((await queue(italyAdmin.token)).includes(aboutRome));
    assert.equal((await h.post(`/v1/admin/reports/${aboutRome}/assign`, milanAdmin.token)).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.post(`/v1/admin/reports/${aboutRome}/resolve`, milanAdmin.token, { status: 'dismissed' })).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.post(`/v1/admin/reports/${aboutMilan}/resolve`, milanAdmin.token, { status: 'dismissed' })).status, 201);
  });

  it('lets them act only inside their area', async () => {
    assert.equal((await h.get(`/v1/admin/users/${romeHost.id}`, milanAdmin.token)).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.get(`/v1/admin/users/${milanHost.id}`, milanAdmin.token)).status, 200);
    assert.equal((await h.post(`/v1/admin/users/${romeHost.id}/suspend`, milanAdmin.token, { reason: 'testing the area', days: 1 })).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.post(`/v1/admin/users/${italyAdmin.id}/suspend`, milanAdmin.token, { reason: 'testing the area', days: 1 })).body.code, 'OUT_OF_SCOPE', 'other staff are for the whole service');
    assert.equal((await h.post(`/v1/admin/activities/${romePlan}/remove`, milanAdmin.token, { reason: 'testing the area' })).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.post(`/v1/admin/activities/${milanPlan}/remove`, milanAdmin.token, { reason: 'testing the area' })).status, 201);
    assert.equal((await h.post(`/v1/admin/users/${romeHost.id}/suspend`, italyAdmin.token, { reason: 'inside the country', days: 1 })).status, 201);
    assert.equal((await h.post(`/v1/admin/users/${romeHost.id}/restore`, italyAdmin.token, { reason: 'inside the country' })).status, 201);
    const romeTrip = (await h.post('/v1/trips', romeHost.token, trip('Rome', 40))).body.id;
    const milanTrip = (await h.post('/v1/trips', milanHost.token, trip('Milan', 40))).body.id;
    assert.equal((await h.post(`/v1/admin/trips/${romeTrip}/remove`, milanAdmin.token, { reason: 'testing the area' })).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.post(`/v1/admin/trips/${milanTrip}/remove`, milanAdmin.token, { reason: 'testing the area' })).status, 201);
    const trips = ((await h.get('/v1/admin/trips', italyAdmin.token)).body.items as { id: string }[]).map((t) => t.id);
    assert.ok(trips.includes(romeTrip));
  });

  it('keeps everything that is not for an area closed: the audit log, health, the on-call rota, roles, the other cities', async () => {
    for (const path of ['/v1/admin/audit', '/v1/admin/health', '/v1/admin/overview', '/v1/admin/oncall', '/v1/admin/verifications', '/v1/admin/regions/unassigned', '/v1/admin/reports/workload', '/v1/admin/no-shows']) {
      const r = await h.get(path, milanAdmin.token);
      assert.equal(r.status, 403, path);
      assert.equal(r.body.code, 'GLOBAL_STAFF_ONLY', path);
    }
    assert.equal((await h.post(`/v1/admin/users/${milanHost.id}/role`, milanAdmin.token, { role: 'moderator' })).body.code, 'GLOBAL_STAFF_ONLY', 'they cannot make staff');
    assert.equal((await h.get('/v1/admin/audit', admin)).status, 200, 'the whole service still can');
  });

  it('lets them set the limits for their own area and below, and nothing above it', async () => {
    const list = (await h.get('/v1/admin/regions', milanAdmin.token)).body;
    assert.deepEqual(list.items.map((i: { key: string }) => i.key), ['milan']);
    assert.deepEqual(list.scope, { key: 'milan', name: 'Milan', kind: 'city' });
    assert.equal(list.items[0].parentKey, null, 'the place above is not shown');
    assert.equal((await patchRegion(milanAdmin.token, 'milan', { hereMonths: 3 })).status, 200);
    assert.equal((await h.get('/v1/regions/limits?city=Milan', milanHost.token)).body.here.months, 3);
    assert.equal((await h.post('/v1/activities', milanHost.token, act('Milan', 80))).status, 201, 'the city admin gave Milan three months');
    for (const key of ['italy', 'rome', 'global']) assert.equal((await patchRegion(milanAdmin.token, key, { hereMonths: 6 })).body.code, 'OUT_OF_SCOPE', key);
    assert.equal((await h.call('DELETE', '/v1/admin/regions/milan', milanAdmin.token)).body.code, 'OUT_OF_SCOPE', 'a city admin cannot remove their own city');
    assert.equal((await region(milanAdmin.token, { name: 'Sub', kind: 'city', parentKey: 'milan' })).body.code, 'INVALID_PLACE', 'nothing sits under a city');

    // a country admin can add cities and regions under the country, not beside it
    const turin = await region(italyAdmin.token, { name: 'Turin', kind: 'city', parentKey: 'italy', thereMonths: 12 });
    assert.equal(turin.status, 201, JSON.stringify(turin.body));
    assert.equal((await region(italyAdmin.token, { name: 'Lyon', kind: 'city', parentKey: 'global' })).body.code, 'OUT_OF_SCOPE');
    assert.equal((await region(italyAdmin.token, { name: 'France', kind: 'country' })).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.get('/v1/regions/limits?city=Turin', milanHost.token)).body.there.months, 12);
    assert.equal((await h.call('DELETE', '/v1/admin/regions/turin', italyAdmin.token)).status, 200);
    assert.equal((await h.call('DELETE', '/v1/admin/regions/italy', italyAdmin.token)).body.code, 'OUT_OF_SCOPE');
    // a place with staff cannot be removed from under them
    assert.equal((await h.call('DELETE', '/v1/admin/regions/rome', admin)).status, 200);
    assert.equal((await region(admin, { name: 'Rome', kind: 'city', parentKey: 'italy' })).status, 201);
    await h.prisma.user.update({ where: { id: milanAdmin.id }, data: { adminRegionKey: 'rome' } });
    assert.equal((await h.call('DELETE', '/v1/admin/regions/rome', admin)).body.code, 'PLACE_HAS_STAFF');
    await h.prisma.user.update({ where: { id: milanAdmin.id }, data: { adminRegionKey: 'milan' } });
  });

  it('shuts out an account whose area no longer exists instead of opening everything', async () => {
    const orphan = await staff('ScOrphan', 'admin', 'milan');
    await h.prisma.user.update({ where: { id: orphan.id }, data: { adminRegionKey: 'removed-place' } });
    assert.deepEqual(((await h.get('/v1/admin/activities', orphan.token)).body.items), []);
    assert.deepEqual(((await h.get('/v1/admin/users', orphan.token)).body.items), []);
    assert.equal((await h.post(`/v1/admin/users/${milanHost.id}/suspend`, orphan.token, { reason: 'should not work', days: 1 })).body.code, 'OUT_OF_SCOPE');
    assert.equal((await h.get('/v1/admin/audit', orphan.token)).body.code, 'GLOBAL_STAFF_ONLY');
  });
});

describe('choosing where to work after signing in (the X-Admin-Place header)', () => {
  const asPlace = (token: string, path: string, place?: string) => fetch(h.base + path, { headers: { authorization: `Bearer ${token}`, ...(place ? { 'x-admin-place': place } : {}) } }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
  const ids = async (token: string, path: string, place?: string) => ((await asPlace(token, path, place)).body.items as { id: string }[]).map((i) => i.id);
  let milanPerson: Person;
  let romePerson: Person;
  let milanPlan = '';
  let romePlan = '';
  let wholeAdmin: Person;
  let italyAdmin: Person;
  let milanAdmin: Person;

  it('narrows every list to the chosen place, for staff of the whole service', async () => {
    // a second country, so there is a place outside Italy to choose
    assert.equal((await region(admin, { name: 'France', kind: 'country' })).status, 201);
    assert.equal((await region(admin, { name: 'Paris', kind: 'city', parentKey: 'france' })).status, 201);
    milanPerson = await h.verified('PlMilan');
    romePerson = await h.verified('PlRome');
    await h.prisma.profile.update({ where: { userId: romePerson.id }, data: { homeCity: 'Rome', homeCityKey: 'rome' } });
    milanPlan = (await h.post('/v1/activities', milanPerson.token, act('Milan', 2))).body.id;
    romePlan = (await h.post('/v1/activities', romePerson.token, act('Rome', 2))).body.id;
    assert.ok(milanPlan && romePlan);
    const romeTrip = (await h.post('/v1/trips', romePerson.token, trip('Rome', 30))).body.id;
    const milanTrip = (await h.post('/v1/trips', milanPerson.token, trip('Milan', 30))).body.id;
    for (const [u, ref] of [[milanPerson, 'pl-m'], [romePerson, 'pl-r']] as const) await h.prisma.verificationCheck.create({ data: { userId: u.id, providerRef: ref, eligibility: 'pending', provider: 'manual' } });

    const acts = (place?: string) => ids(admin, '/v1/admin/activities', place);
    assert.ok((await acts()).includes(romePlan) && (await acts()).includes(milanPlan), 'no place chosen: everything');
    assert.ok((await acts('all')).includes(romePlan), '"all" is the same as nothing chosen');
    assert.deepEqual([(await acts('milan')).includes(milanPlan), (await acts('milan')).includes(romePlan)], [true, false]);
    assert.deepEqual([(await acts('rome')).includes(milanPlan), (await acts('rome')).includes(romePlan)], [false, true]);
    assert.ok((await acts('italy')).includes(romePlan) && (await acts('italy')).includes(milanPlan), 'a country covers its cities');
    assert.ok(!(await acts('france')).includes(milanPlan), 'another country: nothing of Italy');
    assert.ok(!(await acts('lombardy')).includes(romePlan), 'a region covers only its own cities');

    const trips = (place?: string) => ids(admin, '/v1/admin/trips', place);
    assert.deepEqual([(await trips('milan')).includes(milanTrip), (await trips('milan')).includes(romeTrip)], [true, false]);
    const users = (place?: string) => ids(admin, '/v1/admin/users', place);
    assert.deepEqual([(await users('milan')).includes(milanPerson.id), (await users('milan')).includes(romePerson.id)], [true, false]);
    assert.ok((await users('italy')).includes(romePerson.id));
    const pending = async (place?: string) => ((await asPlace(admin, '/v1/admin/verifications?status=pending', place)).body.items as { providerRef: string }[]).map((c) => c.providerRef);
    assert.deepEqual([(await pending('milan')).includes('pl-m'), (await pending('milan')).includes('pl-r')], [true, false]);
    assert.ok((await pending()).includes('pl-r'));

    // reports follow what they are about
    const reporter = await h.verified('PlReporter');
    const aboutRome = (await h.post('/v1/reports', reporter.token, { targetType: 'activity', targetId: romePlan, category: 'spam' })).body.id;
    const aboutMilan = (await h.post('/v1/reports', reporter.token, { targetType: 'activity', targetId: milanPlan, category: 'spam' })).body.id;
    const queue = (place?: string) => ids(admin, '/v1/admin/reports?status=open', place);
    assert.deepEqual([(await queue('rome')).includes(aboutRome), (await queue('rome')).includes(aboutMilan)], [true, false]);
    assert.deepEqual([(await queue('milan')).includes(aboutRome), (await queue('milan')).includes(aboutMilan)], [false, true]);

    // a place that does not exist is an error, not "everything"
    const bad = await asPlace(admin, '/v1/admin/activities', 'atlantis');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'INVALID_PLACE');
  });

  it('lets an area admin choose their area or a place inside it, never one outside, and never more than their area', async () => {
    wholeAdmin = await staff('PlWhole', 'admin', null);
    italyAdmin = await staff('PlItaly', 'admin', 'italy');
    milanAdmin = await staff('PlMilanAdmin', 'admin', 'milan');
    const acts = (t: Person, place?: string) => ids(t.token, '/v1/admin/activities', place);
    // Italy: no choice = all of Italy; Milan or Rome = just that city
    const both = await acts(italyAdmin);
    assert.ok(both.includes(milanPlan) && both.includes(romePlan));
    assert.deepEqual([(await acts(italyAdmin, 'milan')).includes(milanPlan), (await acts(italyAdmin, 'milan')).includes(romePlan)], [true, false]);
    assert.deepEqual([(await acts(italyAdmin, 'rome')).includes(milanPlan), (await acts(italyAdmin, 'rome')).includes(romePlan)], [false, true]);
    assert.deepEqual([(await acts(italyAdmin, 'italy')).includes(milanPlan), (await acts(italyAdmin, 'all')).includes(romePlan)], [true, true]);
    // outside the area: refused, whatever the header says
    for (const place of ['france', 'global', 'paris']) {
      const r = await asPlace(italyAdmin.token, '/v1/admin/activities', place);
      assert.equal(r.status, 403, place);
      assert.equal(r.body.code, 'OUT_OF_SCOPE', place);
    }
    // a city admin: their city only; another city is refused; "all" means their own city, not everything
    assert.equal((await asPlace(milanAdmin.token, '/v1/admin/activities', 'rome')).body.code, 'OUT_OF_SCOPE');
    assert.ok(!(await acts(milanAdmin, 'all')).includes(romePlan), 'all = the whole of their own area');
    assert.ok((await acts(milanAdmin, 'milan')).includes(milanPlan));
    // the header cannot be used to reach a page that is not for an area
    assert.equal((await asPlace(milanAdmin.token, '/v1/admin/audit', 'milan')).body.code, 'GLOBAL_STAFF_ONLY');
    assert.equal((await asPlace(wholeAdmin.token, '/v1/admin/audit', 'milan')).status, 200, 'staff of the whole service still reach it');
  });
});
