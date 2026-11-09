import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/auth';
import { PushService } from '../common/push.service';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';

export const subscribeSchema = z.object({ kind: z.enum(['web', 'expo', 'fcm']), token: z.string().min(10).max(4000) });
export const unsubscribeSchema = z.object({ token: z.string().min(10).max(4000) });

/** Where an app registers (or removes) the address its push notifications should be sent to. */
@Controller('v1/push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly limiter: RateLimiter,
  ) {}

  /** The public key a browser needs to subscribe to push from this server. */
  @Get('config')
  config() {
    return { publicKey: this.push.publicKey() };
  }

  @Post('subscribe')
  async subscribe(@CurrentUser() me: User, @Body() body: unknown) {
    const dto = parse(subscribeSchema, body);
    await this.push.subscribe(me.id, dto.kind, dto.token);
    return { ok: true };
  }

  @Post('unsubscribe')
  async unsubscribe(@CurrentUser() me: User, @Body() body: unknown) {
    const dto = parse(unsubscribeSchema, body);
    await this.push.unsubscribe(me.id, dto.token);
    return { ok: true };
  }

  /**
   * A signed-out device stops getting pushes. No sign-in needed: the app also signs out on its own (the sign-in expired, the
   * account was suspended), when it can no longer prove who it is. The device's push address is the proof: only that device
   * (and this server) knows it, and all this can do is stop pushes to it.
   */
  @Public()
  @Post('forget')
  async forget(@Ip() ip: string, @Body() body: unknown) {
    this.limiter.hit(`push-forget:${ip}`, 30, 15 * 60 * 1000);
    const dto = parse(unsubscribeSchema, body);
    await this.push.forget(dto.token);
    return { ok: true };
  }
}
