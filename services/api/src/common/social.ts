import { PrismaService } from './prisma.service';

/**
 * Who a person cares about, in three tiers (used to put what their circle is going to first):
 *   buddies     people they follow who follow them back (mutual)
 *   following   people they follow who do not follow back
 *   everyone else, including people who follow them but whom they do not follow: no boost
 */
export type Circle = { buddies: Set<string>; following: Set<string> };

export async function circleOf(prisma: PrismaService, meId: string): Promise<Circle> {
  const out = await prisma.follow.findMany({ where: { followerId: meId }, select: { followingId: true } });
  const followed = new Set(out.map((f) => f.followingId));
  if (followed.size === 0) return { buddies: new Set(), following: new Set() };
  const back = await prisma.follow.findMany({ where: { followingId: meId, followerId: { in: [...followed] } }, select: { followerId: true } });
  const buddies = new Set(back.map((f) => f.followerId));
  return { buddies, following: new Set([...followed].filter((id) => !buddies.has(id))) };
}

/** How many of these people are buddies, and how many are people the viewer follows (not buddies). Each person counts once. */
export function tierCounts(people: Iterable<string>, circle: Circle) {
  let buddies = 0;
  let following = 0;
  for (const id of new Set(people)) {
    if (circle.buddies.has(id)) buddies++;
    else if (circle.following.has(id)) following++;
  }
  return { buddies, following };
}

/** 0 people = 0; 1 = 0.6; 2 = 0.84; 3 = 0.94: the first person matters most, and it never passes 1. */
export const crowd = (n: number) => (n <= 0 ? 0 : 1 - 0.4 ** n);

/** The small line shown on a card: "2 buddies going", or "1 you follow going" when no buddy is. */
export const circleLine = (buddies: number, following: number) =>
  buddies > 0 ? `${buddies} ${buddies === 1 ? 'buddy' : 'buddies'} going` : following > 0 ? `${following} you follow ${following === 1 ? 'is' : 'are'} going` : null;
