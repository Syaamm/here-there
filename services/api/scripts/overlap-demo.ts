/**
 * Local demo for activities that happen at the same time: it gives the two Cristiano accounts one approved activity, one
 * pending request that overlaps it, and a few others to try asking for (the app should then ask what to keep).
 * Safe to run again: the previous "Overlap demo" activities are cancelled and fresh ones are made, relative to now.
 * Usage: npm run build && npm run demo:overlap
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'Overlap demo: ';
const MIN = 60 * 1000;

async function main() {
  const people = await prisma.user.findMany({ where: { email: { in: ['cristiano@demo.local', 'cristiano@gmail.com'] } } });
  const hosts = await prisma.user.findMany({ where: { email: { in: ['sofia@demo.local', 'marco@demo.local'] } } });
  const sofia = hosts.find((h) => h.email === 'sofia@demo.local');
  const marco = hosts.find((h) => h.email === 'marco@demo.local');
  if (!sofia || !marco || people.length === 0) throw new Error('The demo accounts (sofia, marco, cristiano) are missing: run the seed first.');

  // start fresh: cancel the last run's activities
  await prisma.activity.updateMany({ where: { title: { startsWith: PREFIX }, status: { not: 'cancelled' } }, data: { status: 'cancelled' } });

  const base = new Date();
  base.setSeconds(0, 0);
  const at = (minutes: number) => new Date(Math.ceil((+base + minutes * MIN) / (5 * MIN)) * 5 * MIN);

  const plan = [
    { title: 'Aperitivo at Navigli', cat: 'drinks', host: sofia, start: 25, hours: 2, venue: 'Bar on the canal (Navigli)', lat: 45.45, lng: 9.17, role: 'approved' as const },
    { title: 'Football in the park', cat: 'sports', host: marco, start: 50, hours: 2, venue: 'Parco Sempione north gate (Sempione)', lat: 45.472, lng: 9.172, role: 'pending' as const },
    { title: 'Sunset run', cat: 'sports', host: sofia, start: 90, hours: 1.5, venue: 'Darsena (Navigli)', lat: 45.451, lng: 9.175, role: null },
    { title: 'Board games night', cat: 'culture', host: marco, start: 120, hours: 2, venue: 'Game cafe in Brera (Brera)', lat: 45.472, lng: 9.188, role: null },
    { title: 'Late dinner', cat: 'food', host: sofia, start: 240, hours: 2, venue: 'Trattoria in Isola (Isola)', lat: 45.485, lng: 9.19, role: null },
  ];

  for (const p of plan) {
    const startsAt = at(p.start);
    const a = await prisma.activity.create({
      data: {
        hostId: p.host.id, title: PREFIX + p.title, category: p.cat, city: 'Milan', cityKey: 'milan', venueName: p.venue, lat: p.lat, lng: p.lng,
        startsAt, endsAt: new Date(+startsAt + p.hours * 60 * MIN), capacity: 6, status: 'published',
        description: 'Made by the overlap demo, to try what the app does when plans happen at the same time.',
      },
    });
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: p.host.id, role: 'host' } });
    await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
    for (const person of people) {
      if (p.role === 'approved') {
        await prisma.activityMembership.create({ data: { activityId: a.id, userId: person.id, role: 'attendee', state: 'approved' } });
        await prisma.activityRequest.create({ data: { activityId: a.id, applicantId: person.id, state: 'approved', decidedAt: new Date(), reviewedBy: p.host.id } });
      } else if (p.role === 'pending') {
        await prisma.activityRequest.create({ data: { activityId: a.id, applicantId: person.id, state: 'requested' } });
      }
    }
    const mark = p.role === 'approved' ? 'approved for you' : p.role === 'pending' ? 'you asked, waiting' : 'not joined';
    console.log(`  ${startsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}  ${p.title.padEnd(22)} ${String(p.hours).padStart(3)} h   ${mark}`);
  }
  console.log(`\nSign in as ${people.map((u) => u.email).join(' or ')} to try it.\n`);
}

main().finally(() => prisma.$disconnect());
