import { createHmac } from 'node:crypto';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from './storage';
import { TenantService, TenantStore, MeterStore, hashApiKey, currentPeriod } from './tenancy';
import { PLANS, getPlan, checkQuota, verifyStripeSignature, planFromStripeEvent } from './billing';
import { SqliteRevocationStore } from './revocation-store';
import { MetricsRegistry, createServiceMetrics } from './metrics';

const freshStorage = () => new Storage(':memory:');

describe('storage', () => {
  test('creates its schema and round-trips a row', () => {
    const storage = freshStorage();
    storage.run(
      `INSERT INTO tenants (id, name, plan, api_key_hash, status, created_at) VALUES (?,?,?,?,?,?)`,
      't1', 'Acme', 'free', 'hash', 'active', new Date().toISOString()
    );
    expect(storage.get<{ name: string }>('SELECT name FROM tenants WHERE id = ?', 't1')?.name).toBe('Acme');
  });

  test('rolls a failed transaction back', () => {
    const storage = freshStorage();
    expect(() =>
      storage.transaction(() => {
        storage.run(
          `INSERT INTO tenants (id, name, plan, api_key_hash, status, created_at) VALUES (?,?,?,?,?,?)`,
          't2', 'Rollback', 'free', 'h2', 'active', new Date().toISOString()
        );
        throw new Error('boom');
      })
    ).toThrow('boom');

    expect(storage.get('SELECT id FROM tenants WHERE id = ?', 't2')).toBeUndefined();
  });
});

describe('tenants', () => {
  test('issues an API key exactly once and stores only its hash', () => {
    const storage = freshStorage();
    const tenants = new TenantStore(storage);
    const created = tenants.create('Acme', 'team');

    expect(created.apiKey).toMatch(/^absk_/);

    // The plaintext key must not be recoverable from storage.
    const row = storage.get<{ api_key_hash: string }>('SELECT api_key_hash FROM tenants WHERE id = ?', created.id);
    expect(row?.api_key_hash).toBe(hashApiKey(created.apiKey));
    expect(row?.api_key_hash).not.toContain(created.apiKey);
    expect(JSON.stringify(tenants.get(created.id))).not.toContain(created.apiKey);
  });

  test('resolves a tenant by API key and rejects a wrong one', () => {
    const tenants = new TenantStore(freshStorage());
    const created = tenants.create('Acme');

    expect(tenants.byApiKey(created.apiKey)?.id).toBe(created.id);
    expect(tenants.byApiKey('absk_wrong')).toBeUndefined();
    expect(tenants.byApiKey('')).toBeUndefined();
  });

  test('rotating a key invalidates the previous one', () => {
    const tenants = new TenantStore(freshStorage());
    const created = tenants.create('Acme');
    const rotated = tenants.rotateApiKey(created.id)!;

    expect(tenants.byApiKey(rotated.apiKey)?.id).toBe(created.id);
    expect(tenants.byApiKey(created.apiKey)).toBeUndefined();
  });

  test('requires a name', () => {
    const tenants = new TenantStore(freshStorage());
    expect(() => tenants.create('   ')).toThrow(/name is required/i);
  });

  test('changes plan and status', () => {
    const tenants = new TenantStore(freshStorage());
    const created = tenants.create('Acme');

    expect(tenants.setPlan(created.id, 'business')?.plan).toBe('business');
    expect(tenants.setStatus(created.id, 'suspended')?.status).toBe('suspended');
  });
});

describe('metering', () => {
  test('accumulates usage within a period', () => {
    const meters = new MeterStore(freshStorage());
    meters.record('t1', 'validations', 5);
    meters.record('t1', 'validations', 3);

    expect(meters.used('t1', 'validations')).toBe(8);
  });

  test('keeps periods separate', () => {
    const meters = new MeterStore(freshStorage());
    meters.record('t1', 'validations', 10, '2026-01');
    meters.record('t1', 'validations', 4, '2026-02');

    expect(meters.used('t1', 'validations', '2026-01')).toBe(10);
    expect(meters.used('t1', 'validations', '2026-02')).toBe(4);
  });

  test('keeps tenants separate', () => {
    const meters = new MeterStore(freshStorage());
    meters.record('t1', 'validations', 10);
    meters.record('t2', 'validations', 1);

    expect(meters.used('t1', 'validations')).toBe(10);
    expect(meters.used('t2', 'validations')).toBe(1);
  });

  test('summarises every metric for an invoice', () => {
    const meters = new MeterStore(freshStorage());
    meters.record('t1', 'validations', 100);
    meters.record('t1', 'agents', 3);

    expect(meters.summary('t1')).toEqual({ validations: 100, agents: 3 });
  });

  test('period format is year-month', () => {
    expect(currentPeriod(new Date(Date.UTC(2026, 6, 28)))).toBe('2026-07');
    expect(currentPeriod(new Date(Date.UTC(2026, 11, 1)))).toBe('2026-12');
  });
});

describe('quotas', () => {
  test('allows usage below the limit and blocks at it', () => {
    const free = getPlan('free');
    expect(checkQuota(free, 'agents', free.limits.agents - 1).allowed).toBe(true);
    expect(checkQuota(free, 'agents', free.limits.agents).allowed).toBe(false);
  });

  test('treats -1 as unlimited', () => {
    const verdict = checkQuota(getPlan('enterprise'), 'validations', 999_999_999);
    expect(verdict.allowed).toBe(true);
    expect(verdict.remaining).toBe(-1);
    expect(verdict.utilisation).toBe(0);
  });

  test('reports utilisation for an early warning', () => {
    const plan = getPlan('team');
    const verdict = checkQuota(plan, 'validations', plan.limits.validations * 0.9);
    expect(verdict.utilisation).toBeCloseTo(0.9, 5);
  });

  test('every plan is self-consistent', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.priceCents).toBeGreaterThanOrEqual(0);
      for (const limit of Object.values(plan.limits)) {
        expect(limit === -1 || limit > 0).toBe(true);
      }
    }
  });

  test('higher plans are never more restrictive than lower ones', () => {
    const rank = ['free', 'team', 'business'] as const;
    for (let i = 1; i < rank.length; i++) {
      const lower = PLANS[rank[i - 1]!].limits;
      const higher = PLANS[rank[i]!].limits;
      for (const key of Object.keys(lower) as Array<keyof typeof lower>) {
        expect(higher[key] === -1 || higher[key] >= lower[key]).toBe(true);
      }
    }
  });
});

describe('tenant service', () => {
  const setup = () => {
    const storage = freshStorage();
    const service = new TenantService(storage);
    return { service, tenant: service.tenants.create('Acme', 'free') };
  };

  test('blocks once the plan quota is exhausted', () => {
    const { service, tenant } = setup();
    const limit = getPlan('free').limits.agents;

    for (let i = 0; i < limit; i++) service.meters.record(tenant.id, 'agents', 1);

    const verdict = service.authorise(tenant, 'agents');
    expect(verdict.allowed).toBe(false);
    expect(verdict.remaining).toBe(0);
  });

  test('a suspended tenant is refused even within quota', () => {
    const { service, tenant } = setup();
    service.tenants.setStatus(tenant.id, 'suspended');

    const suspended = service.tenants.get(tenant.id)!;
    const verdict = service.authorise(suspended, 'agents');

    expect(verdict.allowed).toBe(false);
    expect(verdict.suspended).toBe(true);
  });

  test('upgrading a plan restores capacity without losing usage', () => {
    const { service, tenant } = setup();
    for (let i = 0; i < getPlan('free').limits.agents; i++) service.meters.record(tenant.id, 'agents', 1);
    expect(service.authorise(tenant, 'agents').allowed).toBe(false);

    const upgraded = service.tenants.setPlan(tenant.id, 'team')!;
    expect(service.authorise(upgraded, 'agents').allowed).toBe(true);
    expect(service.meters.used(tenant.id, 'agents')).toBe(getPlan('free').limits.agents);
  });

  test('usage report flags metrics approaching their limit', () => {
    const { service, tenant } = setup();
    service.meters.record(tenant.id, 'agents', getPlan('free').limits.agents - 1);

    const report = service.usageReport(tenant);
    expect(report.plan.id).toBe('free');
    expect(report.approachingLimit.some(quota => quota.metric === 'agents')).toBe(true);
  });
});

describe('stripe webhooks', () => {
  const secret = 'whsec_test_secret';
  const sign = (payload: string, timestamp: number) =>
    `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;

  test('accepts a correctly signed payload', () => {
    const payload = JSON.stringify({ type: 'customer.subscription.updated' });
    const now = Math.floor(Date.now() / 1000);
    expect(verifyStripeSignature(payload, sign(payload, now), secret, 300, now).valid).toBe(true);
  });

  test('rejects a tampered payload', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = sign('{"amount":10}', now);
    expect(verifyStripeSignature('{"amount":100000}', header, secret, 300, now).valid).toBe(false);
  });

  test('rejects a replayed old signature', () => {
    const payload = '{}';
    const old = Math.floor(Date.now() / 1000) - 10_000;
    const result = verifyStripeSignature(payload, sign(payload, old), secret, 300);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/tolerance/i);
  });

  test('rejects when no secret is configured', () => {
    expect(verifyStripeSignature('{}', 't=1,v1=abc', '').valid).toBe(false);
  });

  test('rejects a malformed header', () => {
    expect(verifyStripeSignature('{}', 'garbage', secret).valid).toBe(false);
    expect(verifyStripeSignature('{}', 't=abc,v1=def', secret).valid).toBe(false);
  });

  test('maps subscription events onto plan changes', () => {
    expect(planFromStripeEvent({
      type: 'customer.subscription.updated',
      data: { object: { metadata: { plan: 'business' }, customer: 'cus_1', status: 'active' } },
    })).toEqual({ action: 'set-plan', plan: 'business', customer: 'cus_1' });

    expect(planFromStripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_1' } },
    })).toEqual({ action: 'set-plan', plan: 'free', customer: 'cus_1' });

    expect(planFromStripeEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    })).toEqual({ action: 'suspend', customer: 'cus_1' });

    expect(planFromStripeEvent({ type: 'ping' }).action).toBe('ignore');
  });

  test('a cancelled subscription downgrades rather than deleting', () => {
    const outcome = planFromStripeEvent({
      type: 'customer.subscription.updated',
      data: { object: { status: 'canceled', customer: 'cus_9', metadata: { plan: 'business' } } },
    });
    expect(outcome).toEqual({ action: 'set-plan', plan: 'free', customer: 'cus_9' });
  });
});

describe('sqlite revocation store', () => {
  test('revokes durably and is visible to another handle on the same database', async () => {
    const storage = freshStorage();
    const store = new SqliteRevocationStore(storage);
    const future = Math.floor(Date.now() / 1000) + 3600;

    expect(await store.isRevoked('jti-1')).toBe(false);
    await store.revoke('jti-1', future);
    expect(await store.isRevoked('jti-1')).toBe(true);

    // A second store over the same storage sees it, as a sibling service would.
    expect(await new SqliteRevocationStore(storage).isRevoked('jti-1')).toBe(true);
  });

  test('prunes entries whose token already expired', async () => {
    const store = new SqliteRevocationStore(freshStorage());
    await store.revoke('stale', Math.floor(Date.now() / 1000) - 60);

    expect(await store.isRevoked('stale')).toBe(false);
    expect(await store.prune()).toBe(1);
  });

  test('revoking twice is idempotent', async () => {
    const store = new SqliteRevocationStore(freshStorage());
    const future = Math.floor(Date.now() / 1000) + 3600;

    await store.revoke('dupe', future);
    await store.revoke('dupe', future);
    expect(await store.isRevoked('dupe')).toBe(true);
  });
});

describe('metrics', () => {
  test('renders counters in Prometheus format', () => {
    const registry = new MetricsRegistry();
    registry.counter('test_total', 'A test counter');
    registry.increment('test_total', { route: '/a' }, 2);
    registry.increment('test_total', { route: '/a' });

    const output = registry.render();
    expect(output).toContain('# TYPE test_total counter');
    expect(output).toContain('test_total{route="/a"} 3');
  });

  test('histogram buckets are cumulative', () => {
    const registry = new MetricsRegistry();
    registry.histogram('lat_ms', 'Latency', [10, 100]);
    registry.observe('lat_ms', 5);

    const output = registry.render();
    // 5ms falls into both the 10 and 100 buckets.
    expect(output).toContain('lat_ms_bucket{le="10"} 1');
    expect(output).toContain('lat_ms_bucket{le="100"} 1');
    expect(output).toContain('lat_ms_count 1');
    expect(output).toContain('lat_ms_sum 5');
  });

  test('escapes label values so output cannot be broken', () => {
    const registry = new MetricsRegistry();
    registry.counter('c_total', 'c');
    registry.increment('c_total', { route: 'a"b' });

    expect(registry.render()).toContain('route="a\\"b"');
  });

  test('service registry reports up', () => {
    expect(createServiceMetrics('capkit').render()).toContain('absuite_up{service="capkit"} 1');
  });
});

describe('concurrent write safety', () => {
  test('transactions take the write lock up front', () => {
    // Regression guard. A bare BEGIN starts a deferred transaction, and SQLite
    // cannot apply busy_timeout when that upgrades to a write — so concurrent
    // writers fail instantly with SQLITE_BUSY. In practice this silently
    // dropped ~60% of execution traces under load. BEGIN IMMEDIATE is required.
    const source = readFileSync(join(__dirname, 'storage.ts'), 'utf8');

    expect(source).toContain("BEGIN IMMEDIATE");
    expect(source).not.toMatch(/exec\('BEGIN'\)/);
    expect(source).toContain('busy_timeout');
  });

  test('interleaved transactions from two handles both commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'absuite-concurrent-'));
    const path = join(dir, 'concurrent.db');

    const a = new Storage(path);
    const b = new Storage(path);

    a.transaction(() => a.run("INSERT INTO usage (tenant_id, metric, period, count) VALUES ('t1','m','2026-07',1)"));
    b.transaction(() => b.run("INSERT INTO usage (tenant_id, metric, period, count) VALUES ('t2','m','2026-07',1)"));

    expect(a.get<{ n: number }>('SELECT COUNT(*) AS n FROM usage')?.n).toBe(2);
    a.close();
    b.close();
  });
});
