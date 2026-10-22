import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ActivitiesController } from './activities/activities.controller';
import { ActivitiesService } from './activities/activities.service';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { ContactVerificationService } from './auth/contact-verification.service';
import { GuestService } from './auth/guest.service';
import { AuditService } from './common/audit.service';
import { EmailService } from './common/email.service';
import { SmsService } from './common/sms.service';
import { AuthGuard } from './common/auth';
import { PrismaService } from './common/prisma.service';
import { RateLimiter } from './common/rate-limiter';
import { ConversationsController, ConversationsService } from './conversations/conversations.controller';
import { PhotoController } from './profile/photo.controller';
import { LiveService } from './common/live.service';
import { PushService } from './common/push.service';
import { NotificationsController } from './notifications/notifications.controller';
import { PushController } from './notifications/push.controller';
import { NotificationsService } from './notifications/notifications.service';
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
    ActivitiesController,
    TripsController,
    ConversationsController,
    NotificationsController,
    PushController,
    SafetyController,
    VerificationController,
    PhotoController,
    AdminController,
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
    PushService,
    NotificationsService,
    SafetyService,
    VerificationService,
    ActivitiesService,
    TripsService,
    ConversationsService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PrismaService, RateLimiter],
})
export class AppModule {}
