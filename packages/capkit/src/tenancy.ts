/**
 * Multi-tenancy: tenants, their API keys, plans and usage metering.
 *
 * A tenant is the unit a bill is addressed to. Every metered action records
 * against one, so usage is attributable without any extra bookkeeping at the
 * call site.
 *
 * API keys are stored only as SHA-256 hashes. The plaintext is returned exactly
 * once at creation and is unrecoverable afterwards — a leaked database must not
 * hand over working credentials.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Storage } from './storage';
import { getPlan, checkQuota, type Plan, type PlanId, type QuotaMetric, type QuotaVerdict } from './billing';

export type TenantStatus = 'active' | 'suspended';

export interface Tenant {
  id: string;
  name: string;
  plan: PlanId;
  status: TenantStatus;
  externalRef?: string;
  createdAt: string;
}

export interface CreatedTenant extends Tenant {
  /** Shown once. Never retrievable again. */
  apiKey: string;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/** Current metering period, e.g. "2026-07". Usage resets each calendar month. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Type alias, not an interface, so it stays assignable to Storage's Row. */
type TenantRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
  external_ref: string | null;
  created_at: string;
};

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    plan: (row.plan as PlanId) ?? 'free',
    status: (row.status as TenantStatus) ?? 'active',
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
    createdAt: row.created_at,
  };
}

export class TenantStore {
  constructor(private readonly storage: Storage) {}

  create(name: string, plan: PlanId = 'free', externalRef?: string): CreatedTenant {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('A tenant name is required');

    const id = `ten_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const apiKey = `absk_${randomBytes(24).toString('base64url')}`;
    const createdAt = new Date().toISOString();

    this.storage.run(
      `INSERT INTO tenants (id, name, plan, api_key_hash, status, external_ref, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
      id, trimmed, plan, hashApiKey(apiKey), externalRef ?? null, createdAt
    );

    return { id, name: trimmed, plan, status: 'active', ...(externalRef ? { externalRef } : {}), createdAt, apiKey };
  }

  get(id: string): Tenant | undefined {
    const row = this.storage.get<TenantRow>('SELECT * FROM tenants WHERE id = ?', id);
    return row ? toTenant(row) : undefined;
  }

  /**
   * Resolve a tenant from a plaintext API key.
   *
   * The lookup is by hash, so the comparison is done by SQLite on a unique
   * index. The extra constant-time check guards against any future change that
   * might make the comparison content-dependent.
   */
  byApiKey(apiKey: string): Tenant | undefined {
    const provided = String(apiKey || '').trim();
    if (!provided) return undefined;

    const hash = hashApiKey(provided);
    const row = this.storage.get<TenantRow & { api_key_hash: string }>(
      'SELECT * FROM tenants WHERE api_key_hash = ?', hash
    );
    if (!row) return undefined;

    const a = Buffer.from(row.api_key_hash, 'utf8');
    const b = Buffer.from(hash, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;

    return toTenant(row);
  }

  byExternalRef(externalRef: string): Tenant | undefined {
    const row = this.storage.get<TenantRow>('SELECT * FROM tenants WHERE external_ref = ?', externalRef);
    return row ? toTenant(row) : undefined;
  }

  list(limit = 100): Tenant[] {
    return this.storage
      .all<TenantRow>('SELECT * FROM tenants ORDER BY created_at DESC LIMIT ?', Math.min(Math.max(limit, 1), 1000))
      .map(toTenant);
  }

  setPlan(id: string, plan: PlanId): Tenant | undefined {
    this.storage.run('UPDATE tenants SET plan = ? WHERE id = ?', plan, id);
    return this.get(id);
  }

  setStatus(id: string, status: TenantStatus): Tenant | undefined {
    this.storage.run('UPDATE tenants SET status = ? WHERE id = ?', status, id);
    return this.get(id);
  }

  /** Issue a fresh key and invalidate the old one atomically. */
  rotateApiKey(id: string): { apiKey: string } | undefined {
    if (!this.get(id)) return undefined;

    const apiKey = `absk_${randomBytes(24).toString('base64url')}`;
    this.storage.run('UPDATE tenants SET api_key_hash = ? WHERE id = ?', hashApiKey(apiKey), id);
    return { apiKey };
  }

  delete(id: string): boolean {
    const existed = Boolean(this.get(id));
    this.storage.transaction(() => {
      this.storage.run('DELETE FROM usage WHERE tenant_id = ?', id);
      this.storage.run('DELETE FROM tenants WHERE id = ?', id);
    });
    return existed;
  }
}

export class MeterStore {
  constructor(private readonly storage: Storage) {}

  /**
   * Record usage.
   *
   * UPSERT keeps this a single statement, so concurrent requests cannot lose an
   * increment through a read-modify-write race.
   */
  record(tenantId: string, metric: string, amount = 1, period = currentPeriod()): void {
    if (!tenantId || amount === 0) return;

    this.storage.run(
      `INSERT INTO usage (tenant_id, metric, period, count) VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, metric, period) DO UPDATE SET count = count + excluded.count`,
      tenantId, metric, period, amount
    );
  }

  used(tenantId: string, metric: string, period = currentPeriod()): number {
    const row = this.storage.get<{ count: number }>(
      'SELECT count FROM usage WHERE tenant_id = ? AND metric = ? AND period = ?',
      tenantId, metric, period
    );
    return Number(row?.count ?? 0);
  }

  /** Every metric for a tenant in a period — what an invoice is built from. */
  summary(tenantId: string, period = currentPeriod()): Record<string, number> {
    const rows = this.storage.all<{ metric: string; count: number }>(
      'SELECT metric, count FROM usage WHERE tenant_id = ? AND period = ?',
      tenantId, period
    );

    const summary: Record<string, number> = {};
    for (const row of rows) summary[row.metric] = Number(row.count);
    return summary;
  }

  /** Usage across all tenants for a period, newest plans first. */
  allTenants(period = currentPeriod()): Array<{ tenantId: string; metric: string; count: number }> {
    return this.storage
      .all<{ tenant_id: string; metric: string; count: number }>(
        'SELECT tenant_id, metric, count FROM usage WHERE period = ?', period
      )
      .map(row => ({ tenantId: row.tenant_id, metric: row.metric, count: Number(row.count) }));
  }
}

/**
 * Tenants plus metering plus plan limits — the object services actually use.
 */
export class TenantService {
  readonly tenants: TenantStore;
  readonly meters: MeterStore;

  constructor(private readonly storage: Storage) {
    this.tenants = new TenantStore(storage);
    this.meters = new MeterStore(storage);
  }

  planFor(tenant: Tenant): Plan {
    return getPlan(tenant.plan);
  }

  /**
   * Would one more unit of this metric exceed the tenant's plan?
   *
   * A suspended tenant is refused outright — that is how a failed payment
   * actually stops service.
   */
  authorise(tenant: Tenant, metric: QuotaMetric): QuotaVerdict & { suspended: boolean } {
    const plan = this.planFor(tenant);
    const used = this.meters.used(tenant.id, metric);
    const verdict = checkQuota(plan, metric, used);

    if (tenant.status === 'suspended') {
      return { ...verdict, allowed: false, suspended: true };
    }
    return { ...verdict, suspended: false };
  }

  /** Record usage and return the verdict for the *next* call. */
  consume(tenant: Tenant, metric: QuotaMetric, amount = 1): QuotaVerdict & { suspended: boolean } {
    this.meters.record(tenant.id, metric, amount);
    return this.authorise(tenant, metric);
  }

  /** Full billing picture for a tenant — what a dashboard or invoice renders. */
  usageReport(tenant: Tenant, period = currentPeriod()) {
    const plan = this.planFor(tenant);
    const summary = this.meters.summary(tenant.id, period);

    const quotas = (Object.keys(plan.limits) as QuotaMetric[]).map(metric =>
      checkQuota(plan, metric, summary[metric] ?? 0)
    );

    return {
      tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
      period,
      plan: { id: plan.id, label: plan.label, priceCents: plan.priceCents, features: plan.features },
      usage: summary,
      quotas,
      // Surfaced so a customer can be nudged before they are cut off. The
      // `remaining <= 1` arm matters: on a small plan (free allows 3 agents)
      // utilisation jumps 0.67 -> 1.0, so a percentage threshold alone would
      // never warn the customers most likely to upgrade.
      approachingLimit: quotas.filter(
        quota => quota.limit > 0 && (quota.utilisation >= 0.8 || quota.remaining <= 1)
      ),
    };
  }
}
