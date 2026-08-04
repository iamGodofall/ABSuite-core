import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, KeyRound, AlertCircle } from 'lucide-react';
import { Panel, Problem } from '../surface/Surface';

/**
 * Where a person actually gives this instance its keys.
 *
 * Every provider in the room reported `NEEDS SETUP` and offered no setup, and
 * every connector reported `not configured` beside no field to configure it in.
 * The instruction was "put it in your .env" — a file the person reading the
 * screen may never have opened, on a machine they may not be sitting at. It is
 * the same dead end this system forbids everywhere else: a state that names no
 * step out of itself.
 *
 * Two things this deliberately does not do.
 *
 * It does not keep the value in the browser. The admin key still lives in
 * localStorage, which is a real inconsistency and is written down as one in
 * AUDIT §4r — but a provider secret typed here goes straight to the server and
 * is never held, cached or re-rendered on this side.
 *
 * It does not read anything back. The API answers whether a key is set and
 * refuses to say what it is, so this panel could not redisplay a secret even if
 * someone later asked it to. A settings screen that shows you your own key
 * turns every screen-share into a disclosure, and this room is demonstrated on
 * video.
 */

interface Credential {
  key: string;
  provider: string;
  label: string;
  /** Live in the running process. */
  inEnvironment: boolean;
  /** Written to the file, which is not the same as in effect. */
  inFile: boolean;
}

type Saving = { key: string } | null;
type Result = { key: string; ok: boolean; message: string } | null;

export function CredentialsPanel({ headers, only }: {
  /** The admin credential this tab holds. */
  headers: HeadersInit;
  /** Restrict to one provider's keys, for rendering beside that provider. */
  only?: string;
}) {
  const [state, setState] = useState<{ file: string; credentials: Credential[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Saving>(null);
  const [result, setResult] = useState<Result>(null);

  const read = useCallback(async () => {
    try {
      const res = await fetch('/config/credentials', { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          res.status === 403 || res.status === 503
            ? 'This needs the admin key. Enter it above, then reopen this panel.'
            : (body as { message?: string }).message ?? `The instance answered ${res.status}.`,
        );
        return;
      }
      setError(null);
      setState(await res.json());
    } catch {
      setError('The dashboard could not be reached from this tab.');
    }
    // `headers` is a fresh object every render; depending on it would refetch
    // forever. The admin key changing is handled by the panel being reopened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void read(); }, [read]);

  const save = async (key: string) => {
    const value = (values[key] ?? '').trim();
    if (!value) return;
    setSaving({ key });
    setResult(null);
    try {
      const res = await fetch('/config/credentials', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const body = await res.json().catch(() => ({}));
      setResult({
        key,
        ok: res.ok,
        message: (body as { message?: string; error?: string }).message
          ?? (body as { error?: string }).error
          ?? (res.ok ? 'Saved.' : `The instance answered ${res.status}.`),
      });
      if (res.ok) {
        // Cleared immediately: the value has left this tab and there is no
        // reason for a secret to sit in a React state tree afterwards.
        setValues(current => ({ ...current, [key]: '' }));
        void read();
      }
    } catch {
      setResult({ key, ok: false, message: 'The request did not arrive. Nothing was written.' });
    } finally {
      setSaving(null);
    }
  };

  if (error) {
    return <Problem title="Credentials cannot be read from this tab" what={error} />;
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading which credentials are set…
      </div>
    );
  }

  const rows = only
    ? state.credentials.filter(entry => entry.provider === only)
    : state.credentials;

  // One block per provider, because a provider with two accepted names is one
  // decision — set either — and listing them as two rows reads as two chores.
  const byProvider = new Map<string, Credential[]>();
  for (const row of rows) {
    const list = byProvider.get(row.provider) ?? [];
    list.push(row);
    byProvider.set(row.provider, list);
  }

  return (
    <div className="space-y-5">
      {!only && (
        <p className="text-sm text-text-muted">
          Paste a key and it is written to{' '}
          <span className="font-mono text-text-secondary break-all">{state.file}</span> on the server. It is never
          kept in this browser and never sent back to it — this panel can tell you a key is set and cannot tell you
          what it is. CapKit reads its environment when it starts, so restart the suite for a new key to take effect.
        </p>
      )}

      {[...byProvider].map(([provider, entries]) => {
        const live = entries.some(entry => entry.inEnvironment);
        const stored = entries.some(entry => entry.inFile);
        const primary = entries[0];
        const shown = result?.key && entries.some(entry => entry.key === result.key) ? result : null;

        return (
          <Panel
            key={provider}
            title={primary.label}
            subtitle={
              entries.length > 1
                ? `Either ${entries.map(entry => entry.key).join(' or ')} — whichever your provider calls it.`
                : entries[0].key
            }
            actions={
              live ? (
                <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">In effect</span>
              ) : stored ? (
                <span className="text-[10px] font-mono uppercase tracking-widest text-amber-300">
                  Saved — restart to apply
                </span>
              ) : (
                <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Not set</span>
              )
            }
          >
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                autoComplete="off"
                value={values[primary.key] ?? ''}
                onChange={event => setValues(current => ({ ...current, [primary.key]: event.target.value }))}
                onKeyDown={event => { if (event.key === 'Enter') void save(primary.key); }}
                placeholder={live || stored ? 'Replace it' : `Paste ${primary.key}`}
                aria-label={primary.key}
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg-tertiary px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-emerald-500/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void save(primary.key)}
                disabled={!(values[primary.key] ?? '').trim() || saving?.key === primary.key}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
              >
                {saving?.key === primary.key
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <KeyRound className="h-3.5 w-3.5" />}
                Save to server
              </button>
            </div>

            {shown && (
              <p className={`mt-2 flex items-start gap-2 text-xs ${shown.ok ? 'text-emerald-300' : 'text-red-300'}`}>
                {shown.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                {shown.message}
              </p>
            )}
          </Panel>
        );
      })}

      {rows.length === 0 && (
        <p className="text-sm text-text-muted">
          No credential is defined for this provider — it is reached without one.
        </p>
      )}
    </div>
  );
}
