import { HttpException } from '@nestjs/common';

/** Structured error: { statusCode, code, message, details }. Codes form the client-facing error taxonomy. */
export class ApiError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    details?: unknown,
  ) {
    super({ statusCode: status, code, message, details }, status);
  }
}

export const E = {
  badRequest: (code: string, msg: string, d?: unknown) => new ApiError(400, code, msg, d),
  unauthorized: (code = 'UNAUTHENTICATED', msg = 'Authentication required') => new ApiError(401, code, msg),
  forbidden: (code: string, msg: string, d?: unknown) => new ApiError(403, code, msg, d),
  notFound: (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (code: string, msg: string, d?: unknown) => new ApiError(409, code, msg, d),
  tooMany: (msg = 'Too many requests, slow down') => new ApiError(429, 'RATE_LIMITED', msg),
};
