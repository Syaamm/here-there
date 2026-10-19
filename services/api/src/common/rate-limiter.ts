import { Injectable } from '@nestjs/common';
import { E } from './errors';

/** In-memory sliding window. Replace with Redis when running more than one API instance. */
@Injectable()
export class RateLimiter {
  private hits = new Map<string, number[]>();

  hit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      throw E.tooMany();
    }
    arr.push(now);
    this.hits.set(key, arr);
  }

  reset() {
    this.hits.clear();
  }
}
