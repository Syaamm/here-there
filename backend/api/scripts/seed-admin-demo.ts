/**
 * Fills the admin console with made-up data so every page and field can be looked at: members in every state (with
 * profile pictures), staff, reports, identity checks, appeals, no-show notes, warnings, on-call shifts, audit entries and places.
 * Everything is fictional and every account uses an address ending in @fill.demo, so it can be taken out again.
 *
 *   node dist/scripts/seed-admin-demo.js            add it (running it twice does nothing the second time)
 *   node dist/scripts/seed-admin-demo.js --remove   take all of it out again
 *
 * Needs the normal seed to have run first (it reuses the sample activities and the admin account).
 */
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { hashPassword } from '../src/common/password';
import { blindIndex, encryptField } from '../src/common/vault';

const prisma = new PrismaClient();
const DOMAIN = '@fill.demo';
const MARK = '"demo":"fill"';
const REGION_KEYS = ['it', 'it-lombardy', 'it-lazio', 'it-milan', 'it-rome', 'fr', 'fr-paris'];
const ago = (h: number) => new Date(Date.now() - h * 3600_000);
const ahead = (h: number) => new Date(Date.now() + h * 3600_000);
const pick = <T>(a: T[], i: number) => a[i % a.length];

async function remove() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const reports = await prisma.report.deleteMany({ where: { OR: [{ reporterId: { in: ids } }, { targetId: { in: ids } }] } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ metadata: { contains: MARK } }, { objectId: { in: ids } }, { actorId: { in: ids } }] } });
  await prisma.attendanceMark.deleteMany({ where: { OR: [{ userId: { in: ids } }, { markedById: { in: ids } }] } });
  await prisma.activityMembership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.activity.deleteMany({ where: { hostId: { in: ids } } });
  await prisma.region.deleteMany({ where: { key: { in: REGION_KEYS } } });
  const gone = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Removed ${gone.count} demo accounts and ${reports.count} reports (plus their notes, appeals, checks, shifts and audit entries).`);
}

/** A round picture with the person's initials, drawn here (no outside service, no real faces). */
async function portrait(name: string, i: number) {
  const hues = [152, 24, 205, 280, 340, 45, 175, 10];
  const h = hues[i % hues.length];
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,62%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},60%,40%)"/></linearGradient></defs><rect width="384" height="384" fill="url(#g)"/><circle cx="192" cy="150" r="64" fill="rgba(255,255,255,0.35)"/><ellipse cx="192" cy="330" rx="118" ry="96" fill="rgba(255,255,255,0.35)"/><text x="192" y="222" font-family="Arial, Helvetica, sans-serif" font-size="120" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

type P = { name: string; city: string; photo: boolean; state?: string; days?: number; eligibility?: string; reason?: string; bio?: string; role?: string; mfa?: boolean; phone?: string };

async function main() {
  if (process.argv.includes('--remove')) return remove();
  if (await prisma.user.findFirst({ where: { email: { endsWith: DOMAIN } } })) return console.log('The demo data is already there. Use --remove to take it out first.');
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('Run the normal seed first (npm run seed): there is no administrator yet.');
  const password = await hashPassword('demo-password-1');

  const people: P[] = [
    // staff
    { name: 'Giulia Rossi', city: 'Milan', photo: true, role: 'staff', mfa: true, phone: '+393331110001', eligibility: 'verified' },
    { name: 'Luca Bianchi', city: 'Milan', photo: true, role: 'staff', mfa: true, eligibility: 'verified' },
    { name: 'Chiara Conti', city: 'Rome', photo: true, role: 'staff', mfa: true, phone: '+393331110003', eligibility: 'verified' },
    { name: 'Paolo Neri', city: 'Milan', photo: false, role: 'staff', mfa: false, eligibility: 'verified' },
    // members
    { name: 'Elena Marchetti', city: 'Milan', photo: true, eligibility: 'verified', bio: 'Coffee, long walks and bad puns.' },
    { name: 'Matteo Ferri', city: 'Milan', photo: true, eligibility: 'verified' },
    { name: 'Sara Ricci', city: 'Rome', photo: true, eligibility: 'verified', bio: 'Always up for a trip.' },
    { name: 'Davide Greco', city: 'Milan', photo: false, eligibility: 'pending' },
    { name: 'Marta Colombo', city: 'Milan', photo: true, eligibility: 'pending' },
    { name: 'Franco Villa', city: 'Rome', photo: true, eligibility: 'rejected', reason: 'document_unreadable' },
    { name: 'Irene Fontana', city: 'Milan', photo: true, eligibility: 'rejected', reason: 'face_mismatch' },
    { name: 'Nicolo Esposito', city: 'Rome', photo: false, eligibility: 'expired' },
    { name: 'Bianca Moretti', city: 'Milan', photo: true, eligibility: 'reverification_required' },
    { name: 'Tommaso Barbieri', city: 'Milan', photo: true, eligibility: 'unverified' },
    { name: 'Alice Gallo', city: 'Rome', photo: true, eligibility: 'verified', state: 'suspended', days: 7 },
    { name: 'Riccardo Leone', city: 'Milan', photo: false, eligibility: 'verified', state: 'suspended' },
    { name: 'Federica Serra', city: 'Paris', photo: true, eligibility: 'verified' },
    { name: 'Jean Dupont', city: 'Paris', photo: true, eligibility: 'verified' },
  ];

  const made: { id: string; p: P }[] = [];
  let n = 0;
  for (const p of people) {
    const email = `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}${DOMAIN}`;
    const verified = p.eligibility === 'verified';
    const u = await prisma.user.create({
      data: {
        email,
        passwordHash: password,
        role: p.role ?? 'user',
        state: p.state ?? 'active',
        suspendedUntil: p.days ? ahead(p.days * 24) : null,
        adultConfirmed: true,
        adultVerifiedAt: verified ? ago(200 + n * 7) : null,
        emailVerifiedAt: ago(300 + n * 5),
        phoneNumber: p.phone ? encryptField(p.phone) : null,
        phoneHash: p.phone ? blindIndex('phone', p.phone) : null,
        phoneVerifiedAt: p.phone ? ago(250) : null,
        mfaEnabledAt: p.mfa ? ago(120) : null,
        eligibility: p.eligibility ?? 'verified',
        verifiedUntil: verified ? ahead(24 * 300) : null,
        reverifyReason: p.eligibility === 'reverification_required' ? 'security' : null,
        createdAt: ago(24 * (60 - n * 3)),
        profile: { create: { displayName: p.name, homeCity: p.city, homeCityKey: p.city.toLowerCase(), languages: 'English,Italian', interests: 'coffee,culture,travel', bio: p.bio ?? null } },
      },
    });
    if (p.photo) {
      await prisma.profilePhoto.create({ data: { userId: u.id, data: await portrait(p.name, n), mime: 'image/webp' } });
      await prisma.profile.update({ where: { userId: u.id }, data: { photoUrl: `/v1/users/${u.id}/photo?v=${Date.now()}` } });
    }
    made.push({ id: u.id, p });
    n++;
  }
  const by = (name: string) => made.find((m) => m.p.name === name)!.id;
  const staff = { mod: by('Giulia Rossi'), support: by('Luca Bianchi'), trust: by('Chiara Conti') };

  // the demo members also get a picture on the existing sample accounts when they have none
  const existing = await prisma.user.findMany({ where: { email: { endsWith: '@demo.local' } }, include: { profile: true, photo: true } });
  let k = 40;
  for (const u of existing) {
    if (u.photo || !u.profile) continue;
    await prisma.profilePhoto.create({ data: { userId: u.id, data: await portrait(u.profile.displayName, k++), mime: 'image/webp' } });
    await prisma.profile.update({ where: { userId: u.id }, data: { photoUrl: `/v1/users/${u.id}/photo?v=${Date.now()}` } });
  }

  // identity checks, as the trust lead's queue shows them
  const checks: [string, string, string | null, number][] = [
    ['Davide Greco', 'pending', null, 3],
    ['Marta Colombo', 'pending', null, 20],
    ['Franco Villa', 'rejected', 'document_unreadable', 50],
    ['Irene Fontana', 'rejected', 'face_mismatch', 70],
    ['Elena Marchetti', 'verified', null, 400],
    ['Matteo Ferri', 'verified', null, 380],
    ['Sara Ricci', 'verified', null, 300],
  ];
  for (const [name, eligibility, rejectionReason, h] of checks) {
    const decided = eligibility !== 'pending';
    await prisma.verificationCheck.create({
      data: { userId: by(name), provider: 'manual', method: 'face', providerRef: `demo-${by(name).slice(-6)}`, eligibility, rejectionReason, consentAt: ago(h + 1), expiresAt: eligibility === 'verified' ? ahead(24 * 300) : null, decidedAt: decided ? ago(h - 1) : null, reviewedBy: decided ? staff.trust : null, createdAt: ago(h) },
    });
  }

  // reports of every kind
  const activities = await prisma.activity.findMany({ take: 6, orderBy: { createdAt: 'desc' } });
  const trips = await prisma.trip.findMany({ take: 2, orderBy: { createdAt: 'desc' } });
  const rep = (reporter: string, targetType: string, targetId: string, category: string, details: string, extra: Record<string, unknown> = {}, h = 5) =>
    prisma.report.create({ data: { reporterId: by(reporter), targetType, targetId, category, details, createdAt: ago(h), ...extra } as never });
  await rep('Elena Marchetti', 'user', by('Riccardo Leone'), 'harassment', 'Kept sending messages after I asked him to stop, and turned up at the café I had mentioned.', { status: 'resolved', assignedTo: staff.mod, firstReviewedAt: ago(70), resolvedAt: ago(60), resolution: 'Suspended until staff restore the account.' }, 90);
  await rep('Matteo Ferri', 'user', by('Alice Gallo'), 'spam', 'Posts the same link in every chat.', { status: 'resolved', assignedTo: staff.mod, firstReviewedAt: ago(40), resolvedAt: ago(36), resolution: 'Suspended for 7 days.' }, 48);
  await rep('Sara Ricci', 'user', by('Tommaso Barbieri'), 'fraud', 'Asked everyone in the group to send money to a personal account before the trip.', { priority: 'normal', escalationLevel: 1, escalatedAt: ago(20), status: 'open' }, 30);
  await rep('Federica Serra', 'user', by('Jean Dupont'), 'physical_safety', 'He threatened another member in the chat after the dinner. I am worried about the next event.', { priority: 'urgent', status: 'open', escalationLevel: 2, escalatedAt: ago(2) }, 4);
  await rep('Jean Dupont', 'user', by('Bianca Moretti'), 'underage', 'Her profile says 18 but she mentioned being in year 10 at school.', { status: 'in_review', assignedTo: staff.mod, firstReviewedAt: ago(1) }, 9);
  await rep('Marta Colombo', 'user', by('Nicolo Esposito'), 'inappropriate_content', 'Profile text with offensive language.', { status: 'dismissed', assignedTo: staff.mod, firstReviewedAt: ago(100), resolvedAt: ago(98), resolution: 'Checked: the wording is within the rules.' }, 120);
  await rep('Alice Gallo', 'user', by('Davide Greco'), 'financial_solicitation', 'Offered a paid "VIP list" to join his events.', { status: 'open' }, 6);
  if (activities[0]) await rep('Matteo Ferri', 'activity', activities[0].id, 'inappropriate_content', 'The description promotes something that looks like a pyramid scheme.', { status: 'open' }, 12);
  if (activities[1]) await rep('Irene Fontana', 'activity', activities[1].id, 'fraud', 'The venue does not exist at that address.', { status: 'in_review', assignedTo: staff.mod, firstReviewedAt: ago(3) }, 14);
  if (activities[2]) await rep('Elena Marchetti', 'activity', activities[2].id, 'spam', 'Same event posted three times.', { status: 'resolved', assignedTo: staff.mod, resolvedAt: ago(30), resolution: 'Two copies removed.' }, 40);
  if (trips[0]) await rep('Sara Ricci', 'trip', trips[0].id, 'fraud', 'The organiser asks for a deposit outside the app.', { status: 'open', priority: 'normal' }, 22);

  // appeals
  const appeal = (name: string, kind: string, message: string, extra: Record<string, unknown> = {}, h = 10) =>
    prisma.appeal.create({ data: { userId: by(name), kind, message, createdAt: ago(h), ...extra } as never });
  await appeal('Franco Villa', 'verification', 'My passport photo was blurry because of the glare. I have attached a new one in the app and can retry in daylight.', {}, 30);
  await appeal('Irene Fontana', 'verification', 'The face match failed because I wore glasses, which I never wear in my photo. Please check again.', { state: 'rejected', decidedBy: staff.trust, decidedAt: ago(40), decision: 'We looked again: the document photo and the live photo do not match. You can try again with a new check.' }, 60);
  await appeal('Riccardo Leone', 'suspension', 'I was not harassing anyone, we simply disagreed about the plans. I would like to be given another chance.', {}, 8);
  await appeal('Alice Gallo', 'suspension', 'The link was a group chat for my running club, not spam. I will not post links again.', { state: 'upheld', decidedBy: staff.mod, decidedAt: ago(20), decision: 'Understood. We have shortened the suspension and noted your promise.' }, 30);
  if (activities[3]) await appeal('Davide Greco', 'removal', 'My event was removed but it was a genuine free coffee meetup.', { targetType: 'activity', targetId: activities[3].id }, 16);

  // no-show notes and their stages
  const plan = (i: number) => activities[i] ?? activities[0];
  if (plan(0)) {
    const mark = (host: string, who: string, i: number, state: string, extra: Record<string, unknown> = {}) =>
      prisma.attendanceMark.create({ data: { kind: 'activity', targetId: plan(i).id, userId: by(who), markedById: by(host), title: plan(i).title, planEndsAt: ago(20 + i * 5), markedAt: ago(18 + i * 5), state, ...extra } as never }).catch(() => undefined);
    await mark('Elena Marchetti', 'Tommaso Barbieri', 0, 'marked');
    await mark('Elena Marchetti', 'Davide Greco', 1, 'disputed', { disputeNote: 'My train was cancelled and I told the host in the chat before the start.', disputedAt: ago(10) });
    await mark('Matteo Ferri', 'Bianca Moretti', 2, 'upheld', { disputedAt: ago(40), disputeNote: 'I was ill.', decidedById: staff.mod, decidedAt: ago(30), decisionNote: 'No message to the host before the start: the note stands.' });
    await mark('Sara Ricci', 'Nicolo Esposito', 3, 'overturned', { disputedAt: ago(60), disputeNote: 'The venue changed and nobody told me.', decidedById: staff.mod, decidedAt: ago(50), decisionNote: 'The host changed the place late. The note is removed.' });
  }

  // warnings
  await prisma.userWarning.create({ data: { userId: by('Tommaso Barbieri'), reason: 'Asking people to send money outside the app is not allowed.', createdById: staff.mod, createdAt: ago(25) } });
  await prisma.userWarning.create({ data: { userId: by('Davide Greco'), reason: 'Selling a "VIP list" is not allowed.', createdById: staff.mod, createdAt: ago(5), withdrawnAt: null } });

  // places and limits
  const region = (key: string, name: string, kind: string, parentKey: string | null, cityKey: string | null, hereMonths: number | null, thereMonths: number | null) =>
    prisma.region.upsert({ where: { key }, update: {}, create: { key, name, kind, parentKey, cityKey, hereMonths, thereMonths, updatedById: admin.id } }).catch(() => undefined);
  await prisma.region.upsert({ where: { key: 'global' }, update: {}, create: { key: 'global', name: 'Whole service', kind: 'global' } }).catch(() => undefined);
  await region('it', 'Italy', 'country', 'global', null, 2, 9);
  await region('it-lombardy', 'Lombardy', 'region', 'it', null, null, null);
  await region('it-lazio', 'Lazio', 'region', 'it', null, 1, 6);
  await region('it-milan', 'Milan', 'city', 'it-lombardy', 'milan', 3, null);
  await region('it-rome', 'Rome', 'city', 'it-lazio', 'rome', null, 12);
  await region('fr', 'France', 'country', 'global', null, 1, 6);
  await region('fr-paris', 'Paris', 'city', 'fr', 'paris', null, null);
  // staff always look after one area: Rome for Chiara, Milan for the others
  for (const [name, area] of [['Giulia Rossi', 'it-milan'], ['Luca Bianchi', 'it-milan'], ['Chiara Conti', 'it-rome'], ['Paolo Neri', 'it-milan']] as const)
    await prisma.user.update({ where: { id: by(name) }, data: { adminRegionKey: area, staffPermissions: name === 'Luca Bianchi' ? ['users', 'content'] : ['reports', 'verification', 'users', 'content'] } });

  // audit entries: what the staff did, spread over the last days
  const log = (actor: string, action: string, objectType: string, objectId: string, meta: Record<string, unknown>, h: number) =>
    prisma.auditEvent.create({ data: { actorId: actor, action, objectType, objectId, metadata: JSON.stringify({ demo: 'fill', ...meta }), createdAt: ago(h) } });
  await log(staff.mod, 'user.suspend', 'user', by('Riccardo Leone'), { reason: 'Harassment confirmed in chat logs', until: 'restored by staff' }, 60);
  await log(staff.mod, 'user.suspend', 'user', by('Alice Gallo'), { reason: 'Spam links', days: 7 }, 36);
  await log(staff.mod, 'report.resolve', 'report', 'demo', { status: 'resolved', resolution: 'Suspended until staff restore the account.' }, 60);
  await log(staff.mod, 'report.resolve', 'report', 'demo', { status: 'dismissed', resolution: 'Wording within the rules.' }, 98);
  await log(staff.trust, 'verification.decision', 'verification', 'demo', { decision: 'rejected', reason: 'document_unreadable' }, 50);
  await log(staff.trust, 'verification.decision', 'verification', 'demo', { decision: 'verified' }, 380);
  await log(staff.trust, 'appeal.decision', 'appeal', 'demo', { state: 'rejected' }, 40);
  await log(staff.mod, 'appeal.decision', 'appeal', 'demo', { state: 'upheld' }, 20);
  await log(staff.mod, 'warning.create', 'user', by('Tommaso Barbieri'), { reason: 'Money outside the app' }, 25);
  await log(staff.mod, 'attendance.decision', 'attendance', 'demo', { state: 'upheld' }, 30);
  await log(admin.id, 'staff.create', 'user', by('Giulia Rossi'), { role: 'staff' }, 200);
  await log(admin.id, 'staff.create', 'user', by('Chiara Conti'), { role: 'staff' }, 190);
  await log(admin.id, 'user.role_change', 'user', by('Paolo Neri'), { role: 'staff' }, 90);
  await log(admin.id, 'region.update', 'region', 'it', { hereMonths: 2, thereMonths: 9 }, 70);
  await log(staff.support, 'mfa.enabled', 'user', staff.support, {}, 120);
  await log(staff.mod, 'mfa.enabled', 'user', staff.mod, {}, 130);
  await log(admin.id, 'mfa.reset_by_admin', 'user', by('Chiara Conti'), { reason: 'Lost phone' }, 100);
  await log(staff.mod, 'login.lockout', 'user', by('Tommaso Barbieri'), { ip: '203.0.113.5' }, 12);

  console.log(`Added ${made.length} demo accounts (all @fill.demo, password demo-password-1), reports, identity checks, appeals, no-show notes, warnings, on-call shifts, places and audit entries. Take it out with: node dist/scripts/seed-admin-demo.js --remove`);
}

main().finally(() => prisma.$disconnect());
