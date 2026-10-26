/**
 * Local demo for the paged lists: gives feed-you@demo.local (see demo:feed) enough favourites, plans and alerts that each
 * list needs several pages (6, then 5 at a time). Safe to run again; it only adds what is missing.
 * Usage: npm run build && npm run demo:feed && npm run demo:paging
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const you = await prisma.user.findUnique({ where: { email: 'feed-you@demo.local' } });
  if (!you) throw new Error('Run npm run demo:feed first: it creates feed-you@demo.local.');
  const acts = await prisma.activity.findMany({ where: { status: { in: ['published', 'full'] }, startsAt: { gt: new Date() }, hostId: { not: you.id } }, orderBy: { startsAt: 'asc' } });

  // favourites: every upcoming activity
  for (const [i, a] of acts.entries()) {
    await prisma.favorite.upsert({
      where: { userId_activityId: { userId: you.id, activityId: a.id } },
      create: { userId: you.id, activityId: a.id, createdAt: new Date(Date.now() - i * 60_000) },
      update: {},
    });
  }

  // plans: going to the first 7 that have a free place, waiting on the next 2, declined on one
  const open = acts.filter((a) => a.status === 'published');
  for (const a of open.slice(0, 7)) {
    await prisma.activityMembership.upsert({
      where: { activityId_userId: { activityId: a.id, userId: you.id } },
      create: { activityId: a.id, userId: you.id, role: 'attendee', state: 'approved' },
      update: {},
    });
    await prisma.activityRequest.upsert({ where: { activityId_applicantId: { activityId: a.id, applicantId: you.id } }, create: { activityId: a.id, applicantId: you.id, state: 'approved', decidedAt: new Date() }, update: {} });
  }
  for (const [i, a] of open.slice(7, 10).entries()) {
    await prisma.activityRequest.upsert({ where: { activityId_applicantId: { activityId: a.id, applicantId: you.id } }, create: { activityId: a.id, applicantId: you.id, state: i === 2 ? 'declined' : 'requested' }, update: {} });
  }

  // alerts: 14 notices, newest first
  const have = await prisma.notification.count({ where: { userId: you.id, title: { startsWith: 'Demo alert' } } });
  for (let i = have; i < 14; i++) {
    await prisma.notification.create({
      data: { userId: you.id, type: 'activity_changed', title: `Demo alert ${i + 1}`, body: 'Paging test: scroll the alerts to load more.', createdAt: new Date(Date.now() - i * 5 * 60_000) },
    });
  }
  console.log('\nfeed-you@demo.local now has favourites, plans and 14 alerts to page through.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
