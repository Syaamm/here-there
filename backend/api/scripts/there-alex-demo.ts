/**
 * THERE demo for Alex (alex@demo.local, made by the seed): enough trips to try THERE Home and every "See all" page.
 *
 *   Next up        3 trips of Alex's own: one he organises, one he is going on, one he applied to (never repeated below)
 *   Leaving soon   9 trips leaving in the next two weeks
 *   Next months    10 trips leaving in 2 weeks to 3 months
 *   Later          8 trips leaving in 3 to 6 months
 *
 * Alex's circle, so the ranking can be seen (friends' trips first, then people he follows, then his followers, then the rest):
 *   friends (follow each other): Sofia, Marco      he follows: Giulia, Luca      follow him: Anna, Tom
 *
 * Safe to run again: the trips made by the last run (titles starting "Alex demo:") are removed first.
 * Usage: npm run build && npm run demo:there:alex     then sign in as alex@demo.local / demo-password-1 and switch to THERE.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const PASSWORD = 'demo-password-1';
const DAY = 24 * 3600 * 1000;
const PREFIX = 'Alex demo: ';

async function person(email: string, name: string, homeCity = 'Milan') {
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
      profile: { create: { displayName: name, homeCity, homeCityKey: homeCity.toLowerCase(), languages: 'English,Italian', interests: 'travel,food,culture', bio: `${name} likes slow travel and good company.` } },
    },
  });
}

async function follow(from: { id: string }, to: { id: string }) {
  await prisma.follow.upsert({ where: { followerId_followingId: { followerId: from.id, followingId: to.id } }, create: { followerId: from.id, followingId: to.id }, update: {} });
}

/** midday, `days` from today: so a trip "in 3 days" stays in the same section all day */
const at = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(12, 0, 0, 0);
  return d;
};

async function main() {
  const alex = await prisma.user.findUnique({ where: { email: 'alex@demo.local' } });
  if (!alex) throw new Error('The demo account alex@demo.local is missing: run the seed first (npm run seed).');

  // ---- the people around Alex
  const sofia = await person('sofia@demo.local', 'Sofia');
  const marco = await person('marco@demo.local', 'Marco');
  const giulia = await person('giulia@demo.local', 'Giulia');
  const luca = await person('luca@demo.local', 'Luca');
  const anna = await person('anna@demo.local', 'Anna');
  const tom = await person('tom@demo.local', 'Tom');
  // travellers Alex does not know
  const priya = await person('there-priya@demo.local', 'Priya', 'Rome');
  const kenji = await person('there-kenji@demo.local', 'Kenji', 'Turin');
  const lea = await person('there-lea@demo.local', 'Léa', 'Bologna');
  const omar = await person('there-omar@demo.local', 'Omar', 'Florence');
  const ines = await person('there-ines@demo.local', 'Inês', 'Genoa');
  const sam = await person('there-sam@demo.local', 'Sam', 'Verona');

  // friends: both ways; following: Alex to them; followers: them to Alex
  for (const f of [sofia, marco]) (await follow(alex, f), await follow(f, alex));
  for (const f of [giulia, luca]) await follow(alex, f);
  for (const f of [anna, tom]) await follow(f, alex);

  // ---- start fresh
  await prisma.trip.deleteMany({ where: { title: { startsWith: PREFIX } } });

  type Spec = { title: string; host: { id: string }; dest: string; from: string; start: number; nights: number; budget: [number, number]; tags: string; size?: [number, number]; members?: { id: string }[]; about?: string; transport?: boolean };
  const make = async (s: Spec) => {
    const t = await prisma.trip.create({
      data: {
        hostId: s.host.id,
        title: PREFIX + s.title,
        destination: s.dest,
        destinationKey: s.dest.toLowerCase(),
        originCity: s.from,
        originKey: s.from.toLowerCase(),
        dateStart: at(s.start),
        dateEnd: at(s.start + s.nights),
        dateFlexibility: s.nights > 6 ? 'plus_minus_3' : 'exact',
        budgetMin: s.budget[0],
        budgetMax: s.budget[1],
        budgetIncludesTransport: s.transport ?? true,
        tags: s.tags,
        description: s.about ?? null,
        minCapacity: s.size?.[0] ?? 3,
        maxCapacity: s.size?.[1] ?? 6,
        status: 'published',
        visibility: 'public',
      },
    });
    await prisma.tripMembership.create({ data: { tripId: t.id, userId: s.host.id, role: 'organizer', state: 'approved', datesConfirmed: true } });
    for (const m of s.members ?? []) await prisma.tripMembership.create({ data: { tripId: t.id, userId: m.id, role: 'member', state: 'approved' } });
    await prisma.conversation.create({ data: { scopeType: 'trip', tripId: t.id } });
    return t;
  };

  // ---- Alex's own trips: in Next up only
  await make({ title: 'Amsterdam canals by bike', host: alex, dest: 'Amsterdam, Netherlands', from: 'Milan', start: 20, nights: 4, budget: [450, 700], tags: 'city,culture', members: [sofia], about: 'Bikes, museums and canal-side dinners.' });
  await make({ title: 'Vienna Christmas markets', host: sofia, dest: 'Vienna, Austria', from: 'Milan', start: 9, nights: 3, budget: [300, 500], tags: 'city,food', members: [alex, marco] });
  const lapland = await make({ title: 'Lapland northern lights', host: marco, dest: 'Rovaniemi, Finland', from: 'Milan', start: 45, nights: 5, budget: [900, 1400], tags: 'nature,adventure,photography', size: [3, 5] });
  await prisma.tripApplication.create({ data: { tripId: lapland.id, applicantId: alex.id, intro: 'I have always wanted to see the northern lights. I am easy-going and happy to help plan.', experience: 'intermediate', state: 'pending' } });

  // ---- Leaving soon: the next two weeks (friends' trips should come first, then people Alex follows, then followers)
  const soon: Spec[] = [
    { title: 'Weekend in Lisbon', host: priya, dest: 'Lisbon, Portugal', from: 'Rome', start: 3, nights: 3, budget: [350, 550], tags: 'city,food' },
    { title: 'Dolomites hut-to-hut', host: marco, dest: 'Dolomites, Italy', from: 'Milan', start: 6, nights: 4, budget: [300, 450], tags: 'hiking,nature', about: 'Three huts, big views, early starts.' },
    { title: 'Barcelona tapas and Gaudí', host: kenji, dest: 'Barcelona, Spain', from: 'Turin', start: 4, nights: 4, budget: [400, 650], tags: 'food,art,city' },
    { title: 'Lake Como slow days', host: giulia, dest: 'Lake Como, Italy', from: 'Milan', start: 8, nights: 2, budget: [200, 350], tags: 'relax,nature' },
    { title: 'Paris photo walk', host: anna, dest: 'Paris, France', from: 'Milan', start: 5, nights: 3, budget: [450, 700], tags: 'photography,city' },
    { title: 'Ljubljana and Lake Bled', host: lea, dest: 'Ljubljana, Slovenia', from: 'Bologna', start: 10, nights: 3, budget: [300, 480], tags: 'nature,city', members: [luca] },
    { title: 'Prague old town', host: omar, dest: 'Prague, Czechia', from: 'Florence', start: 12, nights: 3, budget: [320, 500], tags: 'culture,city' },
    { title: 'Cinque Terre coast walk', host: sofia, dest: 'Cinque Terre, Italy', from: 'Milan', start: 11, nights: 2, budget: [220, 380], tags: 'hiking,beach' },
    { title: 'Budapest baths and ruin bars', host: sam, dest: 'Budapest, Hungary', from: 'Verona', start: 7, nights: 4, budget: [350, 520], tags: 'relax,city' },
  ];
  // ---- In the next few months: 2 weeks to 3 months
  const months: Spec[] = [
    { title: 'Morocco desert and Marrakech', host: ines, dest: 'Marrakech, Morocco', from: 'Genoa', start: 24, nights: 7, budget: [800, 1200], tags: 'adventure,culture' },
    { title: 'Iceland ring road', host: luca, dest: 'Reykjavik, Iceland', from: 'Milan', start: 35, nights: 8, budget: [1400, 2100], tags: 'nature,photography,adventure', size: [3, 4] },
    { title: 'Seville and Granada', host: priya, dest: 'Seville, Spain', from: 'Rome', start: 28, nights: 5, budget: [500, 800], tags: 'culture,food' },
    { title: 'Greek islands hopping', host: marco, dest: 'Naxos, Greece', from: 'Milan', start: 60, nights: 7, budget: [700, 1100], tags: 'beach,relax' },
    { title: 'Berlin art weekend', host: kenji, dest: 'Berlin, Germany', from: 'Turin', start: 19, nights: 3, budget: [350, 550], tags: 'art,city' },
    { title: 'Scottish Highlands', host: tom, dest: 'Inverness, Scotland', from: 'Milan', start: 42, nights: 6, budget: [900, 1300], tags: 'hiking,nature' },
    { title: 'Copenhagen food tour', host: lea, dest: 'Copenhagen, Denmark', from: 'Bologna', start: 50, nights: 3, budget: [600, 900], tags: 'food,city' },
    { title: 'Sicily road trip', host: omar, dest: 'Palermo, Italy', from: 'Florence', start: 70, nights: 7, budget: [600, 950], tags: 'beach,food,culture', members: [giulia] },
    { title: 'Swiss Alps by train', host: sam, dest: 'Zermatt, Switzerland', from: 'Verona', start: 33, nights: 4, budget: [900, 1400], tags: 'nature,photography' },
    { title: 'Istanbul two continents', host: ines, dest: 'Istanbul, Türkiye', from: 'Genoa', start: 80, nights: 5, budget: [600, 900], tags: 'culture,food' },
  ];
  // ---- Later: 3 to 6 months
  const later: Spec[] = [
    { title: 'Japan cherry blossom', host: kenji, dest: 'Kyoto, Japan', from: 'Turin', start: 120, nights: 12, budget: [2200, 3200], tags: 'culture,photography', size: [4, 6] },
    { title: 'Patagonia trekking', host: priya, dest: 'El Chaltén, Argentina', from: 'Rome', start: 150, nights: 14, budget: [2500, 3600], tags: 'hiking,adventure,nature', size: [3, 5] },
    { title: 'Norwegian fjords', host: sofia, dest: 'Bergen, Norway', from: 'Milan', start: 110, nights: 6, budget: [1100, 1600], tags: 'nature,photography' },
    { title: 'Vietnam north to south', host: lea, dest: 'Hanoi, Vietnam', from: 'Bologna', start: 140, nights: 16, budget: [1800, 2600], tags: 'adventure,food,culture' },
    { title: 'Madeira hiking', host: giulia, dest: 'Funchal, Madeira', from: 'Milan', start: 100, nights: 6, budget: [800, 1200], tags: 'hiking,nature' },
    { title: 'Mexico City and Oaxaca', host: omar, dest: 'Mexico City, Mexico', from: 'Florence', start: 160, nights: 10, budget: [1800, 2500], tags: 'food,art,culture' },
    { title: 'Canary Islands surf week', host: anna, dest: 'Lanzarote, Spain', from: 'Milan', start: 130, nights: 7, budget: [700, 1000], tags: 'beach,adventure' },
    { title: 'Edinburgh festival', host: sam, dest: 'Edinburgh, Scotland', from: 'Verona', start: 170, nights: 5, budget: [900, 1300], tags: 'art,city' },
  ];
  for (const s of [...soon, ...months, ...later]) await make(s);

  console.log(`
THERE demo for Alex is ready (${3 + soon.length + months.length + later.length} trips). Password for everyone: ${PASSWORD}

Sign in as alex@demo.local in the app and switch to THERE:
  Next up        Amsterdam (you organise), Vienna (you are going), Lapland (you applied). These are NOT in the lists below.
  Leaving soon   ${soon.length} trips in the next two weeks: "+N more trips · See all" opens them all.
                 Order: friends first (Marco, Sofia), then people you follow (Giulia; Ljubljana has Luca going),
                 then your followers (Anna), then everyone else.
  Next months    ${months.length} trips (2 weeks to 3 months), with See all.
  Later          ${later.length} trips (3 to 6 months), with See all.
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
