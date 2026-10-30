import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AccountController, AccountService } from './account/account.controller';
import { ActivitiesController } from './activities/activities.controller';
import { ActivitiesService } from './activities/activities.service';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { MfaController, MfaService } from './auth/mfa.controller';
import { SocialService } from './auth/social.service';
import { ContactVerificationService } from './auth/contact-verification.service';
import { GuestService } from './auth/guest.service';
import { AuditService } from './common/audit.service';
import { EmailService } from './common/email.service';
import { SmsService } from './common/sms.service';
import { AuthGuard } from './common/auth';
import { PrismaService } from './common/prisma.service';
import { RateLimiter } from './common/rate-limiter';
import { DocsController } from './docs/docs.controller';
import { PlacesController } from './places/places.controller';
import { AppealsController, AppealsService } from './appeals/appeals.controller';
import { MatchingController, MatchingService } from './matching/matching.controller';
import { ShareController } from './share/share.controller';
import { RegionsAdminController, RegionsPublicController, RegionsService } from './regions/regions.service';
import { TripPlanController, TripPlanService } from './trips/trip-plan.controller';
import { ModerationController, ModerationService } from './moderation/moderation.controller';
import { OnCallController, OnCallService } from './moderation/oncall';
import { DraftsController } from './drafts/drafts.controller';
import { ReliabilityController, ReliabilityService } from './reliability/reliability.controller';
import { RetentionController, RetentionService } from './retention/retention.service';
import { ConversationsController, ConversationsService } from './conversations/conversations.controller';
import { PhotoController } from './profile/photo.controller';
import { LiveService } from './common/live.service';
import { EventBus, LiveSubscriber } from './common/events';
import { SessionService } from './auth/session.service';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { JobsService } from './common/jobs.service';
import { PushService } from './common/push.service';
import { NotificationsController } from './notifications/notifications.controller';
import { PushController } from './notifications/push.controller';
import { NotificationsService } from './notifications/notifications.service';
import { NotificationSettingsController } from './notifications/preferences';
import { NotificationPrefsService } from './notifications/preference-rules';
import { FollowsController } from './safety/follows.controller';
import { SafetyController } from './safety/safety.controller';
import { SafetyService } from './safety/safety.service';
import { TripsController } from './trips/trips.controller';
import { TripsService } from './trips/trips.service';
import { VerificationController } from './verification/verification.controller';
import { VerificationService } from './verification/verification.service';

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  return 'dev-only-secret-change-me';
}

@Global()
@Module({
  imports: [JwtModule.register({ global: true, secret: jwtSecret(), signOptions: { expiresIn: '7d' } })],
  controllers: [
    AuthController,
    AccountController,
    MfaController,
    RetentionController,
    ReliabilityController,
    DraftsController,
    ModerationController,
    OnCallController,
    RegionsPublicController,
    RegionsAdminController,
    MatchingController,
    TripPlanController,
    ShareController,
    AppealsController,
    ActivitiesController,
    PlacesController,
    TripsController,
    ConversationsController,
    NotificationsController,
    NotificationSettingsController,
    PushController,
    SafetyController,
    FollowsController,
    VerificationController,
    PhotoController,
    AdminController,
    DocsController,
  ],
  providers: [
    PrismaService,
    RateLimiter,
    AuditService,
    EmailService,
    SmsService,
    ContactVerificationService,
    GuestService,
    LiveService,
    EventBus,
    LiveSubscriber,
    JobsService,
    PushService,
    NotificationsService,
    NotificationPrefsService,
    OnCallService,
    RegionsService,
    SafetyService,
    VerificationService,
    ActivitiesService,
    TripsService,
    ConversationsService,
    AccountService,
    MfaService,
    SessionService,
    SocialService,
    RetentionService,
    ReliabilityService,
    AppealsService,
    ModerationService,
    MatchingService,
    TripPlanService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [PrismaService, RateLimiter],
})
export class AppModule {}
