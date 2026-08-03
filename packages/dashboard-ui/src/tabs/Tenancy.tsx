/**
 * Tenancy and billing — the last row of AUDIT §2 with no interface.
 *
 * Six routes existed and none were reachable, so creating a tenant, moving a
 * plan or rotating an API key was curl only.
 *
 * ## The thing this screen must not do
 *
 * Every plan declares five limits: agents, validations, schedules,
 * benchmarkRuns and auditRetentionDays. **Two of them are counted.**
 * `enforceQuota` is applied to `POST /auth/token` and `POST /auth/token/validate`
 * and to nothing else, so schedules and benchmark runs are never incremented,
 * and nothing anywhere enforces a retention period.
 *
 * A quota bar showing `0 / 5 schedules` is therefore a lie in the most
 * dangerous shape this product knows: **zero because nothing counted is
 * indistinguishable from zero because nothing happened**, and the reader
 * concludes they have headroom. It is the same defect `watch.coverage()` exists
 * to prevent, arriving in a screen about money.
 *
 * So a metric that nothing meters reads `ABSENT` with the reason attached, never
 * a number and never a bar. An operator can then ask the only useful question —
 * *is this limit real?* — instead of trusting a full-looking gauge.
 *
 * ## The API key
 *
 * Returned exactly once, by create and by rotate, and stored only as a
 * SHA-256 hash. It is shown once here, with that stated. A key this server could
 * show you twice would be a key this server had kept.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Panel, Empty, Problem, Loading, Badge, Note } from '../surface/Surface';

type PlanId = 'free' | 'team' | 'business' | 'enterprise';
type QuotaMetric = 'agents' | 'validations' | 'schedules' | 'benchmarkRuns' | 'auditRetentionDays';

interface Quota {
  metric: QuotaMetric;
  limit: number;
  used: number;
  remaining: number;
  utilisation: number;
}

interface TenantReport {
  tenant: { id: string; name: string; plan: PlanId; status: 'active' | 'suspended' };
  period: string;
  plan: { id: PlanId; label: string; priceCents: number; features: string[] };
  usage: Record<string, number>;
  quotas: Quota[];
  approachingLimit: Quota[];
}

/**
 * Which limits are actually incremented, read from the one place that does it.
 *
 * Written here rather than derived, and that is a real weakness — it is a
 * hand-copied fact, the defect this repository keeps finding in itself. It is
 * copied deliberately because the alternative is worse: inferring "metered"
 * from a usage count of zero would make an unmetered limit indistinguishable
 * from an unused one, which is the exact confusion this panel exists to end.
 *
 * `check:metered` fails the build if these stop matching `enforceQuota` in
 * capkit's server, so the copy cannot drift silently.
 */
const METERED: Record<QuotaMetric, string | null> = {
  agents: null,
  validations: null,
  schedules: 'Nothing increments this. Schedules are created in edge-run, which does not share the meter.',
  benchmarkRuns: 'Nothing increments this. Benchmark runs are counted in quickbench, which does not share the meter.',
  auditRetentionDays: 'Not a counter, and not enforced. ABSuite deletes no records, so this is a commercial commitment rather than a mechanism.',
};

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const post = async (path: string, body: unknown) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...getAdminHeaders() },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as { error?: { message?: string } | string };
  if (!res.ok) {
    const detail = parsed.error;
    throw new Error((typeof detail === 'string' ? detail : detail?.message) ?? `Not recorded (${res.status}).`);
  }
  return parsed;
};

const money = (cents: number) => (cents === 0 ? 'free' : `$${(cents / 100).toFixed(0)}/mo`);

/** One limit, and whether the number beside it means anything. */
const QuotaRow = ({ quota }: { quota: Quota }) => {
  const unmetered = METERED[quota.metric];
  const unlimited = quota.limit < 0;

  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-slate-400">{quota.metric}</span>
        {unmetered ? (
          <Badge state="ABSENT">not counted</Badge>
        ) : (
          <span className="font-mono text-slate-300">
            {quota.used} / {unlimited ? 'unlimited' : quota.limit}
          </span>
        )}
      </div>

      {unmetered
        ? <div className="mt-0.5 text-[11px] text-slate-500">{unmetered}</div>
        : !unlimited && (
            <div className="mt-1 h-1 w-full rounded bg-slate-800">
              <div
                className="h-1 rounded bg-slate-500"
                style={{ width: `${Math.min(100, Math.round(quota.utilisation * 100))}%` }}
              />
            </div>
          )}
    </div>
  );
};

const PLANS: PlanId[] = ['free', 'team', 'business', 'enterprise'];

const Tenant = ({ report, onChanged }: { report: TenantReport; onChanged: () => void }) => {
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [rotated, setRotated] = useState('');

  const act = async (action: string, body: unknown) => {
    setProblem(''); setBusy(true);
    try {
      const result = await post(`/admin/tenants/${encodeURIComponent(report.tenant.id)}/${action}`, body);
      if (action === 'rotate-key') setRotated(String((result as { apiKey?: string }).apiKey ?? ''));
      onChanged();
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };

  const suspended = report.tenant.status === 'suspended';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium text-slate-100">{report.tenant.name}</div>
          <div className="font-mono text-[11px] text-slate-500">{report.tenant.id}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{report.plan.label} · {money(report.plan.priceCents)}</span>
          <Badge state={suspended ? 'FAILED' : 'DEMONSTRATED'}>{report.tenant.status}</Badge>
        </div>
      </div>

      <Note>Usage for {report.period}. Two of the five limits below are counted; the rest say so.</Note>

      <div className="mt-2 divide-y divide-slate-800/60">
        {report.quotas.map(quota => <QuotaRow key={quota.metric} quota={quota} />)}
      </div>

      {report.approachingLimit.length > 0 && (
        <div className="mt-3 rounded border border-amber-900/40 bg-amber-950/10 p-2 text-xs text-amber-200/80">
          Close to a limit: {report.approachingLimit.map(quota => quota.metric).join(', ')}. Counted
          limits only — a metric nothing increments can never appear here.
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={report.tenant.plan} disabled={busy}
          onChange={event => void act('plan', { plan: event.target.value })}
          className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
        >
          {PLANS.map(plan => <option key={plan} value={plan}>{plan}</option>)}
        </select>

        <button
          type="button" disabled={busy}
          onClick={() => void act('status', { status: suspended ? 'active' : 'suspended' })}
          className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 disabled:opacity-50"
        >
          {suspended ? 'Reinstate' : 'Suspend'}
        </button>

        <button
          type="button" disabled={busy} onClick={() => void act('rotate-key', {})}
          className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 disabled:opacity-50"
        >
          Rotate API key
        </button>
      </div>

      {rotated && (
        <div className="mt-3 rounded border border-amber-900/40 bg-amber-950/10 p-3">
          <div className="text-xs text-amber-300/80">
            Copy this now. It is stored only as a SHA-256 hash, so this screen cannot show it again
            — and a screen that could would mean the key had been kept.
          </div>
          <div className="mt-1 break-all font-mono text-xs text-amber-100">{rotated}</div>
        </div>
      )}

      {problem && <Problem what={problem} />}
    </div>
  );
};

export const TenancyLayer = () => {
  const [tenants, setTenants] = useState<TenantReport[] | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<PlanId>('free');
  const [created, setCreated] = useState<{ name: string; apiKey: string } | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/admin/tenants', { headers: getAdminHeaders() });
      const body = (await res.json()) as { tenants?: TenantReport[]; error?: { message?: string } | string };
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 503) {
          throw new Error('Reading tenants requires your admin key. Add it under Settings → Admin API key.');
        }
        const detail = body.error;
        throw new Error((typeof detail === 'string' ? detail : detail?.message) ?? `Could not load (${res.status})`);
      }
      setTenants(body.tenants ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setProblem(''); setBusy(true);
    try {
      const result = await post('/admin/tenants', { name, plan }) as { name?: string; apiKey?: string };
      setCreated({ name: String(result.name ?? name), apiKey: String(result.apiKey ?? '') });
      setName('');
      await load();
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Panel
      title="Tenancy and billing"
      subtitle="Who is metered, on what plan, and against which limits. Two of the five limits each plan declares are actually counted — agents on token issue and validations on token validate. The rest are shown as not counted rather than as zero, because a gauge reading empty because nothing measures it looks exactly like one reading empty because nothing happened."
    >
      {error && <Problem what={error} resolvedBy="Set your admin key, then reload." />}

      {!error && tenants === null && <Loading what="tenants" />}

      {!error && tenants !== null && tenants.length === 0 && (
        <Empty
          because="No tenant has been created. On a single-operator instance that is the normal state — metering exists for deployments that serve somebody else."
          resolvedBy="Create one below if you are running this for more than yourself."
        />
      )}

      {tenants !== null && tenants.length > 0 && (
        <div className="space-y-3">
          {tenants.map(report => (
            <Tenant key={report.tenant.id} report={report} onChanged={() => void load()} />
          ))}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <div className="text-sm font-medium text-slate-200">Create a tenant</div>
        <div className="mt-1 text-xs text-slate-400">
          The API key is returned once and stored only as a hash. There is no way to recover it —
          rotate instead.
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={name} onChange={event => setName(event.target.value)} placeholder="name"
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          />
          <select
            value={plan} onChange={event => setPlan(event.target.value as PlanId)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          >
            {PLANS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <button
            type="button" onClick={() => void create()} disabled={busy || !name.trim()}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 disabled:opacity-50"
          >
            Create
          </button>
        </div>

        {created && (
          <div className="mt-3 rounded border border-amber-900/40 bg-amber-950/10 p-3">
            <div className="text-xs text-amber-300/80">
              API key for {created.name}. Copy it now — it is shown once.
            </div>
            <div className="mt-1 break-all font-mono text-xs text-amber-100">{created.apiKey}</div>
          </div>
        )}

        {problem && <Problem what={problem} />}
      </div>

      <ul className="mt-4 space-y-1 text-xs text-slate-500">
        <li>schedules and benchmarkRuns — declared by every plan, incremented by nothing</li>
        <li>auditRetentionDays — a commercial commitment; no mechanism deletes or retains on it</li>
      </ul>
    </Panel>
  );
};

export default TenancyLayer;
