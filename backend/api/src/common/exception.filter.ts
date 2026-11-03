import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { captureError } from './error-tracking';
import { currentRequestId, log } from './observability';

/** Codes for failures that do not come from our own `E.*` helpers (unknown route, oversized body, bad JSON, crash). */
const FRAMEWORK_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'ROUTE_NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

/**
 * Every error the API returns has the same shape: { statusCode, code, message, details? }.
 * Our own errors already carry a code and pass through untouched; everything else (a mistyped URL, an oversized upload,
 * malformed JSON, a crash) is given a code here, and a crash never leaks internals to the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) captureError(exception, { status });
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) return void res.status(status).json(body);
      const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      return void res.status(status).json({ statusCode: status, code: FRAMEWORK_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'), message: Array.isArray(message) ? message.join('; ') : message });
    }

    // body-parser (malformed JSON, body too large) raises plain errors that carry their own HTTP status
    const status = (exception as { status?: number; statusCode?: number } | null)?.status ?? (exception as { statusCode?: number } | null)?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const message = status === 413 ? 'That request is too large' : status === 400 ? 'The request body could not be read' : 'The request could not be processed';
      return void res.status(status).json({ statusCode: status, code: FRAMEWORK_CODES[status] ?? 'REQUEST_FAILED', message });
    }

    // a crash: the full detail goes to the log and to error tracking, tied together by the request id; the person gets only the id
    const requestId = currentRequestId();
    log('error', 'unhandled error', { error: exception instanceof Error ? (exception.stack ?? exception.message) : String(exception) });
    captureError(exception, { status: 500 });
    res.status(500).json({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.', ...(requestId ? { requestId } : {}) });
  }
}
