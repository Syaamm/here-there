/**
 * Local demo for the ranked Home feed: a dozen Milan activities in the next two days, made so that each thing the
 * ranking looks at (friends going, open places, interests, how soon) visibly changes the order. Run it again at any
 * time: the previous demo activities are cancelled and fresh ones are made, so the times are always "from now".
 * Usage: npm run build && npm run demo:feed
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'demo-password-1';
const H = 3600 * 1000;

async function person(email: string, name: string, interests = 'coffee,culture,travel') {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      adultConfirmed: true,
      emailVerifiedAt: new Date(),
      adultVerifiedAt: new Date(),
      verifiedUntil: new Date(Date.now() + 365 * 24 * H),
      eligibility: 'verified',
      profile: { create: { displayName: name, homeCity: 'Milan', languages: 'English,Italian', interests } },
    },
  });
}

async function main() {
  // you: likes coffee and food, and follows Nina and Omar
  const you = await person('feed-you@demo.local', 'Vera (you)', 'coffee,food');
  const nina = await person('feed-nina@demo.local', 'Nina');
  const omar = await person('feed-omar@demo.local', 'Omar');
  const paolo = await person('feed-paolo@demo.local', 'Paolo');
  const quinn = await person('feed-quinn@demo.local', 'Quinn');
  const crowd = await Promise.all([1, 2, 3, 4].map((i) => person(`feed-guest${i}@demo.local`, `Guest ${i}`)));
  for (const f of [nina, omar]) {
    await prisma.follow.upsert({ where: { followerId_followingId: { followerId: you.id, followingId: f.id } }, create: { followerId: you.id, followingId: f.id }, update: {} });
  }

  // start from a clean slate: cancel the earlier demo activities
  await prisma.activity.updateMany({
    where: { hostId: { in: [nina.id, omar.id, paolo.id, quinn.id] }, status: { in: ['published', 'full'] }, startsAt: { gt: new Date() } },
    data: { status: 'cancelled' },
  });

  const tomorrow = (hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const inH = (h: number) => {
    const d = new Date(Date.now() + h * H);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    return d;
  };

  type Plan = { title: string; cat: string; host: { id: string }; start: Date; capacity: number; guests?: { id: string }[]; lat: number; lng: number; venue: string; note: string };
  const plans: Plan[] = [
    // the next two hours: the first two are identical, except that you follow Nina
    { title: 'Espresso break (Paolo)', cat: 'coffee', host: paolo, start: inH(1), capacity: 6, lat: 45.464, lng: 9.19, venue: 'Bar near Duomo (Centro)', note: 'Same plan as the next one, hosted by someone you do not follow.' },
    { title: 'Espresso break (Nina)', cat: 'coffee', host: nina, start: inH(1), capacity: 6, lat: 45.464, lng: 9.19, venue: 'Bar near Duomo (Centro)', note: 'Same plan as the one above, hosted by Nina, who you follow: should come first.' },
    { title: 'Full yoga class', cat: 'sports', host: quinn, start: inH(1), capacity: 2, guests: [crowd[0]], lat: 45.473, lng: 9.2, venue: 'Giardini Pubblici (Centro)', note: 'Every place is taken: should sink to the bottom of its section.' },
    { title: 'Five-a-side football', cat: 'sports', host: paolo, start: inH(1.5), capacity: 10, guests: [crowd[0], crowd[1]], lat: 45.472, lng: 9.171, venue: 'Parco Sempione (Sempione)', note: 'Open places but not one of your interests.' },
    { title: 'Coffee and a walk', cat: 'coffee', host: quinn, start: inH(1.8), capacity: 4, lat: 45.475, lng: 9.172, venue: 'Parco Sempione north gate (Sempione)', note: 'A coffee plan: matches your interests.' },
    { title: 'Late lunch tasting', cat: 'food', host: paolo, start: inH(1.9), capacity: 8, lat: 45.481, lng: 9.184, venue: 'Corso Garibaldi (Centro)', note: 'A food plan: matches your interests.' },
    // later today: Omar, who you follow, has Nina going too
    { title: 'Dinner at the market', cat: 'food', host: omar, start: inH(6), capacity: 8, guests: [nina, crowd[2]], lat: 45.481, lng: 9.184, venue: 'Isola market (Isola)', note: 'Hosted by Omar with Nina going, both people you follow: first in its section.' },
    { title: 'Late drinks on the Navigli', cat: 'drinks', host: paolo, start: inH(6), capacity: 6, lat: 45.45, lng: 9.17, venue: 'Rooftop bar (Navigli)', note: 'Same time as the dinner, but nobody you know.' },
    { title: 'Night run', cat: 'sports', host: quinn, start: inH(7), capacity: 10, lat: 45.472, lng: 9.171, venue: 'Parco Sempione (Sempione)', note: 'Open, but not your interest and nobody you know.' },
    // tomorrow
    { title: 'Brunch in Brera', cat: 'food', host: paolo, start: tomorrow(10), capacity: 6, lat: 45.472, lng: 9.188, venue: 'Bakery cafe (Brera)', note: 'Tomorrow, matches your interests.' },
    { title: 'Gallery morning with Nina', cat: 'culture', host: nina, start: tomorrow(11), capacity: 6, guests: [omar], lat: 45.45, lng: 9.17, venue: 'Fondazione in Navigli (Navigli)', note: 'Tomorrow, Nina hosts and Omar is going: should lead tomorrow.' },
    { title: 'Sunrise run by the canal', cat: 'sports', host: quinn, start: tomorrow(7), capacity: 8, lat: 45.45, lng: 9.17, venue: 'Navigli canal (Navigli)', note: 'Tomorrow, nobody you know.' },
  ];

  for (const p of plans) {
    const guests = p.guests ?? [];
    const a = await prisma.activity.create({
      data: {
        hostId: p.host.id, title: p.title, category: p.cat, city: 'Milan', cityKey: 'milan', venueName: p.venue, lat: p.lat, lng: p.lng,
        startsAt: p.start, endsAt: new Date(+p.start + 2 * H), capacity: p.capacity, description: p.note,
        status: guests.length + 1 >= p.capacity ? 'full' : 'published',
      },
    });
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: p.host.id, role: 'host' } });
    await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
    for (const g of guests) {
      await prisma.activityMembership.create({ data: { activityId: a.id, userId: g.id, role: 'attendee', state: 'approved' } });
      await prisma.activityRequest.create({ data: { activityId: a.id, applicantId: g.id, state: 'approved', decidedAt: new Date(), reviewedBy: p.host.id } });
    }
  }

  console.log(`\nMade ${plans.length} activities in Milan for the next two days.\n`);
  console.log(`Sign in as  feed-you@demo.local  (password ${PASSWORD}). You like coffee and food, and follow Nina and Omar.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
