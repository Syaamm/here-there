/**
 * Local demo for the three tiers (buddies, people you follow, everyone else) in the HERE feed and the THERE trips.
 * Uses the people made by `npm run demo:feed`. Safe to run again.
 * Usage: npm run build && npm run demo:feed && npm run demo:circle
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DAY = 24 * 3600 * 1000;

async function main() {
  const email = (n: string) => `feed-${n}@demo.local`;
  const [you, nina, omar, paolo, quinn] = await Promise.all(['you', 'nina', 'omar', 'paolo', 'quinn'].map((n) => prisma.user.findUnique({ where: { email: email(n) } })));
  if (!you || !nina || !omar || !paolo || !quinn) throw new Error('Run npm run demo:feed first: it creates these people.');

  const follow = (a: string, b: string) => prisma.follow.upsert({ where: { followerId_followingId: { followerId: a, followingId: b } }, create: { followerId: a, followingId: b }, update: {} });
  const unfollow = (a: string, b: string) => prisma.follow.deleteMany({ where: { followerId: a, followingId: b } });
  // Nina: a BUDDY (you follow each other). Omar: someone you FOLLOW (not back). Paolo: only FOLLOWS you. Quinn: nobody you know.
  await follow(you.id, nina.id);
  await follow(nina.id, you.id);
  await follow(you.id, omar.id);
  await unfollow(omar.id, you.id);
  await unfollow(you.id, paolo.id);
  await follow(paolo.id, you.id);
  await unfollow(you.id, quinn.id);
  await unfollow(quinn.id, you.id);

  // four identical activities in the next two hours, one for each kind of person, so the order is easy to see
  await prisma.activity.deleteMany({ where: { title: { startsWith: 'Circle demo' } } });
  const startsAt = new Date(Date.now() + 90 * 60 * 1000);
  startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 5) * 5, 0, 0);
  const activity = async (title: string, host: { id: string }) => {
    const a = await prisma.activity.create({
      data: { hostId: host.id, title, category: 'coffee', city: 'Milan', cityKey: 'milan', venueName: 'Bar near Duomo (Centro)', lat: 45.464, lng: 9.19, startsAt, endsAt: new Date(+startsAt + 2 * 3600 * 1000), capacity: 6, status: 'published', description: 'Demo activity for trying the circle ranking.' },
    });
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: host.id, role: 'host', state: 'approved' } });
    await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
  };
  await activity('Circle demo: coffee by Quinn (nobody you know)', quinn);
  await activity('Circle demo: coffee by Paolo (only follows you)', paolo);
  await activity('Circle demo: coffee by Omar (you follow him)', omar);
  await activity('Circle demo: coffee by Nina (your buddy)', nina);

  // four identical trips, one for each kind of person
  await prisma.trip.deleteMany({ where: { title: { startsWith: 'Circle demo' } } });
  const make = async (title: string, host: { id: string }) => {
    const t = await prisma.trip.create({
      data: { hostId: host.id, title, destination: 'Lisbon, Portugal', destinationKey: 'lisbon, portugal', originCity: 'Milan', dateStart: new Date(Date.now() + 40 * DAY), dateEnd: new Date(Date.now() + 45 * DAY), budgetMin: 500, budgetMax: 900, tags: 'culture,food', description: 'Demo trip for trying the circle ranking.' },
    });
    await prisma.tripMembership.create({ data: { tripId: t.id, userId: host.id, role: 'organizer', state: 'approved' } });
    await prisma.conversation.create({ data: { scopeType: 'trip', tripId: t.id } });
  };
  await make('Circle demo: trip by Quinn (nobody you know)', quinn);
  await make('Circle demo: trip by Paolo (only follows you)', paolo);
  await make('Circle demo: trip by Omar (you follow him)', omar);
  await make('Circle demo: trip by Nina (your buddy)', nina);

  console.log(`
Circle demo ready. Sign in as feed-you@demo.local (password demo-password-1).

  Nina   your BUDDY            (you follow each other)  -> goes first
  Omar   someone you FOLLOW    (he does not follow back) -> goes second
  Paolo  only FOLLOWS you                                -> no boost
  Quinn  nobody you know                                 -> no boost

HERE: open Home. In "Happening soon", the four "Circle demo: coffee by ..." activities are in this order: Nina, Omar, then the other two.
THERE: switch to There and look at the trips: "Circle demo: trip by Nina" should be first, then Omar's.
A small green line shows "1 buddy going" or "1 you follow is going".
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
