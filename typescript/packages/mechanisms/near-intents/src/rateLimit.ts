export interface RateLimit {
  /** Burst size: tokens a fresh key starts with. */
  capacity: number;
  /** Steady-state tokens added per minute. */
  refillPerMinute: number;
}

/**
 * Per-key token bucket. Per-process: a multi-instance facilitator limits per instance.
 */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  /**
   * Creates a token bucket.
   *
   * @param limit - Burst size and refill rate
   */
  constructor(private readonly limit: RateLimit) {}

  /**
   * Takes one token for `key`.
   *
   * @param key - Bucket key
   * @returns `false` when the bucket is empty
   */
  take(key: string): boolean {
    const now = Date.now();
    this.prune(now);
    const bucket = this.buckets.get(key) ?? { tokens: this.limit.capacity, updatedAt: now };
    const refilled = Math.min(
      this.limit.capacity,
      bucket.tokens + ((now - bucket.updatedAt) / 60_000) * this.limit.refillPerMinute,
    );
    const allowed = refilled >= 1;
    this.buckets.set(key, { tokens: allowed ? refilled - 1 : refilled, updatedAt: now });
    return allowed;
  }

  /**
   * Drops buckets that have refilled completely.
   *
   * @param now - Current time in milliseconds
   */
  private prune(now: number): void {
    const fullAfterMs = (this.limit.capacity / this.limit.refillPerMinute) * 60_000;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt >= fullAfterMs) {
        this.buckets.delete(key);
      }
    }
  }
}
