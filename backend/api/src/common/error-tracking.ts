import * as Sentry from '@sentry/node';
import { currentRequestId, currentUserId, log } from './observability';

/**
 * Error tracking (Sentry). Off until SENTRY_DSN is set, so development and tests never call out. When on, a crash arrives with
 * the request id (to find the matching log lines), the route and the person's id: never their email, address, what they
 * typed or their headers (`sendDefaultPii` is off and `beforeSend` removes the request body, cookies, headers and query string).
 */
export type ErrorContext = { route?: string; status?: number };
type Reporter = (err: unknown, ctx: ErrorContext & { requestId?: string; userId?: string }) => void;

let started = false;
let reporter: Reporter | null = null;

/** Tests, or another service, can take the reports instead of Sentry. */
export const setErrorReporter = (r: Reporter | null) => {
  reporter = r;
};

export function initErrorTracking() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    if (process.env.NODE_ENV === 'production') log('warn', 'SENTRY_DSN is not set: crashes are only in the logs, nobody is alerted');
    return false;
  }
  if (started) return true;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      event.user = event.user?.id ? { id: event.user.id } : undefined;
      return event;
    },
  });
  started = true;
  return true;
}

/** Reports a crash (a 5xx). Never throws: a broken tracker must not turn one error into two. */
export function captureError(err: unknown, ctx: ErrorContext = {}) {
  const requestId = currentRequestId();
  const userId = currentUserId();
  try {
    reporter?.(err, { ...ctx, requestId, userId });
    if (!started) return;
    Sentry.withScope((scope) => {
      if (requestId) scope.setTag('requestId', requestId);
      if (ctx.route) scope.setTag('route', ctx.route);
      if (userId) scope.setUser({ id: userId });
      Sentry.captureException(err);
    });
  } catch {
    /* tracking is best effort */
  }
}

/** Sends what is still waiting before the process ends. */
export const flushErrorTracking = (ms = 2000) => (started ? Sentry.flush(ms) : Promise.resolve(true));
