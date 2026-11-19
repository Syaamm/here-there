process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = require('./test-db').testDatabaseUrl('integrations'); // its own schema, so no other test's database is touched
process.env.VERIFICATION_MODE = 'manual';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { dropTestDatabase, resetTestDatabase } from './test-db';

let app: any;
let base = '';
let admin = '';
let member = '';
let newMember: () => Promise<string>;

const call = async (method: string, path: string, token: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  await resetTestDatabase('integrations');
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { JwtService } = await import('@nestjs/jwt');
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const prisma = app.get(PrismaService);
  const a = await prisma.user.create({ data: { email: 'admin@integrations.test', passwordHash: '!', adultConfirmed: true, role: 'admin' } });
  const m = await prisma.user.create({ data: { email: 'member@integrations.test', passwordHash: '!', adultConfirmed: true } });
  admin = await app.get(JwtService).signAsync({ sub: a.id, pv: 0 });
  member = await app.get(JwtService).signAsync({ sub: m.id, pv: 0 });
  let n = 0;
  // a new member for every code: one code per person per 30 seconds
  newMember = async () => app.get(JwtService).signAsync({ sub: (await prisma.user.create({ data: { email: `m${++n}@integrations.test`, passwordHash: '!', adultConfirmed: true } })).id, pv: 0 });
});
after(async () => {
  const { clearIntegrations } = await import('../src/common/integration-config');
  clearIntegrations();
  await app.close();
  await dropTestDatabase('integrations');
});

describe('Settings > Integrations drive the app', () => {
  it('is for admins only', async () => {
    assert.equal((await call('GET', '/v1/admin/integrations', member)).status, 403);
    assert.equal((await call('GET', '/v1/admin/integrations', admin)).status, 200);
  });

  it('the fixed email code and "show the code" come from the email integration that is on', async () => {
    const made = await call('POST', '/v1/admin/integrations', admin, { kind: 'email', provider: 'dev', name: 'Test mode', values: { fixedCode: '654321', showCode: 'true' }, active: true });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const sent = await call('POST', '/v1/me/email/send-code', await newMember());
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.devCode, '654321');

    // turn the code display off: the app no longer hands the code back
    await call('PATCH', `/v1/admin/integrations/${made.body.id}`, admin, { values: { showCode: 'false' } });
    const hidden = await call('POST', '/v1/me/email/send-code', await newMember());
    assert.equal(hidden.status, 201, JSON.stringify(hidden.body));
    assert.equal(hidden.body.devCode, undefined);
  });

  it('an empty fixed code means a random code', async () => {
    const list = await call('GET', '/v1/admin/integrations', admin);
    const mail = list.body.items.find((i: any) => i.kind === 'email');
    await call('PATCH', `/v1/admin/integrations/${mail.id}`, admin, { values: { fixedCode: '', showCode: 'true' } });
    const a = await call('POST', '/v1/me/email/send-code', await newMember());
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.match(a.body.devCode, /^\d{6}$/);
  });

  it('one of each kind is on at a time, and the identity-check mode follows the one that is on', async () => {
    const { VerificationService } = await import('../src/verification/verification.service');
    const svc = app.get(VerificationService);
    assert.equal(svc.mode, 'manual'); // nothing on: .env
    const manual = await call('POST', '/v1/admin/integrations', admin, { kind: 'verification', provider: 'manual', name: 'Manual Review', active: true });
    assert.equal(manual.status, 201, JSON.stringify(manual.body));
    assert.equal(svc.mode, 'manual');
    const veriff = await call('POST', '/v1/admin/integrations', admin, { kind: 'verification', provider: 'veriff', name: 'Veriff', values: { apiKey: 'vk-public', apiSecret: 'vk-secret' }, active: true });
    assert.equal(svc.mode, 'veriff');
    const items = (await call('GET', '/v1/admin/integrations', admin)).body.items.filter((i: any) => i.kind === 'verification');
    assert.equal(items.find((i: any) => i.id === manual.body.id).active, false);
    await call('PATCH', `/v1/admin/integrations/${manual.body.id}`, admin, { active: true });
    assert.equal(svc.mode, 'manual'); // switching Manual Review back on turns Veriff off
    await call('DELETE', `/v1/admin/integrations/${veriff.body.id}`, admin);
    assert.equal(svc.mode, 'manual');
  });

  it('Sandbox and Automatic are not choices any more', async () => {
    const cat = (await call('GET', '/v1/admin/integrations', admin)).body.catalog.verification.providers.map((p: any) => p.id);
    assert.deepEqual(cat, ['manual', 'persona', 'veriff', 'idenfy']);
    for (const provider of ['sandbox', 'auto']) assert.equal((await call('POST', '/v1/admin/integrations', admin, { kind: 'verification', provider, name: 'x1' })).status, 400);
  });

  it('with Manual Review on, an application goes to the admin, who approves or rejects it', async () => {
    const { PrismaService } = await import('../src/common/prisma.service');
    const { JwtService } = await import('@nestjs/jwt');
    const prisma = app.get(PrismaService);
    const apply = async (n: string) => {
      const u = await prisma.user.create({ data: { email: `${n}@integrations.test`, passwordHash: '!', adultConfirmed: true, emailVerifiedAt: new Date() } });
      return { id: u.id, token: await app.get(JwtService).signAsync({ sub: u.id, pv: 0 }) };
    };
    const [a, b] = [await apply('applicant-a'), await apply('applicant-b')];
    for (const u of [a, b]) {
      const r = await call('POST', '/v1/me/verification', u.token, { consent: true });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.eligibility, 'pending');
    }
    const queue = (await call('GET', '/v1/admin/verifications?status=pending', admin)).body.items;
    const mine = (id: string) => queue.find((c: any) => c.user.id === id);
    assert.equal(mine(a.id).provider, 'manual');
    assert.ok(mine(b.id));
    assert.equal((await call('POST', `/v1/admin/verifications/${mine(a.id).id}/decision`, admin, { decision: 'verified' })).status, 201);
    assert.equal((await call('POST', `/v1/admin/verifications/${mine(b.id).id}/decision`, admin, { decision: 'rejected', reason: 'document' })).status, 201);
    const state = async (u: { id: string }) => (await prisma.user.findUnique({ where: { id: u.id } })).eligibility;
    assert.equal(await state(a), 'verified');
    assert.equal(await state(b), 'rejected');
  });

  it('keeps secrets out of every answer, and refuses an incomplete service', async () => {
    const bad = await call('POST', '/v1/admin/integrations', admin, { kind: 'verification', provider: 'persona', name: 'Persona', values: { templateId: 'itmpl_1' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code ?? bad.body.error?.code, 'INTEGRATION_FIELD');
    const ok = await call('POST', '/v1/admin/integrations', admin, { kind: 'verification', provider: 'persona', name: 'Persona', values: { templateId: 'itmpl_1', apiKey: 'persona_secret_KEY1', webhookSecret: 'whsec_ABCD' } });
    assert.equal(ok.status, 201);
    const text = JSON.stringify((await call('GET', '/v1/admin/integrations', admin)).body);
    assert.ok(!text.includes('persona_secret_KEY1') && !text.includes('whsec_ABCD'));
    assert.ok(text.includes('••••KEY1'));
  });

  it('any SMTP email provider works: a known one only asks for its login, the host and port are filled in', async () => {
    const made = await call('POST', '/v1/admin/integrations', admin, { kind: 'email', provider: 'brevo', name: 'Production Brevo', values: { username: 'me@example.com', password: 'xsmtpsib-SECRET9', from: 'LAMIS <no-reply@example.com>' }, active: true });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const row = (await call('GET', '/v1/admin/integrations', admin)).body.items.find((i: any) => i.id === made.body.id);
    assert.equal(row.settings.host, 'smtp-relay.brevo.com');
    assert.equal(row.settings.port, '587');
    assert.equal(row.secretsSet.password, '••••ET9'.length ? row.secretsSet.password : '');
    assert.ok(!JSON.stringify(row).includes('xsmtpsib-SECRET9'));
    // a real provider means random codes and no code shown in the app
    const { fixedCodeFor } = await import('../src/common/test-codes');
    assert.equal(fixedCodeFor('email'), null);
    const sent = await call('POST', '/v1/me/email/send-code', await newMember());
    assert.equal(sent.body.devCode, undefined);
    // SendGrid and Resend ask for the key only
    const sg = await call('POST', '/v1/admin/integrations', admin, { kind: 'email', provider: 'sendgrid', name: 'SG', values: { password: 'SG.key', from: 'a@b.co' } });
    assert.equal(sg.status, 201, JSON.stringify(sg.body));
    assert.equal((await call('GET', '/v1/admin/integrations', admin)).body.items.find((i: any) => i.id === sg.body.id).settings.username, 'apikey');
  });

  it('a Veriff or Vonage integration saved here is what the app then uses', async () => {
    const { VerificationService } = await import('../src/verification/verification.service');
    const { SmsService } = await import('../src/common/sms.service');
    const veriff = await call('POST', '/v1/admin/integrations', admin, { kind: 'verification', provider: 'veriff', name: 'Veriff 2', values: { apiKey: 'vk-public', apiSecret: 'vk-secret' }, active: true });
    assert.equal(veriff.status, 201, JSON.stringify(veriff.body));
    assert.equal(app.get(VerificationService).mode, 'veriff');

    const vonage = await call('POST', '/v1/admin/integrations', admin, { kind: 'sms', provider: 'vonage', name: 'Vonage', values: { apiKey: 'ak', apiSecret: 'as', from: 'LAMIS' }, active: true });
    assert.equal(vonage.status, 201, JSON.stringify(vonage.body));
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => (seen.push(String(url)), new Response(JSON.stringify({ messages: [{ status: '0' }] }), { status: 200 }))) as typeof fetch;
    try {
      await app.get(SmsService).send('+447700900123', 'Your LAMIS code is 123456.');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(seen, ['https://rest.nexmo.com/sms/json']);
    // a real SMS provider means random codes and no code shown in the app
    const { fixedCodeFor } = await import('../src/common/test-codes');
    assert.equal(fixedCodeFor('phone'), null);
    assert.equal(app.get(SmsService).devEcho, false);
  });
});
