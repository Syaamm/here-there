import { User } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { blindIndex } from './vault';

/** How many accounts one phone or tablet may create in 30 days (a family sharing a device is why it is not 1). */
export const MAX_ACCOUNTS_PER_DEVICE = () => Number(process.env.MAX_ACCOUNTS_PER_DEVICE ?? 3);
const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

/** The app sends a random id it made for this install. Only a keyed fingerprint of it is ever stored. */
export function deviceFingerprint(raw: string | string[] | undefined): string | null {
  const id = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!id || id.length < 16 || id.length > 100) return null;
  return blindIndex('device', id);
}

export const emailFingerprint = (email: string) => blindIndex('email', email.trim().toLowerCase());

/** Is this email, number or device linked to an account that staff suspended until further notice? */
export async function isBanned(prisma: PrismaService, checks: { kind: 'email' | 'phone' | 'device'; hash: string | null }[]) {
  const wanted = checks.filter((c): c is { kind: 'email' | 'phone' | 'device'; hash: string } => !!c.hash);
  if (wanted.length === 0) return false;
  return !!(await prisma.bannedIdentity.findFirst({ where: { OR: wanted.map((c) => ({ kind: c.kind, hash: c.hash })) }, select: { id: true } }));
}

/** Too many accounts from one device lately? */
export async function deviceOverLimit(prisma: PrismaService, device: string | null) {
  if (!device) return false;
  const made = await prisma.user.count({ where: { registeredDevice: device, createdAt: { gt: new Date(Date.now() - THIRTY_DAYS) } } });
  return made >= MAX_ACCOUNTS_PER_DEVICE();
}

/** Remember the fingerprints of a banned account's email, number and device, so a fresh account cannot reuse them. */
export async function banIdentities(prisma: PrismaService, user: User, reason: string) {
  const items: { kind: string; hash: string }[] = [{ kind: 'email', hash: emailFingerprint(user.email) }];
  if (user.phoneHash) items.push({ kind: 'phone', hash: user.phoneHash });
  if (user.registeredDevice) items.push({ kind: 'device', hash: user.registeredDevice });
  for (const i of items) {
    await prisma.bannedIdentity.upsert({ where: { kind_hash: { kind: i.kind, hash: i.hash } }, create: { ...i, userId: user.id, reason }, update: { userId: user.id, reason } });
  }
  return items.length;
}

export const liftBans = (prisma: PrismaService, userId: string) => prisma.bannedIdentity.deleteMany({ where: { userId } });
