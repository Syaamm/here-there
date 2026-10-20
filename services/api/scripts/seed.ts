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
      emailVerifiedAt: new Date(),
      adultVerifiedAt: new Date(),
      verifiedUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
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

  // Sample activities for tonight and tomorrow until noon. Re-running tops the feed up whenever it has run low,
  // so the demo never shows an empty HERE feed. Times are local to the machine running the seed.
  const alex = await user('alex@demo.local', 'Alex', 'demo-password-1');
  const upcoming = await prisma.activity.count({ where: { status: 'published', startsAt: { gt: new Date() } } });
  if (upcoming < 6) {
    const at = (dayOffset: number, h: number, m = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + dayOffset);
      d.setHours(h, m, 0, 0);
      return d;
    };
    // a "tonight" slot that has already passed slides to later in the evening instead of being skipped
    const soonest = new Date(Date.now() + 25 * 60 * 1000);
    const tonight = (h: number, m = 0) => {
      const d = at(0, h, m);
      return d > soonest ? d : new Date(soonest.getTime() + (h - 17) * 20 * 60 * 1000);
    };
    const mk = async (hostId: string, title: string, category: string, venueName: string, lat: number, lng: number, startsAt: Date, durationH: number, capacity: number, description: string) => {
      const a = await prisma.activity.create({
        data: {
          hostId, title, category, city: 'Milan', cityKey: 'milan', venueName, lat, lng,
          startsAt, endsAt: new Date(startsAt.getTime() + durationH * 3600 * 1000), capacity, status: 'published', description,
        },
      });
      await prisma.activityMembership.create({ data: { activityId: a.id, userId: hostId, role: 'host' } });
      await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
    };
    // tonight
    await mk(sofia.id, 'After-work aperitivo', 'drinks', 'Bar in Brera (Brera)', 45.472, 9.188, tonight(18, 30), 2, 6, 'Casual drinks and conversation with new people. English and Italian welcome.');
    await mk(marco.id, 'Evening running club', 'sports', 'Parco Sempione (Sempione)', 45.472, 9.171, tonight(19, 0), 1.5, 10, 'Easy 5 km loop, all paces. We finish with a stretch by the arch.');
    await mk(alex.id, 'Street food crawl', 'food', 'Corso Garibaldi (Centro)', 45.481, 9.184, tonight(20, 0), 2.5, 8, 'Three stops, small plates, split the bill. Vegetarian options included.');
    await mk(sofia.id, 'Gallery late opening', 'culture', 'Fondazione in Navigli (Navigli)', 45.45, 9.17, tonight(20, 30), 3, 6, 'Free late opening, then a drink nearby. No art knowledge needed.');
    // tomorrow, until noon
    await mk(marco.id, 'Sunrise run by the canal', 'sports', 'Navigli canal (Navigli)', 45.45, 9.17, at(1, 7, 0), 1, 8, 'Relaxed pace along the canal, coffee afterwards for anyone who wants it.');
    await mk(alex.id, 'Coffee and a walk', 'coffee', 'Parco Sempione north gate (Sempione)', 45.475, 9.172, at(1, 9, 0), 1.5, 4, 'A slow morning coffee and a stroll through the park.');
    await mk(sofia.id, 'Brunch in Brera', 'food', 'Bakery cafe (Brera)', 45.472, 9.188, at(1, 10, 30), 1.5, 6, 'Long brunch table, good conversation, come hungry.');
    await mk(marco.id, 'Morning yoga in the park', 'sports', 'Giardini Pubblici (Centro)', 45.473, 9.2, at(1, 8, 0), 1, 12, 'Beginner-friendly flow on the lawn. Bring a mat or a towel.');
  }

  // Always keep a couple of plans that start within two hours, so "Happening soon" is never empty in the demo.
  const soonCount = await prisma.activity.count({ where: { status: 'published', startsAt: { gt: new Date(), lt: hours(2) } } });
  if (soonCount < 3) {
    const in5 = (min: number) => {
      const d = new Date(Date.now() + min * 60 * 1000);
      d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
      return d;
    };
    const quick = async (hostId: string, title: string, category: string, venueName: string, lat: number, lng: number, startsAt: Date, capacity: number, description: string) => {
      const a = await prisma.activity.create({
        data: { hostId, title, category, city: 'Milan', cityKey: 'milan', venueName, lat, lng, startsAt, endsAt: new Date(+startsAt + 90 * 60 * 1000), capacity, status: 'published', description },
      });
      await prisma.activityMembership.create({ data: { activityId: a.id, userId: hostId, role: 'host' } });
      await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
    };
    await quick(alex.id, 'Quick espresso break', 'coffee', 'Bar near Duomo (Centro)', 45.464, 9.19, in5(40), 4, 'Short and friendly: one espresso, good company.');
    await quick(sofia.id, 'Aperitivo on the terrace', 'drinks', 'Rooftop bar (Navigli)', 45.45, 9.17, in5(85), 6, 'Early spritz before the evening crowd arrives.');
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
