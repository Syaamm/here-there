import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../common/auth';
import { ActivitiesService } from './activities.service';

@Controller('v1')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get('activities')
  list(@CurrentUser() me: User, @Query() q: unknown) {
    return this.activities.list(me, q);
  }

  @Post('activities')
  create(@CurrentUser() me: User, @Body() body: unknown) {
    return this.activities.create(me, body);
  }

  @Get('activities/:id')
  detail(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.detail(me, id);
  }

  @Patch('activities/:id')
  update(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.activities.update(me, id, body);
  }

  @Post('activities/:id/cancel')
  cancel(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.cancel(me, id);
  }

  @Post('activities/:id/reconfirm')
  reconfirm(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.reconfirm(me, id);
  }

  @Post('activities/:id/handover')
  offerHandover(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.activities.offerHandover(me, id, body);
  }

  @Delete('activities/:id/handover')
  withdrawHandover(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.withdrawHandover(me, id);
  }

  @Post('activities/:id/handover/answer')
  answerHandover(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.activities.answerHandover(me, id, body);
  }

  @Post('activities/:id/attendance')
  attendance(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.activities.confirmAttendance(me, id, body);
  }

  @Post('activities/:id/requests')
  request(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.activities.request(me, id, body);
  }

  @Post('activities/:id/appeal')
  appeal(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.activities.appealDecline(me, id, body);
  }

  @Get('activities/:id/requests')
  requests(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.listRequests(me, id);
  }

  @Post('activities/:id/requests/:requestId/decision')
  decide(
    @CurrentUser() me: User,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    return this.activities.decide(me, id, requestId, body);
  }

  @Delete('activities/:id/requests/mine')
  withdraw(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.withdraw(me, id);
  }

  @Post('activities/:id/leave')
  leave(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.leave(me, id);
  }

  @Delete('activities/:id/members/:userId')
  removeMember(@CurrentUser() me: User, @Param('id') id: string, @Param('userId') userId: string) {
    return this.activities.removeMember(me, id, userId);
  }

  @Post('activities/:id/favorite')
  favorite(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.favorite(me, id, true);
  }

  @Delete('activities/:id/favorite')
  unfavorite(@CurrentUser() me: User, @Param('id') id: string) {
    return this.activities.favorite(me, id, false);
  }

  @Get('me/favorites')
  favorites(@CurrentUser() me: User, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.activities.myFavorites(me, limit, cursor);
  }

  @Get('me/activities')
  mine(@CurrentUser() me: User) {
    return this.activities.mine(me);
  }

  /** The plans on now or starting within `hours` (Home's Next up). */
  @Get('me/activities/soon')
  soon(@CurrentUser() me: User, @Query('hours') hours?: string) {
    return this.activities.soon(me, hours);
  }

  /** Your open plans overlapping a time window (the clash warning before joining). */
  @Get('me/activities/overlapping')
  overlapping(@CurrentUser() me: User, @Query('from') from?: string, @Query('to') to?: string, @Query('exclude') exclude?: string) {
    return this.activities.overlapping(me, from, to, exclude);
  }

  /** One tab of "My activities" (mine | pending | rejected | all), a page at a time, plus how many each tab holds. */
  @Get('me/activities/page')
  minePage(@CurrentUser() me: User, @Query('tab') tab?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.activities.minePage(me, tab, limit, cursor);
  }
}
