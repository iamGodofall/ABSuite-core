/**
 * Layer 5 — the decisions a person owes.
 *
 * The queue is the whole product here. Everything else in this interface is a
 * place you read what already happened; this is the one surface where an action
 * has not happened yet and is waiting on somebody, which makes it the only place
 * where being slow has a cost outside the record.
 *
 * Three rules are carried in the markup rather than left to CapKit, because they
 * are what makes an approval mean anything and a reader has to see them:
 *
 * - **What is bound is the payload, not the request.** The action hash covers
 *   the subject, module, action and input hash, so an approval granted here
 *   cannot travel to a different input. The hash is shown for that reason.
 * - **The summary is the requester's.** It is what the approver reads, and its
 *   hash goes inside the signature — but it was written by the party asking, and
 *   the panel says so rather than presenting it as fact.
 * - **A decision needs a basis.** The button is disabled without one. CapKit
 *   refuses it too; this is not the enforcement, it is the explanation.
 *
 * What is deliberately not here: any ranking of which request matters most, any
 * count-down urgency styling, and any default. A queue that nudges is a queue
 * that decides.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Panel, Empty, Problem, Loading, Badge, Note } from '../surface/Surface';
import { cn } from '../utils';

interface Approval {
  id: string;
  actionHash: string;
  action: { subject: string; module: string; action: string; inputHash: string };
  context: string;
  policyRef: string;
  policyVersion: string;
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  state: 'PENDING' | 'GRANTED' | 'REFUSED' | 'WITHDRAWN' | 'CONSUMED' | 'EXPIRED';
  decidedBy?: string;
  decidedAt?: string;
  basis?: string;
  assurance: 'PROVEN' | 'ASSERTED';
  consumedBy?: string;
}

const STATE_TONE = {
  PENDING: 'UNKNOWN',
  GRANTED: 'DEMONSTRATED',
  CONSUMED: 'DEMONSTRATED',
  REFUSED: 'FAILED',
  WITHDRAWN: 'ABSENT',
  EXPIRED: 'FAILED',
} as const;

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const short = (hash: string) => `${hash.slice(0, 12)}…${hash.slice(-6)}`;

/** One request, and the two things a person can do about it. */
const Request = ({ approval, onDecided }: { approval: Approval; onDecided: () => void }) => {
  const [basis, setBasis] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const decide = async (decision: 'GRANTED' | 'REFUSED') => {
    setBusy(true);
    setProblem('');
    try {
      const res = await fetch(`/approvals/${approval.id}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify({ decision, decidedBy: who.trim(), basis: basis.trim() }),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `The decision was not recorded (${res.status}).`);
      onDecided();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pending = approval.state === 'PENDING';
  const ready = pending && who.trim().length > 0 && basis.trim().length > 0;

  return (
    <li className="rounded-xl border border-border bg-bg-primary/40 p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm text-text-primary leading-snug">{approval.context}</p>
          <p className="text-[11px] text-text-muted mt-1">
            Summary written by <span className="font-mono">{approval.requestedBy}</span>, who is asking.
            It is not independent of the request.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge state={STATE_TONE[approval.state]}>{approval.state}</Badge>
          {approval.state !== 'PENDING' && (
            <Badge state={approval.assurance === 'PROVEN' ? 'DEMONSTRATED' : undefined}>
              {approval.assurance}
            </Badge>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
        <div className="flex gap-2">
          <dt className="text-text-muted shrink-0">Action</dt>
          <dd className="font-mono text-text-primary truncate">
            {approval.action.subject} → {approval.action.module}.{approval.action.action}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-muted shrink-0">Rule</dt>
          <dd className="font-mono text-text-primary truncate">
            {approval.policyRef} v{approval.policyVersion}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-muted shrink-0">Covers</dt>
          <dd className="font-mono text-text-muted truncate" title={approval.actionHash}>
            {short(approval.actionHash)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-text-muted shrink-0">{pending ? 'Lapses' : 'Decided'}</dt>
          <dd className="font-mono text-text-muted truncate">
            {pending ? approval.expiresAt : `${approval.decidedAt} by ${approval.decidedBy}`}
          </dd>
        </div>
      </dl>

      {approval.basis && !pending && (
        <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
          <span className="text-text-muted/70">Basis — </span>{approval.basis}
        </p>
      )}

      {pending && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <input
              value={who}
              onChange={event => setWho(event.target.value)}
              placeholder="Who is deciding"
              className="flex-1 min-w-[140px] rounded-lg bg-bg-secondary border border-border px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
            />
            <input
              value={basis}
              onChange={event => setBasis(event.target.value)}
              placeholder="On what basis"
              className="flex-[2] min-w-[200px] rounded-lg bg-bg-secondary border border-border px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              disabled={!ready || busy}
              onClick={() => void decide('GRANTED')}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border',
                ready && !busy
                  ? 'border-[#00F58C]/40 text-[#00F58C] hover:bg-[#00F58C]/10'
                  : 'border-border text-text-muted/50 cursor-not-allowed'
              )}
            >
              Grant
            </button>
            <button
              disabled={!ready || busy}
              onClick={() => void decide('REFUSED')}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border',
                ready && !busy
                  ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                  : 'border-border text-text-muted/50 cursor-not-allowed'
              )}
            >
              Refuse
            </button>
            <span className="text-[11px] text-text-muted/70">
              {ready
                ? 'Recorded against your name, permanently. It cannot be revised — a change is a new request.'
                : 'Both fields are required. A decision nobody signed their name to cannot be reviewed later.'}
            </span>
          </div>

          {problem && <Problem what={problem} />}
        </div>
      )}

      {approval.consumedBy && (
        <p className="text-[11px] text-text-muted/70 mt-2 font-mono">
          Spent on execution {approval.consumedBy}
        </p>
      )}
    </li>
  );
};

export const Approvals = () => {
  const [data, setData] = useState<{ approvals: Approval[] } | null>(null);
  const [error, setError] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      // Built as a plain path rather than an interpolated template: the route
      // checker matches client calls against server routes by reading the
      // literal, and an expression inside the template hides the path from it.
      const query = onlyPending ? '?state=PENDING' : '';
      const res = await fetch('/approvals' + query, { headers: getAdminHeaders() });
      const body = (await res.json()) as { approvals?: Approval[]; error?: { message?: string } | string };
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Reading the approval queue requires your admin key. Add it under Settings → Admin API key.');
        }
        const detail = body.error;
        throw new Error((typeof detail === 'string' ? detail : detail?.message) ?? `Could not load (${res.status})`);
      }
      setData({ approvals: body.approvals ?? [] });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [onlyPending]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <Panel
        title={onlyPending ? 'Waiting on a person' : 'Every approval, decided or not'}
        subtitle={
          'A governing rule answered REQUIRES_APPROVAL, so the action has not run. Each request is bound to a hash of ' +
          'exactly what will be done — the subject, the module, the action and the input — so a decision made here cannot ' +
          'travel to a different payload.'
        }
        actions={
          <>
            <button
              onClick={() => setOnlyPending(value => !value)}
              className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-all"
            >
              {onlyPending ? 'Show all' : 'Only pending'}
            </button>
            <button
              onClick={() => void load()}
              className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-all"
            >
              Refresh
            </button>
          </>
        }
        footnote={
          'The requester may not decide their own request, and a decision cannot be revised — changing your mind is a new ' +
          'request, so that both are in the record. An approval covers one execution; a reusable one would be an authority, ' +
          'and authority is a capability token.'
        }
      >
        {error ? (
          <Problem title="The queue could not be read" what={error} resolvedBy="Check that CapKit is reachable and your admin key is set." />
        ) : data === null ? (
          <Loading what="Reading the approval queue…" />
        ) : data.approvals.length === 0 ? (
          <Empty
            because={
              onlyPending
                ? 'Nothing is waiting on a decision. No governing rule has returned REQUIRES_APPROVAL for an action that has not yet been settled.'
                : 'No approval has ever been requested on this instance.'
            }
            resolvedBy="An empty queue means nothing is pending. It is not a statement that every action was approved — an action that never asked does not appear here at all."
          />
        ) : (
          <ul className="space-y-2.5">
            {data.approvals.map(approval => (
              <Request key={approval.id} approval={approval} onDecided={() => void load()} />
            ))}
          </ul>
        )}
      </Panel>

      <Note>
        A decision recorded without a signature is attributed by the name typed above, and reads as{' '}
        <span className="font-mono">ASSERTED</span> rather than{' '}
        <span className="font-mono">PROVEN</span>. To reach PROVEN, the approver enrols an Ed25519 key
        and signs the decision themselves — which anyone holding that public key can then verify without
        trusting this console or the server behind it.
      </Note>
    </div>
  );
};

export default Approvals;
