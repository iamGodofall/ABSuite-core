/**
 * Per-tenant rate limiting.
 *
 * Plan quotas cap usage per *month*. Nothing capped it per *second* — so one
 * tenant looping a request could saturate a node and degrade service for every
 * other tenant while still being comfortably inside their monthly allowance.
 * That is a noisy-neighbour problem, and it is the reason a monthly quota alone
 * cannot back an SLA.
 *
 * Token bucket rather than a fixed window: a fixed window lets a caller send
 * their whole allowance in the last second of one window and again in the first
 * second of the next, producing a burst of double the intended rate at the
 * boundary. A bucket refills continuously, so the average rate holds while
 * still permitting a short, bounded burst.
 */

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the next token is available. 0 when allowed. */
  retryAfter: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now = Date.now()
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  /** Take one token if available. */
  take(now = Date.now()): RateLimitVerdict {
    this.refill(now);

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, limit: this.capacity, remaining: Math.floor(this.tokens), retryAfter: 0 };
    }

    const secondsToNextToken = (1 - this.tokens) / this.refillPerSecond;
    return {
      allowed: false,
      limit: this.capacity,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil(secondsToNextToken)),
    };
  }

  private refill(now: number): void {
    const elapsedSeconds = Math.max(0, (now - this.lastRefill) / 1000);
    if (elapsedSeconds === 0) return;

    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = now;
  }

  /** Idle buckets are full; used to decide when one can be discarded. */
  isFull(now = Date.now()): boolean {
    this.refill(now);
    return this.tokens >= this.capacity;
  }
}

export interface TenantRateLimiterOptions {
  /** Requests per minute when a tenant's plan does not specify one. */
  defaultPerMinute?: number;
  /** How long an idle bucket is retained before being dropped. */
  idleTtlMs?: number;
}

/**
 * Rate limiter keyed by tenant.
 *
 * Buckets are created lazily and pruned once idle, so an instance that has seen
 * many tenants does not hold memory for all of them forever.
 */
export class TenantRateLimiter {
  private readonly buckets = new Map<string, { bucket: TokenBucket; limit: number; lastSeen: number }>();
  private readonly defaultPerMinute: number;
  private readonly idleTtlMs: number;

  constructor(options: TenantRateLimiterOptions = {}) {
    this.defaultPerMinute = Math.max(1, options.defaultPerMinute ?? Number(process.env.ABSUITE_RATE_LIMIT_PER_MINUTE || 60));
    this.idleTtlMs = options.idleTtlMs ?? 600_000;
  }

  /**
   * Consume one request's worth of allowance.
   *
   * A limit of -1 means unlimited, checked before any bucket is created so an
   * enterprise tenant costs nothing to track.
   */
  consume(key: string, perMinute?: number, now = Date.now()): RateLimitVerdict {
    const limit = perMinute ?? this.defaultPerMinute;
    if (limit < 0) {
      return { allowed: true, limit: -1, remaining: -1, retryAfter: 0 };
    }

    const effective = Math.max(1, limit);
    let entry = this.buckets.get(key);

    // Recreate the bucket if the tenant's plan changed, so an upgrade takes
    // effect immediately rather than after the old bucket expires.
    if (!entry || entry.limit !== effective) {
      entry = { bucket: new TokenBucket(effective, effective / 60, now), limit: effective, lastSeen: now };
      this.buckets.set(key, entry);
    }

    entry.lastSeen = now;
    return entry.bucket.take(now);
  }

  /** Drop buckets that are idle and full. Returns how many were removed. */
  prune(now = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.buckets) {
      if (now - entry.lastSeen > this.idleTtlMs && entry.bucket.isFull(now)) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }

  reset(key?: string): void {
    if (key) this.buckets.delete(key);
    else this.buckets.clear();
  }
}
