import { Body, Controller, Get, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../common/auth';
import { PushService } from '../common/push.service';
import { parse } from '../common/validate';

const subscribeSchema = z.object({ kind: z.enum(['web', 'expo']), token: z.string().min(10).max(4000) });
const unsubscribeSchema = z.object({ token: z.string().min(10).max(4000) });

/** Where an app registers (or removes) the address its push notifications should be sent to. */
@Controller('v1/push')
export class PushController {
  constructor(private readonly push: PushService) {}

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
}
