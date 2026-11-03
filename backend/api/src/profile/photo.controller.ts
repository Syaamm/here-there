import { Controller, Delete, Get, Param, Put, Query, Req, Res } from '@nestjs/common';
import { User } from '@prisma/client';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { CurrentUser, Public } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { TtlCache } from '../common/ttl-cache';

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const SIZE = 384; // square, plenty for the biggest avatar on a tablet
const ALLOWED = new Set(['jpeg', 'png', 'webp']);

/** Small copies for lists (`?s=96` or `?s=192`), made from the stored picture the first time and kept for an hour. */
const SMALL_SIZES = new Set([96, 192]);
const small = new TtlCache<Buffer>(3600_000, 3000);

const urlFor = (userId: string) => `/v1/users/${userId}/photo?v=${Date.now()}`;

/**
 * Profile pictures. The upload is decoded, auto-rotated, cropped to a square, shrunk and re-encoded as webp, which also
 * removes all metadata (camera details, GPS location). Only that small webp is kept, in the database, one per person.
 */
@Controller('v1')
export class PhotoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Body is the raw image bytes (Content-Type image/*). */
  @Put('me/photo')
  async upload(@CurrentUser() u: User, @Req() req: Request) {
    this.limiter.hit(`photo:${u.id}`, 20, 3600_000);
    const input = req.body;
    if (!Buffer.isBuffer(input) || input.length === 0) throw E.badRequest('NO_IMAGE', 'Send the picture as the request body (image/jpeg, image/png or image/webp).');
    if (input.length > MAX_UPLOAD_BYTES) throw E.badRequest('IMAGE_TOO_LARGE', 'That picture is too large (6 MB at most).');

    let data: Buffer;
    try {
      const img = sharp(input, { limitInputPixels: 50_000_000 });
      const meta = await img.metadata();
      if (!meta.format || !ALLOWED.has(meta.format)) throw new Error('format');
      data = await img.rotate().resize(SIZE, SIZE, { fit: 'cover', position: 'centre' }).webp({ quality: 80 }).toBuffer();
    } catch {
      throw E.badRequest('INVALID_IMAGE', 'We could not read that picture. Use a JPEG, PNG or WebP image.');
    }

    await this.prisma.profilePhoto.upsert({ where: { userId: u.id }, create: { userId: u.id, data: new Uint8Array(data), mime: 'image/webp' }, update: { data: new Uint8Array(data), mime: 'image/webp' } });
    const photoUrl = urlFor(u.id);
    await this.prisma.profile.update({ where: { userId: u.id }, data: { photoUrl } });
    return { photoUrl };
  }

  @Delete('me/photo')
  async remove(@CurrentUser() u: User) {
    await this.prisma.profilePhoto.deleteMany({ where: { userId: u.id } });
    await this.prisma.profile.update({ where: { userId: u.id }, data: { photoUrl: null } });
    return { photoUrl: null };
  }

  /**
   * The picture itself. Public so it can be used as a plain image address (an <Image> cannot send a login header on
   * the web); the user id in the address is an unguessable random id that only signed-in people ever see.
   */
  @Public()
  @Get('users/:id/photo')
  async photo(@Param('id') id: string, @Query('s') s: string | undefined, @Res() res: Response) {
    const p = await this.prisma.profilePhoto.findUnique({ where: { userId: id } });
    if (!p) throw E.notFound('Photo');
    // the address carries ?v=<upload time>, so a given address never changes: the phone may keep it for a long time
    res.set({ 'Content-Type': p.mime, 'Cache-Control': 'public, max-age=604800, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' });
    const px = Number(s);
    if (SMALL_SIZES.has(px)) {
      const key = `${id}:${px}:${+p.updatedAt}`;
      res.send(await small.get(key, () => sharp(Buffer.from(p.data)).resize(px, px, { fit: 'cover' }).webp({ quality: 75 }).toBuffer()));
      return;
    }
    res.send(Buffer.from(p.data));
  }
}
