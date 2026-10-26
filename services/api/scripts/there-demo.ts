/**
 * Local demo for the THERE features: the shared plan, final-dates confirmation, a completed trip, and travel buddies.
 * Safe to run again (it starts the demo trips and answers afresh). Password for everyone: demo-password-1
 * Usage: npm run build && npm run demo:there
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'demo-password-1';
const H = 3600 * 1000;
const DAY = 24 * H;

async function person(email: string, name: string, interests = 'food,culture,travel') {
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
      profile: { create: { displayName: name, homeCity: 'Milan', languages: 'English,Italian', interests, bio: `${name} loves slow travel, good food and early trains.` } },
    },
  });
}

async function main() {
  const you = await person('there-you@demo.local', 'Tess (you)', 'food,culture');
  const ana = await person('there-ana@demo.local', 'Ana');
  const bruno = await person('there-bruno@demo.local', 'Bruno', 'food,hiking');
  const chiara = await person('there-chiara@demo.local', 'Chiara', 'culture,music');
  const dario = await person('there-dario@demo.local', 'Dario');
  const fox = await person('there-fox@demo.local', 'Fox');

  // ---- start fresh: the earlier demo trips and answers go
  await prisma.trip.deleteMany({ where: { title: { startsWith: 'Demo:' } } });
  await prisma.travelMatchChoice.deleteMany({ where: { OR: [{ fromId: you.id }, { toId: you.id }] } });
  await prisma.travelMatchPref.deleteMany({ where: { userId: { in: [you.id, ana.id, bruno.id, chiara.id, dario.id, fox.id] } } });
  await prisma.conversation.updateMany({ where: { scopeType: 'match', OR: [{ userAId: you.id }, { userBId: you.id }] }, data: { endedAt: new Date() } });

  const trip = async (title: string, host: { id: string }, members: { id: string }[], startDays: number, endDays: number, extra: Record<string, unknown> = {}) => {
    const t = await prisma.trip.create({
      data: {
        hostId: host.id, title, destination: 'Porto, Portugal', destinationKey: 'porto, portugal', originCity: 'Milan',
        dateStart: new Date(Date.now() + startDays * DAY), dateEnd: new Date(Date.now() + endDays * DAY),
        budgetMin: 400, budgetMax: 700, tags: 'food,culture', description: 'Demo trip for trying the THERE features.', minCapacity: 3, maxCapacity: 5, ...extra,
      },
    });
    await prisma.tripMembership.create({ data: { tripId: t.id, userId: host.id, role: 'organizer', state: 'approved', datesConfirmed: true } });
    for (const m of members) await prisma.tripMembership.create({ data: { tripId: t.id, userId: m.id, role: 'member', state: 'approved' } });
    await prisma.conversation.create({ data: { scopeType: 'trip', tripId: t.id } });
    return t;
  };

  // 1. a trip in planning: Ana organises, you and Bruno are in; final dates were proposed and only Ana and Bruno confirmed
  const porto = await trip('Demo: Porto week (confirm the dates)', ana, [you, bruno], 40, 46, { status: 'planning', datesState: 'proposed' });
  await prisma.tripMembership.updateMany({ where: { tripId: porto.id, userId: bruno.id }, data: { datesConfirmed: true } });
  const d = (n: number) => new Date(Date.now() + (40 + n) * DAY);
  await prisma.tripItem.createMany({
    data: [
      { tripId: porto.id, kind: 'itinerary', day: d(0), title: 'Arrive and walk along the Ribeira', note: 'Meet at the station', createdById: ana.id },
      { tripId: porto.id, kind: 'itinerary', day: d(1), title: 'Douro valley day trip', createdById: bruno.id },
      { tripId: porto.id, kind: 'itinerary', title: 'Ideas for the last evening', createdById: ana.id },
      { tripId: porto.id, kind: 'budget', title: 'Hostel, 6 nights', amount: 240, createdById: ana.id },
      { tripId: porto.id, kind: 'budget', title: 'Food', amount: 180, createdById: bruno.id },
    ],
  });

  // 2. a trip that has already ended: it shows as Completed
  await trip('Demo: Seville long weekend (already finished)', ana, [you, chiara], -9, -5, { destination: 'Seville, Spain', destinationKey: 'seville, spain', status: 'confirmed', datesState: 'proposed' });

  // 3. a trip you can apply to, to see the plan stay closed until you are in
  await trip('Demo: Lisbon weekend (open to apply)', bruno, [], 50, 54, { destination: 'Lisbon, Portugal', destinationKey: 'lisbon, portugal', minCapacity: 2, maxCapacity: 4 });

  // ---- travel buddies: who has turned matching on
  const wish = (userId: string, destination: string, from: number, to: number) =>
    prisma.travelMatchPref.create({ data: { userId, destination, destinationKey: destination.toLowerCase(), dateStart: new Date(Date.now() + from * DAY), dateEnd: new Date(Date.now() + to * DAY) } });
  await wish(ana.id, 'Seville, Spain', 30, 36);
  await wish(bruno.id, 'Seville', 33, 40);
  await wish(chiara.id, 'Seville', 28, 34);
  await wish(dario.id, 'Seville', 90, 95); // same place, dates do not overlap
  await wish(fox.id, 'Oslo, Norway', 30, 36); // same dates, another place
  // Ana has already said yes to you. Bruno and Chiara have not.
  await prisma.travelMatchChoice.create({ data: { fromId: ana.id, toId: you.id, choice: 'yes' } });

  console.log(`
THERE demo ready. Password for everyone: ${PASSWORD}

Sign in as there-you@demo.local (Tess) in the app, switch to THERE, then:

SHARED PLAN AND DATES
  Open "Demo: Porto week (confirm the dates)": the card lists who has confirmed the dates (Ana and Bruno yes, you waiting).
  Tap "I can travel on these dates", then "Plan: itinerary and budget" to add, edit and remove lines.
  Open "Demo: Lisbon weekend": you are not in it, so there is no plan button.
  "Demo: Seville long weekend (already finished)" shows as Completed.

TRAVEL BUDDIES (Profile > Travel buddies)
  Turn it on with: Seville, dates about 33 to 38 days from now.
  You see Ana, Bruno and Chiara (not Dario: dates differ, not Fox: other city).
  Say "I would like to chat" to Bruno: nothing happens (he is not told).
  Say it to Ana: it is a match at once (she had said yes), and a private chat opens.
  Open Inbox > chats for the match chat, try "End chat" in its menu.

LINK AND MONEY RULES (any trip chat, or the plan)
  Try: "see https://bit.ly/abc"  or  "send me money first"  or  "my iban IT60 X054 2811 1010 0000 0123 456": all refused.
  Try: "Menu: https://www.trattoria-rossi.it/menu": allowed, with a caution line under it.
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
