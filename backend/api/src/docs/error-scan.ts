import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type ErrorCode = { code: string; status: number; message: string; where: string[] };

const KIND_STATUS: Record<string, number> = { badRequest: 400, unauthorized: 401, forbidden: 403, notFound: 404, conflict: 409, unprocessable: 422, tooMany: 429 };

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
}

/** First string literal at the start of `s` (single, double or back-tick quotes), or null. */
function literal(s: string): { value: string; rest: string } | null {
  const m = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/s.exec(s);
  return m ? { value: m[2].replace(/\\(['"`])/g, '$1').replace(/\s+/g, ' ').trim(), rest: s.slice(m[0].length) } : null;
}

/**
 * Reads the source for every error the API can raise: `E.forbidden('CODE', 'message')`, `new ApiError(409, 'CODE', 'message')`.
 * The result IS the error taxonomy, so it can never be out of step with the code.
 */
export function scanErrorCodes(srcDir: string): { codes: ErrorCode[]; dynamic: string[] } {
  const found = new Map<string, ErrorCode>();
  const dynamic: string[] = [];
  const add = (code: string, status: number, message: string, file: string) => {
    const where = path.relative(srcDir, file).replace(/\\/g, '/');
    const cur = found.get(code);
    if (!cur) found.set(code, { code, status, message, where: [where] });
    else {
      if (!cur.where.includes(where)) cur.where.push(where);
      if (!cur.message && message) cur.message = message;
    }
  };

  for (const file of files(srcDir)) {
    if (file.includes(`${path.sep}docs${path.sep}`) || file.endsWith(`${path.sep}errors.ts`)) continue;
    const text = readFileSync(file, 'utf8');
    const rel = path.relative(srcDir, file).replace(/\\/g, '/');

    for (const m of text.matchAll(/\bE\.(badRequest|unauthorized|forbidden|conflict|unprocessable)\(/g)) {
      const status = KIND_STATUS[m[1]];
      const tail = text.slice(m.index! + m[0].length);
      const code = literal(tail);
      if (!code) {
        if (m[1] === 'unauthorized' && /^\s*\)/.test(tail)) add('UNAUTHENTICATED', 401, 'Authentication required', file);
        else dynamic.push(`${rel}: E.${m[1]}(${tail.slice(0, 40).replace(/\s+/g, ' ')}`);
        continue;
      }
      const msg = literal(code.rest.replace(/^\s*,/, ''));
      add(code.value, status, msg?.value ?? '', file);
    }
    for (const m of text.matchAll(/new ApiError\(\s*(\d{3})\s*,/g)) {
      const tail = text.slice(m.index! + m[0].length);
      const code = literal(tail);
      if (!code) { dynamic.push(`${rel}: new ApiError(${m[1]}, ${tail.slice(0, 40).replace(/\s+/g, ' ')}`); continue; }
      const msg = literal(code.rest.replace(/^\s*,/, ''));
      add(code.value, Number(m[1]), msg?.value ?? '', file);
    }
    for (const m of text.matchAll(/\bE\.tooMany\(/g)) add('RATE_LIMITED', 429, 'Too many requests, slow down', file);
    for (const m of text.matchAll(/\bE\.notFound\(/g)) { void m; add('NOT_FOUND', 404, 'Resource not found', file); }
  }
  // raised by the framework or shared helpers rather than a call above
  add('VALIDATION_FAILED', 400, 'Request validation failed', path.join(srcDir, 'common', 'validate.ts'));
  return { codes: [...found.values()].sort((a, b) => a.status - b.status || a.code.localeCompare(b.code)), dynamic };
}
