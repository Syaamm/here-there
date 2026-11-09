import { PrismaService } from './prisma.service';

/**
 * Who a person cares about, in tiers (used to put what their circle is going to first), strongest first:
 *   buddies     people they follow who follow them back (friends, mutual)
 *   following   people they follow who do not follow back
 *   followers   people who follow them whom they do not follow (owner's decision 2026-11-09: a small boost; it was none)
 *   everyone else: no boost
 */
export type Circle = { buddies: Set<string>; following: Set<string>; followers: Set<string> };

export async function circleOf(prisma: PrismaService, meId: string): Promise<Circle> {
  const [out, inn] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: meId }, select: { followingId: true } }),
    prisma.follow.findMany({ where: { followingId: meId }, select: { followerId: true } }),
  ]);
  const followed = new Set(out.map((f) => f.followingId));
  const followsMe = new Set(inn.map((f) => f.followerId));
  const buddies = new Set([...followed].filter((id) => followsMe.has(id)));
  return { buddies, following: new Set([...followed].filter((id) => !buddies.has(id))), followers: new Set([...followsMe].filter((id) => !buddies.has(id))) };
}

/** How many of these people are in each tier (each person counts once, in their strongest tier). */
export function tierCounts(people: Iterable<string>, circle: Circle) {
  let buddies = 0;
  let following = 0;
  let followers = 0;
  for (const id of new Set(people)) {
    if (circle.buddies.has(id)) buddies++;
    else if (circle.following.has(id)) following++;
    else if (circle.followers?.has(id)) followers++;
  }
  return { buddies, following, followers };
}

/** 0 people = 0; 1 = 0.6; 2 = 0.84; 3 = 0.94: the first person matters most, and it never passes 1. */
export const crowd = (n: number) => (n <= 0 ? 0 : 1 - 0.4 ** n);

/** The small line shown on a card: "2 buddies going", or "1 you follow going" when no buddy is. */
export const circleLine = (buddies: number, following: number) =>
  buddies > 0 ? `${buddies} ${buddies === 1 ? 'buddy' : 'buddies'} going` : following > 0 ? `${following} you follow ${following === 1 ? 'is' : 'are'} going` : null;
