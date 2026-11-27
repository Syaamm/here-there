import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { addMonths, chainOf, effectiveMonths, latestStart, monthsWord, type RegionRow } from '../src/regions/regions';
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
const staff = async (name: string, role: string): Promise<Person> => {
  const u = await h.verified(name);
  const r = await h.post(`/v1/admin/users/${u.id}/role`, admin, { role });
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

  it('a loop in the data cannot hang the lookup', () => {
    const loop: RegionRow[] = [{ ...at('it'), parentKey: 'it-lom' }, { ...at('it-lom'), parentKey: 'it' }];
    assert.ok(chainOf(loop, loop[0]).length <= 2);
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
    assert.equal((await h.post('/v1/activities', host.token, act('Rome', 110))).status, 201); // not day 100: this host is on the Milan trip then (one plan at a time)
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
    assert.deepEqual(list.defaults, { here: 1, there: 6, area: 25 });
    const milan = list.items.find((i: { key: string }) => i.key === 'milan');
    assert.deepEqual([milan.effective.here, milan.effective.hereFrom, milan.hereMonths], [2, 'Italy', null]);
    assert.equal(list.items.find((i: { key: string }) => i.key === 'global').canEdit, true);
    // only administrators change places; staff can look at the places of their area
    const mod = await staff('RegionMod', 'staff');
    assert.equal((await h.get('/v1/admin/regions', mod.token)).status, 200);
    assert.equal((await patchRegion(mod.token, 'italy', { hereMonths: 3 })).status, 403);
    assert.equal((await patchRegion(mod.token, 'milan', { hereMonths: 3 })).status, 403, 'not even their own city');
    // the cities people use that no place covers yet
    const unassigned = (await h.get('/v1/admin/regions/unassigned', admin)).body.items;
    assert.ok(unassigned.some((u: { cityKey: string }) => u.cityKey === 'anywhere'));
    assert.ok(!unassigned.some((u: { cityKey: string }) => u.cityKey === 'milan'), 'Milan is covered');
  });
});

describe('staff permissions and people who travel', () => {
  it('lets an admin change what a staff member may do, and records it in the audit log', async () => {
    const s = await h.staff('PermStaff');
    assert.equal((await h.get('/v1/admin/reports', s.token)).status, 200);
    const changed = await h.call('PATCH', `/v1/admin/staff/${s.id}`, admin, { permissions: ['users', 'content'] });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.deepEqual(changed.body.permissions, ['users', 'content']);
    const blocked = await h.get('/v1/admin/reports', s.token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'NO_PERMISSION', 'no reports permission: no reports');
    assert.equal((await h.get('/v1/admin/verifications', s.token)).body.code, 'NO_PERMISSION');
    assert.equal((await h.get('/v1/admin/users', s.token)).status, 200, 'what they still have keeps working');
    const entry = await h.prisma.auditEvent.findFirst({ where: { action: 'staff.update', objectId: s.id } });
    assert.ok(entry, 'the change is in the audit log');
    assert.deepEqual(JSON.parse(entry.metadata).before.permissions, ['reports', 'verification', 'users', 'content']);
    // only an admin changes it, and only for staff
    assert.equal((await h.call('PATCH', `/v1/admin/staff/${s.id}`, s.token, { permissions: ['reports'] })).status, 403);
    const plain = await h.verified('PermPlain');
    assert.equal((await h.call('PATCH', `/v1/admin/staff/${plain.id}`, admin, { permissions: ['reports'] })).body.code, 'INVALID_TARGET');
    assert.equal((await h.call('PATCH', `/v1/admin/staff/${s.id}`, admin, { permissions: ['everything'] })).status, 400);
  });

  it('lets a staff account work with no area at all, and needs none to make one', async () => {
    const plain = await h.verified('NoAreaPlain');
    // making someone staff takes only the role (and, if wanted, what they may use): no area, no 'AREA_REQUIRED'
    const made = await h.post(`/v1/admin/users/${plain.id}/role`, admin, { role: 'staff' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(made.body, { role: 'staff', permissions: ['reports', 'verification', 'users', 'content'] });
    for (const path of ['/v1/admin/reports', '/v1/admin/users', '/v1/admin/verifications', '/v1/admin/activities', '/v1/admin/trips', '/v1/admin/scope']) {
      const r = await h.get(path, plain.token);
      assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
    }
    assert.deepEqual((await h.get('/v1/admin/scope', plain.token)).body, { role: 'staff', permissions: ['reports', 'verification', 'users', 'content'] }, 'no area in what the console is told');
    // staff made on the Staff page need none either
    const created = await h.post('/v1/admin/staff', admin, { email: 'whole.staff@example.com', displayName: 'Whole Staff', password: 'a-long-password-1' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.regionKey, undefined);
  });

  it('shows staff the members, plans and trips of every city, and never lets them act on other staff', async () => {
    const s = await h.staff('AllCityStaff');
    const roman = await h.verified('AllCityRoman');
    await h.prisma.profile.update({ where: { userId: roman.id }, data: { homeCity: 'Rome', homeCityKey: 'rome' } });
    const romePlan = (await h.post('/v1/activities', roman.token, act('Rome', 3))).body.id;
    assert.ok(romePlan);
    const listed = async (path: string, id: string) => ((await h.get(path, s.token)).body.items as { id: string }[]).some((x) => x.id === id);
    assert.equal(await listed('/v1/admin/users?q=AllCityRoman', roman.id), true, 'a member of another city is listed');
    assert.equal(await listed('/v1/admin/activities', romePlan), true, 'and so is its plan');
    assert.equal((await h.get(`/v1/admin/users/${roman.id}`, s.token)).status, 200);
    assert.equal((await h.post(`/v1/admin/users/${roman.id}/warn`, s.token, { reason: 'Please be on time.' })).status, 201);
    assert.equal((await h.post(`/v1/admin/users/${roman.id}/suspend`, s.token, { reason: 'testing', days: 1 })).status, 201);
    await h.post(`/v1/admin/users/${roman.id}/restore`, admin, { reason: 'test over' });
    // staff never act on staff (or themselves)
    const other = await h.staff('AllCityOther');
    assert.equal((await h.post(`/v1/admin/users/${other.id}/suspend`, s.token, { reason: 'testing', days: 1 })).body.code, 'FORBIDDEN');
    assert.equal((await h.post(`/v1/admin/users/${other.id}/warn`, s.token, { reason: 'Not allowed to do this' })).body.code, 'FORBIDDEN');
    assert.equal((await h.post(`/v1/admin/users/${s.id}/suspend`, s.token, { reason: 'myself', days: 1 })).body.code, 'INVALID_TARGET');
  });
});
