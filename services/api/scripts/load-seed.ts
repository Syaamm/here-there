/**
 * Load-test data: many verified people in many group chats, all clearly marked (`load-NNNN@load.test`) so they can be removed.
 *
 * SAFETY: this writes thousands of rows, so it never uses the normal DATABASE_URL. Point LOAD_DATABASE_URL at an EMPTY,
 * throw-away PostgreSQL database (or schema), start a separate API on it, and test that one. Never the owner's data, never live.
 *
 * Usage (from services/api, after npm run build):
 *   LOAD_DATABASE_URL=postgresql://user:pw@localhost:5432/loadtest npm run load:seed -- [people] [groupSize]
 *   LOAD_DATABASE_URL=...  npm run load:seed -- --clean      removes everything this script made
 * Defaults: 300 people in groups of 10. Writes load-manifest.json (who is in which chat) next to where you run it.
 */
import { writeFileSync } from 'node:fs';

const raw = process.env.LOAD_DATABASE_URL ?? '';
if (!/^postgres(ql)?:/.test(raw)) {
  console.error('Set LOAD_DATABASE_URL to an empty, throw-away PostgreSQL database. This script never touches DATABASE_URL.');
  process.exit(1);
}
process.env.DATABASE_URL = raw;

// eslint-disable-next-line import/first
import { PrismaClient } from '@prisma/client';
// eslint-disable-next-line import/first
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient({ datasources: { db: { url: raw } }, log: [] });
export const LOAD_PASSWORD = 'load-test-password-1';
const DOMAIN = '@load.test';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

async function clean() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const acts = await prisma.activity.findMany({ where: { hostId: { in: ids } }, select: { id: true } });
  const actIds = acts.map((a) => a.id);
  await prisma.message.deleteMany({ where: { conversation: { activityId: { in: actIds } } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.conversation.deleteMany({ where: { activityId: { in: actIds } } });
  await prisma.activityRequest.deleteMany({ where: { activityId: { in: actIds } } });
  await prisma.activityMembership.deleteMany({ where: { activityId: { in: actIds } } });
  await prisma.activity.deleteMany({ where: { id: { in: actIds } } });
  const gone = await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => {
    console.error('Some people still have other rows (sessions, audit); remove the whole throw-away database instead.', e.message);
    return { count: 0 };
  });
  console.log(`Removed ${gone.count} people and ${actIds.length} groups.`);
}

async function main() {
  if (process.argv.includes('--clean')) return clean();
  const nums = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
  const people = Math.min(Math.max(nums[0] ?? 300, 10), 20000);
  const size = Math.min(Math.max(nums[1] ?? 10, 2), 40);
  const groups = Math.floor(people / size);
  const hash = await hashPassword(LOAD_PASSWORD); // one hash for everyone: seeding is fast, sign-in still does the real work

  console.log(`Creating ${groups * size} people in ${groups} groups of ${size} ...`);
  const manifest: { password: string; groups: { conversationId: string; members: { email: string; userId: string }[] }[] } = { password: LOAD_PASSWORD, groups: [] };
  const startsAt = new Date(Math.ceil((Date.now() + 5 * DAY) / HOUR) * HOUR);
  for (let g = 0; g < groups; g++) {
    const members: { email: string; userId: string }[] = [];
    for (let i = 0; i < size; i++) {
      const n = String(g * size + i).padStart(5, '0');
      const email = `load-${n}${DOMAIN}`;
      // old enough to get the normal message limit (new accounts get a tighter one)
      const u = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          email, passwordHash: hash, adultConfirmed: true, emailVerifiedAt: new Date(), adultVerifiedAt: new Date(), verifiedUntil: new Date(Date.now() + 365 * DAY),
          eligibility: 'verified', createdAt: new Date(Date.now() - 3 * DAY),
          profile: { create: { displayName: `Load ${n}`, homeCity: 'Milan', homeCityKey: 'milan', languages: 'English', interests: 'coffee,culture' } },
        },
      });
      members.push({ email, userId: u.id });
    }
    const host = members[0];
    const act = await prisma.activity.create({
      data: {
        hostId: host.userId, title: `Load group ${g}`, category: 'coffee', city: 'Milan', cityKey: 'milan', venueName: 'Piazza Duomo', lat: 45.4642, lng: 9.19,
        startsAt, endsAt: new Date(+startsAt + 3 * HOUR), capacity: size + 2, status: 'published', description: 'Made by the load-test seed.',
      },
    });
    await prisma.activityMembership.create({ data: { activityId: act.id, userId: host.userId, role: 'host' } });
    for (const m of members.slice(1)) {
      await prisma.activityMembership.create({ data: { activityId: act.id, userId: m.userId, role: 'attendee', state: 'approved' } });
      await prisma.activityRequest.create({ data: { activityId: act.id, applicantId: m.userId, state: 'approved', decidedAt: new Date(), reviewedBy: host.userId } });
    }
    const conv = await prisma.conversation.create({ data: { scopeType: 'activity', activityId: act.id } });
    manifest.groups.push({ conversationId: conv.id, members });
    if ((g + 1) % 10 === 0) console.log(`  ${g + 1}/${groups} groups`);
  }
  writeFileSync('load-manifest.json', JSON.stringify(manifest));
  console.log(`Done. load-manifest.json written (${groups * size} people, password ${LOAD_PASSWORD}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
