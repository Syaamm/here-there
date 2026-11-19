import { Body, Controller, Delete, Get, Injectable, OnModuleDestroy, OnModuleInit, Param, Patch, Post } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Staff } from '../common/auth';
import { allowsSimulated, isDemo } from '../common/demo';
import { E } from '../common/errors';
import { refreshIntegrations } from '../common/integration-config';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { decryptField, encryptField } from '../common/vault';
import { CATALOG, INTEGRATION_KINDS, Kind, Provider, providerOf, SIMULATED } from './integration-catalog';

const valuesSchema = z.record(z.string().max(64), z.string().trim().max(8000));

export const createIntegrationSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  provider: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(120).default(''),
  values: valuesSchema.default({}),
  /** switch it on straight away (the others of its kind go off) */
  active: z.boolean().optional(),
});
export const updateIntegrationSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(120).optional(),
  /** a secret left out or empty keeps what is saved; any other detail left empty is cleared */
  values: valuesSchema.optional(),
  active: z.boolean().optional(),
});

type Row = { id: string; kind: string; provider: string; name: string; description: string; settings: unknown; secret: string | null; active: boolean; updatedAt: Date };

/**
 * Settings > Integrations. What is saved here is what the app runs on: the integration that is on for a kind replaces the .env
 * settings of that kind (see common/integration-config.ts). Every change takes effect at once on this server, and within
 * seconds on any other server sharing the database.
 */
@Injectable()
export class IntegrationsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    try {
      if (process.env.NODE_ENV !== 'test') await this.seed();
      await refreshIntegrations(this.prisma);
      this.timer = setInterval(() => void refreshIntegrations(this.prisma).catch(() => undefined), 15_000);
      this.timer.unref();
    } catch (e) {
      console.warn(`Integrations could not be read: ${(e as Error).message}. The .env settings are used.`);
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * First start only: put what the server is doing today on the page, so nothing changes and the admin can see and edit it.
   * (Test-mode email and SMS with the fixed code, and the identity-check mode from .env.) Real keys in .env are not copied.
   */
  private async seed() {
    // Sandbox and Automatic are gone from the page: whatever was saved as one is now Manual Review (a demo server keeps its simulated check)
    if (!isDemo()) await this.prisma.integration.updateMany({ where: { kind: 'verification', provider: { in: ['sandbox', 'auto'] } }, data: { provider: 'manual', name: 'Manual Review', description: '', settings: {} } });
    const rows: Prisma.IntegrationCreateManyInput[] = [];
    if ((await this.prisma.integration.count()) === 0) {
      const showCode = process.env.EMAIL_DEV_ECHO === 'true' || isDemo() ? 'true' : 'false';
      if (allowsSimulated() && !process.env.SMTP_URL) rows.push({ kind: 'email', provider: 'dev', name: 'Test mode', description: 'Nothing is emailed; the code is fixed', settings: { fixedCode: '123456', showCode }, active: true });
      if (allowsSimulated() && !(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)) rows.push({ kind: 'sms', provider: 'dev', name: 'Test mode', description: 'Nothing is texted; the code is fixed', settings: { fixedCode: '123456', showCode }, active: true });
    }
    // identity checks: Manual Review is on until the admin sets up a provider (unless .env already runs a real one)
    const mode = process.env.VERIFICATION_MODE ?? '';
    if (!isDemo() && !['persona', 'idenfy', 'veriff'].includes(mode) && (await this.prisma.integration.count({ where: { kind: 'verification' } })) === 0)
      rows.push({ kind: 'verification', provider: 'manual', name: 'Manual Review', description: '', settings: {}, active: true });
    if (rows.length) await this.prisma.integration.createMany({ data: rows });
  }

  private secrets(row: Row): Record<string, string> {
    try {
      return row.secret ? (JSON.parse(decryptField(row.secret)) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  /** Never returns a secret: only the last four characters, so it can be recognised. */
  private view(row: Row) {
    const secrets = this.secrets(row);
    return {
      id: row.id,
      kind: row.kind,
      provider: row.provider,
      name: row.name,
      description: row.description,
      active: row.active,
      settings: (row.settings ?? {}) as Record<string, string>,
      secretsSet: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v ? `••••${v.slice(-4)}` : ''])),
      updatedAt: row.updatedAt,
    };
  }

  /** Checks what the form sent against the provider's field list and splits it into plain details and secrets. */
  private split(p: Provider, input: Record<string, string>) {
    const known = new Map(p.fields.map((f) => [f.key, f]));
    const unknown = Object.keys(input).filter((k) => !known.has(k));
    if (unknown.length) throw E.badRequest('INTEGRATION_FIELD', `${p.label} has no setting called ${unknown[0]}`);
    const plain: Record<string, string> = {};
    const secret: Record<string, string> = {};
    for (const f of p.fields) {
      const v = input[f.key];
      if (v === undefined) continue;
      if (v !== '' && f.options && !f.options.some(([o]) => o === v)) throw E.badRequest('INTEGRATION_FIELD', `${f.label}: choose one of the listed answers`);
      if (f.key === 'fixedCode' && v !== '' && !/^\d{6}$/.test(v)) throw E.badRequest('INTEGRATION_FIELD', 'The fixed code is six digits, like 123456');
      if (f.secret) {
        if (v !== '') secret[f.key] = v; // an empty secret keeps what is saved
      } else plain[f.key] = v;
    }
    return { plain, secret };
  }

  /** A provider can be switched on only when everything it needs is filled in, and test-only ones only where they are allowed. */
  private ready(row: { kind: string; provider: string }, p: Provider, settings: Record<string, string>, secrets: Record<string, string>) {
    if (SIMULATED.has(`${row.kind}:${row.provider}`) && !allowsSimulated()) throw E.badRequest('INTEGRATION_SIMULATED', 'Test-only services are not allowed on a production server');
    const missing = p.fields.find((f) => !f.optional && !(f.secret ? secrets[f.key] : (settings[f.key] ?? f.default)));
    if (missing) throw E.badRequest('INTEGRATION_FIELD', `${missing.label} is required`);
  }

  async list() {
    const rows = await this.prisma.integration.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] });
    return { catalog: CATALOG, kinds: INTEGRATION_KINDS, items: rows.map((r) => this.view(r)) };
  }

  async create(actor: User, body: unknown) {
    const dto = parse(createIntegrationSchema, body);
    const p = providerOf(dto.kind, dto.provider);
    if (!p) throw E.badRequest('INTEGRATION_PROVIDER', `${dto.provider} is not a ${CATALOG[dto.kind].label.toLowerCase()} provider`);
    const { plain, secret } = this.split(p, dto.values);
    for (const f of p.fields) if (!f.secret && plain[f.key] === undefined && f.default !== undefined) plain[f.key] = f.default;
    this.ready({ kind: dto.kind, provider: dto.provider }, p, plain, secret); // incomplete ones are refused up front, so "on" always works
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (dto.active) ops.push(this.prisma.integration.updateMany({ where: { kind: dto.kind }, data: { active: false } }));
    const id = randomUUID();
    ops.push(this.prisma.integration.create({ data: { id, kind: dto.kind, provider: dto.provider, name: dto.name, description: dto.description, settings: plain, secret: Object.keys(secret).length ? encryptField(JSON.stringify(secret)) : null, active: !!dto.active, updatedById: actor.id } }));
    await this.prisma.$transaction(ops);
    await this.audit.log(actor.id, 'integration.create', 'integration', id, { kind: dto.kind, provider: dto.provider, name: dto.name, active: !!dto.active });
    await refreshIntegrations(this.prisma);
    return { id };
  }

  async update(actor: User, id: string, body: unknown) {
    const dto = parse(updateIntegrationSchema, body);
    const row = await this.prisma.integration.findUnique({ where: { id } });
    if (!row) throw E.notFound('Integration');
    const p = providerOf(row.kind as Kind, row.provider)!;
    const data: Prisma.IntegrationUpdateInput = { updatedById: actor.id };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    let settings = (row.settings ?? {}) as Record<string, string>;
    let secrets = this.secrets(row);
    if (dto.values) {
      const { plain, secret } = this.split(p, dto.values);
      settings = { ...settings, ...plain };
      secrets = { ...secrets, ...secret };
      data.settings = settings;
      data.secret = Object.keys(secrets).length ? encryptField(JSON.stringify(secrets)) : null;
    }
    // a service that is on (or about to be) must stay complete
    if (dto.active === true || (dto.active === undefined && row.active)) this.ready(row, p, settings, secrets);
    // one of each kind is on at a time: switching one on switches the others of its kind off
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (dto.active === true) ops.push(this.prisma.integration.updateMany({ where: { kind: row.kind, id: { not: id } }, data: { active: false } }));
    if (dto.active !== undefined) data.active = dto.active;
    ops.push(this.prisma.integration.update({ where: { id }, data }));
    await this.prisma.$transaction(ops);
    const onlyToggled = dto.active !== undefined && dto.name === undefined && dto.description === undefined && !dto.values;
    await this.audit.log(actor.id, onlyToggled ? (dto.active ? 'integration.on' : 'integration.off') : 'integration.update', 'integration', id, {
      kind: row.kind,
      name: dto.name ?? row.name,
      ...(dto.values && { changed: Object.keys(dto.values).filter((k) => dto.values![k] !== '' || !p.fields.find((f) => f.key === k)?.secret) }),
    });
    await refreshIntegrations(this.prisma);
    return { id };
  }

  async remove(actor: User, id: string) {
    const row = await this.prisma.integration.findUnique({ where: { id } });
    if (!row) throw E.notFound('Integration');
    await this.prisma.integration.delete({ where: { id } });
    await this.audit.log(actor.id, 'integration.delete', 'integration', id, { kind: row.kind, name: row.name });
    await refreshIntegrations(this.prisma);
    return { id };
  }
}

@Controller('v1/admin/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Staff('admin')
  @Get()
  list() {
    return this.integrations.list();
  }

  @Staff('admin')
  @Post()
  create(@CurrentUser() me: User, @Body() body: unknown) {
    return this.integrations.create(me, body);
  }

  @Staff('admin')
  @Patch(':id')
  update(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.integrations.update(me, id, body);
  }

  @Staff('admin')
  @Delete(':id')
  remove(@CurrentUser() me: User, @Param('id') id: string) {
    return this.integrations.remove(me, id);
  }
}
