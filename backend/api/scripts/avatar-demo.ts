/**
 * Local demo for the avatars of people WITHOUT a profile photo: six accounts with no picture, one HERE activity they are going to
 * (with open places left) and one THERE trip, so the initials circles can be looked at on the cards, "Who's going" and the host card.
 * Safe to run again (the earlier demo activity and trip are replaced). Password for everyone: demo-password-1
 * SAFETY: it only runs against a database on this computer (localhost), never a server.
 * Usage: npm run build && npm run demo:avatars
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'demo-password-1';
const H = 3600 * 1000;
const DAY = 24 * H;

function assertLocal() {
  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* an unreadable address is refused below */
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    console.error('Refusing to run: DATABASE_URL is not a database on this computer. This demo never writes to a server.');
    process.exit(1);
  }
}

async function person(email: string, name: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      adultConfirmed: true,
      emailVerifiedAt: new Date(),
      adultVerifiedAt: new Date(),
      verifiedUntil: new Date(Date.now() + 365 * DAY),
      eligibility: 'verified',
      // no photoUrl on purpose: this is what the demo is for
      profile: { create: { displayName: name, homeCity: 'Milan', languages: 'English,Italian', interests: 'coffee,food,culture,travel' } },
    },
  });
}

async function main() {
  assertLocal();
  const you = await person('avatar-you@demo.local', 'Zoe (you)');
  const iris = await person('avatar-iris@demo.local', 'Iris Bianchi');
  const jonas = await person('avatar-jonas@demo.local', 'Jonas Keller');
  const kira = await person('avatar-kira@demo.local', 'Kira Novak');
  const lena = await person('avatar-lena@demo.local', 'Lena Rossi');
  const milo = await person('avatar-milo@demo.local', 'Milo Santos');
  const noor = await person('avatar-noor@demo.local', 'Noor Haddad');

  // ---- a clean slate
  await prisma.activity.updateMany({ where: { hostId: iris.id, title: { startsWith: 'Demo avatars' }, status: { in: ['published', 'full'] } }, data: { status: 'cancelled' } });
  await prisma.trip.deleteMany({ where: { title: { startsWith: 'Demo avatars' } } });

  // ---- HERE: Iris hosts, four people are going (so "+1" shows after three faces), three places are still open
  const start = new Date(Date.now() + 3 * H);
  start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5, 0, 0);
  const a = await prisma.activity.create({
    data: {
      hostId: iris.id, title: 'Demo avatars: aperitivo on the Navigli', category: 'drinks', city: 'Milan', cityKey: 'milan',
      venueName: 'Rooftop bar (Navigli)', lat: 45.45, lng: 9.17, startsAt: start, endsAt: new Date(+start + 2 * H), capacity: 8,
      description: 'Demo for people without a profile photo: their circles show their initials on a soft green.', status: 'published',
    },
  });
  await prisma.activityMembership.create({ data: { activityId: a.id, userId: iris.id, role: 'host' } });
  await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
  for (const g of [jonas, kira, lena, milo]) {
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: g.id, role: 'attendee', state: 'approved' } });
    await prisma.activityRequest.create({ data: { activityId: a.id, applicantId: g.id, state: 'approved', decidedAt: new Date(), reviewedBy: iris.id } });
  }

  // ---- THERE: Noor organises, Jonas and Kira are in, two places are open
  const t = await prisma.trip.create({
    data: {
      hostId: noor.id, title: 'Demo avatars: Lisbon long weekend', destination: 'Lisbon, Portugal', destinationKey: 'lisbon, portugal', originCity: 'Milan',
      dateStart: new Date(Date.now() + 30 * DAY), dateEnd: new Date(Date.now() + 34 * DAY), budgetMin: 300, budgetMax: 600, tags: 'food,culture',
      description: 'Demo for people without a profile photo.', minCapacity: 2, maxCapacity: 5,
    },
  });
  await prisma.tripMembership.create({ data: { tripId: t.id, userId: noor.id, role: 'organizer', state: 'approved', datesConfirmed: true } });
  for (const m of [jonas, kira]) await prisma.tripMembership.create({ data: { tripId: t.id, userId: m.id, role: 'member', state: 'approved' } });
  await prisma.conversation.create({ data: { scopeType: 'trip', tripId: t.id } });

  console.log('\nMade 1 HERE activity (Iris hosts, 4 going, 4 places open) and 1 THERE trip (Noor organises, 3 in).');
  console.log(`None of the people has a profile photo. Sign in as  avatar-you@demo.local  (password ${PASSWORD}) and open Home / Explore.\n`);
  void you;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
