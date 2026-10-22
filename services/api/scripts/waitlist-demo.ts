/**
 * Local demo for the waiting list: a full activity (the host and two approved members), ready for you to ask to join
 * from your own account, so you land first on the waiting list. Then sign in as one of the members and leave: you
 * should be let in and get an alert.
 * Usage: npm run build && npm run demo:waitlist
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'demo-password-1';

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
      verifiedUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      eligibility: 'verified',
      profile: { create: { displayName: name, homeCity: 'Milan', languages: 'English,Italian', interests: 'coffee,culture,travel' } },
    },
  });
}

async function main() {
  const host = await person('waitlist-host@demo.local', 'Dana');
  const leo = await person('waitlist-leo@demo.local', 'Leo');
  const mia = await person('waitlist-mia@demo.local', 'Mia');

  const title = 'Waiting list test';
  let a = await prisma.activity.findFirst({ where: { hostId: host.id, title, startsAt: { gt: new Date() }, status: { in: ['published', 'full'] } } });
  if (!a) {
    const startsAt = new Date(Date.now() + 3 * 3600 * 1000);
    startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 5) * 5, 0, 0);
    a = await prisma.activity.create({
      data: {
        hostId: host.id, title, category: 'coffee', city: 'Milan', cityKey: 'milan', venueName: 'Bar near Duomo (Centro)', lat: 45.464, lng: 9.19,
        startsAt, endsAt: new Date(+startsAt + 2 * 3600 * 1000), capacity: 3, status: 'full',
        description: 'A full activity for trying the waiting list: ask to join, then have one of the members leave.',
      },
    });
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: host.id, role: 'host' } });
    await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
    for (const m of [leo, mia]) {
      await prisma.activityMembership.create({ data: { activityId: a.id, userId: m.id, role: 'attendee', state: 'approved' } });
      await prisma.activityRequest.create({ data: { activityId: a.id, applicantId: m.id, state: 'approved', decidedAt: new Date(), reviewedBy: host.id } });
    }
  }
  console.log(`\nActivity "${title}" (3 places, all taken) starts ${a.startsAt.toLocaleString()}\n`);
  console.log('Members you can sign in as to leave it (password for all: ' + PASSWORD + '):');
  console.log('  waitlist-leo@demo.local   (Leo)');
  console.log('  waitlist-mia@demo.local   (Mia)');
  console.log('  waitlist-host@demo.local  (Dana, the host)\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
