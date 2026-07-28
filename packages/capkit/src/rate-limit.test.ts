import { TokenBucket, TenantRateLimiter } from './rate-limit';
import { PLANS, getPlan } from './billing';

describe('token bucket', () => {
  test('allows a burst up to capacity then refuses', () => {
    const start = Date.now();
    const bucket = new TokenBucket(3, 3 / 60, start);

    expect(bucket.take(start).allowed).toBe(true);
    expect(bucket.take(start).allowed).toBe(true);
    expect(bucket.take(start).allowed).toBe(true);
    expect(bucket.take(start).allowed).toBe(false);
  });

  test('refills continuously rather than in steps', () => {
    const start = Date.now();
    const bucket = new TokenBucket(60, 1, start); // 60/min = 1/sec

    for (let i = 0; i < 60; i++) bucket.take(start);
    expect(bucket.take(start).allowed).toBe(false);

    // One second later exactly one token is back.
    expect(bucket.take(start + 1000).allowed).toBe(true);
    expect(bucket.take(start + 1000).allowed).toBe(false);
  });

  test('reports a usable retry-after', () => {
    const start = Date.now();
    const bucket = new TokenBucket(1, 1 / 60, start); // 1/min

    bucket.take(start);
    const verdict = bucket.take(start);

    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfter).toBeGreaterThan(0);
    expect(verdict.retryAfter).toBeLessThanOrEqual(60);
  });

  test('never refills beyond capacity', () => {
    const start = Date.now();
    const bucket = new TokenBucket(5, 5 / 60, start);

    // A long idle period must not bank unlimited allowance.
    const later = start + 3_600_000;
    for (let i = 0; i < 5; i++) expect(bucket.take(later).allowed).toBe(true);
    expect(bucket.take(later).allowed).toBe(false);
  });

  test('avoids the fixed-window boundary burst', () => {
    // A fixed window would permit 2x the rate across a boundary. A bucket
    // cannot: capacity is the hard ceiling at any instant.
    const start = Date.now();
    const bucket = new TokenBucket(10, 10 / 60, start);

    for (let i = 0; i < 10; i++) bucket.take(start + 59_000);
    let allowedAcrossBoundary = 0;
    for (let i = 0; i < 10; i++) {
      if (bucket.take(start + 60_000).allowed) allowedAcrossBoundary += 1;
    }
    expect(allowedAcrossBoundary).toBeLessThan(10);
  });
});

describe('tenant rate limiter', () => {
  test('isolates tenants from each other', () => {
    const limiter = new TenantRateLimiter();
    const now = Date.now();

    for (let i = 0; i < 60; i++) limiter.consume('tenant:a', 60, now);
    expect(limiter.consume('tenant:a', 60, now).allowed).toBe(false);

    // The noisy neighbour must not affect anyone else.
    expect(limiter.consume('tenant:b', 60, now).allowed).toBe(true);
  });

  test('treats -1 as unlimited without allocating a bucket', () => {
    const limiter = new TenantRateLimiter();
    const now = Date.now();

    for (let i = 0; i < 10_000; i++) {
      expect(limiter.consume('enterprise', -1, now).allowed).toBe(true);
    }
    expect(limiter.size).toBe(0);
  });

  test('a plan upgrade takes effect immediately', () => {
    const limiter = new TenantRateLimiter();
    const now = Date.now();

    for (let i = 0; i < 60; i++) limiter.consume('tenant:c', 60, now);
    expect(limiter.consume('tenant:c', 60, now).allowed).toBe(false);

    // Upgraded mid-minute — should not have to wait for the old bucket.
    expect(limiter.consume('tenant:c', 300, now).allowed).toBe(true);
  });

  test('prunes idle buckets so memory does not grow without bound', () => {
    const limiter = new TenantRateLimiter({ idleTtlMs: 1000 });
    const now = Date.now();

    limiter.consume('tenant:d', 60, now);
    expect(limiter.size).toBe(1);

    expect(limiter.prune(now + 5000)).toBe(1);
    expect(limiter.size).toBe(0);
  });

  test('does not prune a bucket that is still under load', () => {
    const limiter = new TenantRateLimiter({ idleTtlMs: 1000 });
    const now = Date.now();

    for (let i = 0; i < 60; i++) limiter.consume('tenant:e', 60, now);
    // Idle long enough by clock, but the bucket has not refilled yet.
    expect(limiter.prune(now + 2000)).toBe(0);
  });

  test('falls back to a default when no plan rate is given', () => {
    const limiter = new TenantRateLimiter({ defaultPerMinute: 2 });
    const now = Date.now();

    expect(limiter.consume('anon', undefined, now).allowed).toBe(true);
    expect(limiter.consume('anon', undefined, now).allowed).toBe(true);
    expect(limiter.consume('anon', undefined, now).allowed).toBe(false);
  });
});

describe('plan rate limits', () => {
  test('every plan declares one', () => {
    for (const plan of Object.values(PLANS)) {
      expect(typeof plan.rateLimitPerMinute).toBe('number');
      expect(plan.rateLimitPerMinute === -1 || plan.rateLimitPerMinute > 0).toBe(true);
    }
  });

  test('higher plans are never more restrictive', () => {
    const rank = ['free', 'team', 'business'] as const;
    for (let i = 1; i < rank.length; i++) {
      const lower = getPlan(rank[i - 1]!).rateLimitPerMinute;
      const higher = getPlan(rank[i]!).rateLimitPerMinute;
      expect(higher === -1 || higher >= lower).toBe(true);
    }
    expect(getPlan('enterprise').rateLimitPerMinute).toBe(-1);
  });

  test('rate limiting is separate from monthly quotas', () => {
    // They answer different questions and must not be conflated: one caps
    // volume over a month, the other caps rate over a minute.
    expect('rateLimitPerMinute' in getPlan('free').limits).toBe(false);
  });
});
