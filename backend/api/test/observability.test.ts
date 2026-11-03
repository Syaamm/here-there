import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
let adminToken = '';
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600'; // a slow machine can take longer than the usual 15 minutes
  h = await startHarness('observe' + (process.env.TEST_DB_TAG ?? ''), { queueWrites: true });
  adminToken = (await h.post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token;
});
after(async () => {
  await h?.stop();
});

const raw = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: unknown) =>
  fetch(h.base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('request ids and structured logs', () => {
  it('gives every answer an id, keeps a sensible one the caller sent, and replaces a junk one', async () => {
    const a = await raw('/v1/reliability/info');
    const idA = a.headers.get('x-request-id')!;
    assert.match(idA, /^[0-9a-f-]{36}$/, 'a fresh id when none is sent');
    assert.notEqual((await raw('/v1/reliability/info')).headers.get('x-request-id'), idA, 'a different one each time');
    assert.equal((await raw('/v1/reliability/info', { 'x-request-id': 'edge-7f3a9c21-trace' })).headers.get('x-request-id'), 'edge-7f3a9c21-trace', 'kept, so a log line can be matched with the proxy\'s');
    for (const junk of ['short', 'has spaces in it ok?', 'x'.repeat(200), '<script>alert(1)</script>']) {
      const got = (await raw('/v1/reliability/info', { 'x-request-id': junk })).headers.get('x-request-id')!;
      assert.notEqual(got, junk);
      assert.match(got, /^[0-9a-f-]{36}$/);
    }
    // it is also on errors, and a missing page is still an answer with an id
    const missing = await raw('/v1/not-a-page');
    assert.equal(missing.status, 404);
    assert.ok(missing.headers.get('x-request-id'));
  });

  it('writes one structured line per request: the route as written, the status and the time, with nothing personal in it', async () => {
    const { setLogSink } = await import('../src/common/observability');
    const lines: Record<string, any>[] = [];
    setLogSink((l) => lines.push(l));
    try {
      const me = await h.verified('LogPerson');
      lines.length = 0;
      const secretTitle = 'My very private plan title';
      const made = await raw('/v1/activities?secret=querystring-value', { authorization: `Bearer ${me.token}`, 'x-request-id': 'trace-log-0001' }, 'POST', h.activityBody({ title: secretTitle }));
      assert.equal(made.status, 201);
      const id = (await made.json()).id as string;
      await raw(`/v1/activities/${id}`, { authorization: `Bearer ${me.token}` });
      await raw('/v1/me/reliability', { authorization: 'Bearer not-a-real-token' });

      const requests = lines.filter((l) => l.msg === 'request');
      assert.equal(requests.length, 3, 'one line each');
      const create = requests.find((l) => l.reqId === 'trace-log-0001')!;
      assert.deepEqual([create.method, create.route, create.status], ['POST', '/v1/activities', 201]);
      assert.ok(['info', 'warn'].includes(create.level), 'warn only when the request was slow (a busy machine)');
      assert.equal(typeof create.ms, 'number');
      assert.match(create.t, /^\d{4}-\d\d-\d\dT/);
      assert.equal(create.userId, me.id, 'the person is identified by id');
      // the route is the pattern, not the address: no plan id, no query string
      const one = requests.find((l) => l.method === 'GET' && String(l.route).startsWith('/v1/activities'))!;
      assert.equal(one.route, '/v1/activities/:id');
      const bad = requests.find((l) => l.status === 401)!;
      assert.equal(bad.level, 'warn');
      assert.equal(bad.userId, undefined);
      // what a person wrote, the address, the token and the email are nowhere in the log
      const everything = JSON.stringify(lines);
      for (const secret of [secretTitle, 'querystring-value', id, me.token, me.email, 'Bar Brera']) assert.ok(!everything.includes(secret), `the log must not contain ${secret}`);
    } finally {
      setLogSink(null);
    }
  });

  it('turns a crash into a log line and an error report that carry the same request id, and tells the person only the id', async () => {
    const { ApiExceptionFilter } = await import('../src/common/exception.filter');
    const { withRequestId, setLogSink } = await import('../src/common/observability');
    const { setErrorReporter } = await import('../src/common/error-tracking');
    const lines: Record<string, any>[] = [];
    const reports: { err: unknown; ctx: Record<string, any> }[] = [];
    setLogSink((l) => lines.push(l));
    setErrorReporter((err, ctx) => reports.push({ err, ctx }));
    try {
      const sent: { status?: number; body?: any } = {};
      const res = { headersSent: false, status: (s: number) => ((sent.status = s), res), json: (b: unknown) => ((sent.body = b), res) };
      withRequestId('trace-crash-0001', () => new ApiExceptionFilter().catch(new Error('SELECT secret FROM users failed at /srv/db.ts'), { switchToHttp: () => ({ getResponse: () => res }) } as never));
      assert.equal(sent.status, 500);
      assert.equal(sent.body.requestId, 'trace-crash-0001');
      assert.ok(!JSON.stringify(sent.body).includes('secret'), 'nothing internal reaches the person');
      const line = lines.find((l) => l.msg === 'unhandled error')!;
      assert.equal(line.level, 'error');
      assert.equal(line.reqId, 'trace-crash-0001');
      assert.match(line.error, /SELECT secret/, 'the full detail is in the log');
      assert.equal(reports.length, 1);
      assert.equal(reports[0].ctx.requestId, 'trace-crash-0001', 'and in the error report, with the id to find the log lines');
      assert.match((reports[0].err as Error).message, /SELECT secret/);

      // a mistake by the caller (a 4xx) is not a crash: no report
      reports.length = 0;
      const { ApiError } = await import('../src/common/errors');
      new ApiExceptionFilter().catch(new ApiError(409, 'ACTIVITY_FULL', 'full'), { switchToHttp: () => ({ getResponse: () => res }) } as never);
      assert.equal(reports.length, 0);
    } finally {
      setLogSink(null);
      setErrorReporter(null);
    }
  });

  it('keeps error tracking off until it is set up, and never throws when the tracker itself fails', async () => {
    const { initErrorTracking, captureError, setErrorReporter } = await import('../src/common/error-tracking');
    assert.equal(initErrorTracking(), false, 'no SENTRY_DSN: nothing is sent anywhere');
    setErrorReporter(() => {
      throw new Error('tracker is down');
    });
    try {
      assert.doesNotThrow(() => captureError(new Error('boom')));
    } finally {
      setErrorReporter(null);
    }
  });
});

describe('slow queries', () => {
  it('logs a database call that takes too long with its table and action, never the filter or the values, and counts it', async () => {
    const { setLogSink, metrics } = await import('../src/common/observability');
    const lines: Record<string, any>[] = [];
    metrics.reset();
    setLogSink((l) => lines.push(l));
    process.env.SLOW_QUERY_MS = '0'; // everything counts as slow for this test
    try {
      const email = 'needle-person@example.com';
      await h.post('/v1/auth/login', undefined, { email, password: 'whatever-it-is-1' });
      const slow = lines.filter((l) => l.msg === 'slow query');
      assert.ok(slow.length > 0, 'queries were logged');
      assert.ok(slow.some((l) => l.what === 'User.findUnique'), 'the table and the action are shown');
      assert.ok(slow.every((l) => typeof l.ms === 'number' && typeof l.what === 'string' && l.what.length <= 120));
      assert.ok(!JSON.stringify(lines).includes(email), 'the value that was looked up is not in the log');
      assert.ok(slow.some((l) => l.reqId), 'tied to the request that caused it');
      assert.ok(metrics.snapshot().totals.slowQueries >= slow.length);
      assert.ok(metrics.snapshot().slowQueries.length > 0);
    } finally {
      process.env.SLOW_QUERY_MS = '60000'; // far above anything a query takes, however busy the machine is
      setLogSink(null);
    }
    // under the limit a query is not logged
    lines.length = 0;
    setLogSink((l) => lines.push(l));
    try {
      await h.get('/v1/reliability/info');
      assert.equal(lines.filter((l) => l.msg === 'slow query').length, 0);
    } finally {
      setLogSink(null);
    }
  });
});

describe('the health numbers in the admin console', () => {
  it('counts sign-ups, joins and messages per minute, and the error rate', async () => {
    const { metrics } = await import('../src/common/observability');
    metrics.reset();
    const host = await h.verified('HealthHost'); // one sign-up
    const guest = await h.verified('HealthGuest'); // two
    const id = (await h.post('/v1/activities', host.token, h.activityBody({ capacity: 3, joinPolicy: 'instant' }))).body.id as string;
    assert.equal((await h.post(`/v1/activities/${id}/requests`, guest.token, {})).body.state, 'approved'); // one join
    const conv = (await h.get(`/v1/activities/${id}`, host.token)).body.conversationId as string;
    for (const body of ['one', 'two', 'three']) assert.equal((await h.post(`/v1/conversations/${conv}/messages`, host.token, { body })).status, 201);

    const health = await h.get('/v1/admin/health', adminToken);
    assert.equal(health.status, 200, JSON.stringify(health.body));
    assert.equal(health.body.series.length, 60);
    assert.equal(health.body.totals.signups, 2);
    assert.equal(health.body.totals.joins, 1);
    assert.equal(health.body.totals.messages, 3);
    assert.ok(health.body.totals.requests > 10);
    assert.equal(health.body.status, 'ok');
    assert.ok(health.body.database.pingMs >= 0);
    assert.equal(health.body.errorTracking.configured, false);
    assert.equal(health.body.series.reduce((a: number, m: { signups: number }) => a + m.signups, 0), 2, 'the minutes add up');
    assert.equal(health.body.series.reduce((a: number, m: { messages: number }) => a + m.messages, 0), 3);
    assert.equal((await h.get('/v1/admin/health?minutes=10', adminToken)).body.series.length, 10);
    assert.equal((await h.get('/v1/admin/health', host.token)).status, 403, 'staff only');
    assert.equal((await h.get('/v1/admin/health')).status, 401);
  });

  it('calls the service degraded when 5% or more of the last five minutes\' requests fail on our side, and recovers', async () => {
    const { metrics } = await import('../src/common/observability');
    metrics.reset();
    for (let i = 0; i < 95; i++) metrics.request(200, 20);
    for (let i = 0; i < 4; i++) metrics.request(500, 20);
    for (let i = 0; i < 10; i++) metrics.request(404, 5); // the caller's mistakes are not the service's errors
    assert.equal(metrics.snapshot().status, 'ok', '4 in 109 is under 5%');
    for (let i = 0; i < 4; i++) metrics.request(503, 20);
    const bad = metrics.snapshot();
    assert.equal(bad.status, 'degraded', '8 in 113 is over 5%');
    assert.equal(bad.errorRate5m, Math.round((8 / 113) * 10000) / 10000);
    assert.equal(bad.totals.errors, 8);
    assert.equal(bad.series.reduce((a, m) => a + m.clientErrors, 0), 10);
    // too few requests to judge: never an alarm
    metrics.reset();
    metrics.request(500, 20);
    assert.equal(metrics.snapshot().status, 'ok');
    // the 95th percentile of the minute
    metrics.reset();
    for (let i = 1; i <= 100; i++) metrics.request(200, i);
    assert.equal(metrics.snapshot().lastMinute.p95Ms, 95);
  });

  it('forgets minutes older than the window and shows quiet minutes as zeros', async () => {
    const { Metrics } = await import('../src/common/observability');
    const m = new Metrics();
    const t0 = Date.parse('2026-10-30T10:00:30Z');
    const realNow = Date.now;
    Date.now = () => t0;
    m.count('signups');
    m.request(200, 10);
    Date.now = () => t0 + 3 * 60_000;
    m.count('signups', 2);
    Date.now = realNow;
    const s = m.snapshot(5, t0 + 3 * 60_000);
    assert.deepEqual(s.series.map((x) => x.signups), [0, 1, 0, 0, 2]);
    assert.equal(s.series[1].requests, 1);
    assert.equal(s.series[0].p95Ms, null, 'a minute with no requests has no latency');
    delete process.env.SLOW_QUERY_MS;
  });
});
