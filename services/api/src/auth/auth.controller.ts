import { Body, Controller, Get, Ip, Param, Patch, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { VerificationService } from '../verification/verification.service';

const csv = (a: string[]) => a.join(',');
const list = (s: string) => (s ? s.split(',') : []);

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(2).max(40),
  homeCity: z.string().trim().max(60).optional(),
  adultConfirmed: z.literal(true, { error: 'You must confirm you are 18 or older' }),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().min(1),
});

const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  homeCity: z.string().trim().max(60).nullable().optional(),
  languages: z.array(z.string().trim().min(2).max(20)).max(8).optional(),
  interests: z.array(z.string().trim().min(2).max(24)).max(15).optional(),
  bio: z.string().trim().max(300).nullable().optional(),
  photoUrl: z.url().nullable().optional(),
});

type UserWithProfile = User & { profile: { displayName: string; homeCity: string | null; languages: string; interests: string; bio: string | null; photoUrl: string | null } | null };

function me(u: UserWithProfile) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    adultConfirmed: u.adultConfirmed,
    eligibility: u.eligibility,
    profile: u.profile && {
      displayName: u.profile.displayName,
      homeCity: u.profile.homeCity,
      languages: list(u.profile.languages),
      interests: list(u.profile.interests),
      bio: u.profile.bio,
      photoUrl: u.profile.photoUrl,
    },
  };
}

@Controller('v1')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly limiter: RateLimiter,
    private readonly verification: VerificationService,
  ) {}

  private token(userId: string) {
    return this.jwt.signAsync({ sub: userId });
  }

  @Public()
  @Post('auth/register')
  async register(@Body() body: unknown, @Ip() ip: string) {
    this.limiter.hit(`register:${ip}`, Number(process.env.REGISTER_LIMIT_PER_HOUR ?? 10), 60 * 60 * 1000);
    const dto = parse(registerSchema, body);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } }))
      throw E.conflict('EMAIL_TAKEN', 'An account with this email already exists');
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, Number(process.env.BCRYPT_ROUNDS ?? 12)),
        adultConfirmed: true,
        profile: { create: { displayName: dto.displayName, homeCity: dto.homeCity } },
      },
      include: { profile: true },
    });
    return { token: await this.token(user.id), user: me(user) };
  }

  @Public()
  @Post('auth/login')
  async login(@Body() body: unknown, @Ip() ip: string) {
    const dto = parse(loginSchema, body);
    this.limiter.hit(`login:${ip}:${dto.email}`, 10, 15 * 60 * 1000);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email }, include: { profile: true } });
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) throw E.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (user.state === 'suspended') throw E.forbidden('ACCOUNT_SUSPENDED', 'This account is suspended');
    return { token: await this.token(user.id), user: me(user) };
  }

  @Get('me')
  async getMe(@CurrentUser() u: User) {
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { profile: true } });
    return me(full);
  }

  @Patch('me/profile')
  async updateProfile(@CurrentUser() u: User, @Body() body: unknown) {
    const dto = parse(profileSchema, body);
    const bad = contentProblem(dto.bio) ?? contentProblem(dto.displayName);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    await this.prisma.profile.update({
      where: { userId: u.id },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.homeCity !== undefined && { homeCity: dto.homeCity }),
        ...(dto.languages && { languages: csv(dto.languages) }),
        ...(dto.interests && { interests: csv(dto.interests) }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.photoUrl !== undefined && { photoUrl: dto.photoUrl }),
      },
    });
    return this.getMe(u);
  }

  @Post('me/verification')
  startVerification(@CurrentUser() u: User) {
    return this.verification.start(u);
  }

  /** Public profile: no email, no internal fields, only the verified-adult badge. */
  @Get('users/:id')
  async publicProfile(@Param('id') id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, include: { profile: true } });
    if (!u || u.state !== 'active' || !u.profile) throw E.notFound('User');
    const [hosted, joined] = await Promise.all([
      this.prisma.activity.count({ where: { hostId: id, status: { notIn: ['cancelled', 'draft'] }, endsAt: { lt: new Date() } } }),
      this.prisma.activityMembership.count({ where: { userId: id, role: 'attendee', state: 'approved', activity: { endsAt: { lt: new Date() } } } }),
    ]);
    return {
      id: u.id,
      displayName: u.profile.displayName,
      homeCity: u.profile.homeCity,
      languages: list(u.profile.languages),
      interests: list(u.profile.interests),
      bio: u.profile.bio,
      photoUrl: u.profile.photoUrl,
      verifiedAdult: u.eligibility === 'verified',
      stats: { activitiesHosted: hosted, activitiesJoined: joined },
    };
  }
}
