/**
 * A small in-memory cache whose entries expire on their own. For things that are read a lot and may be a little out of
 * date (a public profile's activity counts, the retention text); never for anything a person must see change at once.
 * It is per server process and holds at most `max` entries (the oldest goes first).
 */
export class TtlCache<V> {
  private readonly items = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 2000,
  ) {}

  async get(key: string, load: () => Promise<V> | V): Promise<V> {
    if (this.ttlMs <= 0) return load();
    const hit = this.items.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = await load();
    if (this.items.size >= this.max) this.items.delete(this.items.keys().next().value as string);
    this.items.set(key, { at: Date.now(), value });
    return value;
  }

  forget(key: string) {
    this.items.delete(key);
  }
}
