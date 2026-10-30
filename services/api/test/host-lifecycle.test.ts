import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

/**
 * The heart of the product, end to end: create -> requests -> approve -> chat -> meet -> mark no-shows -> reliability level.
 * Real requests all the way; the only shortcut is moving the plan's clock into the past (we cannot wait for the day to come),
 * which is done the same way the other tests do it, straight in the database.
 */
let h: Awaited<ReturnType<typeof startHarness>>;
let adminToken = '';
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600'; // a slow machine can take longer than the usual 15 minutes
  h = await startHarness('lifecycle' + (process.env.TEST_DB_TAG ?? ''), { queueWrites: true });
  adminToken = (await h.post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token;
});
after(async () => {
  await h?.stop();
});

const ago = (hours: number) => new Date(Date.now() - hours * 3600 * 1000);
type Person = { token: string; id: string };

/** A plan made through the API, with the given people asking to join and the host approving each. Returns the plan and its chat. */
async function runPlan(host: Person, members: Person[], title: string) {
  const created = await h.post('/v1/activities', host.token, h.activityBody({ title, capacity: members.length + 1 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  for (const m of members) {
    const asked = await h.post(`/v1/activities/${id}/requests`, m.token, { intro: 'I would love to come' });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.equal((await h.post(`/v1/activities/${id}/requests/${asked.body.id}/decision`, host.token, { decision: 'approve' })).status, 201);
  }
  const conv = (await h.get(`/v1/activities/${id}`, host.token)).body.conversationId as string;
  return { id, conv };
}

/** The plan has happened: move its times so it ended `endedHoursAgo` hours ago and lasted two hours. */
const happen = (id: string, endedHoursAgo: number) => h.prisma.activity.update({ where: { id }, data: { startsAt: ago(endedHoursAgo + 2), endsAt: ago(endedHoursAgo), status: 'completed' } });

/** What staff see behind a person's level. */
const staffView = async (u: Person) => (await h.get(`/v1/admin/users/${u.id}/reliability`, adminToken)).body;

describe('host lifecycle: create, request, approve, chat, meet, mark, reliability', () => {
  it('runs the whole journey and ends in the right reliability levels', async () => {
    const host = await h.verified('LcHost');
    const steady = await h.verified('LcSteady'); // comes to everything
    const flaky = await h.verified('LcFlaky'); // is marked absent twice, and the host is right

    // three plans, each on its own day (two kept plans a day at most count towards a level)
    const plans: { id: string; conv: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const plan = await runPlan(host, [steady, flaky], `Aperitivo ${i + 1}`);
      // chat: only approved members can talk, and each sees the others' words
      assert.equal((await h.post(`/v1/conversations/${plan.conv}/messages`, host.token, { body: `See you at ${i + 1}!` })).status, 201);
      assert.equal((await h.post(`/v1/conversations/${plan.conv}/messages`, steady.token, { body: 'On my way' })).status, 201);
      const seen = (await h.get(`/v1/conversations/${plan.conv}/messages`, flaky.token)).body.items.map((m: { body: string }) => m.body);
      assert.ok(seen.includes(`See you at ${i + 1}!`) && seen.includes('On my way'));
      const outsider = await h.verified('LcOutsider');
      assert.equal((await h.get(`/v1/conversations/${plan.conv}/messages`, outsider.token)).status, 403, 'not a member: no chat');
      // it happens (HERE plans are for today or tomorrow, so each one is over before the next is made): ended an hour ago
      await happen(plan.id, 1);
      plans.push(plan);
    }
    // the host says the flaky one did not come to the first two
    for (const plan of plans.slice(0, 2)) {
      const marked = await h.post(`/v1/activities/${plan.id}/no-shows`, host.token, { userId: flaky.id });
      assert.equal(marked.status, 201, JSON.stringify(marked.body));
      assert.equal(marked.body.state, 'marked');
    }
    // nothing counts until 48 hours after a plan ended, so nobody has a level to speak of yet
    assert.equal((await staffView(steady)).level, 'new');
    // the member is told; the note alone changes nothing yet
    assert.equal((await h.get('/v1/notifications', flaky.token)).body.items.filter((n: { type: string }) => n.type === 'attendance_marked').length, 2);
    assert.equal((await staffView(flaky)).summary.noShows, 0, 'a note is only a note until it is confirmed');

    // nobody disputes within 7 days, so the notes are confirmed: move the clock back 8 days, each plan to its own day
    for (const [i, plan] of plans.entries()) {
      const endedHoursAgo = 24 * (8 + i) + 3;
      await happen(plan.id, endedHoursAgo);
      await h.prisma.attendanceMark.updateMany({ where: { targetId: plan.id }, data: { planEndsAt: ago(endedHoursAgo), markedAt: ago(24 * 8) } });
    }

    const steadyNow = await staffView(steady);
    assert.equal(steadyNow.summary.kept, 3);
    assert.equal(steadyNow.level, 'reliable', 'three kept plans make someone Reliable');
    const flakyNow = await staffView(flaky);
    assert.equal(flakyNow.summary.noShows, 2, 'both confirmed notes count');
    assert.equal(flakyNow.summary.kept, 1, 'the one plan nobody marked still counts as kept');
    assert.equal(flakyNow.level, 'needs_care', 'repeated confirmed no-shows outweigh one kept plan');
    assert.ok(flakyNow.changes.some((c: { to: string }) => c.to === 'needs_care'), 'the change is kept in their history, with the reason');

    // the person sees only their level and one line, never the detail
    const mine = (await h.get('/v1/me/reliability', flaky.token)).body;
    assert.deepEqual(Object.keys(mine).sort(), ['label', 'level', 'line']);
    assert.equal(mine.level, 'needs_care');
    // the host (who hosted three plans with guests) is Reliable too
    assert.equal((await staffView(host)).level, 'reliable');
  });
});

describe('host did not show up: the member side', () => {
  /** An activity the member is in, on at the given moment. */
  async function plan(startedMinutesAgo: number, endsInMinutes = 90) {
    const host = await h.verified('AbHost');
    const a = await h.verified('AbOne');
    const b = await h.verified('AbTwo');
    const { id } = await runPlan(host, [a, b], 'Walk in the park');
    await h.prisma.activity.update({ where: { id }, data: { startsAt: new Date(Date.now() - startedMinutesAgo * 60_000), endsAt: new Date(Date.now() + endsInMinutes * 60_000) } });
    return { host, a, b, id };
  }

  it('lets an approved member say it, but only once the plan has been on for 30 minutes and only for 72 hours after', async () => {
    const { host, a, id } = await plan(10);
    assert.equal((await h.post(`/v1/activities/${id}/host-no-show`, a.token, {})).body.code, 'HOST_ABSENT_TOO_EARLY');
    await h.prisma.activity.update({ where: { id }, data: { startsAt: ago(1), endsAt: ago(0.1) } });
    const said = await h.post(`/v1/activities/${id}/host-no-show`, a.token, { note: 'We waited an hour' });
    assert.equal(said.status, 201, JSON.stringify(said.body));
    assert.equal(said.body.expectedWithin, '24 hours');
    assert.equal(said.body.emergency.number, '112');
    // the same person saying it again is the same report
    assert.equal((await h.post(`/v1/activities/${id}/host-no-show`, a.token, {})).body.id, said.body.id);
    assert.equal(await h.prisma.report.count({ where: { targetId: id, category: 'host_no_show' } }), 1);
    // the host is told, in neutral words
    const told = (await h.get('/v1/notifications', host.token)).body.items.find((n: { type: string }) => n.type === 'host_absence_reported');
    assert.ok(told && /moderator will look/.test(told.body));
    // far too late
    await h.prisma.activity.update({ where: { id }, data: { startsAt: ago(100), endsAt: ago(98) } });
    const other = await h.verified('AbLate');
    const late = await plan(10);
    await h.prisma.activity.update({ where: { id: late.id }, data: { startsAt: ago(100), endsAt: ago(98) } });
    assert.equal((await h.post(`/v1/activities/${late.id}/host-no-show`, late.b.token, {})).body.code, 'HOST_ABSENT_WINDOW_CLOSED');
    void other;
  });

  it('refuses everyone who was not approved for the plan, and the host themselves, as if it did not exist', async () => {
    const { host, id } = await plan(60);
    const stranger = await h.verified('AbStranger');
    assert.equal((await h.post(`/v1/activities/${id}/host-no-show`, stranger.token, {})).status, 404);
    assert.equal((await h.post(`/v1/activities/${id}/host-no-show`, host.token, {})).status, 404, 'the host is not an attendee');
    // asking to join is not being approved
    const asked = await h.post(`/v1/activities/${id}/requests`, stranger.token, {});
    assert.ok([201, 409].includes(asked.status));
    assert.equal((await h.post(`/v1/activities/${id}/host-no-show`, stranger.token, {})).status, 404);
    // the general report route cannot be used to get round it
    assert.equal((await h.post('/v1/reports', stranger.token, { targetType: 'activity', targetId: id, category: 'host_no_show' })).status, 404);
    assert.equal((await h.post('/v1/reports', stranger.token, { targetType: 'user', targetId: host.id, category: 'host_no_show' })).body.code, 'INVALID_TARGET');
  });

  it('gives a moderator the evidence, and a confirmed report counts against the host and cancels the host\'s notes for that plan', async () => {
    const { host, a, b, id } = await plan(120, -30);
    // the host also tried to mark one of the people who are saying they did not come
    await h.prisma.activity.update({ where: { id }, data: { startsAt: ago(3), endsAt: ago(1) } });
    assert.equal((await h.post(`/v1/activities/${id}/no-shows`, host.token, { userId: a.id })).status, 201);
    assert.equal((await h.post(`/v1/activities/${id}/host-no-show`, a.token, { note: 'Nobody came' })).status, 201);
    assert.equal((await h.post(`/v1/activities/${id}/host-no-show`, b.token, {})).status, 201);
    await h.prisma.activityMembership.update({ where: { activityId_userId: { activityId: id, userId: b.id } }, data: { attendance: 'attended' } });

    const queue = (await h.get('/v1/admin/reports?status=open', adminToken)).body.items.filter((r: { category: string; targetId: string }) => r.category === 'host_no_show' && r.targetId === id);
    assert.equal(queue.length, 2);
    const ev = queue.find((r: { reporterId: string }) => r.reporterId === a.id).evidence;
    assert.equal(ev.reporters, 2, 'two different members say it');
    assert.equal(ev.attendees, 2);
    assert.equal(ev.hostMarkedThisReporter, true, 'the host marked the very person who reported them');
    assert.equal(ev.membersSaidTheyAttended, 1);
    assert.equal(ev.hostMessagesDuringPlan, 0, 'the host wrote nothing in the chat during the plan');
    assert.equal(queue[0].subject.userId, host.id, 'the report is about the host');

    // the moderator confirms it: resolved
    const first = queue[0];
    assert.equal((await h.post(`/v1/admin/reports/${first.id}/resolve`, adminToken, { status: 'resolved', resolution: 'The host never answered the chat' })).status, 201);
    // the member's note is cancelled and they are told; the host is told
    assert.equal((await h.prisma.attendanceMark.findFirst({ where: { targetId: id, userId: a.id } })).state, 'overturned');
    assert.ok((await h.get('/v1/notifications', a.token)).body.items.some((n: { type: string; title: string }) => n.type === 'attendance_decided' && n.title === 'Note cancelled'));
    assert.ok((await h.get('/v1/notifications', host.token)).body.items.some((n: { type: string }) => n.type === 'host_absence_decided'));
    // and it is an upheld report against the host's level
    const view = await staffView(host);
    assert.ok(view.events.some((e: { text: string }) => e.text.includes('the host did not show up')), JSON.stringify(view.events));
    // a dismissed report does nothing of the sort
    const second = queue.find((r: { id: string }) => r.id !== first.id);
    assert.equal((await h.post(`/v1/admin/reports/${second.id}/resolve`, adminToken, { status: 'dismissed' })).status, 201);
  });
});

describe('hosts who say many people did not come', () => {
  it('flags a host who marks half of everyone, tells the moderators once, and shows it beside their notes', async () => {
    const host = await h.verified('MarkyHost');
    const guests: Person[] = [];
    for (let i = 0; i < 5; i++) guests.push(await h.verified(`MarkyGuest${i}`));
    const mod = await h.verified('MarkyMod');
    await h.prisma.user.update({ where: { id: mod.id }, data: { role: 'moderator' } });

    // one plan, five guests, all of them marked absent: 5 of 5
    const { id } = await runPlan(host, guests, 'Marky night');
    await happen(id, 1);
    for (const g of guests.slice(0, 3)) assert.equal((await h.post(`/v1/activities/${id}/no-shows`, host.token, { userId: g.id })).status, 201);
    assert.equal((await h.get('/v1/admin/no-shows/hosts', adminToken)).body.items.some((x: { hostId: string }) => x.hostId === host.id), false, 'three notes is not yet unusual');
    assert.equal((await h.post(`/v1/activities/${id}/no-shows`, host.token, { userId: guests[3].id })).status, 201);
    assert.equal((await h.post(`/v1/activities/${id}/no-shows`, host.token, { userId: guests[4].id })).status, 201);

    const hosts = (await h.get('/v1/admin/no-shows/hosts', adminToken)).body;
    const row = hosts.items.find((x: { hostId: string }) => x.hostId === host.id);
    assert.ok(row, 'the host is listed');
    assert.equal(row.flag, true);
    assert.equal(row.marks, 5);
    assert.match(row.reasons[0], /5 of 5 people did not come/);
    assert.equal(hosts.rule.minMarks, 4);
    // the moderators were told exactly once, however many notes followed
    const alerts = (await h.get('/v1/notifications', mod.token)).body.items.filter((n: { type: string }) => n.type === 'host_marks_review');
    assert.equal(alerts.length, 1);
    // and a moderator reading one of those notes sees the warning on it
    const note = (await h.get('/v1/admin/no-shows?state=marked', adminToken)).body.items.find((i: { host: { id: string } }) => i.host.id === host.id);
    assert.ok(note.hostUnusual && note.hostUnusual.length > 0);
    // staff only
    assert.equal((await h.get('/v1/admin/no-shows/hosts', host.token)).status, 403);
  });

  it('also flags a host whose notes keep being overturned, and leaves a fair host alone', async () => {
    const host = await h.verified('OverHost');
    const fair = await h.verified('FairHost');
    const guests: Person[] = [];
    for (let i = 0; i < 8; i++) guests.push(await h.verified(`OverGuest${i}`));
    const { id } = await runPlan(host, guests.slice(0, 5), 'Over night');
    await happen(id, 1);
    const marks = [];
    for (const g of guests.slice(0, 4)) marks.push((await h.post(`/v1/activities/${id}/no-shows`, host.token, { userId: g.id })).body.id);
    // a moderator overturns two of them: that is half of those decided
    for (const m of marks.slice(0, 2)) await h.post(`/v1/admin/no-shows/${m}/decision`, adminToken, { decision: 'overturn', note: 'they were there' });
    const row = (await h.get('/v1/admin/no-shows/hosts?all=true', adminToken)).body.items.find((x: { hostId: string }) => x.hostId === host.id);
    assert.equal(row.overturned, 2);
    assert.ok(row.reasons.some((r: string) => /2 of 2 decided notes were overturned/.test(r)), JSON.stringify(row));

    // a fair host: eight guests, one note
    const other = await runPlan(fair, guests, 'Fair night');
    await happen(other.id, 1);
    await h.post(`/v1/activities/${other.id}/no-shows`, fair.token, { userId: guests[0].id });
    const fairRow = (await h.get('/v1/admin/no-shows/hosts?all=true', adminToken)).body.items.find((x: { hostId: string }) => x.hostId === fair.id);
    assert.equal(fairRow.flag, false);
    assert.equal((await h.get('/v1/admin/no-shows/hosts', adminToken)).body.items.some((x: { hostId: string }) => x.hostId === fair.id), false, 'only unusual hosts are listed by default');
  });
});
