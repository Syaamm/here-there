import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { ALERT_GROUPS, groupOf, inQuietHours, minuteOfDayIn } from '../src/notifications/preference-rules';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
let adminToken = '';
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600'; // a slow machine can take longer than the usual 15 minutes
  h = await startHarness('notif' + (process.env.TEST_DB_TAG ?? ''), { queueWrites: true });
  adminToken = (await h.post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token;
});
after(async () => {
  await h?.stop();
});

type Person = { token: string; id: string };
const put = (u: Person, body: unknown) => h.call('PUT', '/v1/me/notification-settings', u.token, body);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Pushes are sent by the job worker a moment after the request: wait until none are waiting (however slow the machine is). */
async function drain() {
  await pause(250); // let the request's own job reach the queue
  for (let i = 0; i < 1200; i++) {
    if ((await h.prisma.job.count({ where: { type: 'push.send', state: 'queued' } })) === 0) break;
    await pause(100);
  }
  await pause(150);
}
const alerts = async (u: Person, type: string) => (await h.get('/v1/notifications', u.token)).body.items.filter((n: { type: string }) => n.type === type);
const hhmm = (minute: number) => {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Pushes that go out while `fn` runs (Expo's push service is stubbed, so nothing leaves the machine). */
async function pushesDuring(fn: () => Promise<unknown>) {
  await drain(); // what an earlier step queued must be over before this one is measured
  const sent: { to: string; title: string; body: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url).startsWith('https://exp.host/')) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 });
    }
    return real(url, init);
  }) as typeof fetch;
  try {
    await fn();
    await drain();
  } finally {
    globalThis.fetch = real;
  }
  return sent;
}

/** A host, a member who is in the plan and has a phone to push to, and the plan's chat. */
let counter = 0;
async function scene() {
  const host = await h.verified('NfHost');
  const member = await h.verified('NfMember');
  const id = (await h.post('/v1/activities', host.token, h.activityBody({ capacity: 4, title: `Nf plan ${++counter}` }))).body.id as string;
  const asked = await h.post(`/v1/activities/${id}/requests`, member.token, {});
  await h.post(`/v1/activities/${id}/requests/${asked.body.id}/decision`, host.token, { decision: 'approve' });
  const conv = (await h.get(`/v1/activities/${id}`, host.token)).body.conversationId as string;
  const token = `ExponentPushToken[member${counter}abcdefgh]`;
  assert.equal((await h.post('/v1/push/subscribe', member.token, { kind: 'expo', token })).status, 201);
  const hostToken = `ExponentPushToken[host${counter}abcdefghij]`;
  assert.equal((await h.post('/v1/push/subscribe', host.token, { kind: 'expo', token: hostToken })).status, 201);
  const say = (body: string) => h.post(`/v1/conversations/${conv}/messages`, host.token, { body });
  return { host, member, id, conv, say, token, hostToken };
}

describe('alert groups and quiet hours: the rules', () => {
  it('puts every alert type in one group or leaves it important, and safety alerts are never switchable', () => {
    assert.equal(groupOf('chat_message'), 'messages');
    assert.equal(groupOf('join_request'), 'requests');
    assert.equal(groupOf('request_approved'), 'requests');
    assert.equal(groupOf('starting_soon'), 'reminders');
    assert.equal(groupOf('activity_changed'), 'reminders');
    assert.equal(groupOf('activity_changed', { saved: true }), 'saved', 'the same alert, sent to someone who only saved the plan');
    assert.equal(groupOf('spot_opened'), 'saved');
    assert.equal(groupOf('follow'), 'people');
    for (const important of ['warning', 'message_removed', 'report_urgent', 'report_escalated', 'verification_result', 'appeal_decided', 'attendance_marked', 'activity_cancelled', 'removed', 'host_absence_reported', 'something_new_nobody_listed']) {
      assert.equal(groupOf(important), null, `${important} must always reach the person`);
    }
    // no type is in two groups
    const all = Object.values(ALERT_GROUPS).flatMap((g) => [...g.types]);
    assert.equal(new Set(all).size, all.length);
  });

  it('works out quiet hours, including a window that runs past midnight, and ignores an empty one', () => {
    const at = (h: number, m = 0) => h * 60 + m;
    assert.equal(inQuietHours(at(23), at(22), at(8)), true);
    assert.equal(inQuietHours(at(3), at(22), at(8)), true);
    assert.equal(inQuietHours(at(8), at(22), at(8)), false, 'the end is the first minute of the day');
    assert.equal(inQuietHours(at(12), at(22), at(8)), false);
    assert.equal(inQuietHours(at(13), at(12, 30), at(14)), true, 'a window inside one day');
    assert.equal(inQuietHours(at(15), at(12, 30), at(14)), false);
    assert.equal(inQuietHours(at(23), null, null), false);
    assert.equal(inQuietHours(at(23), at(8), at(8)), false);
    // the same moment is a different time of day in a different time zone
    const noonUtc = new Date('2026-01-15T12:00:00Z');
    assert.equal(minuteOfDayIn('UTC', noonUtc), 12 * 60);
    assert.equal(minuteOfDayIn('Europe/Rome', noonUtc), 13 * 60);
    assert.equal(minuteOfDayIn('Asia/Tokyo', noonUtc), 21 * 60);
  });
});

describe('notification settings: the person decides what pushes', () => {
  // these tests are about settings, not about grouping: every message may push (the grouping tests below keep the one-a-minute rule)
  beforeEach(() => {
    process.env.PUSH_GROUP_SECONDS = '0';
  });
  afterEach(() => {
    delete process.env.PUSH_GROUP_SECONDS;
  });

  it('starts with everything on and no quiet hours, and checks what is saved', async () => {
    const u = await h.verified('NfDefaults');
    const s = (await h.get('/v1/me/notification-settings', u.token)).body;
    assert.deepEqual(s.groups.map((g: { key: string; push: boolean }) => [g.key, g.push]), Object.keys(ALERT_GROUPS).map((k) => [k, true]));
    assert.equal(s.quietHours.enabled, false);
    assert.match(s.important.text, /always reach you/);
    assert.equal((await h.get('/v1/me/notification-settings')).status, 401);

    assert.equal((await put(u, { quietHours: { enabled: true, start: '25:00' } })).status, 400, 'not a time');
    assert.equal((await put(u, { quietHours: { enabled: true, start: '22:00', end: '22:00' } })).body.code, 'INVALID_QUIET_HOURS');
    assert.equal((await put(u, { quietHours: { enabled: true, timezone: 'Mars/Olympus' } })).body.code, 'INVALID_TIMEZONE');
    assert.equal((await put(u, { groups: { everything: false } })).status, 400, 'there is no such group');
    assert.equal((await put(u, { groups: { messages: false } })).status, 200);
    // what is left out stays as it was
    const after = (await put(u, { quietHours: { enabled: true, start: '23:00', end: '07:30', timezone: 'Europe/London' } })).body;
    assert.equal(after.groups.find((g: { key: string }) => g.key === 'messages').push, false);
    assert.deepEqual(after.quietHours, { enabled: true, start: '23:00', end: '07:30', timezone: 'Europe/London' });
    const off = (await put(u, { quietHours: { enabled: false } })).body;
    assert.equal(off.quietHours.enabled, false);
    assert.equal(off.groups.find((g: { key: string }) => g.key === 'messages').push, false, 'switching quiet hours off leaves the groups alone');
  });

  it('stops pushes for a switched-off group but keeps the alert in the list, and lets safety alerts through anyway', async () => {
    const { host, member, say, id } = await scene();
    // on: a message pushes
    const first = await pushesDuring(() => say('hello one'));
    assert.equal(first.length, 1);
    assert.ok(first[0].body.includes('hello one'));

    // chat messages off: no push, but the alert is still in the list
    assert.equal((await put(member, { groups: { messages: false } })).status, 200);
    await h.prisma.notification.updateMany({ where: { userId: member.id, type: 'chat_message' }, data: { readAt: new Date() } }); // as if they had opened the chat
    const muted = await pushesDuring(() => say('hello two'));
    assert.equal(muted.length, 0, 'switched off');
    assert.equal((await alerts(member, 'chat_message')).filter((n: { readAt: unknown }) => !n.readAt).length, 1, 'the alert is still in their list');

    // a warning is a safety alert: it pushes whatever the person switched off, and in quiet hours too
    const now = minuteOfDayIn('Europe/Rome');
    for (const g of Object.keys(ALERT_GROUPS)) await put(member, { groups: { [g]: false } });
    await put(member, { quietHours: { enabled: true, start: hhmm(now - 60), end: hhmm(now + 60), timezone: 'Europe/Rome' } });
    const warned = await pushesDuring(() => h.post(`/v1/admin/users/${member.id}/warn`, adminToken, { reason: 'Please keep chat friendly' }));
    assert.equal(warned.length, 1, 'safety and account alerts always reach the person');
    assert.match(warned[0].title, /warning/i);

    // back on: pushes again
    for (const g of Object.keys(ALERT_GROUPS)) await put(member, { groups: { [g]: true } });
    await put(member, { quietHours: { enabled: false } });
    await h.prisma.notification.updateMany({ where: { userId: member.id, type: 'chat_message' }, data: { readAt: new Date() } });
    const back = await pushesDuring(() => say('hello three'));
    assert.equal(back.length, 1);
    void host;
  });

  it('keeps pushes quiet inside quiet hours (in the person\'s own time zone) and sends them outside', async () => {
    const { member, say } = await scene();
    const rome = minuteOfDayIn('Europe/Rome');
    await put(member, { quietHours: { enabled: true, start: hhmm(rome - 30), end: hhmm(rome + 30), timezone: 'Europe/Rome' } });
    assert.equal((await pushesDuring(() => say('quiet one'))).length, 0, 'inside quiet hours');
    assert.equal((await alerts(member, 'chat_message')).length, 1, 'the alert is in the list for when they look');

    // the same wall-clock window means something else in Tokyo: now it is outside it
    const tokyo = minuteOfDayIn('Asia/Tokyo');
    await put(member, { quietHours: { enabled: true, start: hhmm(tokyo + 120), end: hhmm(tokyo + 180), timezone: 'Asia/Tokyo' } });
    await h.prisma.notification.updateMany({ where: { userId: member.id }, data: { readAt: new Date() } });
    assert.equal((await pushesDuring(() => say('quiet two'))).length, 1, 'outside quiet hours');

    // a window running past midnight
    await put(member, { quietHours: { enabled: true, start: hhmm(rome - 5), end: hhmm(rome - 10), timezone: 'Europe/Rome' } });
    await h.prisma.notification.updateMany({ where: { userId: member.id }, data: { readAt: new Date() } });
    assert.equal((await pushesDuring(() => say('quiet three'))).length, 0, 'a window that wraps all the way round covers now');
  });

  it('silences the other groups too: requests and answers', async () => {
    const { host, id } = await scene();
    const later = await h.verified('NfAsker');
    await put(host, { groups: { requests: false } });
    const none = await pushesDuring(() => h.post(`/v1/activities/${id}/requests`, later.token, { intro: 'Room for one more?' }));
    assert.equal(none.length, 0);
    assert.equal((await alerts(host, 'join_request')).length, 1, 'but the request is waiting in their alerts');
  });
});

describe('repeat alerts are grouped', () => {
  it('turns many messages in one chat into one alert with a count, moved to the top, and one push a minute', async () => {
    const { member, say, conv } = await scene();
    const sent = await pushesDuring(async () => {
      await say('one');
      await say('two');
      await say('three');
    });
    assert.equal(sent.length, 1, 'only the first message pushes inside the grouping window');
    assert.ok(sent[0].body.includes('one'));

    const list = await alerts(member, 'chat_message');
    assert.equal(list.length, 1, 'one alert, not three');
    assert.equal(list[0].data.count, 3);
    assert.match(list[0].title, /^3 new messages in /);
    assert.ok(list[0].body.includes('three'), 'it shows the newest message');
    assert.equal((await h.get('/v1/notifications?unread=true', member.token)).body.unreadCount >= 1, true);

    // reading the chat clears it; the next message starts a new alert
    await h.get(`/v1/conversations/${conv}/messages?read=1`, member.token);
    assert.equal((await alerts(member, 'chat_message')).filter((n: { readAt: unknown }) => !n.readAt).length, 0);
    await say('four');
    const fresh = (await alerts(member, 'chat_message')).filter((n: { readAt: unknown }) => !n.readAt);
    assert.equal(fresh.length, 1);
    assert.match(fresh[0].title, /^New message in /);
    assert.equal(fresh[0].data.count ?? 1, 1);
  });

  it('groups a plan that is changed again and again into one alert for the people who saved it', async () => {
    const host = await h.verified('NfGroupHost');
    const saver = await h.verified('NfSaver');
    const id = (await h.post('/v1/activities', host.token, h.activityBody({ capacity: 4, title: 'Edited plan' }))).body.id as string;
    assert.equal((await h.post(`/v1/activities/${id}/favorite`, saver.token)).status, 201);
    for (const venue of ['Bar One', 'Bar Two', 'Bar Three']) {
      const changed = await h.call('PATCH', `/v1/activities/${id}`, host.token, { venueName: venue });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
    }
    const list = await alerts(saver, 'activity_changed');
    assert.equal(list.length, 1, 'three edits, one alert');
    assert.equal(list[0].data.count, 3);
    assert.equal(list[0].data.saved, true);
    assert.match(list[0].title, /3 changes/);
  });
});
