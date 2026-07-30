/**
 * Three states, because two are a lie.
 *
 *     VERIFIED — checked, and it holds.
 *     FAILED   — checked, and it does not.
 *     UNKNOWN  — not checked, or not checkable by this verifier.
 *
 * **Unknown is not the same as false.** A thermometer that cannot read
 * 10,000°C does not report `temperature: false`; it reports out of range. A
 * verifier that has not checked a signature has not disproved it, and a build
 * too old to read a record has not caught anyone tampering. Collapsing those
 * into "invalid" turns every limitation of the verifier into an accusation
 * against the evidence — and the accused record is usually the one that is
 * right.
 *
 * The rule this file enforces: **an UNKNOWN must always carry what would
 * resolve it.** An unknown with no route out is a dead end dressed as an
 * answer, and a reader who cannot act on it will eventually start reading it
 * as a pass.
 */

export type Determination = 'VERIFIED' | 'FAILED' | 'UNKNOWN';

export interface Finding {
  determination: Determination;
  /** What was concluded, in one sentence. */
  statement: string;
  /**
   * How to resolve it. Required for UNKNOWN, absent otherwise — an unknown
   * nobody can act on will be read as a pass within a week.
   */
  resolvedBy?: string;
}

/** Build a finding, refusing an unknown that offers no way out. */
export function finding(
  determination: Determination,
  statement: string,
  resolvedBy?: string
): Finding {
  if (determination === 'UNKNOWN' && !resolvedBy) {
    throw new Error(
      'An UNKNOWN determination must state what would resolve it. ' +
        'An unknown with no route out is a dead end dressed as an answer.'
    );
  }
  return { determination, statement, ...(resolvedBy ? { resolvedBy } : {}) };
}

/**
 * The determination for a trace verdict.
 *
 * Note what this reports for a verdict with no signature check. `verifyTrace`
 * returns `valid: true` when no public key is supplied — the content matches
 * its hash, which is all it was asked to do — and that boolean has been read as
 * "this record is genuine" ever since. It is not: nobody checked who wrote it.
 * The honest determination is UNKNOWN, and the resolution is to supply the key.
 */
export function determineTrace(verdict: {
  valid: boolean;
  contentIntact: boolean | null;
  signatureValid: boolean | null;
  checkable?: boolean;
  reason?: string;
}): Finding {
  if (verdict.checkable === false) {
    return finding(
      'UNKNOWN',
      verdict.reason ?? 'This record was written in a canonical form this build does not know.',
      'Upgrade to a build that supports this record’s canonical form, then verify again.'
    );
  }

  if (verdict.contentIntact === null) {
    return finding(
      'UNKNOWN',
      'The content was not checked against its hash.',
      'Run verifyTrace() on the full record.'
    );
  }

  if (!verdict.contentIntact) {
    return finding('FAILED', verdict.reason ?? 'The content does not match its hash.');
  }

  if (verdict.signatureValid === null) {
    // Content intact, authorship never examined. This is the case that has been
    // quietly reading as success.
    return finding(
      'UNKNOWN',
      'The content matches its hash, but no signature was checked, so who wrote this record is unproven.',
      'Verify again with the signing key’s public half — GET /executions/public-key.'
    );
  }

  if (!verdict.signatureValid) {
    return finding('FAILED', verdict.reason ?? 'The signature does not verify against the key it was checked with.');
  }

  return finding('VERIFIED', 'The content matches its hash and the signature verifies against the public key.');
}

/** Render a finding for a terminal or a ticket, never conflating the three. */
export function renderFinding(item: Finding): string {
  const mark = item.determination === 'VERIFIED' ? '✓' : item.determination === 'FAILED' ? '✗' : '?';
  return item.resolvedBy
    ? `${mark} ${item.determination}: ${item.statement}\n    resolved by: ${item.resolvedBy}`
    : `${mark} ${item.determination}: ${item.statement}`;
}
