import { Body, Controller, Get, Put } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../common/auth';
import { NotificationPrefsService } from './preference-rules';

@Controller('v1/me/notification-settings')
export class NotificationSettingsController {
  constructor(private readonly prefs: NotificationPrefsService) {}

  /** Which alert groups push to this person's phone, and their quiet hours. */
  @Get()
  get(@CurrentUser() me: User) {
    return this.prefs.get(me.id);
  }

  /** Change any of it; what is left out stays as it was. Safety and account alerts cannot be switched off. */
  @Put()
  save(@CurrentUser() me: User, @Body() body: unknown) {
    return this.prefs.save(me.id, body);
  }
}
