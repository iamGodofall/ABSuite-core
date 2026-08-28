/**
 * Having somebody else witness the chain head.
 *
 * ## Why this is the paid product
 *
 * A hash chain proves nobody edited a record after it was written. It does not
 * prove WHEN it was written, and the operator being audited holds the signing
 * key — so a perfectly valid chain could in principle be a reconstruction made
 * this morning. Nothing inside one deployment can close that, because
 * everything inside it is signed by the same party.
 *
 * A notary is the smallest possible somebody else. This is the client that
 * sends it thirty-two bytes on a schedule and keeps what comes back.
 *
 * ## It does not import the notary package, deliberately
 *
 * Witnessing is a POST and a stored response. Verifying a receipt is a separate
 * act performed later, by an auditor, quite possibly on another machine — and
 * that is what `@absuitecore/notary` is for. Taking a dependency here would put
 * the verifier inside the thing being verified, which is the shape this whole
 * product exists to argue against.
 */
import { guardedFetch } from './guarded-fetch';
import { type AddressRange } from './outbound';
import type { Plan } from './billing';

/**
 * How often THIS INSTANCE should witness, given the tenants on it.
 *
 * One hash chain is shared by every tenant — `tenant_id` is a column on it, not
 * a separate chain — so there is one cadence, and it must be the SHORTEST any
 * tenant is entitled to. A business tenant paying for an hour must get an hour
 * even when a team tenant sharing the instance is only owed a day.
 *
 * That is deliberately the mirror of retention, which takes the LONGEST window
 * any tenant is owed. Both err the same way: toward giving customers more than
 * they paid for rather than less, because the alternative in each case is
 * silently under-serving somebody who paid.
 *
 * Returns -1 when nobody on this instance is witnessed at all.
 */
export function instanceWitnessInterval(plans: Plan[]): number {
  const intervals = plans.map(p => p.witnessIntervalHours).filter(h => h >= 0);
  return intervals.length === 0 ? -1 : Math.min(...intervals);
}

export interface WitnessRequest {
  chainId: string;
  headHash: string;
  claimedLength?: number;
}

export interface WitnessOutcome {
  witnessed: boolean;
  /** The receipt exactly as the notary returned it, unparsed beyond JSON. */
  receipt?: unknown;
  status?: number;
  error?: string;
}

/**
 * Ask a notary to witness a head.
 *
 * Through `guardedFetch`, because the notary URL is configuration and
 * configuration is reachable by whoever can edit configuration.
 *
 * Never throws. A notary being down must not take down the instance whose
 * evidence it is meant to strengthen — the correct behaviour is to miss a
 * witnessing and say so, and the next sweep will try again.
 */
export async function witnessHead(
  notaryUrl: string,
  request: WitnessRequest,
  options: { refuse: AddressRange[]; allow?: string[]; timeoutMs?: number } = { refuse: [] }
): Promise<WitnessOutcome> {
  if (!request.headHash) {
    // An empty chain has no head worth witnessing, and a receipt for a hash of
    // nothing would be evidence of nothing while looking like evidence.
    return { witnessed: false, error: 'No chain head to witness' };
  }

  try {
    const response = await guardedFetch(
      notaryUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      },
      { refuse: options.refuse, ...(options.allow ? { allow: options.allow } : {}), verb: 'witness' }
    );

    if (!response.ok) return { witnessed: false, status: response.status, error: `Notary answered ${response.status}` };

    const receipt = await response.json();
    return { witnessed: true, status: response.status, receipt };
  } catch (error) {
    return { witnessed: false, error: error instanceof Error ? error.message : String(error) };
  }
}
