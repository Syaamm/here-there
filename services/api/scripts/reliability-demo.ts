/**
 * Local demo for reliability levels: verified people at every level, and a plan that ended an hour ago so a host can
 * try "Who came?" straight away. Safe to run again: it rebuilds its own demo plans and notes each time.
 * Usage: npm run build && npm run demo:reliability
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'demo-password-1';
const H = 3600 * 1000;
const ago = (hours: number) => new Date(Date.now() - hours * H);

async function person(email: string, name: string) {
  const data = { eligibility: 'verified', adultConfirmed: true, emailVerifiedAt: new Date(), adultVerifiedAt: new Date(), verifiedUntil: new Date(Date.now() + 365 * 24 * H) };
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return prisma.user.update({ where: { id: existing.id }, data });
  return prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash(PASSWORD, 12), ...data, profile: { create: { displayName: name, homeCity: 'Milan', languages: 'English', interests: 'coffee,food' } } },
  });
}

async function main() {
  const host = await person('rel-host@demo.local', 'Hana (host)');
  const mia = await person('rel-mia@demo.local', 'Mia');
  const leo = await person('rel-leo@demo.local', 'Leo');
  const pro = await person('rel-pro@demo.local', 'Pia (Very reliable)');
  const solid = await person('rel-solid@demo.local', 'Sol (Reliable)');
  const care = await person('rel-care@demo.local', 'Cal (Needs care)');
  const fresh = await person('rel-new@demo.local', 'Noa (New)');

  // start clean: the earlier demo plans, their notes and the level history
  const old = await prisma.activity.findMany({ where: { hostId: host.id }, select: { id: true } });
  const ids = [host, mia, leo, pro, solid, care, fresh].map((u) => u.id);
  await prisma.attendanceMark.deleteMany({ where: { OR: [{ targetId: { in: old.map((a) => a.id) } }, { userId: { in: ids } }] } });
  await prisma.activity.deleteMany({ where: { hostId: host.id } });
  await prisma.reliabilityChange.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { reliabilityLevel: null } });

  const plan = async (title: string, startHoursAgo: number, endHoursAgo: number, members: string[]) => {
    const a = await prisma.activity.create({
      data: { hostId: host.id, title, category: 'coffee', city: 'Milan', cityKey: 'milan', venueName: 'Bar near Duomo (Centro)', lat: 45.464, lng: 9.19, startsAt: ago(startHoursAgo), endsAt: ago(endHoursAgo), capacity: 8, status: 'published', description: 'Demo plan for trying reliability.' },
    });
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: host.id, role: 'host', state: 'approved' } });
    await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
    for (const u of members) await prisma.activityMembership.create({ data: { activityId: a.id, userId: u, role: 'attendee', state: 'approved' } });
    return a;
  };

  // the one to try right now: it ended an hour ago, so the host can still say who did not come (for 47 more hours)
  const live = await plan('Coffee that just ended', 3, 1, [mia.id, leo.id, care.id]);

  // older plans (each on its own day) that build the levels
  const day = (n: number) => [24 * n + 2, 24 * n] as const;
  for (let i = 0; i < 10; i++) await plan(`Demo plan ${i + 1} (Pia)`, ...day(5 + i), [pro.id]);
  for (let i = 0; i < 3; i++) await plan(`Demo plan ${i + 1} (Sol)`, ...day(5 + i), [solid.id]);
  await plan('Demo plan 1 (Noa)', ...day(6), [fresh.id]);
  // Cal came to three and was noted as absent twice; nobody disputed within 7 days, so both count
  for (let i = 0; i < 3; i++) await plan(`Demo plan ${i + 1} (Cal)`, ...day(20 + i), [care.id]);
  for (const n of [1, 2]) {
    const p = await plan(`Demo missed ${n} (Cal)`, ...day(12 + n), [care.id]);
    await prisma.attendanceMark.create({ data: { kind: 'activity', targetId: p.id, userId: care.id, markedById: host.id, title: p.title, planEndsAt: p.endsAt, markedAt: ago(24 * (10 + n)) } });
  }

  console.log(`
Reliability demo ready. Everyone signs in with password: ${PASSWORD}

  rel-host@demo.local    Hana, the host.  Her plan "Coffee that just ended" has Mia, Leo and Cal in it.
  rel-mia@demo.local     Mia (try being marked as not there, then disputing it)
  rel-leo@demo.local     Leo
  rel-pro@demo.local     Very reliable (10 kept plans)
  rel-solid@demo.local   Reliable (3 kept plans)
  rel-care@demo.local    Needs care (2 confirmed no-shows)
  rel-new@demo.local     New (1 kept plan)

The plan to try: ${live.id}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
