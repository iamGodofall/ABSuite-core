/**
 * Layer 4 — model identity. Is the thing answering still the model you approved?
 *
 * Four routes existed in capkit and none were reachable from here, so the only
 * way to approve a model or ask for an attestation was curl. That is the same
 * shape Identity had before it got a surface: a layer that is built, and cannot
 * be operated.
 *
 * The question this answers is narrow and worth stating exactly, because a
 * screen called "model identity" invites a much larger reading:
 *
 *   It compares **identifying material** — provider, model, version, digest.
 *   It says nothing about **behaviour**.
 *
 * A provider that rolls a version silently, a quantisation that changes
 * numerics, a proxy repointed at a different endpoint: those are what this
 * catches, and each of them is invisible in an execution log. A model that
 * reports the same version and answers differently is not, and the panel says so
 * on the answer rather than in a footnote.
 *
 * Attestation is deliberately a *question you ask*, not a stored verdict. You
 * supply what you observe now; the registry compares it with what was approved.
 * Nothing here goes and interrogates a provider on your behalf, because a
 * fingerprint this server collected is a fingerprint this server could invent.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Panel, Empty, Problem, Loading, Badge, Note } from '../surface/Surface';

type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

interface Fingerprint {
  provider: string;
  model: string;
  version?: string;
  digest?: string;
}

interface ApprovedModel {
  name: string;
  fingerprint: Fingerprint;
  hash: string;
  approvedAt: string;
  approvedBy: string;
  basis: string;
}

interface Drift {
  field: string;
  approved: string | null;
  observed: string | null;
}

interface Attestation {
  state: Determination;
  name: string;
  finding: string;
  drift: Drift[];
  limits: string[];
}

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

/** The fields a fingerprint is made of, as one editable group. */
const FingerprintFields = ({ value, onChange, prefix }: {
  value: Fingerprint;
  onChange: (next: Fingerprint) => void;
  prefix: string;
}) => (
  <div className="grid grid-cols-2 gap-2">
    {([
      ['provider', 'anthropic', true],
      ['model', 'claude-sonnet-4-5', true],
      ['version', 'optional', false],
      ['digest', 'optional', false],
    ] as [keyof Fingerprint, string, boolean][]).map(([field, hint, required]) => (
      <label key={field} className="text-xs text-slate-400">
        {field}{required ? '' : ' (optional)'}
        <input
          id={`${prefix}-${field}`}
          value={value[field] ?? ''}
          onChange={event => onChange({ ...value, [field]: event.target.value })}
          placeholder={hint}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
        />
      </label>
    ))}
  </div>
);

const EMPTY: Fingerprint = { provider: '', model: '', version: '', digest: '' };

/**
 * One approved model, what it was approved on, and the attestation you asked for.
 *
 * `basis` is shown at full width rather than truncated. An approval with no
 * stated reason cannot be reviewed six months later, and capkit refuses one —
 * so the field is always populated and always worth the space.
 */
const Model = ({ model, onChanged }: { model: ApprovedModel; onChanged: () => void }) => {
  const [observed, setObserved] = useState<Fingerprint>(model.fingerprint);
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [basis, setBasis] = useState('');
  const [by, setBy] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const attest = async () => {
    setProblem(''); setBusy(true);
    try {
      setAttestation(await post(`/models/${encodeURIComponent(model.name)}/attest`,
        { fingerprint: observed }) as unknown as Attestation);
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };

  const supersede = async () => {
    setProblem(''); setBusy(true);
    try {
      await post(`/models/${encodeURIComponent(model.name)}/supersede`,
        { fingerprint: observed, approvedBy: by, basis });
      setReplacing(false); setBasis(''); setBy(''); setAttestation(null);
      onChanged();
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium text-slate-100">{model.name}</div>
          <div className="text-xs text-slate-400">
            {model.fingerprint.provider} · {model.fingerprint.model}
            {model.fingerprint.version ? ` · ${model.fingerprint.version}` : ''}
          </div>
        </div>
        {attestation && <Badge state={attestation.state}>{attestation.state}</Badge>}
      </div>

      <div className="mt-2 font-mono text-[11px] text-slate-500">{model.hash}</div>

      <Note>
        Approved {new Date(model.approvedAt).toLocaleString()} by {model.approvedBy} — {model.basis}
      </Note>

      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-slate-500">What you observe now</div>
        <div className="mt-2">
          <FingerprintFields value={observed} onChange={setObserved} prefix={`observed-${model.name}`} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button" onClick={() => void attest()} disabled={busy}
          className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 disabled:opacity-50"
        >
          Attest
        </button>
        <button
          type="button" onClick={() => setReplacing(value => !value)} disabled={busy}
          className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 disabled:opacity-50"
        >
          {replacing ? 'Cancel' : 'Supersede'}
        </button>
      </div>

      {attestation && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-950/60 p-3">
          <div className="text-sm text-slate-200">{attestation.finding}</div>

          {attestation.drift.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-slate-500">
                <tr><th className="text-left font-normal">field</th>
                    <th className="text-left font-normal">approved</th>
                    <th className="text-left font-normal">observed</th></tr>
              </thead>
              <tbody className="font-mono text-slate-300">
                {attestation.drift.map(row => (
                  <tr key={row.field}>
                    <td className="pr-3 text-slate-400">{row.field}</td>
                    <td className="pr-3">{row.approved ?? '—'}</td>
                    <td>{row.observed ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/*
            * The limits travel with the answer, never underneath it. A reader
            * who takes DEMONSTRATED away without them has taken the wrong thing.
            */}
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {attestation.limits.map(limit => <li key={limit}>{limit}</li>)}
          </ul>
        </div>
      )}

      {replacing && (
        <div className="mt-3 space-y-2 rounded border border-amber-900/40 bg-amber-950/10 p-3">
          <div className="text-xs text-amber-300/80">
            Superseding replaces the approved fingerprint with the observed one above. It is a
            decision somebody makes, which is why it asks who and why.
          </div>
          <input
            value={by} onChange={event => setBy(event.target.value)} placeholder="approved by"
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          />
          <textarea
            value={basis} onChange={event => setBasis(event.target.value)}
            placeholder="basis — why this replacement is correct"
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          />
          <button
            type="button" onClick={() => void supersede()} disabled={busy || !by.trim() || !basis.trim()}
            className="rounded bg-amber-900/40 px-3 py-1 text-sm text-amber-100 disabled:opacity-50"
          >
            Replace the approval
          </button>
        </div>
      )}

      {problem && <Problem what={problem} />}
    </div>
  );
};

export const ModelIdentityLayer = () => {
  const [models, setModels] = useState<ApprovedModel[] | null>(null);
  const [unverifiable, setUnverifiable] = useState<{ field: string; because: string }[]>([]);
  const [error, setError] = useState('');
  const [fingerprint, setFingerprint] = useState<Fingerprint>(EMPTY);
  const [name, setName] = useState('');
  const [by, setBy] = useState('');
  const [basis, setBasis] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/models', { headers: getAdminHeaders() });
      const body = (await res.json()) as {
        models?: ApprovedModel[];
        unverifiable?: { field: string; because: string }[];
        error?: { message?: string } | string;
      };
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 503) {
          throw new Error('Reading approved models requires your admin key. Add it under Settings → Admin API key.');
        }
        const detail = body.error;
        throw new Error((typeof detail === 'string' ? detail : detail?.message) ?? `Could not load (${res.status})`);
      }
      setModels(body.models ?? []);
      setUnverifiable(body.unverifiable ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const approve = async () => {
    setProblem(''); setBusy(true);
    try {
      await post('/models', { name, fingerprint, approvedBy: by, basis });
      setName(''); setFingerprint(EMPTY); setBy(''); setBasis('');
      await load();
    } catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Panel
      title="Model identity"
      subtitle="Is the thing answering still the model that was approved? This compares identifying material — provider, model, version, digest — and nothing else. A provider that rolls a version silently, a quantisation that changes numerics, a proxy repointed elsewhere: those are what it catches, and none of them appears in an execution log."
    >
      {error && <Problem what={error} resolvedBy="Set your admin key, then reload." />}

      {!error && models === null && <Loading what="approved models" />}

      {!error && models !== null && models.length === 0 && (
        <Empty
          because="No model has been approved on this instance, so every attestation answers UNKNOWN — which is correct rather than a failure. Nothing has been claimed, so nothing can be compared."
          resolvedBy="Approve one below. You need what the provider reports about it now, and a reason."
        />
      )}

      {models !== null && models.length > 0 && (
        <div className="space-y-3">
          {models.map(model => <Model key={model.name} model={model} onChanged={() => void load()} />)}
        </div>
      )}

      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <div className="text-sm font-medium text-slate-200">Approve a model</div>
        <div className="mt-1 text-xs text-slate-400">
          The fingerprint is whatever you can actually obtain. Most hosted providers expose no
          weight digest, and the form does not pretend otherwise — provider and model are enough
          to catch a repointed proxy, and a version catches a silent roll.
        </div>

        <div className="mt-3 space-y-2">
          <input
            value={name} onChange={event => setName(event.target.value)}
            placeholder="name — e.g. refunds-classifier"
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          />
          <FingerprintFields value={fingerprint} onChange={setFingerprint} prefix="approve" />
          <input
            value={by} onChange={event => setBy(event.target.value)} placeholder="approved by"
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          />
          <textarea
            value={basis} onChange={event => setBasis(event.target.value)}
            placeholder="basis — why this model is approved for this use"
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          />
          <button
            type="button" onClick={() => void approve()}
            disabled={busy || !name.trim() || !fingerprint.provider.trim() || !fingerprint.model.trim() || !by.trim() || !basis.trim()}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 disabled:opacity-50"
          >
            Approve
          </button>
        </div>

        {problem && <Problem what={problem} />}
      </div>

      {unverifiable.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-slate-500">
          {unverifiable.map(item => <li key={item.field}>{item.field} — {item.because}</li>)}
        </ul>
      )}
    </Panel>
  );
};

export default ModelIdentityLayer;
