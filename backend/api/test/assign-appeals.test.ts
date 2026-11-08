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
