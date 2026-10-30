import type { Prisma } from '@prisma/client';

/**
 * Take a lock on one activity (or trip) for the rest of the transaction, and read its CURRENT capacity and status.
 *
 * "Count the members, then add one" is only safe if nobody else can add a member between the two steps. SQLite lets one
 * writer in at a time, which hides the gap; PostgreSQL does not (two transactions can both count 2 of 3 and both insert).
 * A write to the activity's own row makes a second transaction on the same activity wait until the first has committed,
 * on both databases, and it then counts again. Call this first in every transaction that adds or removes a member.
 */
export const lockActivity = (tx: Prisma.TransactionClient, id: string) =>
  tx.activity.update({ where: { id }, data: { updatedAt: new Date() }, select: { capacity: true, status: true } });

export const lockTrip = (tx: Prisma.TransactionClient, id: string) =>
  tx.trip.update({ where: { id }, data: { updatedAt: new Date() }, select: { maxCapacity: true, status: true } });
