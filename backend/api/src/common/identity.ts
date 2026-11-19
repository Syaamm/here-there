import { User } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { blindIndex } from './vault';

export const emailFingerprint = (email: string) => blindIndex('email', email.trim().toLowerCase());

/** Is this email or number linked to an account that staff suspended until further notice? */
export async function isBanned(prisma: PrismaService, checks: { kind: 'email' | 'phone'; hash: string | null }[]) {
  const wanted = checks.filter((c): c is { kind: 'email' | 'phone'; hash: string } => !!c.hash);
  if (wanted.length === 0) return false;
  return !!(await prisma.bannedIdentity.findFirst({ where: { OR: wanted.map((c) => ({ kind: c.kind, hash: c.hash })) }, select: { id: true } }));
}

/** Remember the fingerprints of a banned account's email and number, so a fresh account cannot reuse them. */
export async function banIdentities(prisma: PrismaService, user: User, reason: string) {
  const items: { kind: string; hash: string }[] = [{ kind: 'email', hash: emailFingerprint(user.email) }];
  if (user.phoneHash) items.push({ kind: 'phone', hash: user.phoneHash });
  for (const i of items) {
    await prisma.bannedIdentity.upsert({ where: { kind_hash: { kind: i.kind, hash: i.hash } }, create: { ...i, userId: user.id, reason }, update: { userId: user.id, reason } });
  }
  return items.length;
}

export const liftBans = (prisma: PrismaService, userId: string) => prisma.bannedIdentity.deleteMany({ where: { userId } });
