/**
 * Who has been doing what, under whose authority.
 *
 * An access review normally reads a list of issued tokens, which describes
 * intent. This reads records of things that happened, which describes behaviour.
 * A capability nobody used does not appear, and a subject that acted without a
 * recorded scope appears loudly — because "no restriction" and "no record of a
 * restriction" are opposite claims, and only one of them is safe to assume.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { cn } from '../utils';

interface SubjectAuthority {
  subject: string;
  total: number;
  lastSeen: string;
  unscoped: number;
  scopes: { scope: string; count: number }[];
}

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

export const AuthorityPanel = () => {
  const [subjects, setSubjects] = useState<SubjectAuthority[] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/executions/authority', { headers: getAdminHeaders() });
      const text = await res.text();
      let parsed: Record<string, unknown>;
      try { parsed = text ? JSON.parse(text) : {}; }
      catch { throw new Error(`The authority endpoint returned ${res.status} and not JSON.`); }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Reading the execution log requires your admin key. Add it under Settings → Admin API key.');
        }
        const e = parsed.error as { message?: string } | string | undefined;
        throw new Error((typeof e === 'string' ? e : e?.message) ?? `Could not load (${res.status})`);
      }
      setSubjects((parsed.subjects as SubjectAuthority[]) ?? []);
      setNote(String(parsed.note ?? ''));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-text-primary">Authority actually exercised</h3>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-lg text-text-muted hover:text-text-primary text-xs font-medium transition-all"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-text-muted mb-3 leading-relaxed">
        Every subject that has acted, and the scopes it acted under, counted from signed records. This
        is behaviour, not a list of what was handed out.
      </p>

      {error && <p className="text-xs text-amber-400">{error}</p>}
      {!error && !subjects && <p className="text-sm text-text-muted">Reading the record…</p>}

      {subjects && subjects.length === 0 && (
        <p className="text-sm text-text-muted">
          No subject has acted yet. Nothing has been exercised, so there is nothing to review.
        </p>
      )}

      {subjects && subjects.length > 0 && (
        <ul className="space-y-2 max-h-[28rem] overflow-y-auto">
          {subjects.map(entry => (
            <li
              key={entry.subject}
              className={cn(
                'rounded-lg border p-3',
                entry.unscoped > 0 ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-border bg-bg-primary/40'
              )}
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1.5">
                <span className="text-xs font-mono text-text-primary">{entry.subject}</span>
                <span className="text-[10px] font-mono text-text-muted">
                  {entry.total.toLocaleString('en-US')} action(s) · last {new Date(entry.lastSeen).toLocaleString()}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {entry.scopes.map(scope => (
                  <span
                    key={scope.scope}
                    className="rounded border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-0.5 text-[11px] font-mono text-emerald-400"
                  >
                    {scope.scope} <span className="text-text-muted">×{scope.count}</span>
                  </span>
                ))}
                {entry.unscoped > 0 && (
                  <span className="rounded border border-amber-500/40 bg-amber-500/[0.08] px-2 py-0.5 text-[11px] font-mono text-amber-400">
                    no scope recorded ×{entry.unscoped}
                  </span>
                )}
              </div>

              {entry.unscoped > 0 && (
                <p className="text-[11px] text-amber-400/80 mt-1.5 leading-snug">
                  {entry.unscoped} of these actions carry no recorded authority, so they cannot be
                  shown to have been permitted. That is not proof they were not.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p className="text-[11px] text-text-muted mt-3 pt-2 border-t border-border leading-snug opacity-80">
          {note}
        </p>
      )}
    </div>
  );
};

export default AuthorityPanel;
