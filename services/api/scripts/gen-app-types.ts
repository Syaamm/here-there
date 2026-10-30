// Writes the app's request types from docs/openapi.json, so the app and the server cannot drift apart. Run with: npm run docs
// (the server's own validation rules are the source: change a rule there and the app stops compiling where it no longer fits).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { API_ROOT } from '../src/docs/generate';

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  additionalProperties?: boolean | Schema;
};

const lit = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

/** A JSON-schema description as a TypeScript type. */
export function tsType(s: Schema | undefined): string {
  if (!s) return 'unknown';
  if (s.const !== undefined) return lit(s.const);
  if (s.enum) return s.enum.map(lit).join(' | ') || 'never';
  const alt = s.anyOf ?? s.oneOf;
  if (alt) return [...new Set(alt.map(tsType))].join(' | ');
  if (s.allOf) return s.allOf.map(tsType).join(' & ');
  const t = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const parts = t.map((one) => {
    switch (one) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'array':
        return `Array<${tsType(s.items)}>`;
      case 'object': {
        const props = Object.entries(s.properties ?? {});
        if (props.length === 0) return s.additionalProperties && typeof s.additionalProperties === 'object' ? `Record<string, ${tsType(s.additionalProperties)}>` : 'Record<string, unknown>';
        const req = new Set(s.required ?? []);
        return `{ ${props.map(([k, v]) => `${key(k)}${req.has(k) ? '' : '?'}: ${tsType(v)}`).join('; ')} }`;
      }
      default:
        return 'unknown';
    }
  });
  return parts.length ? [...new Set(parts)].join(' | ') : s.properties ? tsType({ ...s, type: 'object' }) : 'unknown';
}

type Operation = { parameters?: Array<{ in: string; name: string; required?: boolean; schema?: Schema }>; requestBody?: { content?: Record<string, { schema?: Schema }> }; responses?: Record<string, { description?: string }> };

export function buildAppTypes(openapi: { paths: Record<string, Record<string, Operation>>; components?: { schemas?: { Error?: { properties?: { code?: { enum?: string[] } } } } } }): string {
  const codes: string[] = openapi.components?.schemas?.Error?.properties?.code?.enum ?? [];
  const routes: string[] = [];
  for (const [p, methods] of Object.entries(openapi.paths).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [method, op] of Object.entries(methods).sort(([a], [b]) => a.localeCompare(b))) {
      const body = op.requestBody?.content?.['application/json']?.schema;
      const query = (op.parameters ?? []).filter((q) => q.in === 'query');
      const errs = [...new Set(Object.values(op.responses ?? {}).flatMap((r) => [...(r.description ?? '').matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1])))].filter((c) => codes.includes(c)).sort();
      const fields = [
        body ? `body: ${tsType(body)}` : null,
        query.length ? `query: { ${query.map((q) => `${key(q.name)}${q.required ? '' : '?'}: ${tsType(q.schema)}`).join('; ')} }` : null,
        `errors: ${errs.length ? errs.map((c) => JSON.stringify(c)).join(' | ') : 'never'}`,
      ].filter(Boolean);
      routes.push(`  ${JSON.stringify(`${method.toUpperCase()} ${p}`)}: { ${fields.join('; ')} };`);
    }
  }
  return `// GENERATED from services/api/docs/openapi.json by \`npm run docs\` in services/api. Do not edit by hand.
// The request bodies and query strings are the server's own validation rules; the error codes are the ones each route can raise.
// Responses are described in words in the OpenAPI file, so they are not generated here.

/** Every error code the API can return. Branch on these, never on the message. */
export type ErrorCode = ${codes.map((c) => JSON.stringify(c)).join(' | ') || 'string'};

export interface ApiRoutes {
${routes.join('\n')}
}

export type RouteKey = keyof ApiRoutes;
/** The JSON body a route expects: \`RouteBody<'POST /v1/auth/login'>\`. */
export type RouteBody<K extends RouteKey> = ApiRoutes[K] extends { body: infer B } ? B : never;
/** The query string a route takes. */
export type RouteQuery<K extends RouteKey> = ApiRoutes[K] extends { query: infer Q } ? Q : never;
/** The error codes a route can raise besides the common ones. */
export type RouteErrors<K extends RouteKey> = ApiRoutes[K]['errors'];
`;
}

export const APP_TYPES_PATH = path.resolve(API_ROOT, '..', '..', 'apps', 'mobile', 'src', 'lib', 'api-types.gen.ts');

if (require.main === module) {
  const file = path.join(API_ROOT, 'docs', 'openapi.json');
  if (!existsSync(file)) throw new Error('docs/openapi.json is missing: run the docs step first');
  writeFileSync(APP_TYPES_PATH, buildAppTypes(JSON.parse(readFileSync(file, 'utf8'))));
  console.log(`apps/mobile/src/lib/api-types.gen.ts written`);
}
