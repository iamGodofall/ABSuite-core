/**
 * The global view — what this instance is actually holding, right now.
 *
 * Every tile is a count of records that exist, taken on this request, with the
 * window it covers printed underneath. There is no sampling, no projection and
 * no "≈". When a number is zero it says zero, because an empty system reporting
 * itself empty is the correct answer and the only one this product is allowed
 * to give.
 *
 * The last block is the important one: it lists the figures a control plane is
 * expected to show and this one deliberately does not — active agents,
 * incidents, open disputes — with the reason each would have to be invented. A
 * dashboard showing "0 incidents" for a concept it has never had is worse than
 * one that admits the concept is missing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '../utils';

interface Stats {
  total: number;
  subjects: number;
  modules: number;
  actions: number;
  failures: number;
  windowHours: number;
  inWindow: number;
  failuresInWindow: number;
  oldest?: string;
  newest?: string;
  withoutScope: number;
  chain: { valid: boolean; checked: number; brokenAt?: number; reason?: string; contentIntact?: boolean | null; checkable?: boolean; headHash: string };
  unverifiable: { field: string; because: string }[];
}

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const Tile = ({ label, value, sub, tone = 'plain' }: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone?: 'plain' | 'good' | 'warn' | 'bad';
}) => (
  <div className={cn(
    'rounded-xl border p-4',
    tone === 'good' ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
      : tone === 'warn' ? 'border-amber-500/40 bg-amber-500/[0.06]'
      : tone === 'bad' ? 'border-red-500/40 bg-red-500/[0.06]'
      : 'border-border bg-bg-secondary'
  )}>
    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-1">{label}</div>
    <div className={cn('text-2xl font-bold',
      tone === 'good' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400'
        : tone === 'bad' ? 'text-red-400' : 'text-text-primary')}>
      {value}
    </div>
    <div className="text-xs text-text-muted mt-1 leading-snug">{sub}</div>
  </div>
);

export const GlobalView = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/executions/stats?windowHours=24', { headers: getAdminHeaders() });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`The stats endpoint returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Reading the execution log requires your admin key. Add it under Settings → Admin API key.');
        }
        const e = data.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Could not load counts (${res.status})`);
      }
      setStats(data as unknown as Stats);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
        <p className="text-sm font-semibold text-amber-400 mb-1">Counts unavailable</p>
        <p className="text-xs text-text-muted">{error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="rounded-xl border border-border bg-bg-secondary p-4 text-sm text-text-muted">
        Counting what is held…
      </div>
    );
  }

  const window = stats.windowHours === 24 ? 'last 24 hours' : `last ${stats.windowHours} hours`;
  // Verification rate is checked/total, and only means something once the chain
  // has actually been walked — which it is, on this request.
  const verified = stats.total === 0 ? null : (stats.chain.checked / stats.total) * 100;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Records held"
          value={stats.total.toLocaleString('en-US')}
          sub={stats.total === 0 ? 'nothing recorded yet' : `${stats.inWindow.toLocaleString('en-US')} in the ${window}`}
        />
        {/* A failed signature with intact content is a key problem, not an
            intrusion. Calling both "Broken" trains people to ignore the word. */}
        <Tile
          label="Chain"
          tone={stats.total === 0 ? 'plain' : stats.chain.valid ? 'good'
            : stats.chain.checkable === false || stats.chain.contentIntact ? 'warn' : 'bad'}
          value={stats.total === 0 ? '—'
            : stats.chain.valid ? 'Intact'
            : stats.chain.checkable === false ? 'Unreadable here'
            : stats.chain.contentIntact ? 'Key mismatch'
            : `Broken at #${stats.chain.brokenAt}`}
          sub={stats.total === 0
            ? 'no records to verify'
            : stats.chain.valid
              ? `${stats.chain.checked.toLocaleString('en-US')} record(s) verified just now`
              : stats.chain.checkable === false
                ? `Record #${stats.chain.brokenAt} was written in a newer format. Upgrade to check it — this is not tampering.`
                : stats.chain.contentIntact
                  ? `Record #${stats.chain.brokenAt} was not edited — it was signed by a different key.`
                  : stats.chain.reason ?? 'verification failed'}
        />
        <Tile
          label="Verification rate"
          tone={verified === null ? 'plain' : verified === 100 && stats.chain.valid ? 'good' : 'warn'}
          value={verified === null ? '—' : `${verified.toFixed(verified === 100 ? 0 : 2)}%`}
          sub={verified === null ? 'nothing to verify' : 'of held records verified on this request'}
        />
        <Tile
          label="Subjects seen"
          value={stats.subjects.toLocaleString('en-US')}
          sub={`across ${stats.modules} module(s) and ${stats.actions} distinct action(s)`}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Failures"
          tone={stats.failuresInWindow > 0 ? 'warn' : 'plain'}
          value={stats.failuresInWindow.toLocaleString('en-US')}
          sub={`in the ${window} · ${stats.failures.toLocaleString('en-US')} all time`}
        />
        <Tile
          label="Recorded without scope"
          tone={stats.withoutScope > 0 ? 'warn' : 'plain'}
          value={stats.withoutScope.toLocaleString('en-US')}
          sub={stats.withoutScope > 0
            ? 'cannot be shown to have been permitted'
            : 'every record names the authority it held'}
        />
        <Tile
          label="Oldest record"
          value={stats.oldest ? new Date(stats.oldest).toLocaleDateString() : '—'}
          sub={stats.oldest ? new Date(stats.oldest).toLocaleTimeString() : 'nothing recorded yet'}
        />
        <Tile
          label="Newest record"
          value={stats.newest ? new Date(stats.newest).toLocaleDateString() : '—'}
          sub={stats.newest ? new Date(stats.newest).toLocaleTimeString() : 'nothing recorded yet'}
        />
      </div>

      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted mb-2">
          What this screen will not tell you
        </div>
        <p className="text-xs text-text-muted mb-3 leading-relaxed">
          A control plane is expected to show these. This one does not, because each would have to be
          invented from data nobody here holds — and a single fabricated number would cost more than
          every honest one above is worth.
        </p>
        <ul className="space-y-1.5">
          {stats.unverifiable.map(item => (
            <li key={item.field} className="text-[11px] leading-snug flex gap-2">
              <span className="font-mono text-amber-400/80 shrink-0">{item.field}</span>
              <span className="text-text-muted">— {item.because}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default GlobalView;
