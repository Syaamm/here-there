import { Controller, Get, Headers, Ip, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { ACTIVITY_SHAREABLE, activityLines, androidAssociation, appleAssociation, renderSharePage, shareConfig, TRIP_SHAREABLE, tripLines, type ShareItem } from './share.page';

/**
 * Shared links: https://<our domain>/a/<id> (an activity) and /t/<id> (a trip). The page sends people to the app, or to the
 * App Store / Google Play when they do not have it (see share.page.ts). The two .well-known files are what make an iPhone and
 * an Android phone open the app straight from the link, without ever showing this page.
 */
@Controller()
export class ShareController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
  ) {}

  private send(res: Response, status: number, html: string) {
    res
      .status(status)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        // no scripts, no images from elsewhere, nothing that can frame it: the page is plain text and links
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex',
        // a minute is plenty: a plan that is cancelled stops being described soon after
        'Cache-Control': 'public, max-age=60',
        Vary: 'User-Agent',
      })
      .send(html);
  }

  private visit(ip: string) {
    this.limiter.hit(`share:${ip}`, 120, 60_000);
  }

  @Public()
  @Get('a/:id')
  async activity(@Param('id') id: string, @Headers('user-agent') ua: string | undefined, @Ip() ip: string, @Res() res: Response) {
    this.visit(ip);
    const cfg = shareConfig();
    const a = await this.prisma.activity.findUnique({ where: { id: id.slice(0, 64) }, select: { id: true, title: true, city: true, startsAt: true, status: true, visibility: true } });
    // an invite-only plan is described to no one outside it
    const item: ShareItem = a && a.visibility === 'public' && ACTIVITY_SHAREABLE.includes(a.status) ? { kind: 'activity', id: a.id, title: a.title, lines: activityLines(a, cfg.timeZone) } : null;
    const page = renderSharePage('activity', id.slice(0, 64), item, ua, cfg);
    this.send(res, page.status, page.html);
  }

  @Public()
  @Get('t/:id')
  async trip(@Param('id') id: string, @Headers('user-agent') ua: string | undefined, @Ip() ip: string, @Res() res: Response) {
    this.visit(ip);
    const cfg = shareConfig();
    const t = await this.prisma.trip.findUnique({ where: { id: id.slice(0, 64) }, select: { id: true, title: true, destination: true, dateStart: true, dateEnd: true, status: true } });
    const item: ShareItem = t && TRIP_SHAREABLE.includes(t.status) ? { kind: 'trip', id: t.id, title: t.title, lines: tripLines(t, cfg.timeZone) } : null;
    const page = renderSharePage('trip', id.slice(0, 64), item, ua, cfg);
    this.send(res, page.status, page.html);
  }

  @Public()
  @Get('.well-known/apple-app-site-association')
  apple(@Res() res: Response) {
    const body = appleAssociation();
    if (!body) return res.status(404).json({ statusCode: 404, code: 'NOT_FOUND', message: 'Not set up yet' });
    return res.status(200).set({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }).send(JSON.stringify(body));
  }

  @Public()
  @Get('.well-known/assetlinks.json')
  android(@Res() res: Response) {
    const body = androidAssociation();
    if (!body) return res.status(404).json({ statusCode: 404, code: 'NOT_FOUND', message: 'Not set up yet' });
    return res.status(200).set({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }).send(JSON.stringify(body));
  }
}
