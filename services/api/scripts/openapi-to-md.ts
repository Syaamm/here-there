// Turns docs/openapi.json into docs/API.md, a readable version of the same document. Run with: npm run docs (it runs after gen-docs).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Schema = { type?: string; format?: string; enum?: unknown[]; const?: unknown; default?: unknown; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; items?: Schema; properties?: Record<string, Schema>; required?: string[]; anyOf?: Schema[]; oneOf?: Schema[]; description?: string; $ref?: string };
type Param = { name: string; in: string; required?: boolean; schema?: Schema; description?: string };
type Op = { tags?: string[]; summary?: string; description?: string; security?: unknown[]; parameters?: Param[]; requestBody?: { content?: Record<string, { schema?: Schema }> }; responses?: Record<string, { description?: string }> };
type Doc = { info: { title: string; version: string; description?: string }; paths: Record<string, Record<string, Op>>; tags?: { name: string }[]; 'x-error-codes'?: { code: string; status: number; meaning: string; clientShould: string }[] };

const root = path.resolve(__dirname, '..', '..');
const doc = JSON.parse(readFileSync(path.join(root, 'docs', 'openapi.json'), 'utf8')) as Doc;

const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "string", "number (1 to 50)", "one of: a, b", "array of string" ... */
function typeOf(s?: Schema): string {
  if (!s) return '';
  if (s.$ref) return s.$ref.split('/').pop() ?? '';
  if (s.enum) return `one of: ${s.enum.map((v) => `\`${v}\``).join(', ')}`;
  if (s.const !== undefined) return `\`${JSON.stringify(s.const)}\``;
  const alt = s.anyOf ?? s.oneOf;
  if (alt) return alt.map(typeOf).join(' or ');
  let t = s.type ?? 'any';
  if (s.type === 'array') t = `array of ${typeOf(s.items) || 'any'}`;
  if (s.format) t += ` (${s.format})`;
  const range: string[] = [];
  if (s.minimum !== undefined || s.maximum !== undefined) range.push(`${s.minimum ?? ''} to ${s.maximum ?? ''}`.trim());
  if (s.minLength !== undefined || s.maxLength !== undefined) range.push(`${s.minLength ?? 0} to ${s.maxLength ?? ''} characters`.replace(/ to  /, ' or more '));
  return range.length ? `${t} (${range.join(', ')})` : t;
}

/** Flatten an object schema into rows; nested objects become "parent.child". */
function fields(s: Schema | undefined, prefix = ''): { name: string; type: string; required: boolean; note: string }[] {
  if (!s?.properties) return [];
  const rows: { name: string; type: string; required: boolean; note: string }[] = [];
  for (const [k, v] of Object.entries(s.properties)) {
    const name = prefix + k;
    const required = (s.required ?? []).includes(k);
    const note = [v.default !== undefined ? `default \`${JSON.stringify(v.default)}\`` : '', v.description ?? ''].filter(Boolean).join('. ');
    rows.push({ name, type: typeOf(v), required, note });
    if (v.type === 'object') rows.push(...fields(v, `${name}.`));
    else if (v.type === 'array' && v.items?.type === 'object') rows.push(...fields(v.items, `${name}[].`));
  }
  return rows;
}

const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

const out: string[] = [];
out.push(`# ${doc.info.title}`, '', `Version ${doc.info.version}. Generated from \`openapi.json\` by \`npm run docs\`: do not edit by hand.`, '');
if (doc.info.description) out.push(doc.info.description.replace(/^## /gm, '### '), '');

// group the routes by tag, keeping the tag order of the document
const order = (doc.tags ?? []).map((t) => t.name);
const groups = new Map<string, { method: string; path: string; op: Op }[]>();
for (const [p, methods] of Object.entries(doc.paths))
  for (const [method, op] of Object.entries(methods)) {
    const tag = op.tags?.[0] ?? 'Other';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)!.push({ method: method.toUpperCase(), path: p, op });
  }
const tags = [...order.filter((t) => groups.has(t)), ...[...groups.keys()].filter((t) => !order.includes(t))];

out.push('## Contents', '');
for (const t of tags) out.push(`- [${t}](#${anchor(t)}) (${groups.get(t)!.length})`);
if (doc['x-error-codes']) out.push('- [Error codes](#error-codes)');
out.push('');

for (const t of tags) {
  out.push(`## ${t}`, '');
  for (const { method, path: p, op } of groups.get(t)!) {
    out.push(`### \`${method} ${p}\``, '');
    if (op.summary) out.push(`**${op.summary}**`, '');
    out.push(op.security && op.security.length === 0 ? 'Access: public (no token needed).' : 'Access: signed in (`Authorization: Bearer <token>`).', '');
    if (op.description) out.push(op.description, '');
    const params = op.parameters ?? [];
    if (params.length)
      out.push('Parameters', '', table(['Name', 'In', 'Type', 'Required', 'Notes'], params.map((x) => [`\`${x.name}\``, x.in, typeOf(x.schema), x.required ? 'yes' : 'no', [x.schema?.default !== undefined ? `default \`${JSON.stringify(x.schema.default)}\`` : '', x.description ?? ''].filter(Boolean).join('. ')])), '');
    const body = op.requestBody?.content?.['application/json']?.schema;
    const rows = fields(body);
    if (rows.length) out.push('Request body (JSON)', '', table(['Field', 'Type', 'Required', 'Notes'], rows.map((r) => [`\`${r.name}\``, r.type, r.required ? 'yes' : 'no', r.note])), '');
    else if (op.requestBody) out.push('Request body: JSON (see the route description).', '');
    const res = Object.entries(op.responses ?? {}).filter(([code]) => code !== '500');
    if (res.length) out.push('Responses', '', ...res.map(([code, r]) => `- **${code}**: ${r.description ?? ''}`), '');
  }
}

const errors = doc['x-error-codes'];
if (errors) {
  out.push('## Error codes', '', 'Every failure answers `{ statusCode, code, message, details? }`. Branch on `code`, never on `message`.', '');
  out.push(table(['Code', 'Status', 'What it means', 'What the app should do'], errors.map((e) => [`\`${e.code}\``, String(e.status), e.meaning, e.clientShould])), '');
}

const file = path.join(root, 'docs', 'API.md');
writeFileSync(file, out.join('\n'));
console.log(`docs/API.md: ${[...groups.values()].reduce((n, g) => n + g.length, 0)} routes, ${errors?.length ?? 0} error codes`);
