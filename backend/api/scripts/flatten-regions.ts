/**
 * Keeps only the whole-service default and the cities in the Region table: countries and regions are removed.
 * Each city moves directly under the default and keeps the retention it had in practice (a value it took from its country or
 * region becomes its own value), so no city's limits change. Staff whose area was a country or region are left with no area
 * (an admin gives them a city again). It only reports what it would do unless you add --apply.
 * Usage: npm run build && node dist/scripts/flatten-regions.js          (look)
 *        node dist/scripts/flatten-regions.js --apply                   (do it)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const rows = await prisma.region.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const root = rows.find((r) => r.kind === 'global');
  if (!root) throw new Error('There is no whole-service row (kind "global"): nothing to move the cities under.');
  const cities = rows.filter((r) => r.kind === 'city');
  const remove = rows.filter((r) => r.kind === 'country' || r.kind === 'region');

  // what a city really gets today: its own value, else the nearest parent that has one, else the whole service
  const effective = (r: (typeof rows)[number], f: 'hereMonths' | 'thereMonths'): number | null => {
    for (let p: typeof r | undefined = r, i = 0; p && i < 10; p = p.parentKey ? byKey.get(p.parentKey) : undefined, i++) if (p[f] !== null) return p[f];
    return null;
  };
  const moves = cities.map((c) => {
    const here = effective(c, 'hereMonths');
    const there = effective(c, 'thereMonths');
    return {
      key: c.key,
      name: c.name,
      from: c.parentKey,
      hereMonths: here !== null && here !== root.hereMonths ? here : null,
      thereMonths: there !== null && there !== root.thereMonths ? there : null,
    };
  });
  const gone = remove.map((r) => r.key);
  const staff = await prisma.user.findMany({ where: { adminRegionKey: { in: gone } }, select: { email: true, adminRegionKey: true } });

  console.log(`Removing ${remove.length}: ${remove.map((r) => `${r.name} (${r.kind})`).join(', ') || 'none'}`);
  for (const m of moves) console.log(`  city ${m.name}: under ${m.from ?? '-'} -> ${root.key}; activities ${m.hereMonths ?? 'default'}, trips ${m.thereMonths ?? 'default'}`);
  console.log(`Staff left without an area: ${staff.length ? staff.map((s) => `${s.email} (${s.adminRegionKey})`).join(', ') : 'none'}`);
  if (!apply) return console.log('\nNothing changed. Add --apply to do it.');

  await prisma.$transaction([
    ...moves.map((m) => prisma.region.update({ where: { key: m.key }, data: { parentKey: root.key, hereMonths: m.hereMonths, thereMonths: m.thereMonths } })),
    prisma.user.updateMany({ where: { adminRegionKey: { in: gone } }, data: { adminRegionKey: null } }),
    prisma.region.deleteMany({ where: { key: { in: gone } } }),
  ]);
  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
