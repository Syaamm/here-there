/**
 * Local demo for a chat with a long history: Alex hosts an activity whose group chat already holds a few hundred messages
 * from seven people over the last week, so scrolling up to load earlier messages (and the day dividers) can be tried.
 * Every message starts with its number (#1 is the oldest), so you can see the order is right and nothing is skipped.
 * Safe to run again: the previous "Long chat demo" activity of Alex is removed and a fresh one is made, relative to now.
 * Usage: npm run build && npm run demo:chat   (optionally: npm run demo:chat -- 400   for 400 messages)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TITLE = 'Long chat demo: Sunday brunch and a walk';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const LINES = [
  'Good morning everyone!', 'Has anyone checked the weather for Sunday?', 'It should be sunny, around 18 degrees.', 'Perfect for a walk after brunch.',
  'I can bring a blanket for the park.', 'I will bring some fruit and a thermos of coffee.', 'Is the bakery near the gate open that early?',
  'I think it opens at eight on Sundays.', 'Let us meet by the arch then, ten o clock?', 'Ten works for me.', 'Could we make it ten thirty? I am coming from Navigli.',
  'Ten thirty is fine, no rush.', 'How long is the walk, roughly?', 'About five kilometres, very easy, we stop for photos.', 'Nice, I will wear comfortable shoes.',
  'Does anyone have a good playlist?', 'I can make one, send me your favourite songs.', 'Please nothing too loud, we are in a public park.',
  'Fair point, something calm then.', 'Is there anything we should bring for the picnic?', 'Just yourself and something to share, if you like.',
  'I will bring homemade focaccia.', 'Amazing, thank you!', 'Any allergies in the group?', 'Not me, I eat everything.', 'I am vegetarian, but that is easy.',
  'Noted, I will bring vegetarian options too.', 'What if it rains?', 'Then we move to the cafe in Brera and play board games.', 'Good plan B.',
  'I have a small card game in my bag, just in case.', 'Haha, of course you do.', 'Who is coming by metro?', 'I am taking the red line to Cadorna.',
  'Same, we can walk together from the station.', 'See you at Cadorna at ten fifteen then.', 'Is it okay if I bring a friend?', 'Please ask them to request to join first.',
  'Will do, they are verified already.', 'Great, the more the merrier.', 'I forgot to say, there is a free guided tour at noon.', 'Oh nice, is it in English?',
  'English and Italian, I checked.', 'Count me in for the tour.', 'Me too!', 'I will skip the tour but join for the coffee afterwards.', 'That works.',
  'Thanks for organising this, Alex.', 'My pleasure, I am happy to see everyone.', 'Does anyone need a lift back afterwards?', 'I have two free seats.',
  'Thank you, that is kind.', 'Remember to take some water with you.', 'And sunscreen, the sun can be strong at midday.', 'Good tip.',
  'I just saw some clouds in the forecast, but only later in the evening.', 'Then we are fine.', 'Photos from last time are in my phone, I can share them.',
  'Yes please, I would love to see them.', 'Here you go, it was such a good day.', 'Lovely pictures!', 'Looking forward to Sunday.', 'Me too, see you all soon.',
];

async function main() {
  const count = Math.min(Math.max(Number(process.argv[2]) || 240, 60), 2000);
  const email = (n: string) => `${n}@demo.local`;
  const alex = await prisma.user.findUnique({ where: { email: email('alex') } });
  if (!alex) throw new Error('The demo account alex is missing: run the seed first (npm run seed).');
  const others = await prisma.user.findMany({ where: { email: { in: ['sofia', 'marco', 'giulia', 'luca', 'anna', 'tom'].map(email) } } });
  if (others.length < 3) throw new Error('The other demo accounts are missing: run the seed first (npm run seed).');

  // start fresh: remove the last run's activity (its chat and members go with it)
  const old = await prisma.activity.findMany({ where: { hostId: alex.id, title: TITLE }, select: { id: true } });
  for (const o of old) {
    await prisma.activity.delete({ where: { id: o.id } }).catch(() => prisma.activity.update({ where: { id: o.id }, data: { status: 'cancelled' } }));
  }

  // an activity in three days, so the chat is open to write in and the plan is upcoming
  const startsAt = new Date(Math.ceil((Date.now() + 3 * DAY) / HOUR) * HOUR);
  const activity = await prisma.activity.create({
    data: {
      hostId: alex.id, title: TITLE, category: 'food', city: 'Milan', cityKey: 'milan', venueName: 'Parco Sempione north gate (Sempione)', lat: 45.475, lng: 9.172,
      startsAt, endsAt: new Date(+startsAt + 4 * HOUR), capacity: 12, status: 'published',
      description: 'Made by the long-chat demo, to try scrolling through a chat with many messages.',
    },
  });
  await prisma.activityMembership.create({ data: { activityId: activity.id, userId: alex.id, role: 'host' } });
  for (const p of others) {
    await prisma.activityMembership.create({ data: { activityId: activity.id, userId: p.id, role: 'attendee', state: 'approved' } });
    await prisma.activityRequest.create({ data: { activityId: activity.id, applicantId: p.id, state: 'approved', decidedAt: new Date(), reviewedBy: alex.id } });
  }
  const conv = await prisma.conversation.create({ data: { scopeType: 'activity', activityId: activity.id } });

  // the messages: oldest first, spread over the last seven days up to a few minutes ago, from everyone (Alex most often).
  // A fixed pseudo-random sequence, so every run reads the same.
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const people = [alex, alex, ...others];
  const from = Date.now() - 7 * DAY;
  const to = Date.now() - 4 * 60 * 1000;
  const rows = [];
  for (let i = 1; i <= count; i++) {
    // later messages are a little closer together, like a plan getting nearer; a night gap now and then
    let at = from + ((to - from) * (i - 1)) / (count - 1);
    at += Math.floor(next() * 20 * 60 * 1000);
    rows.push({
      conversationId: conv.id,
      senderId: people[Math.floor(next() * people.length)].id,
      body: `#${i} ${LINES[Math.floor(next() * LINES.length)]}`,
      createdAt: new Date(Math.min(at, to)),
    });
  }
  rows.sort((a, b) => +a.createdAt - +b.createdAt);
  // the numbers follow the time order, so #1 is the oldest and the highest number is the newest
  rows.forEach((r, i) => (r.body = r.body.replace(/^#\d+/, `#${i + 1}`)));
  await prisma.message.createMany({ data: rows });

  console.log(`\nMade "${TITLE}" with ${count} messages from ${others.length + 1} people (#1 oldest, #${count} newest).`);
  console.log('Sign in as alex@demo.local / demo-password-1, open Inbox > Chats, open the chat and scroll up.\n');
}

main().finally(() => prisma.$disconnect());
