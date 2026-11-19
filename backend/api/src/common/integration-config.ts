import { CATALOG, INTEGRATION_KINDS, Kind } from '../admin/integration-catalog';
import { decryptField } from './vault';

/**
 * The integrations an admin switched on in Settings > Integrations, kept in memory so the rest of the app can read them
 * without waiting on the database. While one is on for a kind (email, sms, verification) it replaces the .env settings
 * for that kind; while none is on, .env is used exactly as before.
 */
export type ActiveIntegration = { id: string; provider: string; values: Record<string, string> };

let snapshot = new Map<Kind, ActiveIntegration>();

/** The integration that is on for this kind, or null (then .env decides). */
export const activeIntegration = (kind: Kind): ActiveIntegration | null => snapshot.get(kind) ?? null;

type Row = { id: string; kind: string; provider: string; settings: unknown; secret: string | null; active: boolean };
type Db = { integration: { findMany(args: { where: { active: boolean } }): Promise<Row[]> } };

/** Reads the switched-on integrations (secrets decrypted, in memory only). A database that cannot be read leaves what was loaded. */
export async function refreshIntegrations(prisma: Db) {
  const rows = await prisma.integration.findMany({ where: { active: true } });
  const next = new Map<Kind, ActiveIntegration>();
  for (const r of rows) {
    if (!(INTEGRATION_KINDS as readonly string[]).includes(r.kind)) continue;
    let secrets: Record<string, string> = {};
    try {
      secrets = r.secret ? (JSON.parse(decryptField(r.secret)) as Record<string, string>) : {};
    } catch {
      /* unreadable secret: treated as not set */
    }
    next.set(r.kind as Kind, { id: r.id, provider: r.provider, values: { ...((r.settings ?? {}) as Record<string, string>), ...secrets } });
  }
  snapshot = next;
}

/** For tests. */
export const clearIntegrations = () => {
  snapshot = new Map();
};

/**
 * One server setting: the integration's own value while one is on for this kind, otherwise the .env value.
 * Details a provider does not have fall back to .env as well, so a half-filled integration never breaks what .env already provides.
 */
export function setting(kind: Kind, envName: string): string {
  const a = activeIntegration(kind);
  if (a) {
    const field = CATALOG[kind].providers.find((p) => p.id === a.provider)?.fields.find((f) => f.env === envName);
    if (field) return (a.values[field.key] ?? field.default ?? '').trim();
  }
  return (process.env[envName] ?? '').trim();
}
