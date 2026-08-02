/**
 * Layer 1 — Identity. Who is acting, and can they prove it.
 *
 * This is the base of the ascent and it had no interface at all. Seven routes
 * existed; the only way to enrol a subject was curl. That is the reason every
 * condition report in this product reads `Identity: UNKNOWN` on a fresh
 * instance — not because the layer is unbuilt, but because nobody could operate
 * the one thing it needs.
 *
 * The distinction this surface has to carry, and the reason it is not just a
 * list of names:
 *
 *   A record's signature proves **this server wrote the record**.
 *   It does not prove **the named subject acted**.
 *
 * Those were once conflated here, and Identity reported DEMONSTRATED on the
 * strength of the trace signature — a false green on the strongest word the
 * product has, in the layer every other layer rests on. Enrolment plus proof of
 * possession is what closes it, and this panel says so on every row rather than
 * leaving the reader to assume a name is an identity.
 *
 * **Only the public half is ever sent.** CapKit refuses a PEM containing
 * PRIVATE KEY outright, and the form says why before it is submitted — a server
 * that could sign as you is a server whose proof means nothing to anyone who
 * does not already trust it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Panel, Empty, Problem, Loading, Badge, Note } from '../surface/Surface';
import { cn } from '../utils';

interface Identity {
  subject: string;
  publicKeyPem: string;
  kind: 'agent' | 'human' | 'service' | 'model';
  status: 'active' | 'suspended';
  label?: string;
  enrolledAt: string;
  lastProvenAt?: string;
  suspendedAt?: string;
  suspendedReason?: string;
}

const KINDS: Identity['kind'][] = ['agent', 'human', 'service', 'model'];

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
  const parsed = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(parsed.error?.message ?? `Not recorded (${res.status}).`);
  return parsed;
};

/**
 * One subject, and what can honestly be said about it.
 *
 * `lastProvenAt` is the field that matters and it is the one a list of names
 * would omit. An enrolled subject that has never signed a challenge is a public
 * key somebody pasted; a subject that has is the only thing here that earns the
 * word DEMONSTRATED.
 */
const Subject = ({ identity, onChanged }: { identity: Identity; onChanged: () => void }) => {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const act = async (action: 'suspend' | 'reinstate') => {
    setBusy(true);
    setProblem('');
    try {
      await post(`/identities/${encodeURIComponent(identity.subject)}/${action}`,
        action === 'suspend' ? { reason: reason.trim() } : {});
      setOpen(false);
      setReason('');
      onChanged();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const suspended = identity.status === 'suspended';
  const proven = Boolean(identity.lastProvenAt);

  return (
    <li className="rounded-xl border border-border bg-bg-primary/40 p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm text-text-primary font-mono">{identity.subject}</p>
          {identity.label && <p className="text-[11px] text-text-muted mt-0.5">{identity.label}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge>{identity.kind}</Badge>
          <Badge state={suspended ? 'FAILED' : proven ? 'DEMONSTRATED' : 'UNKNOWN'}>
            {suspended ? 'suspended' : proven ? 'proven' : 'unproven'}
          </Badge>
        </div>
      </div>

      <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
        {suspended
          ? `Suspended ${identity.suspendedAt}${identity.suspendedReason ? ` — ${identity.suspendedReason}` : ''}. No new authority is issued to it; everything it already did stands unchanged.`
          : proven
            ? `Signed a challenge with the key on file at ${identity.lastProvenAt}. A token issued in this name after that moment can be traced to a subject that proved it holds its own key.`
            : 'Enrolled, and has never signed a challenge. This is a public key somebody pasted — it shows what could be proven, not that anything was.'}
      </p>

      <p className="text-[11px] text-text-muted/70 mt-1.5 font-mono">
        enrolled {identity.enrolledAt}
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-2.5 px-3 py-1 rounded-full border border-border text-text-muted hover:text-text-primary text-[11px] font-medium transition-all"
        >
          {suspended ? 'Reinstate' : 'Suspend'}
        </button>
      ) : (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
          {!suspended && (
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder="Why this identity is being suspended"
              className="w-full rounded-lg bg-bg-secondary border border-border px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
            />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              disabled={busy || (!suspended && reason.trim().length === 0)}
              onClick={() => void act(suspended ? 'reinstate' : 'suspend')}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border',
                busy || (!suspended && reason.trim().length === 0)
                  ? 'border-border text-text-muted/50 cursor-not-allowed'
                  : suspended
                    ? 'border-[#00F58C]/40 text-[#00F58C] hover:bg-[#00F58C]/10'
                    : 'border-red-500/40 text-red-400 hover:bg-red-500/10'
              )}
            >
              {suspended ? 'Reinstate' : 'Suspend'}
            </button>
            <button
              onClick={() => { setOpen(false); setProblem(''); }}
              className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs transition-all"
            >
              Cancel
            </button>
            <span className="text-[11px] text-text-muted/70">
              {suspended
                ? 'The suspension stays in the record. Reinstating is a new decision about it, not a deletion of it.'
                : 'A reason is required. Withdrawing authority with no stated cause cannot be reviewed or contested.'}
            </span>
          </div>
          {problem && <Problem what={problem} />}
        </div>
      )}
    </li>
  );
};

/** Enrol a subject. Public half only, and the form says so before it is sent. */
const Enrol = ({ onEnrolled }: { onEnrolled: () => void }) => {
  const [subject, setSubject] = useState('');
  const [publicKeyPem, setPublicKeyPem] = useState('');
  const [kind, setKind] = useState<Identity['kind']>('agent');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  // Caught here as well as in CapKit, because the useful moment to say it is
  // before the paste leaves the browser.
  const looksPrivate = publicKeyPem.includes('PRIVATE KEY');
  const ready = subject.trim().length > 0 && publicKeyPem.trim().length > 0 && !looksPrivate;

  const submit = async () => {
    setBusy(true);
    setProblem('');
    try {
      await post('/identities', {
        subject: subject.trim(),
        publicKeyPem: publicKeyPem.trim(),
        kind,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      setSubject(''); setPublicKeyPem(''); setLabel('');
      onEnrolled();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Enrol a subject"
      subtitle="A subject with a key on file can be asked to prove it holds the private half. Without that, the name on a record is a string the caller typed."
      footnote="Generate a keypair with generateIdentityKeypair(), or ssh-keygen -t ed25519. Keep the private half on the machine that will act; nothing here should ever see it."
    >
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          <input
            value={subject}
            onChange={event => setSubject(event.target.value)}
            placeholder="Subject — e.g. agent:invoicing"
            className="flex-[2] min-w-[180px] rounded-lg bg-bg-primary/40 border border-border px-3 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted/60"
          />
          <select
            value={kind}
            onChange={event => setKind(event.target.value as Identity['kind'])}
            className="rounded-lg bg-bg-primary/40 border border-border px-3 py-1.5 text-xs text-text-primary"
          >
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="Label (optional)"
            className="flex-1 min-w-[140px] rounded-lg bg-bg-primary/40 border border-border px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
          />
        </div>

        <textarea
          value={publicKeyPem}
          onChange={event => setPublicKeyPem(event.target.value)}
          rows={3}
          placeholder="-----BEGIN PUBLIC KEY-----"
          className="w-full rounded-xl bg-bg-primary/40 border border-border px-3 py-2 text-[11px] font-mono text-text-primary placeholder:text-text-muted/60 resize-y"
        />

        {looksPrivate && (
          <Problem
            title="That is a private key"
            what="Enrolment takes the public half only. Sending this would hand your signing key to a service that never needed it — and a proof this server could produce for you means nothing to anybody who does not already trust it."
            resolvedBy="Send the matching public key instead."
          />
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            disabled={!ready || busy}
            onClick={() => void submit()}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border',
              ready && !busy
                ? 'border-[#00F58C]/40 text-[#00F58C] hover:bg-[#00F58C]/10'
                : 'border-border text-text-muted/50 cursor-not-allowed'
            )}
          >
            Enrol
          </button>
          <span className="text-[11px] text-text-muted/70">
            Enrolling does not prove anything on its own. It makes proof possible.
          </span>
        </div>

        {problem && <Problem what={problem} />}
      </div>
    </Panel>
  );
};

export const IdentityLayer = () => {
  const [data, setData] = useState<{ identities: Identity[] } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/identities', { headers: getAdminHeaders() });
      const body = (await res.json()) as { identities?: Identity[]; error?: { message?: string } | string };
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Reading enrolled identities requires your admin key. Add it under Settings → Admin API key.');
        }
        const detail = body.error;
        throw new Error((typeof detail === 'string' ? detail : detail?.message) ?? `Could not load (${res.status})`);
      }
      setData({ identities: body.identities ?? [] });
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const proven = (data?.identities ?? []).filter(i => i.lastProvenAt && i.status === 'active').length;

  return (
    <div className="space-y-4">
      <Panel
        title="Who is acting here"
        subtitle={
          'A record’s signature proves this server wrote the record. It does not prove the named subject acted — that needs a ' +
          'subject enrolled against a public key, and a challenge it signed with the private half. Until then every condition ' +
          'report reads Identity: UNKNOWN, which is exactly what it is.'
        }
        actions={
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-all"
          >
            Refresh
          </button>
        }
        footnote="Enrolment is not trustworthiness and it is not liveness. It shows a subject holds a key. Whether it should be believed, and whether it is even running, are different questions nothing on this screen answers."
      >
        {error ? (
          <Problem
            title="Identities could not be read"
            what={error}
            resolvedBy="Check that CapKit is reachable and your admin key is set."
          />
        ) : data === null ? (
          <Loading what="Reading enrolled identities…" />
        ) : data.identities.length === 0 ? (
          <Empty
            because="No subject is enrolled on this instance. Nothing that has run here can be attributed to anyone who proved they are who the record says."
            resolvedBy="Enrol one below. Until then the subject on every record is a name the caller supplied, and the reports say so."
          />
        ) : (
          <ul className="space-y-2.5">
            {data.identities.map(identity => (
              <Subject key={identity.subject} identity={identity} onChanged={() => void load()} />
            ))}
          </ul>
        )}
      </Panel>

      <Enrol onEnrolled={() => void load()} />

      <Note>
        {data && data.identities.length > 0
          ? `${proven} of ${data.identities.length} enrolled subject(s) have proved possession of their key. The rest are keys on file — which is a real step, and it is not the same as a proof.`
          : 'Proof of possession is a single-use challenge: the subject signs a nonce with the private half, and the nonce is consumed whether or not the signature verifies. A challenge that survives a failed attempt is one an attacker may retry against.'}
      </Note>
    </div>
  );
};

export default IdentityLayer;
