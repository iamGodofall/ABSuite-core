/**
 * What this instance could know and does not — as a queue of work.
 *
 * An UNKNOWN is not a destination. Every one of them already carries its own
 * route out, and across thousands of records those routes collapse into a
 * handful of distinct actions. This is that list.
 *
 * Alphabetical, never ranked. Which gap matters is a judgement, and ordering
 * them by importance would be ABSuite making it — the same refusal as declining
 * to score anything else.
 */
import React, { useCallback, useEffect, useState } from 'react';

interface QueueItem {
  resolution: string;
  conditions: string[];
  examples: string[];
}

interface Payload {
  examined: number;
  held: number;
  queue: QueueItem[];
  note: string;
}

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

export const UnknownsPanel = () => {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/executions/unknowns?limit=200', { headers: getAdminHeaders() });
      const text = await res.text();
      let parsed: Record<string, unknown>;
      try { parsed = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`The unknowns endpoint returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Reading the execution log requires your admin key. Add it under Settings → Admin API key.');
        }
        const e = parsed.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Could not load (${res.status})`);
      }
      setData(parsed as unknown as Payload);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-text-primary">What we could know, and don’t</h3>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-lg text-text-muted hover:text-text-primary text-xs font-medium transition-all"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-text-muted mb-3 leading-relaxed">
        Every unknown in the system carries the step that would resolve it. Grouped, they are a
        queue of work rather than a list of complaints.
      </p>

      {error && <p className="text-xs text-amber-400">{error}</p>}
      {!error && !data && <p className="text-sm text-text-muted">Examining records…</p>}

      {data && data.queue.length === 0 && (
        <p className="text-sm text-text-muted">
          Nothing examined here is unknown for a reason this instance can act on.
        </p>
      )}

      {data && data.queue.length > 0 && (
        <ul className="space-y-2">
          {data.queue.map(item => (
            <li key={item.resolution} className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3">
              <div className="text-xs text-amber-400/90 leading-snug">{item.resolution}</div>
              <div className="text-[10px] font-mono text-text-muted mt-1">
                affects {item.conditions.join(', ')} · e.g. {item.examples.slice(0, 2).join(', ')}
                {item.examples.length > 2 ? ' …' : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <p className="text-[11px] text-text-muted mt-3 pt-2 border-t border-border leading-snug opacity-80">
          Examined {data.examined.toLocaleString('en-US')} of {data.held.toLocaleString('en-US')} record(s). {data.note}
        </p>
      )}
    </div>
  );
};

export default UnknownsPanel;
