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
  favorites(@CurrentUser() me: User) {
    return this.activities.myFavorites(me);
  }

  @Get('me/activities')
  mine(@CurrentUser() me: User) {
    return this.activities.mine(me);
  }
}
