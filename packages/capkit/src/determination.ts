/**
 * Four states, because two are a lie and three are not enough.
 *
 *     DEMONSTRATED — evidence supports the proposition.
 *     FAILED       — evidence contradicts it.
 *     UNKNOWN      — evidence unavailable, or unreadable by this verifier.
 *     ABSENT       — the record never attempted to answer.
 *
 * These are deliberately not `true` / `false` / `null`. True and false are
 * claims about the world; this system only ever makes claims about *evidence*.
 * A record does not make an action correct, and ABSuite saying DEMONSTRATED
 * means "the evidence for this is present and holds", never "this is true".
 *
 * **Unknown is not the same as false**, and its sharper corollary, **unknown is
 * not the same as true** — the one that was actually hiding in this codebase.
 * A thermometer that cannot read 10,000°C reports out of range, not
 * `temperature: false`; and a verifier that checked a hash has not thereby
 * checked a signature.
 *
 * Two rules are enforced at construction rather than left to discipline:
 *
 * - **Every unknown must carry its path to resolution.** Uncertainty without a
 *   next step is paralysis; uncertainty with one is work. An unknown nobody can
 *   act on gets read as a pass within a week.
 * - **Every absence must say why the record is silent.** "Not recorded" and
 *   "recorded as nothing" are different, and a reader deserves to know which —
 *   a field that predates a schema is not the same as one left blank today.
 */

export type Determination = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

export interface Finding {
  determination: Determination;
  /** What was concluded, in one sentence. */
  statement: string;
  /** Required for UNKNOWN: the step that would settle it. */
  resolvedBy?: string;
  /** Required for ABSENT: why this record does not answer the question. */
  notAnsweredBecause?: string;
}

/** Build a finding, refusing the two shapes that decay into noise. */
export function finding(
  determination: Determination,
  statement: string,
  detail?: string
): Finding {
  if (determination === 'UNKNOWN') {
    if (!detail) {
      throw new Error(
        'An UNKNOWN determination must state what would resolve it. ' +
          'An unknown with no route out is a dead end dressed as an answer.'
      );
    }
    return { determination, statement, resolvedBy: detail };
  }

  if (determination === 'ABSENT') {
    if (!detail) {
      throw new Error(
        'An ABSENT determination must say why the record does not answer. ' +
          '"Not recorded" and "recorded as nothing" are different claims.'
      );
    }
    return { determination, statement, notAnsweredBecause: detail };
  }

  return { determination, statement };
}

export interface TraceDetermination {
  /** The single answer, for a caller that must show one thing. */
  overall: Finding;
  /** Has the content changed since it was written? */
  integrity: Finding;
  /** Who wrote it, and can that be shown? */
  authorship: Finding;
}

/**
 * Assess a trace verdict, as two questions rather than one bit.
 *
 * `verifyTrace()` returns `valid: true` when no public key is supplied: the
 * content matches its hash, which is all it was asked to do. That boolean has
 * been readable as "this record is genuine" ever since — and nobody checked who
 * wrote it. One bit was carrying two independent questions, and the answer to
 * the second one was UNKNOWN the whole time.
 *
 * So integrity and authorship are reported separately, and the overall finding
 * is never better than the weaker of the two.
 */
export function determineTrace(verdict: {
  valid: boolean;
  contentIntact: boolean | null;
  signatureValid: boolean | null;
  checkable?: boolean;
  reason?: string;
}): TraceDetermination {
  if (verdict.checkable === false) {
    const unreadable = finding(
      'UNKNOWN',
      verdict.reason ?? 'This record was written in a canonical form this build does not know.',
      'Upgrade to a build that supports this record’s canonical form, then verify again.'
    );
    return { overall: unreadable, integrity: unreadable, authorship: unreadable };
  }

  const integrity: Finding =
    verdict.contentIntact === null
      ? finding('UNKNOWN', 'The content was not checked against its hash.', 'Run verifyTrace() on the full record.')
      : verdict.contentIntact
        ? finding('DEMONSTRATED', 'The content matches the hash it was recorded with.')
        : finding('FAILED', verdict.reason ?? 'The content does not match its hash.');

  const authorship: Finding =
    verdict.signatureValid === null
      ? finding(
          'UNKNOWN',
          'No signature was checked, so who wrote this record is unproven.',
          'Verify again with the signing key’s public half — GET /executions/public-key.'
        )
      : verdict.signatureValid
        ? finding('DEMONSTRATED', 'The Ed25519 signature verifies against the public key.')
        : finding(
            'FAILED',
            verdict.reason ?? 'The signature does not verify against the key it was checked with.'
          );

  // The overall answer is the weaker of the two, never the friendlier.
  const overall: Finding =
    integrity.determination === 'FAILED' || authorship.determination === 'FAILED'
      ? finding(
          'FAILED',
          integrity.determination === 'FAILED' ? integrity.statement : authorship.statement
        )
      : integrity.determination === 'UNKNOWN'
        ? integrity
        : authorship.determination === 'UNKNOWN'
          ? authorship
          : finding('DEMONSTRATED', 'The content matches its hash and the signature verifies against the public key.');

  return { overall, integrity, authorship };
}

/** Render a finding for a terminal or a ticket, never conflating the four. */
export function renderFinding(item: Finding): string {
  const mark =
    item.determination === 'DEMONSTRATED' ? '✓' : item.determination === 'FAILED' ? '✗' : item.determination === 'UNKNOWN' ? '?' : '·';

  const detail = item.resolvedBy
    ? `\n    resolved by: ${item.resolvedBy}`
    : item.notAnsweredBecause
      ? `\n    not answered because: ${item.notAnsweredBecause}`
      : '';

  return `${mark} ${item.determination}: ${item.statement}${detail}`;
}
