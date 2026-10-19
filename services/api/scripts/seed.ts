/**
 * Local dev seed: one admin for the console + a few verified demo users with sample content.
 * Usage: npm run build && npm run seed   (ADMIN_EMAIL / ADMIN_PASSWORD override the defaults)
 * All people/places here are fictional.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const hours = (h: number) => new Date(Date.now() + h * 3600 * 1000);
const days = (d: number) => hours(d * 24);

async function user(email: string, name: string, password: string, extra: { role?: string } = {}) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      adultConfirmed: true,
      eligibility: 'verified',
      role: extra.role ?? 'user',
      profile: { create: { displayName: name, homeCity: 'Milan', languages: 'English,Italian', interests: 'coffee,culture,travel' } },
    },
  });
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@herethere.local';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'change-me-admin-1';
  await user(adminEmail, 'Admin', adminPassword, { role: 'admin' });

  const sofia = await user('sofia@demo.local', 'Sofia', 'demo-password-1');
  const marco = await user('marco@demo.local', 'Marco', 'demo-password-1');
  await user('alex@demo.local', 'Alex', 'demo-password-1');

  if ((await prisma.activity.count()) === 0) {
    const mk = async (hostId: string, title: string, category: string, venueName: string, lat: number, lng: number, startH: number, capacity: number) => {
      const a = await prisma.activity.create({
        data: {
          hostId, title, category, city: 'Milan', cityKey: 'milan', venueName, lat, lng,
          startsAt: hours(startH), endsAt: hours(startH + 2), capacity, status: 'published',
          description: 'Casual and friendly. English and Italian welcome.',
        },
      });
      await prisma.activityMembership.create({ data: { activityId: a.id, userId: hostId, role: 'host' } });
      await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
    };
    await mk(sofia.id, 'After-work aperitivo', 'drinks', 'Bar in Brera', 45.472, 9.188, 1.5, 6);
    await mk(marco.id, 'Evening running club', 'sports', 'Parco Sempione', 45.472, 9.171, 3, 10);
    await mk(sofia.id, 'Coffee and a walk', 'coffee', 'Navigli canal', 45.45, 9.17, 2, 4);
  }

  if ((await prisma.trip.count()) === 0) {
    const t = await prisma.trip.create({
      data: {
        hostId: marco.id, title: 'Tokyo & Kyoto', destination: 'Tokyo & Kyoto, Japan', destinationKey: 'tokyo & kyoto, japan',
        originCity: 'Milan', dateStart: days(40), dateEnd: days(48), dateFlexibility: 'plus_minus_3',
        budgetMin: 1200, budgetMax: 1800, budgetIncludesTransport: true, tags: 'culture,food,adventure',
        description: 'Culture, food, city walks. Final dates agreed together; everyone books independently.',
        minCapacity: 4, maxCapacity: 6, status: 'published',
      },
    });
    await prisma.tripMembership.create({ data: { tripId: t.id, userId: marco.id, role: 'organizer' } });
    await prisma.conversation.create({ data: { scopeType: 'trip', tripId: t.id } });
  }

  console.log(`Seeded. Admin: ${adminEmail} / ${adminPassword}  |  demo users: sofia|marco|alex@demo.local / demo-password-1`);
}

main().finally(() => prisma.$disconnect());
