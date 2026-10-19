import { z } from 'zod';
import { ApiError } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'Request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

/** Cheap content rules: spam links and financial solicitation (spec 4.2 / 7.5). Real moderation sits on top. */
export function contentProblem(text?: string | null): string | null {
  if (!text) return null;
  const urls = text.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (urls > 1) return 'Too many links';
  if (/(.)\1{9,}/.test(text)) return 'Spam-like repetition';
  if (
    /(send|transfer|wire)\s+(me\s+)?(some\s+)?(money|cash|funds)|western union|\biban\b|crypto\s*(wallet|invest)/i.test(
      text,
    )
  )
    return 'Financial solicitation is not allowed';
  return null;
}
