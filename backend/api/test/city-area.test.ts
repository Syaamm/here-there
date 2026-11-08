import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

// A stand-in for the Photon place search service: answers every search with the same two places, and remembers what it was asked.
let photon: Server;
const asked: URL[] = [];
const FEATURES = [
  { geometry: { coordinates: [76.3389, 10.3071] }, properties: { osm_type: 'N', osm_id: 1, name: 'Chalakudy', county: 'Thrissur', state: 'Kerala', country: 'India' } },
  { geometry: { coordinates: [76.3388, 10.3072] }, properties: { osm_type: 'R', osm_id: 2, name: 'Chalakudy', state: 'Kerala', country: 'India' } }, // the same town twice: kept once
];

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  photon = createServer((req, res) => {
    asked.push(new URL(req.url ?? '/', 'http://x'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ features: FEATURES }));
  });
  await new Promise<void>((done) => photon.listen(0, '127.0.0.1', done));
  const addr = photon.address();
  process.env.PHOTON_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('cityarea' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
  photon?.close();
});

const MILAN = { lat: 45.4642, lng: 9.19 };
let n = 0;
/** One activity by its own host (one plan at a time per person), in the given city, at the given spot (or none). */
async function plan(city: string, spot: { lat: number; lng: number } | null) {
  const host = await h.verified(`AreaHost${++n}`);
  const body = h.activityBody({ title: `Plan ${n} in ${city}`, city, venueName: `Venue ${n}`, ...(spot ?? { lat: undefined, lng: undefined }) });
  const r = await h.post('/v1/activities', host.token, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.title as string;
}

describe('the chosen city: activities by area, places by search', () => {
  it('shows everything around the city (any spelling, nearby towns) plus city activities with no position, and nothing far away', async () => {
    const viewer = await h.verified('AreaViewer');
    const center = await plan('Milan', MILAN);
    const otherSpelling = await plan('Milano', { lat: 45.47, lng: 9.2 }); // about 1 km away
    const nearbyTown = await plan('Sesto San Giovanni', { lat: 45.53, lng: 9.23 }); // about 8 km
    const typedVenue = await plan('Milan', null); // a typed place: no position, matched by the city's name
    const farTown = await plan('Bergamo', { lat: 45.69, lng: 9.67 }); // about 45 km
    const elsewhere = await plan('Rome', null);

    for (const sort of ['time', 'relevance']) {
      const r = await h.get(`/v1/activities?city=Milan&lat=${MILAN.lat}&lng=${MILAN.lng}&radiusKm=25&area=true&sort=${sort}`, viewer.token);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const titles = (r.body.items as { title: string }[]).map((a) => a.title);
      for (const t of [center, otherSpelling, nearbyTown, typedVenue]) assert.ok(titles.includes(t), `${sort}: ${t} is in the area`);
      for (const t of [farTown, elsewhere]) assert.ok(!titles.includes(t), `${sort}: ${t} is not`);
    }

    // without area=true, "near me" still means both: the city's name and the radius
    const near = await h.get(`/v1/activities?city=Milan&lat=${MILAN.lat}&lng=${MILAN.lng}&radiusKm=25`, viewer.token);
    const nearTitles = (near.body.items as { title: string }[]).map((a) => a.title);
    assert.ok(nearTitles.includes(center));
    assert.ok(!nearTitles.includes(otherSpelling) && !nearTitles.includes(typedVenue));
  });

  it('searches cities as you type, near the chosen city first, without repeating a place', async () => {
    const me = await h.verified('Searcher');
    const r = await h.get(`/v1/places/search?q=Chalak&kind=city&lat=45.4642&lng=9.19`, me.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.items, [{ id: 'osm:n:1', name: 'Chalakudy', address: 'Thrissur, Kerala, India', lat: 10.3071, lng: 76.3389 }]);
    const q = asked[asked.length - 1];
    assert.equal(q.searchParams.get('q'), 'Chalak');
    assert.deepEqual(q.searchParams.getAll('layer'), ['city', 'district', 'locality', 'county', 'state'], 'cities and regions only');
    assert.equal(q.searchParams.get('lat'), '45.46');

    // a venue search is not limited to cities
    await h.get(`/v1/places/search?q=bar%20basso`, me.token);
    assert.deepEqual(asked[asked.length - 1].searchParams.getAll('layer'), []);

    // where an activity meets: neighbourhoods and areas, not shops
    await h.get(`/v1/places/search?q=brera&kind=area&lat=45.4642&lng=9.19`, me.token);
    assert.deepEqual(asked[asked.length - 1].searchParams.getAll('layer'), ['district', 'locality', 'city']);
  });

  it('searches any destination in the world, countries included, and names it with its country', async () => {
    const me = await h.verified('DestSearcher');
    const r = await h.get('/v1/places/search?q=Chalak&kind=destination&lat=45.46&lng=9.19', me.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.items[0].label, 'Chalakudy, India', 'the name and its country');
    const q = asked[asked.length - 1];
    assert.deepEqual(q.searchParams.getAll('layer'), ['country', 'state', 'city', 'county', 'district', 'locality'], 'from whole countries down to neighbourhoods');
    assert.equal(q.searchParams.get('lat'), null, 'no nearby-first ranking: Milan in Italy is not outranked by a Milan next door');
  });

  it('lets "Create your account" search a city without signing in, but nothing else', async () => {
    const r = await h.get(`/v1/places/search?q=Chalak&kind=city`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.items[0].name, 'Chalakudy');
    assert.equal((await h.get(`/v1/places/reverse?lat=10.3&lng=76.3`)).status, 200, 'finding the city from a position is open too');
    // neighbourhoods and venues need an account
    assert.equal((await h.get(`/v1/places/search?q=brera&kind=area`)).status, 401);
    assert.equal((await h.get(`/v1/places/search?q=bar%20basso`)).status, 401);
  });
});
