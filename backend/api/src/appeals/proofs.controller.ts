import { Controller, Delete, Get, Injectable, Param, Put, Req, Res } from '@nestjs/common';
import { User } from '@prisma/client';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { RegionsService } from '../regions/regions.service';

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const LONG_SIDE = 1280; // long enough to read chat text in a screenshot, small enough to stay around 100-300 KB
const ALLOWED = new Set(['jpeg', 'png', 'webp']);
/** Most photos that can go with one appeal or one dispute. */
export const MAX_PROOFS = 3;
/** Photos uploaded but not sent with anything yet (a person can have this many waiting). */
const MAX_WAITING = 6;

/**
 * Proof photos: a screenshot of a chat, say, sent with an appeal or with a dispute of a "did not come" note. Each is decoded,
 * turned upright, shrunk to 1280 px on its longest side and saved as webp, which also removes everything the camera or phone
 * wrote into it (location, device). They can show other people's messages, so they are PRIVATE: only the person who sent one
 * and the staff who handle appeals and notes can open it, never through a public address. Deleted 30 days after the decision.
 */
@Injectable()
export class ProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly regions: RegionsService,
  ) {}

  /** The photos the person sent with these ids and has not used yet: all of them or an error (nothing is half attached). */
  async claimable(userId: string, ids: string[] | undefined) {
    const list = [...new Set(ids ?? [])];
    if (list.length === 0) return [];
    if (list.length > MAX_PROOFS) throw E.badRequest('TOO_MANY_PROOFS', `You can add up to ${MAX_PROOFS} photos`);
    const found = await this.prisma.proofImage.findMany({ where: { id: { in: list }, userId, appealId: null, markId: null }, select: { id: true } });
    if (found.length !== list.length) throw E.notFound('Photo');
    return list;
  }

  async attach(ids: string[], to: { appealId: string } | { markId: string }) {
    if (ids.length) await this.prisma.proofImage.updateMany({ where: { id: { in: ids } }, data: to });
  }

  /** The ids of the photos on each appeal or note, oldest first (the images are opened one by one, with a sign-in). */
  async idsFor(by: 'appealId' | 'markId', owners: string[]) {
    const out = new Map<string, string[]>();
    if (owners.length === 0) return out;
    const rows = await this.prisma.proofImage.findMany({ where: { [by]: { in: owners } }, select: { id: true, appealId: true, markId: true }, orderBy: { createdAt: 'asc' } });
    for (const r of rows) {
      const key = (by === 'appealId' ? r.appealId : r.markId) as string;
      out.set(key, [...(out.get(key) ?? []), r.id]);
    }
    return out;
  }

  async view(actor: User, id: string) {
    const p = await this.prisma.proofImage.findUnique({ where: { id } });
    if (!p) throw E.notFound('Photo');
    if (p.userId === actor.id) return p;
    const staff = actor.role === 'admin' || (actor.role === 'staff' && actor.staffPermissions.includes('reports'));
    if (!staff) throw E.notFound('Photo'); // not shown to anyone else, not even that it exists
    // staff of one area see only the photos of people in it
    if (actor.role === 'staff' && actor.adminRegionKey && p.appealId) {
      const scope = await this.regions.scopeOf(actor);
      if (scope && !(await this.prisma.user.findFirst({ where: { id: p.userId, ...this.regions.peopleWhere(scope) }, select: { id: true } }))) throw E.notFound('Photo');
    }
    return p;
  }
}

@Controller('v1')
export class ProofsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
    private readonly proofs: ProofsService,
  ) {}

  /** Body is the raw image bytes (Content-Type image/*). The answer is the photo's id, to send with the appeal or the dispute. */
  @Put('me/proofs')
  async upload(@CurrentUser() u: User, @Req() req: Request) {
    this.limiter.hit(`proof:${u.id}`, 20, 3600_000);
    const input = req.body;
    if (!Buffer.isBuffer(input) || input.length === 0) throw E.badRequest('NO_IMAGE', 'Send the picture as the request body (image/jpeg, image/png or image/webp).');
    if (input.length > MAX_UPLOAD_BYTES) throw E.badRequest('IMAGE_TOO_LARGE', 'That picture is too large (6 MB at most).');
    if ((await this.prisma.proofImage.count({ where: { userId: u.id, appealId: null, markId: null } })) >= MAX_WAITING) throw E.badRequest('TOO_MANY_PROOFS', 'Send or remove the photos you already added first');

    let data: Buffer;
    try {
      const img = sharp(input, { limitInputPixels: 50_000_000 });
      const meta = await img.metadata();
      if (!meta.format || !ALLOWED.has(meta.format)) throw new Error('format');
      data = await img.rotate().resize(LONG_SIDE, LONG_SIDE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    } catch {
      throw E.badRequest('INVALID_IMAGE', 'We could not read that picture. Use a JPEG, PNG or WebP image.');
    }
    const p = await this.prisma.proofImage.create({ data: { userId: u.id, data: new Uint8Array(data), mime: 'image/webp' }, select: { id: true } });
    return { id: p.id };
  }

  /** Takes back a photo that has not been sent yet. */
  @Delete('me/proofs/:id')
  async remove(@CurrentUser() u: User, @Param('id') id: string) {
    const { count } = await this.prisma.proofImage.deleteMany({ where: { id, userId: u.id, appealId: null, markId: null } });
    if (!count) throw E.notFound('Photo');
    return { ok: true };
  }

  /** The photo itself, for the person who sent it and the staff who look at the appeal. Never cached or public. */
  @Get('proofs/:id')
  async photo(@CurrentUser() u: User, @Param('id') id: string, @Res() res: Response) {
    const p = await this.proofs.view(u, id);
    res.set({ 'Content-Type': p.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-site' });
    res.send(Buffer.from(p.data));
  }
}
