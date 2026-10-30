/**
 * Local dev seed: one admin for the console + a few verified demo users with sample content.
 * Usage: npm run build && npm run seed   (ADMIN_EMAIL / ADMIN_PASSWORD override the defaults)
 * All people/places here are fictional.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

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
      profile: { create: { displayName: name, homeCity: 'Milan', homeCityKey: 'milan', languages: 'English,Italian', interests: 'coffee,culture,travel' } },
    },
  });
}

const DEFAULT_ADMIN_PASSWORD = 'change-me-admin-1';
const STAFF_DEMO: [string, string, string, string][] = [
  ['support@herethere.local', 'Support', 'support', 'support-demo-1'],
  ['moderator@herethere.local', 'Moderator', 'moderator', 'moderator-demo-1'],
  ['trustlead@herethere.local', 'Trust lead', 'trust_lead', 'trustlead-demo-1'],
];

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@herethere.local';
  const adminPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  // On a live system this makes only the admin, and only with a password of your own: the demo people below all share
  // passwords written in this file, and the default admin password is public.
  if (process.env.NODE_ENV === 'production') {
    if (adminPassword === DEFAULT_ADMIN_PASSWORD || adminPassword.length < 14)
      throw new Error('In production, set ADMIN_PASSWORD to your own password of at least 14 characters (the default is public).');
    await user(adminEmail, 'Admin', adminPassword, { role: 'admin' });
    console.log(`Admin ${adminEmail} is ready. Demo people and sample activities are not created in production.`);
    return;
  }
  await user(adminEmail, 'Admin', adminPassword, { role: 'admin' });
  // One staff account for each other role, for trying the admin console in development (never made on a live system, see above):
  // support looks only, a moderator acts on reports and members, a trust lead also decides identity checks and reads the audit log.
  for (const [email, name, role, password] of STAFF_DEMO) await user(email, name, password, { role });

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

  // Repeated seeding must not pile up copies: keep the first of any upcoming demo activity with the same host and title.
  const upcomingAll = await prisma.activity.findMany({ where: { status: 'published', startsAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' } });
  const seen = new Set<string>();
  for (const a of upcomingAll) {
    const key = `${a.hostId}|${a.title}`;
    if (seen.has(key)) await prisma.activity.update({ where: { id: a.id }, data: { status: 'cancelled' } });
    else seen.add(key);
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
    const has = (title: string) => seen.has(`${title}`) || upcomingAll.some((x) => x.title === title && x.status === 'published');
    if (!has('Quick espresso break')) await quick(alex.id, 'Quick espresso break', 'coffee', 'Bar near Duomo (Centro)', 45.464, 9.19, in5(40), 4, 'Short and friendly: one espresso, good company.');
    if (!has('Aperitivo on the terrace')) await quick(sofia.id, 'Aperitivo on the terrace', 'drinks', 'Rooftop bar (Navigli)', 45.45, 9.17, in5(85), 6, 'Early spritz before the evening crowd arrives.');
  }

  // Make the demo activities look lived-in: a few approved attendees each (never more than the capacity allows).
  // Any extra picture dropped in seed-assets/avatars (cristiano.webp, ...) gets its own demo person, named after the file.
  const known = ['sofia', 'marco', 'alex', 'giulia', 'luca', 'anna', 'tom', 'mei', 'naomi', 'kenji'];
  const avatarFiles = existsSync(path.resolve(__dirname, '..', '..', 'seed-assets', 'avatars')) ? readdirSync(path.resolve(__dirname, '..', '..', 'seed-assets', 'avatars')) : [];
  const extraNames = avatarFiles.map((x) => /^([a-z]+)\.(jpe?g|png|webp)$/i.exec(x)?.[1]?.toLowerCase()).filter((n): n is string => !!n && !known.includes(n));
  const extras = [];
  for (const n of extraNames) extras.push(await user(`${n}@demo.local`, n[0].toUpperCase() + n.slice(1), 'demo-password-1'));
  const guests = [
    ...extras,
    await user('giulia@demo.local', 'Giulia', 'demo-password-1'),
    await user('luca@demo.local', 'Luca', 'demo-password-1'),
    await user('anna@demo.local', 'Anna', 'demo-password-1'),
    await user('tom@demo.local', 'Tom', 'demo-password-1'),
    await user('mei@demo.local', 'Mei', 'demo-password-1'),
    await user('naomi@demo.local', 'Naomi', 'demo-password-1'),
    await user('kenji@demo.local', 'Kenji', 'demo-password-1'),
  ];
  const open = await prisma.activity.findMany({ where: { status: 'published', startsAt: { gt: new Date() } }, include: { memberships: { where: { state: 'approved' } } } });
  for (const [i, a] of open.entries()) {
    // demo data should never leave an activity full: free two places by dropping demo guests if needed
    let kept = a.memberships;
    for (const m of [...a.memberships].reverse()) {
      if (kept.length <= a.capacity - 2) break;
      if (guests.some((g) => g.id === m.userId)) {
        await prisma.activityMembership.delete({ where: { id: m.id } });
        kept = kept.filter((k) => k.id !== m.id);
      }
    }
    const have = new Set(kept.map((m) => m.userId));
    const want = Math.min(a.capacity - 2, [3, 4, 2, 5, 1, 3, 2, 4][i % 8]) - (have.size - 1);
    for (const g of guests) {
      if (want <= 0 || have.size >= a.capacity) break;
      if (have.has(g.id) || g.id === a.hostId) continue;
      await prisma.activityMembership.create({ data: { activityId: a.id, userId: g.id, role: 'attendee', state: 'approved' } });
      have.add(g.id);
      if (have.size - 1 >= Math.min(a.capacity - 2, [3, 4, 2, 5, 1, 3, 2, 4][i % 8])) break;
    }
  }

  // Extra people from dropped-in pictures should be visible: put each in up to three upcoming activities that still have room.
  for (const x of extras) {
    const roomy = await prisma.activity.findMany({ where: { status: 'published', startsAt: { gt: new Date() }, hostId: { not: x.id }, memberships: { none: { userId: x.id } } }, include: { _count: { select: { memberships: { where: { state: 'approved' } } } } }, orderBy: { startsAt: 'asc' } });
    for (const a of roomy.filter((r) => r._count.memberships < r.capacity - 1).slice(0, 3))
      await prisma.activityMembership.create({ data: { activityId: a.id, userId: x.id, role: 'attendee', state: 'approved' } });
  }

  // Demo profile pictures: any image in seed-assets/avatars named after a demo person (sofia.jpg, marco.png, ...).
  const avatarDir = path.resolve(__dirname, '..', '..', 'seed-assets', 'avatars');
  if (existsSync(avatarDir)) {
    for (const file of readdirSync(avatarDir)) {
      const m = /^([a-z]+)\.(jpe?g|png|webp)$/i.exec(file);
      if (!m) continue;
      const u = await prisma.user.findUnique({ where: { email: `${m[1].toLowerCase()}@demo.local` } });
      if (!u) {
        console.log(`avatars: no demo user for ${file}`);
        continue;
      }
      const data = await sharp(readFileSync(path.join(avatarDir, file))).rotate().resize(384, 384, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
      await prisma.profilePhoto.upsert({ where: { userId: u.id }, create: { userId: u.id, data: new Uint8Array(data) }, update: { data: new Uint8Array(data) } });
      await prisma.profile.update({ where: { userId: u.id }, data: { photoUrl: `/v1/users/${u.id}/photo?v=${Date.now()}` } });
      console.log(`avatars: ${file} -> ${m[1]}@demo.local`);
    }
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

  console.log(`Seeded. Admin: ${adminEmail} / ${adminPassword}  |  staff: ${STAFF_DEMO.map(([e, , r, p]) => `${r} ${e} / ${p}`).join(', ')}  |  demo users: sofia|marco|alex@demo.local / demo-password-1`);
}

main().finally(() => prisma.$disconnect());
