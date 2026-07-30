/**
 * What a person should look at.
 *
 * Not an "incident centre". An incident is a judgement about what something
 * means, and ABSuite is the witness — it says what is failed, unproven or
 * unauthorised on its face, names the field that says so, and stops. Whether any
 * of it is an incident is the reader's call, and the panel says as much rather
 * than implying it has already decided.
 *
 * Nothing here is scored or ranked by severity, because severity is a judgement
 * too. Newest first.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '../utils';

interface Flagged {
  trace: {
    id: string;
    subject: string;
    module: string;
    action: string;
    outcome: string;
    error?: string;
    startedAt: string;
    scope?: string[];
  };
  reasons: { reason: string; from: string }[];
}

interface Payload {
  items: Flagged[];
  count: number;
  chain: { valid: boolean; brokenAt?: number; reason?: string; contentIntact?: boolean | null; checkable?: boolean };
  note: string;
}

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

export const AttentionPanel = () => {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/executions/attention?limit=50', { headers: getAdminHeaders() });
      const text = await res.text();
      let parsed: Record<string, unknown>;
      try { parsed = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`The attention endpoint returned ${res.status} and not JSON.`); }
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
        <h3 className="text-sm font-semibold text-text-primary">What warrants a look</h3>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-lg text-text-muted hover:text-text-primary text-xs font-medium transition-all"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-text-muted mb-3 leading-relaxed">
        Records that failed, carry no recorded authority, or are unsigned — each with the field that
        says so. ABSuite states this. It does not call anything an incident, rank it, or tell you what
        to do about it.
      </p>

      {error && <p className="text-xs text-amber-400">{error}</p>}

      {!error && !data && <p className="text-sm text-text-muted">Checking…</p>}

      {data && !data.chain.valid && (
        <div className={cn('rounded-lg border p-3 mb-3',
          data.chain.checkable === false || data.chain.contentIntact
            ? 'border-amber-500/40 bg-amber-500/[0.06]' : 'border-red-500/40 bg-red-500/[0.06]')}>
          <div className={cn('text-xs font-semibold',
            data.chain.checkable === false || data.chain.contentIntact ? 'text-amber-400' : 'text-red-400')}>
            {data.chain.checkable === false
              ? `Record #${data.chain.brokenAt} was written in a newer format than this build reads. Not tampering — upgrade to check it.`
              : data.chain.contentIntact
                ? `Record #${data.chain.brokenAt} was not edited — it was signed by a different key.`
                : `The chain does not verify at record #${data.chain.brokenAt}.`}
          </div>
          {data.chain.reason && <p className="text-[11px] text-text-muted mt-1 leading-snug">{data.chain.reason}</p>}
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="text-sm text-text-muted">
          Nothing. Every record held is signed, scoped and successful — a measured result, not a
          placeholder.
        </p>
      )}

      {data && data.items.length > 0 && (
        <ul className="space-y-2 max-h-[28rem] overflow-y-auto">
          {data.items.map(item => (
            <li key={item.trace.id} className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="text-xs font-mono text-text-primary">
                  {item.trace.subject} · {item.trace.action}
                </span>
                <span className="text-[10px] font-mono text-text-muted">
                  {new Date(item.trace.startedAt).toLocaleString()}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {item.reasons.map((reason, i) => (
                  <li key={i} className="text-[11px] leading-snug">
                    <span className="text-amber-400/90">{reason.reason}</span>
                    <span className="text-text-muted font-mono opacity-70"> — from: {reason.from}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <p className="text-[11px] text-text-muted mt-3 pt-2 border-t border-border leading-snug opacity-80">
          {data.note}
        </p>
      )}
    </div>
  );
};

export default AttentionPanel;
