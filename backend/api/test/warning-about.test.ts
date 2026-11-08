import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('warnabout' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
});

const warningAlert = async (token: string) => (await h.get('/v1/notifications', token)).body.items.find((n: { type: string }) => n.type === 'warning');

describe('a warning says which activity it is about', () => {
  it('knows it from the report it was given on, and shows it in the alert (older warnings too)', async () => {
    const host = await h.verified('WarnedHost');
    const reporter = await h.verified('WarnReporter');
    const made = await h.post('/v1/activities', host.token, h.activityBody({ title: 'Sunday coffee walk' }));
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.id as string;

    // reported as an activity: the warning carries it
    const rep = await h.post('/v1/reports', reporter.token, { targetType: 'activity', targetId: id, category: 'spam', details: 'host did not show' });
    assert.equal(rep.status, 201, JSON.stringify(rep.body));
    assert.equal((await h.post(`/v1/admin/users/${host.id}/warn`, h.adminToken, { reason: 'Please do not skip your own plans', reportId: rep.body.id })).status, 201);
    const alert = await warningAlert(host.token);
    assert.equal(alert.data.aboutType, 'activity');
    assert.equal(alert.data.aboutId, id);
    assert.equal(alert.data.aboutTitle, 'Sunday coffee walk');
    assert.match(alert.body, /^Sunday coffee walk/);

    // a warning with no report behind it is about no plan
    const plain = await h.verified('WarnedPlain');
    assert.equal((await h.post(`/v1/admin/users/${plain.id}/warn`, h.adminToken, { reason: 'Please keep chat friendly' })).status, 201);
    assert.equal((await warningAlert(plain.token)).data.aboutId, undefined);

    // an older alert (made before warnings knew their plan) gets it filled in when listed
    const older = await h.prisma.userWarning.create({ data: { userId: plain.id, reason: 'Earlier warning', createdById: plain.id, aboutType: 'activity', aboutId: id } });
    await h.prisma.notification.create({ data: { userId: plain.id, type: 'warning', title: 'A moderator warned you', body: 'Tap to read why.', data: JSON.stringify({ warningId: older.id }) } });
    const listed = (await h.get('/v1/notifications', plain.token)).body.items.find((n: { data: { warningId?: string } | null }) => n.data?.warningId === older.id);
    assert.equal(listed.data.aboutTitle, 'Sunday coffee walk');
    assert.equal(listed.data.reason, 'Earlier warning');
  });
});
