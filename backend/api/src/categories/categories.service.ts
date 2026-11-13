import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Body, Controller, Delete, Get, Injectable, OnModuleInit, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Public, Staff } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { TtlCache } from '../common/ttl-cache';
import { parse } from '../common/validate';

export type CategoryKind = 'here' | 'there';
type Row = { id: string; kind: string; key: string; label: string; emoji: string; color: string; imageUrl: string | null; position: number; active: boolean };

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const IMAGE_PX = 640; // square: a round chip and a wide card both crop it

/** The pictures the app has always used for these categories (seed-assets/categories/here and /there), found from source or from the build. */
function seedPicture(kind: CategoryKind, key: string): Buffer | null {
  for (const up of ['..', '../..', '../../..']) {
    const file = path.resolve(__dirname, up, 'seed-assets', 'categories', kind, `${key}.webp`);
    if (existsSync(file)) return readFileSync(file);
  }
  return null;
}

/** What the app showed before categories were managed: the five HERE categories and the four travel ones. */
const SEED: Record<CategoryKind, { key: string; label: string; emoji: string; color: string }[]> = {
  here: [
    { key: 'coffee', label: 'Coffee', emoji: '☕', color: '#C7D9BF' },
    { key: 'drinks', label: 'Drinks', emoji: '🍸', color: '#86C4A8' },
    { key: 'food', label: 'Food', emoji: '🍽️', color: '#DCE5B8' },
    { key: 'sports', label: 'Sports', emoji: '🏃', color: '#79B0A6' },
    { key: 'culture', label: 'Culture', emoji: '🎨', color: '#C8C2E2' },
  ],
  there: [
    { key: 'adventure', label: 'Adventure', emoji: '🧗', color: '#E8C9A0' },
    { key: 'nature', label: 'Nature', emoji: '🌿', color: '#BFD8B8' },
    { key: 'beach', label: 'Beach', emoji: '🏖️', color: '#BFE0E6' },
    { key: 'photography', label: 'Photography', emoji: '📷', color: '#D5CBE6' },
  ],
};

const kindSchema = z.enum(['here', 'there']);
const color = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #86C4A8');
export const createCategorySchema = z.object({
  kind: kindSchema,
  label: z.string().trim().min(2).max(24),
  emoji: z.string().trim().max(8).default(''),
  color: color.optional(),
});
export const updateCategorySchema = z.object({
  label: z.string().trim().min(2).max(24).optional(),
  emoji: z.string().trim().max(8).optional(),
  color: color.optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
});
export const listQuery = z.object({ kind: kindSchema.optional() });

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

@Injectable()
export class CategoriesService implements OnModuleInit {
  // read on every activity create and every app start, changed rarely: forgotten at once when an admin saves
  private readonly cache = new TtlCache<Row[]>(Number(process.env.CATEGORY_CACHE_MS ?? 15_000), 1);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    // a database that has none yet starts with the categories the app always had
    for (const kind of ['here', 'there'] as const) {
      if ((await this.prisma.category.count({ where: { kind } })) > 0) continue;
      await this.prisma.category.createMany({ data: SEED[kind].map((c, position) => ({ kind, position, ...c })), skipDuplicates: true });
    }
    // the built-in ones get the pictures the app has always shown, unless an admin has already touched them (changed or removed the picture)
    for (const kind of ['here', 'there'] as const) {
      for (const s of SEED[kind]) {
        const row = await this.prisma.category.findUnique({ where: { kind_key: { kind, key: s.key } } });
        if (!row || row.imageUrl || row.updatedById) continue;
        const data = seedPicture(kind, s.key);
        if (!data) continue;
        await this.prisma.categoryImage.upsert({ where: { categoryId: row.id }, create: { categoryId: row.id, data: new Uint8Array(data), mime: 'image/webp' }, update: { data: new Uint8Array(data), mime: 'image/webp' } });
        await this.prisma.category.update({ where: { id: row.id }, data: { imageUrl: `/v1/categories/${row.id}/image?v=${Date.now()}` } });
      }
    }
    this.changed();
  }

  async all(): Promise<Row[]> {
    return this.cache.get('all', () => this.prisma.category.findMany({ orderBy: [{ kind: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }] }));
  }
  private changed() {
    this.cache.forget('all');
  }

  /** The categories people may choose today, in the order an admin put them. */
  async active(kind: CategoryKind) {
    return (await this.all()).filter((c) => c.kind === kind && c.active);
  }
  /** Refuses a category an admin has not made, or has turned off. */
  async assertChoosable(kind: CategoryKind, key: string) {
    if (!(await this.active(kind)).some((c) => c.key === key)) throw E.badRequest('INVALID_CATEGORY', 'That category is not available');
  }
  /** Keys of the categories a search word may mean ("coffee" finds the Coffee ones): every one ever made, turned off or not. */
  async matching(kind: CategoryKind, word: string) {
    return (await this.all()).filter((c) => c.kind === kind && (c.key.startsWith(word) || word.startsWith(c.key) || c.label.toLowerCase().startsWith(word))).map((c) => c.key);
  }

  prismaImage(id: string) {
    return this.prisma.categoryImage.findUnique({ where: { categoryId: id } });
  }

  async list(kind?: CategoryKind) {
    const rows = (await this.all()).filter((c) => !kind || c.kind === kind);
    const [acts, trips] = await Promise.all([
      this.prisma.activity.groupBy({ by: ['category'], _count: { _all: true } }),
      this.prisma.trip.findMany({ select: { tags: true } }),
    ]);
    const used = new Map<string, number>();
    for (const a of acts) used.set(`here:${a.category}`, a._count._all);
    for (const t of trips) for (const tag of t.tags ? t.tags.split(',') : []) used.set(`there:${tag}`, (used.get(`there:${tag}`) ?? 0) + 1);
    return { items: rows.map((c) => ({ ...c, uses: used.get(`${c.kind}:${c.key}`) ?? 0 })) };
  }

  async create(actor: User, body: unknown) {
    const dto = parse(createCategorySchema, body);
    const rows = (await this.all()).filter((c) => c.kind === dto.kind);
    if (rows.some((r) => r.label.toLowerCase() === dto.label.toLowerCase())) throw E.conflict('CATEGORY_EXISTS', 'There is already a category with that name');
    const base = slug(dto.label) || 'category';
    let key = base;
    for (let n = 2; rows.some((r) => r.key === key); n++) key = `${base}-${n}`;
    const created = await this.prisma.category.create({
      data: { kind: dto.kind, key, label: dto.label, emoji: dto.emoji, color: dto.color ?? '#CFE0D6', position: rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0, updatedById: actor.id },
    });
    this.changed();
    await this.audit.log(actor.id, 'category.created', 'category', created.id, { kind: dto.kind, key, label: dto.label });
    return { id: created.id, key };
  }

  async update(actor: User, id: string, body: unknown) {
    const dto = parse(updateCategorySchema, body);
    const all = await this.all();
    const row = all.find((c) => c.id === id);
    if (!row) throw E.notFound('Category');
    if (dto.label && all.some((c) => c.kind === row.kind && c.id !== id && c.label.toLowerCase() === dto.label!.toLowerCase())) throw E.conflict('CATEGORY_EXISTS', 'There is already a category with that name');
    if (dto.active === false && row.active && (await this.active(row.kind as CategoryKind)).length <= 1) throw E.conflict('LAST_CATEGORY', 'Keep at least one category turned on');
    const data = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (Object.keys(data).length === 0) return { id };
    await this.prisma.category.update({ where: { id }, data: { ...data, updatedById: actor.id } });
    this.changed();
    await this.audit.log(actor.id, 'category.updated', 'category', id, { key: row.key, kind: row.kind, after: data });
    return { id };
  }

  /** The picture of a category: decoded, rotated, cropped square, shrunk and kept as webp (which also drops camera and GPS data). */
  private async storeImage(id: string, input: unknown) {
    if (!Buffer.isBuffer(input) || input.length === 0) throw E.badRequest('NO_IMAGE', 'Send the picture as the request body (image/jpeg, image/png or image/webp).');
    if (input.length > MAX_UPLOAD_BYTES) throw E.badRequest('IMAGE_TOO_LARGE', 'That picture is too large (6 MB at most).');
    let data: Buffer;
    try {
      const img = sharp(input, { limitInputPixels: 50_000_000 });
      const meta = await img.metadata();
      if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('format');
      data = await img.rotate().resize(IMAGE_PX, IMAGE_PX, { fit: 'cover', position: 'centre' }).webp({ quality: 80 }).toBuffer();
    } catch {
      throw E.badRequest('INVALID_IMAGE', 'We could not read that picture. Use a JPEG, PNG or WebP image.');
    }
    await this.prisma.categoryImage.upsert({ where: { categoryId: id }, create: { categoryId: id, data: new Uint8Array(data), mime: 'image/webp' }, update: { data: new Uint8Array(data), mime: 'image/webp' } });
    return `/v1/categories/${id}/image?v=${Date.now()}`;
  }

  async setImage(actor: User, id: string, input: unknown) {
    const row = (await this.all()).find((c) => c.id === id);
    if (!row) throw E.notFound('Category');
    const imageUrl = await this.storeImage(id, input);
    await this.prisma.category.update({ where: { id }, data: { imageUrl, updatedById: actor.id } });
    this.changed();
    await this.audit.log(actor.id, 'category.image_set', 'category', id, { key: row.key, kind: row.kind });
    return { imageUrl };
  }

  async clearImage(actor: User, id: string) {
    const row = (await this.all()).find((c) => c.id === id);
    if (!row) throw E.notFound('Category');
    await this.prisma.categoryImage.deleteMany({ where: { categoryId: id } });
    await this.prisma.category.update({ where: { id }, data: { imageUrl: null, updatedById: actor.id } });
    this.changed();
    await this.audit.log(actor.id, 'category.image_removed', 'category', id, { key: row.key, kind: row.kind });
    return { imageUrl: null };
  }

  /** Only a category nothing has used can be removed; anything else is turned off. */
  async remove(actor: User, id: string) {
    const row = (await this.all()).find((c) => c.id === id);
    if (!row) throw E.notFound('Category');
    const { items } = await this.list(row.kind as CategoryKind);
    if ((items.find((c) => c.id === id)?.uses ?? 0) > 0) throw E.conflict('CATEGORY_IN_USE', 'Activities or trips use it. Turn it off instead.');
    if (row.active && (await this.active(row.kind as CategoryKind)).length <= 1) throw E.conflict('LAST_CATEGORY', 'Keep at least one category turned on');
    await this.prisma.categoryImage.deleteMany({ where: { categoryId: id } });
    await this.prisma.category.delete({ where: { id } });
    this.changed();
    await this.audit.log(actor.id, 'category.removed', 'category', id, { key: row.key, kind: row.kind, label: row.label });
    return { ok: true };
  }
}

@Controller('v1/categories')
export class CategoriesPublicController {
  constructor(private readonly categories: CategoriesService) {}

  /** The categories the apps offer: `here` for activities, `there` for trips. Only the turned-on ones, in the admin's order. */
  @Get()
  async list(@Query() query: unknown) {
    const { kind } = parse(listQuery, query);
    const kinds: CategoryKind[] = kind ? [kind] : ['here', 'there'];
    const out: Record<string, { key: string; label: string; emoji: string; color: string; imageUrl: string | null }[]> = {};
    for (const k of kinds) out[k] = (await this.categories.active(k)).map(({ key, label, emoji, color, imageUrl }) => ({ key, label, emoji, color, imageUrl }));
    return out;
  }

  /** The picture itself. Public so it works as a plain image address; the address carries ?v=<upload time>, so it never changes. */
  @Public()
  @Get(':id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const p = await this.categories.prismaImage(id);
    if (!p) throw E.notFound('Picture');
    res.set({ 'Content-Type': p.mime, 'Cache-Control': 'public, max-age=604800, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' });
    res.send(Buffer.from(p.data));
  }
}

@Controller('v1/admin/categories')
export class CategoriesAdminController {
  constructor(private readonly categories: CategoriesService) {}

  @Staff('admin')
  @Get()
  list(@Query() query: unknown) {
    return this.categories.list(parse(listQuery, query).kind);
  }

  @Staff('admin')
  @Post()
  create(@CurrentUser() me: User, @Body() body: unknown) {
    return this.categories.create(me, body);
  }

  @Staff('admin')
  @Patch(':id')
  update(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.categories.update(me, id, body);
  }

  /** Body is the raw image bytes (Content-Type image/*). */
  @Staff('admin')
  @Put(':id/image')
  setImage(@CurrentUser() me: User, @Param('id') id: string, @Req() req: Request) {
    return this.categories.setImage(me, id, req.body);
  }

  @Staff('admin')
  @Delete(':id/image')
  clearImage(@CurrentUser() me: User, @Param('id') id: string) {
    return this.categories.clearImage(me, id);
  }

  @Staff('admin')
  @Delete(':id')
  remove(@CurrentUser() me: User, @Param('id') id: string) {
    return this.categories.remove(me, id);
  }
}
