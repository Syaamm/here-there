import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('complete' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
});

describe('the host marks an activity as completed', () => {
  it('only from its start on, ends it now, and tells everyone going (alert and push)', async () => {
    const host = await h.verified('DoneHost');
    const member = await h.verified('DoneMember');
    const stranger = await h.verified('DoneStranger');
    const made = await h.post('/v1/activities', host.token, h.activityBody({ joinPolicy: 'instant' }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.id as string;
    assert.equal((await h.post(`/v1/activities/${id}/requests`, member.token, {})).status, 201);

    // not started yet: only cancelling is possible
    const early = await h.post(`/v1/activities/${id}/complete`, host.token, {});
    assert.equal(early.status, 409);
    assert.equal(early.body.code, 'ACTIVITY_NOT_STARTED');

    // it started 20 minutes ago and was planned to run another hour and 40 minutes
    await h.prisma.activity.update({ where: { id }, data: { startsAt: new Date(Date.now() - 20 * 60e3), endsAt: new Date(Date.now() + 100 * 60e3) } });
    assert.equal((await h.post(`/v1/activities/${id}/complete`, member.token, {})).status, 403, 'only the host');
    assert.equal((await h.post(`/v1/activities/${id}/complete`, stranger.token, {})).status, 403);

    const done = await h.post(`/v1/activities/${id}/complete`, host.token, {});
    assert.equal(done.status, 201, JSON.stringify(done.body));
    const row = await h.prisma.activity.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, 'completed');
    assert.ok(+row.endsAt <= Date.now(), 'it ends now, not at the planned time');

    const alerts = await h.get('/v1/notifications', member.token);
    const ended = (alerts.body.items as { type: string; title: string }[]).find((n) => n.type === 'activity_completed');
    assert.ok(ended, 'the member is told');
    assert.match(ended.title, /^Ended: /);
    const pushes = await h.prisma.job.count({ where: { type: 'push.send', payload: { contains: member.id } } });
    assert.ok(pushes >= 1, 'and a push is queued for them');

    // once is enough, and a finished or cancelled activity cannot be completed again
    assert.equal((await h.post(`/v1/activities/${id}/complete`, host.token, {})).status, 201);
    assert.equal((await h.post(`/v1/activities/${id}/cancel`, host.token, {})).status, 409);
  });
});

describe('Mark all read', () => {
  it('reads the alerts that only tell you something, and leaves the ones waiting for you to act', async () => {
    const host = await h.verified('ReadAllHost');
    const asker = await h.verified('ReadAllAsker');
    const fan = await h.verified('ReadAllFan');
    const made = await h.post('/v1/activities', host.token, h.activityBody({ title: 'Read-all check', joinPolicy: 'host_approval' }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal((await h.post(`/v1/activities/${made.body.id}/requests`, asker.token, {})).status, 201); // the host must answer this
    await h.post('/v1/follows', fan.token, { userId: host.id }); // only news
    const unread = async () => ((await h.get('/v1/notifications?unread=true&scope=alerts', host.token)).body.items as { type: string }[]).map((n) => n.type).sort();
    assert.ok((await unread()).includes('join_request'));
    assert.equal((await h.post('/v1/notifications/read-all?scope=alerts', host.token, {})).status, 201);
    assert.deepEqual(await unread(), ['join_request'], 'the request to answer is still waiting');
  });
});

describe('attendance after an activity', () => {
  it('asks each member once when it ends, takes one answer that cannot be changed, and shows the group who went', async () => {
    const host = await h.verified('AttHost');
    const member = await h.verified('AttMember');
    const other = await h.verified('AttOther');
    const made = await h.post('/v1/activities', host.token, h.activityBody({ title: 'Attendance check', joinPolicy: 'instant', capacity: 4 }));
    const id = made.body.id as string;
    for (const u of [member, other]) assert.equal((await h.post(`/v1/activities/${id}/requests`, u.token, {})).status, 201);
    // it ran and ended a few minutes ago
    await h.prisma.activity.update({ where: { id }, data: { startsAt: new Date(Date.now() - 2 * 3600e3), endsAt: new Date(Date.now() - 5 * 60e3) } });

    const svc = h.app.get((await import('../src/activities/activities.service')).ActivitiesService);
    const prompts = (userId: string) => h.prisma.notification.count({ where: { userId, type: 'attendance_prompt', data: { contains: `"activityId":"${id}"` } } });
    await svc.sendAttendancePrompts();
    assert.deepEqual([await prompts(member.id), await prompts(other.id), await prompts(host.id)], [1, 1, 0], 'both members are asked, not the host');
    await svc.sendAttendancePrompts();
    assert.deepEqual([await prompts(member.id), await prompts(other.id)], [1, 1], 'and only once');
    const asked = (await h.get('/v1/notifications', member.token)).body.items.find((n: { type: string }) => n.type === 'attendance_prompt');
    assert.match(asked.title, /^Did you go to Attendance check\?/);

    assert.equal(asked.readAt, null);
    assert.equal((await h.post(`/v1/activities/${id}/attendance`, member.token, { attended: true })).status, 201);
    const unreadPrompts = (userId: string) => h.prisma.notification.count({ where: { userId, type: 'attendance_prompt', readAt: null, data: { contains: `"activityId":"${id}"` } } });
    assert.deepEqual([await unreadPrompts(member.id), await unreadPrompts(other.id)], [0, 1], 'answering (from anywhere) marks its alert read; the other member is still asked');
    assert.equal((await h.post(`/v1/activities/${id}/attendance`, member.token, { attended: true })).status, 201, 'the same answer again is fine');
    const change = await h.post(`/v1/activities/${id}/attendance`, member.token, { attended: false });
    assert.equal(change.status, 409);
    assert.equal(change.body.code, 'ATTENDANCE_SET');

    const seen = (await h.get(`/v1/activities/${id}`, other.token)).body.participants as { id: string; answered?: boolean; attendance?: string }[];
    assert.equal(seen.find((p) => p.id === member.id)?.answered, true);
    assert.equal(seen.find((p) => p.id === other.id)?.answered, false);
    assert.equal(seen.find((p) => p.id === member.id)?.attendance, 'attended', 'the group sees who went');
  });
});

describe('drafts need a name', () => {
  it('refuses an empty draft, and keeps one with just the name', async () => {
    const me = await h.verified('DraftNamer');
    const put = (body: unknown) => h.call('PUT', '/v1/me/drafts', me.token, body);
    assert.equal((await put({ kind: 'activity', data: { category: 'drinks', title: '  ' } })).body.code, 'DRAFT_NEEDS_NAME');
    assert.equal((await put({ kind: 'trip', data: { originCity: 'Milan' } })).body.code, 'DRAFT_NEEDS_NAME');
    assert.equal((await put({ kind: 'activity', data: { title: 'Sunday walk' } })).status, 200);
  });
});

describe('the home feed once an activity has started', () => {
  it('shows it only to the people in it, never to anyone else (a request that was not accepted included)', async () => {
    const host = await h.verified('LiveHost');
    const member = await h.verified('LiveMember');
    const asked = await h.verified('LiveAsked');
    const stranger = await h.verified('LiveStranger');
    const made = await h.post('/v1/activities', host.token, h.activityBody({ title: 'Already running', joinPolicy: 'host_approval' }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.id as string;
    const memberReq = await h.post(`/v1/activities/${id}/requests`, member.token, {});
    assert.equal(memberReq.status, 201, JSON.stringify(memberReq.body));
    assert.equal((await h.post(`/v1/activities/${id}/requests`, asked.token, {})).status, 201);
    assert.equal((await h.post(`/v1/activities/${id}/requests/${memberReq.body.id}/decision`, host.token, { decision: 'approve' })).body.state, 'approved');

    const listed = async (token: string) => ((await h.get('/v1/activities?limit=50', token)).body.items as { id: string }[]).some((a) => a.id === id);
    // before it starts, everybody sees it
    assert.deepEqual([await listed(host.token), await listed(member.token), await listed(asked.token), await listed(stranger.token)], [true, true, true, true]);

    // it has started and is not over: only the host and the approved member
    await h.prisma.activity.update({ where: { id }, data: { startsAt: new Date(Date.now() - 30 * 60e3), endsAt: new Date(Date.now() + 60 * 60e3) } });
    assert.deepEqual([await listed(host.token), await listed(member.token), await listed(asked.token), await listed(stranger.token)], [true, true, false, false]);
  });
});
