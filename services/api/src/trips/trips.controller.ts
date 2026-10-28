import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../common/auth';
import { TripsService } from './trips.service';

@Controller('v1')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get('trips')
  search(@CurrentUser() me: User, @Query() q: unknown) {
    return this.trips.search(me, q);
  }

  @Post('trips')
  create(@CurrentUser() me: User, @Body() body: unknown) {
    return this.trips.create(me, body);
  }

  @Get('trips/:id')
  detail(@CurrentUser() me: User, @Param('id') id: string) {
    return this.trips.detail(me, id);
  }

  @Patch('trips/:id')
  update(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.trips.update(me, id, body);
  }

  @Post('trips/:id/cancel')
  cancel(@CurrentUser() me: User, @Param('id') id: string) {
    return this.trips.cancel(me, id);
  }

  @Post('trips/:id/applications')
  apply(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.trips.apply(me, id, body);
  }

  @Get('trips/:id/applications')
  applications(@CurrentUser() me: User, @Param('id') id: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.trips.listApplications(me, id, limit, cursor);
  }

  @Post('trips/:id/appeal')
  appeal(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.trips.appealDecline(me, id, body);
  }

  @Post('trips/:id/applications/:applicationId/decision')
  decide(
    @CurrentUser() me: User,
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
    @Body() body: unknown,
  ) {
    return this.trips.decide(me, id, applicationId, body);
  }

  @Delete('trips/:id/applications/mine')
  withdraw(@CurrentUser() me: User, @Param('id') id: string) {
    return this.trips.withdraw(me, id);
  }

  @Post('trips/:id/favorite')
  favorite(@CurrentUser() me: User, @Param('id') id: string) {
    return this.trips.favorite(me, id, true);
  }

  @Delete('trips/:id/favorite')
  unfavorite(@CurrentUser() me: User, @Param('id') id: string) {
    return this.trips.favorite(me, id, false);
  }

  @Get('me/favorite-trips')
  favorites(@CurrentUser() me: User) {
    return this.trips.myFavorites(me);
  }

  @Post('trips/:id/leave')
  leave(@CurrentUser() me: User, @Param('id') id: string) {
    return this.trips.leave(me, id);
  }

  @Delete('trips/:id/members/:userId')
  removeMember(@CurrentUser() me: User, @Param('id') id: string, @Param('userId') userId: string) {
    return this.trips.removeMember(me, id, userId);
  }

  @Get('me/trips')
  mine(@CurrentUser() me: User) {
    return this.trips.mine(me);
  }

  /** Your trips a page at a time (`upcoming=1`: only what is still ahead), plus how many of each kind. */
  @Get('me/trips/page')
  minePage(@CurrentUser() me: User, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('upcoming') upcoming?: string) {
    return this.trips.minePage(me, limit, cursor, upcoming);
  }
}
