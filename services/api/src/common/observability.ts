import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { LoggerService } from '@nestjs/common';

/**
 * Seeing problems before people report them: a request id on every request and every log line, one structured log line per
 * request, a slow-query log, and per-minute counters the admin console reads. Nothing here ever records what a person typed:
 * no bodies, no query parameters, no addresses, no tokens (see `requestLine`).
 */

// ---------------------------------------------------------------- request id
type Ctx = { requestId: string; userId?: string };
const store = new AsyncLocalStorage<Ctx>();

export const currentRequestId = () => store.getStore()?.requestId;
/** Called once the caller is known, so later log lines for this request carry their id (never their email). */
export const setRequestUser = (userId: string) => {
  const c = store.getStore();
  if (c) c.userId = userId;
};
export const currentUserId = () => store.getStore()?.userId;

/** A caller may pass its own id (a load balancer does); anything that is not a plain short token is replaced. */
export const cleanRequestId = (raw: unknown) => (typeof raw === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(raw) ? raw : randomUUID());

// ---------------------------------------------------------------- structured log
export type LogLevel = 'info' | 'warn' | 'error';
export type LogLine = { t: string; level: LogLevel; msg: string; reqId?: string; userId?: string; [k: string]: unknown };
type Sink = (line: LogLine) => void;

const format = () => process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text');
let sink: Sink | null = null;
/** Tests (and anything that ships logs elsewhere) can take the lines instead of the console. */
export const setLogSink = (s: Sink | null) => {
  sink = s;
};

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
  const line: LogLine = { t: new Date().toISOString(), level, msg, reqId: currentRequestId(), userId: currentUserId(), ...fields };
  if (sink) return sink(line);
  if (process.env.NODE_ENV === 'test' && !process.env.LOG_IN_TEST) return; // quiet in tests unless LOG_IN_TEST=1
  if (format() === 'json') {
    const out = JSON.stringify(line);
    if (level === 'error') console.error(out);
    else console.log(out);
    return;
  }
  const { t: _t, level: _l, msg: _m, reqId, userId: _u, ...rest } = line;
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(`[${level}] ${msg}${extra}${reqId ? ` (req ${reqId.slice(0, 8)})` : ''}`);
}

/** Nest's own messages (start-up, route mapping, crashes) go through the same lines when logs are JSON. */
export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string) {
    log('info', String(message), context ? { context } : {});
  }
  error(message: unknown, trace?: string, context?: string) {
    log('error', String(message), { ...(trace ? { trace } : {}), ...(context ? { context } : {}) });
  }
  warn(message: unknown, context?: string) {
    log('warn', String(message), context ? { context } : {});
  }
}

// ---------------------------------------------------------------- metrics
type Counter = 'signups' | 'joins' | 'messages';
type Bucket = { minute: number; requests: number; errors5xx: number; errors4xx: number; slowRequests: number; slowQueries: number; signups: number; joins: number; messages: number; ms: number[]; seen: number };
/** `what` is the table and the action (Message.findMany): never the filter or the values. */
export type SlowQuery = { at: string; ms: number; what: string; reqId?: string };

const MINUTE = 60_000;
const KEEP_MINUTES = 120;
const SAMPLE_CAP = 200;

/** Per-minute counters for this server process (a second server has its own; see docs/FOR_DEPLOYMENT.md). */
export class Metrics {
  private buckets = new Map<number, Bucket>();
  private slow: SlowQuery[] = [];
  readonly startedAt = Date.now();

  private bucket(now = Date.now()) {
    const minute = Math.floor(now / MINUTE);
    let b = this.buckets.get(minute);
    if (!b) {
      b = { minute, requests: 0, errors5xx: 0, errors4xx: 0, slowRequests: 0, slowQueries: 0, signups: 0, joins: 0, messages: 0, ms: [], seen: 0 };
      this.buckets.set(minute, b);
      for (const k of this.buckets.keys()) if (k < minute - KEEP_MINUTES) this.buckets.delete(k);
    }
    return b;
  }

  count(kind: Counter, n = 1) {
    this.bucket()[kind] += n;
  }

  request(status: number, ms: number) {
    const b = this.bucket();
    b.requests++;
    if (status >= 500) b.errors5xx++;
    else if (status >= 400) b.errors4xx++;
    if (ms >= slowRequestMs()) b.slowRequests++;
    // a small random sample per minute is enough for a 95th percentile
    b.seen++;
    if (b.ms.length < SAMPLE_CAP) b.ms.push(ms);
    else {
      const i = Math.floor(Math.random() * b.seen);
      if (i < SAMPLE_CAP) b.ms[i] = ms;
    }
  }

  slowQuery(ms: number, what: string) {
    this.bucket().slowQueries++;
    this.slow.unshift({ at: new Date().toISOString(), ms: Math.round(ms), what: what.slice(0, 120), reqId: currentRequestId() });
    if (this.slow.length > 50) this.slow.length = 50;
  }

  reset() {
    this.buckets.clear();
    this.slow = [];
  }

  /** The last `minutes` minutes, oldest first, one entry per minute (quiet minutes are zeros), plus what an operator wants at a glance. */
  snapshot(minutes = 60, now = Date.now()) {
    const end = Math.floor(now / MINUTE);
    const series = Array.from({ length: minutes }, (_, i) => {
      const minute = end - (minutes - 1 - i);
      const b = this.buckets.get(minute);
      const sorted = b ? [...b.ms].sort((x, y) => x - y) : [];
      return {
        at: new Date(minute * MINUTE).toISOString(),
        requests: b?.requests ?? 0,
        errors: b?.errors5xx ?? 0,
        clientErrors: b?.errors4xx ?? 0,
        slowRequests: b?.slowRequests ?? 0,
        slowQueries: b?.slowQueries ?? 0,
        signups: b?.signups ?? 0,
        joins: b?.joins ?? 0,
        messages: b?.messages ?? 0,
        p95Ms: sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]) : null,
      };
    });
    const sum = (rows: typeof series, k: 'requests' | 'errors' | 'slowQueries' | 'signups' | 'joins' | 'messages') => rows.reduce((a, r) => a + r[k], 0);
    const last5 = series.slice(-5);
    const req5 = sum(last5, 'requests');
    const err5 = sum(last5, 'errors');
    const reqAll = sum(series, 'requests');
    const errAll = sum(series, 'errors');
    const errorRate5m = req5 ? err5 / req5 : 0;
    return {
      status: req5 >= 20 && errorRate5m >= ERROR_RATE_ALARM ? ('degraded' as const) : ('ok' as const),
      alarm: { errorRate: ERROR_RATE_ALARM, minRequests: 20, text: `Degraded when 5% or more of the last 5 minutes' requests fail on our side (at least 20 requests).` },
      errorRate5m: Math.round(errorRate5m * 10000) / 10000,
      errorRate60m: reqAll ? Math.round((errAll / reqAll) * 10000) / 10000 : 0,
      totals: { requests: reqAll, errors: errAll, signups: sum(series, 'signups'), joins: sum(series, 'joins'), messages: sum(series, 'messages'), slowQueries: sum(series, 'slowQueries') },
      lastMinute: series[series.length - 1],
      series,
      slowQueries: this.slow,
      slowQueryMs: slowQueryMs(),
      uptimeSeconds: Math.round((now - this.startedAt) / 1000),
      note: 'Counted by this server only. With more than one server, each has its own numbers.',
    };
  }
}

export const ERROR_RATE_ALARM = 0.05;
export const slowQueryMs = () => Number(process.env.SLOW_QUERY_MS ?? 200);
export const slowRequestMs = () => Number(process.env.SLOW_REQUEST_MS ?? 1000);
export const metrics = new Metrics();

// ---------------------------------------------------------------- one line per request
type Req = { method: string; originalUrl?: string; url?: string; baseUrl?: string; route?: { path?: string }; headers: Record<string, unknown> };
type Res = { statusCode: number; setHeader(k: string, v: string): void; on(ev: 'finish', fn: () => void): void };

/** The route as written in the code (`/v1/activities/:id`), never the real address: no ids, no query string, nothing personal. */
export const routeOf = (req: Req) => (req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched');

/** Gives each request an id (returned in the `X-Request-Id` header), then logs one line when it finishes and feeds the counters. */
export function requestLogging(req: Req, res: Res, next: () => void) {
  const requestId = cleanRequestId(req.headers['x-request-id']);
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  store.run({ requestId }, () => {
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      metrics.request(res.statusCode, ms);
      if (req.method === 'OPTIONS') return;
      const level: LogLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 || ms >= slowRequestMs() ? 'warn' : 'info';
      log(level, 'request', { method: req.method, route: routeOf(req), status: res.statusCode, ms: Math.round(ms), ...(ms >= slowRequestMs() ? { slow: true } : {}) });
    });
    next();
  });
}

/** Run a piece of work as if it were a request (background jobs, tests) so its log lines carry an id. */
export const withRequestId = <T>(id: string, fn: () => T): T => store.run({ requestId: id }, fn);
