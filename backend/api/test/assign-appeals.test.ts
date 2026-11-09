import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('assignappeals' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
});

const alerts = async (token: string, type: string) => (await h.get('/v1/notifications', token)).body.items.filter((n: { type: string }) => n.type === type);
async function reportAbout(targetId: string) {
  const by = await h.verified('Reporter');
  const r = await h.post('/v1/reports', by.token, { targetType: 'user', targetId, category: 'harassment', details: 'rude in chat' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

describe('any staff member can decide a report, and two at once never both count', () => {
  it('a staff member who never took the report can resolve it', async () => {
    const anyStaff = await h.staff('AnyStaff');
    const target = await h.verified('TargetAny');
    const id = await reportAbout(target.id);
    const r = await h.post(`/v1/admin/reports/${id}/resolve`, anyStaff.token, { status: 'resolved', resolution: 'Rude messages confirmed' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await h.prisma.report.findUnique({ where: { id } })).status, 'resolved');
  });

  it('two staff resolving at the same moment: exactly one decision counts, the other is told who decided', async () => {
    const one = await h.staff('FirstDecider');
    const two = await h.staff('SecondDecider');
    const target = await h.verified('TargetRace');
    const id = await reportAbout(target.id);
    const [a, b] = await Promise.all([
      h.post(`/v1/admin/reports/${id}/resolve`, one.token, { status: 'resolved', resolution: 'Confirmed by first' }),
      h.post(`/v1/admin/reports/${id}/resolve`, two.token, { status: 'dismissed', resolution: 'Nothing found by second' }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], `one wins, one is refused: ${JSON.stringify([a.body, b.body])}`);
    const lost = a.status === 409 ? a : b;
    assert.equal(lost.body.code, 'REPORT_ALREADY_DECIDED');
    assert.match(lost.body.message, /^Already (resolved|dismissed) by /);
    // one decision on record, one audit entry, one message to the reported person
    const row = await h.prisma.report.findUnique({ where: { id } });
    assert.equal(row.assignedTo, a.status === 201 ? one.id : two.id, 'the report names whoever decided first');
    const decisions = await h.prisma.auditEvent.count({ where: { objectId: id, action: { in: ['report.resolved', 'report.dismissed'] } } });
    assert.equal(decisions, 1);
    // and deciding again later is refused the same way (nothing is decided twice)
    const again = await h.post(`/v1/admin/reports/${id}/resolve`, one.token, { status: 'dismissed' });
    assert.equal(again.status, 409);
  });
});

describe('alerts about a report go to the app it came from', () => {
  const inbox = async (token: string, product: 'here' | 'there') => ((await h.get(`/v1/notifications?product=${product}`, token)).body.items as { type: string }[]).map((n) => n.type);

  it('a person reported in THERE: the warning given on that report shows in THERE only, the same way it would in HERE', async () => {
    const by = await h.verified('ThereReporter');
    const target = await h.verified('ThereTarget');
    const r = await h.post('/v1/reports', by.token, { targetType: 'user', targetId: target.id, category: 'harassment', details: 'rude in a trip chat', product: 'there' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.body.id } })).product, 'there');
    assert.equal((await h.post(`/v1/admin/users/${target.id}/warn`, h.adminToken, { reason: 'Please keep the trip chat friendly', reportId: r.body.id })).status, 201);
    assert.ok((await inbox(target.token, 'there')).includes('warning'), 'in THERE');
    assert.ok(!(await inbox(target.token, 'here')).includes('warning'), 'not in HERE');
  });

  it('a report about a HERE activity is HERE whatever the app says, and its decision shows in HERE only', async () => {
    const host = await h.verified('HereHostReported');
    const by = await h.verified('HereReporter');
    const act = await h.post('/v1/activities', host.token, h.activityBody({ title: 'Reported coffee' }));
    const r = await h.post('/v1/reports', by.token, { targetType: 'activity', targetId: act.body.id, category: 'spam', product: 'there' });
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.body.id } })).product, 'here', 'an activity is always HERE');
    assert.equal((await h.post(`/v1/admin/reports/${r.body.id}/resolve`, h.adminToken, { status: 'resolved', resolution: 'Listing was spam' })).status, 201);
    assert.ok((await inbox(host.token, 'here')).includes('report_decision'), 'in HERE');
    assert.ok(!(await inbox(host.token, 'there')).includes('report_decision'), 'not in THERE');
  });

  it('a report without a product (an older app) still reaches the person, in both apps', async () => {
    const by = await h.verified('OldAppReporter');
    const target = await h.verified('OldAppTarget');
    const r = await h.post('/v1/reports', by.token, { targetType: 'user', targetId: target.id, category: 'spam' });
    await h.post(`/v1/admin/users/${target.id}/warn`, h.adminToken, { reason: 'No spam in chats please', reportId: r.body.id });
    assert.ok((await inbox(target.token, 'here')).includes('warning'));
    assert.ok((await inbox(target.token, 'there')).includes('warning'));
  });
});

describe('giving a report to someone', () => {
  it('lets an admin give a report to any staff member of its area, and staff only take reports themselves', async () => {
    const milan = await h.staff('MilanStaff');
    const rome = await h.staff('RomeStaff', { city: 'Rome' });
    const noReports = await h.staff('NoReportsStaff', { permissions: ['users'] });
    const target = await h.verified('Target'); // home city Milan
    const id = await reportAbout(target.id);

    // an admin gives it to the Milan staff member, who is told
    const given = await h.post(`/v1/admin/reports/${id}/assign`, h.adminToken, { userId: milan.id });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    assert.equal(given.body.assignedTo, milan.id);
    const row = await h.prisma.report.findUnique({ where: { id } });
    assert.equal(row.assignedTo, milan.id);
    assert.equal(row.status, 'in_review');
    assert.ok((await alerts(milan.token, 'report_assigned')).length >= 1);
    const audit = await h.prisma.auditEvent.findFirst({ where: { action: 'report.assign', objectId: id }, orderBy: { createdAt: 'desc' } });
    assert.equal(JSON.parse(audit.metadata).assignedTo, milan.id);

    // not to someone of another area, nor to staff who do not work on reports
    assert.equal((await h.post(`/v1/admin/reports/${id}/assign`, h.adminToken, { userId: rome.id })).body.code, 'INVALID_TARGET');
    assert.equal((await h.post(`/v1/admin/reports/${id}/assign`, h.adminToken, { userId: noReports.id })).body.code, 'INVALID_TARGET');
    assert.equal((await h.post(`/v1/admin/reports/${id}/assign`, h.adminToken, { userId: target.id })).body.code, 'INVALID_TARGET');

    // staff cannot give it to someone else, but can take it themselves
    const other = await h.staff('OtherMilanStaff');
    assert.equal((await h.post(`/v1/admin/reports/${id}/assign`, other.token, { userId: milan.id })).body.code, 'ADMIN_ONLY');
    const taken = await h.post(`/v1/admin/reports/${id}/assign`, other.token, {});
    assert.equal(taken.status, 201, JSON.stringify(taken.body));
    assert.equal((await h.prisma.report.findUnique({ where: { id } })).assignedTo, other.id);
  });
});

describe('appeals go to the staff of the area and always to the admins', () => {
  it('tells admins and the area staff, keeps a staff member off an appeal of their own decision, and lets an admin decide it', async () => {
    const warner = await h.staff('WarnerStaff');
    const second = await h.staff('SecondStaff');
    const romeStaff = await h.staff('RomeOnly', { city: 'Rome' });
    const person = await h.verified('Appellant'); // home city Milan
    assert.equal((await h.post(`/v1/admin/users/${person.id}/warn`, warner.token, { reason: 'Please keep the chat friendly.' })).status, 201);
    const warning = await h.prisma.userWarning.findFirst({ where: { userId: person.id } });

    const before = (await alerts(h.adminToken, 'appeal_new')).length;
    const made = await h.post('/v1/me/appeals', person.token, { kind: 'warning', targetId: warning.id, message: 'I was only joking with a friend.' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal((await alerts(h.adminToken, 'appeal_new')).length, before + 1, 'the admin is told');
    assert.ok((await alerts(second.token, 'appeal_new')).length >= 1, 'the staff of the area are told');
    assert.equal((await alerts(romeStaff.token, 'appeal_new')).length, 0, 'staff of another area are not');

    // the area staff see it; another area does not
    assert.ok((await h.get('/v1/admin/appeals', second.token)).body.items.some((a: { id: string }) => a.id === made.body.id));
    assert.ok(!(await h.get('/v1/admin/appeals', romeStaff.token)).body.items.some((a: { id: string }) => a.id === made.body.id));
    assert.equal((await h.post(`/v1/admin/appeals/${made.body.id}/decision`, romeStaff.token, { decision: 'uphold', note: 'Looks fine to me.' })).body.code, 'OUT_OF_SCOPE');

    // the staff member who warned cannot review the appeal of it; another one can
    assert.equal((await h.post(`/v1/admin/appeals/${made.body.id}/decision`, warner.token, { decision: 'reject', note: 'The warning stands.' })).body.code, 'SECOND_REVIEWER');
    const decided = await h.post(`/v1/admin/appeals/${made.body.id}/decision`, second.token, { decision: 'uphold', note: 'Fair enough, the warning is withdrawn.' });
    assert.equal(decided.status, 201, JSON.stringify(decided.body));
  });

  it('lets an admin decide an appeal even of their own decision', async () => {
    const person = await h.verified('AdminWarned');
    assert.equal((await h.post(`/v1/admin/users/${person.id}/warn`, h.adminToken, { reason: 'No selling in chats.' })).status, 201);
    const warning = await h.prisma.userWarning.findFirst({ where: { userId: person.id } });
    const made = await h.post('/v1/me/appeals', person.token, { kind: 'warning', targetId: warning.id, message: 'It was a free ticket.' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal((await h.post(`/v1/admin/appeals/${made.body.id}/decision`, h.adminToken, { decision: 'reject', note: 'The warning stands.' })).status, 201);
  });
});
