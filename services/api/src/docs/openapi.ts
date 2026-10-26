import { z } from 'zod';
import type { FoundRoute } from './discover';
import type { ErrorCode } from './error-scan';
import { ERROR_GUIDE, FRAMEWORK_ERROR_CODES } from './error-guide';
import { ROUTE_DOCS, type RouteDoc } from './routes';

type Json = Record<string, unknown>;

/** The server's own validation schema, as JSON Schema (what a client must send). Dates and numbers that arrive as text are shown as such. */
function jsonSchema(schema: z.ZodType): Json {
  const out = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
    override: (ctx) => {
      const def = (ctx.zodSchema as unknown as { _zod: { def: { type: string; coerce?: boolean } } })._zod.def;
      if (def.type === 'date') Object.assign(ctx.jsonSchema, { type: 'string', format: 'date-time' });
      if (def.type === 'number' && def.coerce) Object.assign(ctx.jsonSchema, { type: 'number' });
    },
  }) as Json;
  delete out.$schema;
  return out;
}

const STATUS_TITLE: Record<number, string> = {
  400: 'The request is not acceptable',
  401: 'Not signed in',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflicts with the current state',
  429: 'Too many requests',
  500: 'Server error',
};

const INFO = `The shared backend for **HERE.** (activities happening soon) and **THERE.** (trips and travel buddies), used by the mobile app and the admin console. One account and one verification serve both products.

## Conventions
- **Sign-in.** Send \`Authorization: Bearer <token>\` from \`POST /v1/auth/login\`, \`/v1/auth/register\` or \`/v1/auth/guest\`. Routes marked public need no token. Authorization is decided on the server from live data on every call (suspension, role, verification and chat membership take effect immediately).
- **Verified adults only.** Creating or joining activities, creating or applying to trips, and chat need a verified adult. Routes that need it are marked, and fail with \`VERIFICATION_REQUIRED\` otherwise. Browsing needs no verification.
- **Errors.** Every failure has the same body, \`{ "statusCode", "code", "message", "details"? }\`. Branch on \`code\`, never on \`message\`. The full list, with what each means and what a client should do, is in the *Error codes* section below and in \`ERROR-CODES.md\`.
- **Paging.** List routes that return pages answer \`{ items, nextCursor }\`. Send \`nextCursor\` back as \`cursor\` for the next page; \`null\` means the last page. Treat the cursor as opaque.
- **Caching.** \`GET\` answers carry an \`ETag\`; send \`If-None-Match\` to get an empty \`304\` when nothing changed.
- **Limits.** Sensitive and spam-prone routes are rate limited and answer \`429 RATE_LIMITED\`.
- **Live updates.** A WebSocket at \`/v1/live\` (first message carries the token) pushes chat messages and change signals. It is not part of this document.

Request bodies and query strings are generated from the same validation rules the server enforces. Responses are described in words.`;

export function buildOpenApi(routes: FoundRoute[], errors: ErrorCode[], version: string): Json {
  const known = new Set(errors.map((e) => e.code));
  for (const f of FRAMEWORK_ERROR_CODES) known.add(f.code);
  const statusOf = new Map<string, number>([...errors.map((e) => [e.code, e.status] as const), ...FRAMEWORK_ERROR_CODES.map((f) => [f.code, f.status] as const)]);

  const tags = [...new Set(routes.map((r) => ROUTE_DOCS[r.key]?.tag).filter(Boolean))] as string[];
  const paths: Record<string, Record<string, Json>> = {};

  for (const r of routes) {
    const d: RouteDoc | undefined = ROUTE_DOCS[r.key];
    if (!d) throw new Error(`Route ${r.key} has no entry in src/docs/routes.ts`);
    const parameters: Json[] = r.pathParams.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));

    if (d.query) {
      const s = jsonSchema(d.query) as { properties?: Record<string, Json>; required?: string[] };
      for (const [name, schema] of Object.entries(s.properties ?? {})) parameters.push({ name, in: 'query', required: !!s.required?.includes(name), schema });
    }

    const need = new Set<string>(d.errors ?? []);
    if (d.body || d.query) need.add('VALIDATION_FAILED');
    if (d.verified) need.add('VERIFICATION_REQUIRED');
    if (!r.public) { need.add('UNAUTHENTICATED'); need.add('INVALID_TOKEN'); need.add('ACCOUNT_SUSPENDED'); }
    if (r.staff) need.add('FORBIDDEN');
    if (r.pathParams.length) need.add('NOT_FOUND');
    for (const c of need) if (!known.has(c)) throw new Error(`${r.key} lists error code ${c}, which the API never raises`);

    const byStatus = new Map<number, string[]>();
    for (const c of [...need].sort()) {
      const st = statusOf.get(c)!;
      byStatus.set(st, [...(byStatus.get(st) ?? []), c]);
    }
    if (!r.public && !r.staff) byStatus.set(429, [...new Set([...(byStatus.get(429) ?? []), 'RATE_LIMITED'])]);
    const responses: Record<string, Json> = {
      '200': { description: d.returns ?? 'Done.' },
    };
    for (const [st, codes] of [...byStatus.entries()].sort((a, b) => a[0] - b[0])) {
      responses[String(st)] = {
        description: `${STATUS_TITLE[st] ?? 'Error'}. Codes: ${codes.map((c) => '`' + c + '`').join(', ')}`,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      };
    }
    responses['500'] = { description: STATUS_TITLE[500] + ' (`INTERNAL_ERROR`)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };

    const op: Json = {
      tags: [d.tag],
      summary: d.summary,
      operationId: `${r.controller.replace(/Controller$/, '')}_${r.handler}`,
      description: [
        d.note,
        d.verified ? 'Needs a **verified adult**.' : undefined,
        r.staff ? `Staff only. Roles: ${r.staff.join(', ')}.` : undefined,
      ].filter(Boolean).join('\n\n') || undefined,
      ...(r.public ? { security: [] } : r.staff ? { 'x-staff-roles': r.staff } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(d.body ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(d.body) } } } } : {}),
      responses,
    };
    (paths[r.path] ??= {})[r.method.toLowerCase()] = op;
  }

  const codeNames = [...known].sort();
  return {
    openapi: '3.1.0',
    info: { title: 'HERE & THERE API', version, description: INFO },
    servers: [{ url: '/', description: 'This server' }],
    tags: tags.map((name) => ({ name })),
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'The token from login, register or guest.' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['statusCode', 'code', 'message'],
          properties: {
            statusCode: { type: 'integer', example: 409 },
            code: { type: 'string', enum: codeNames, description: 'Stable machine-readable reason. Branch on this.' },
            message: { type: 'string', description: 'Plain-language text that is safe to show to the person.' },
            details: { description: 'Extra data for some codes (for example the field list of VALIDATION_FAILED).' },
          },
        },
      },
    },
    'x-error-codes': errors
      .map((e) => ({ code: e.code, status: e.status, meaning: ERROR_GUIDE[e.code]?.[0], clientShould: ERROR_GUIDE[e.code]?.[1] }))
      .concat(FRAMEWORK_ERROR_CODES.map((f) => ({ ...f, meaning: ERROR_GUIDE[f.code]?.[0], clientShould: ERROR_GUIDE[f.code]?.[1] })))
      .sort((a, b) => a.status - b.status || a.code.localeCompare(b.code)),
  };
}

/** ERROR-CODES.md: one table per HTTP status, written from the same list the OpenAPI document uses. */
export function buildErrorTable(errors: ErrorCode[]): string {
  const all = [
    ...errors.map((e) => ({ code: e.code, status: e.status, example: e.message })),
    ...FRAMEWORK_ERROR_CODES.map((f) => ({ ...f, example: '' })),
  ];
  const seen = new Set<string>();
  const rows = all.filter((e) => (seen.has(e.code) ? false : (seen.add(e.code), true))).sort((a, b) => a.status - b.status || a.code.localeCompare(b.code));
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\$\{[^}]*\}/g, '…');
  const out: string[] = [
    '# API error codes',
    '',
    '> Generated by `npm run docs` from the source code. Do not edit by hand; change `src/docs/error-guide.ts` instead.',
    '',
    'Every failed request returns the same body:',
    '',
    '```json',
    '{ "statusCode": 409, "code": "ACTIVITY_FULL", "message": "This activity is full", "details": null }',
    '```',
    '',
    '- Branch on **`code`**, which is stable. **`message`** is plain language that is safe to show a person, but its wording may change.',
    '- `details` is present for some codes (for example `VALIDATION_FAILED` lists `{ path, message }` per field).',
    '- A mistyped URL, bad JSON, an oversized body or a crash also get a code (`ROUTE_NOT_FOUND`, `BAD_REQUEST`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`), so a client never has to parse an unknown shape.',
    '',
  ];
  const groups: Array<[number, string]> = [[400, 'Bad request (400)'], [401, 'Not signed in (401)'], [403, 'Not allowed (403)'], [404, 'Not found (404, 405)'], [409, 'Conflicts with the current state (409)'], [429, 'Limits (413, 415, 429)'], [500, 'Server (500)']];
  const bucket = (s: number) => (s === 405 ? 404 : s === 413 || s === 415 ? 429 : s);
  for (const [st, title] of groups) {
    const list = rows.filter((r) => bucket(r.status) === st);
    if (!list.length) continue;
    out.push(`## ${title}`, '', '| Code | Status | What it means | What the app should do |', '| --- | --- | --- | --- |');
    for (const r of list) {
      const [meaning, action] = ERROR_GUIDE[r.code] ?? ['', ''];
      out.push(`| \`${r.code}\` | ${r.status} | ${esc(meaning)} | ${esc(action)} |`);
    }
    out.push('');
  }
  return out.join('\n');
}
