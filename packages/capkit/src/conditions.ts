/**
 * The necessary conditions for trust, reported one by one.
 *
 *     Trust := f(Identity, Capability, Evidence, Governance, Time)
 *
 * `f` is deliberately undefined, and this file is where that refusal is
 * implemented rather than merely written down. ABSuite supplies the inputs. A
 * person performs the judgement.
 *
 * The distinction is not pedantry. "Trust: 96.4%" and "all five necessary
 * conditions have been demonstrated" are philosophically different statements:
 * the first replaces evidence with a number, and numbers are seductive — nobody
 * audits a 96.4, they act on it. The second can be disagreed with condition by
 * condition, which is the only kind of conclusion this project is entitled to
 * produce.
 *
 * So there is no score here, no weighting, no aggregate. Five conditions, each
 * demonstrated, unproven or absent, each naming the field it was read from.
 */
import type { ExecutionTrace, TraceVerdict } from './trace';
import { type Determination } from './determination';

/**
 * The same four states used everywhere else — see determination.ts.
 *
 * These were once `demonstrated | unproven | absent`, a third private
 * vocabulary for the same idea. One model, one set of words: a reader should
 * not have to learn what "unproven" means here versus "UNKNOWN" two endpoints
 * away, and FAILED was missing entirely — a record whose content contradicts
 * its own hash is not merely unproven.
 */
export type ConditionState = Determination;

export interface TrustCondition {
  /** Identity, Capability, Evidence, Governance or Time. */
  condition: string;
  /** The question it answers, in one word. */
  answers: string;
  state: ConditionState;
  finding: string;
  /** The field(s) this was read from, so a reader can check rather than believe. */
  from: string;
  /** Required for UNKNOWN: what would settle it. */
  resolvedBy?: string;
  /** Required for ABSENT: why the record does not answer. */
  notAnsweredBecause?: string;
}

export interface ConditionsReport {
  conditions: TrustCondition[];
  /** Prose. Never a score, never a percentage, never a grade. */
  conclusion: string;
  /** Convenience for a caller that must branch. Not a measure of anything. */
  allDemonstrated: boolean;
}

/**
 * Assess one execution against the five conditions.
 *
 * `verdict` and `chainIntact` are optional and their absence is reported as
 * absence — an unchecked record must never read like a checked one.
 */
export function trustConditions(
  trace: ExecutionTrace,
  verdict?: TraceVerdict,
  chainIntact?: boolean
): ConditionsReport {
  // A record this build cannot read tells us nothing about any condition.
  // Reporting five absences would read as five findings against the record,
  // when the only finding is against us.
  if (verdict?.checkable === false) {
    return {
      conditions: [
        {
          condition: 'All',
          answers: 'Anything at all?',
          state: 'UNKNOWN',
          finding: `${verdict.reason ?? 'This record was written in a canonical form this build does not know.'} No condition can be assessed until this build can read it.`,
          from: 'canonicalVersion',
          resolvedBy: 'Upgrade to a build that supports this record’s canonical form.',
        },
      ],
      conclusion:
        'This record cannot be read by this build, so nothing about it has been demonstrated or disproven. Upgrade and ask again.',
      allDemonstrated: false,
    };
  }

  const conditions: TrustCondition[] = [];

  // ── Identity: who? ────────────────────────────────────────────────────────
  const hasSubject = Boolean(trace.subject && trace.subject.trim());
  const signedBy = trace.keyId;
  conditions.push({
    condition: 'Identity',
    answers: 'Who?',
    state: !hasSubject ? 'ABSENT' : verdict?.signatureValid === false ? 'FAILED' : verdict?.signatureValid ? 'DEMONSTRATED' : 'UNKNOWN',
    ...(!hasSubject ? { notAnsweredBecause: 'No subject was recorded on this execution.' } : {}),
    ...(hasSubject && verdict?.signatureValid === undefined || verdict?.signatureValid === null
      ? { resolvedBy: 'Verify the record against the signing key’s public half.' } : {}),
    finding: !hasSubject
      ? 'No subject is recorded, so there is nothing to attribute this action to.'
      : verdict?.signatureValid
        ? `The action is attributed to ${trace.subject}, and the record is signed by ${signedBy ?? 'an unnamed key'}.`
        : `The action names ${trace.subject}, but no valid signature ties that claim to the key that wrote it.`,
    from: 'subject, keyId, verifyTrace(): signatureValid',
  });

  // ── Capability: allowed? ──────────────────────────────────────────────────
  const scopes = trace.scope ?? [];
  conditions.push({
    condition: 'Capability',
    answers: 'Allowed?',
    state: scopes.length === 0 ? 'ABSENT' : trace.jti ? 'DEMONSTRATED' : 'UNKNOWN',
    ...(scopes.length === 0
      ? { notAnsweredBecause: 'No scope was recorded, so the record makes no claim about what was permitted.' }
      : !trace.jti
        ? { resolvedBy: 'Record the token id (jti) alongside the scope so the authority can be traced to an issued credential.' }
        : {}),
    finding: scopes.length === 0
      ? 'No scope is recorded, so what this action was permitted to do cannot be stated from the record.'
      : trace.jti
        ? `Authority was ${scopes.map(scope => `"${scope}"`).join(', ')}, carried by token ${trace.jti}.`
        : `Scope ${scopes.map(scope => `"${scope}"`).join(', ')} is recorded, but no token id ties it to a credential that was actually issued.`,
    from: 'scope, jti',
  });

  // ── Evidence: what happened? ──────────────────────────────────────────────
  const hasInput = Boolean(trace.inputHash);
  const hasOutput = Boolean(trace.outputHash);
  conditions.push({
    condition: 'Evidence',
    answers: 'What happened?',
    state: !hasInput ? 'ABSENT'
      : verdict?.contentIntact === false ? 'FAILED'
      : !verdict ? 'UNKNOWN'
      : hasOutput ? 'DEMONSTRATED' : 'UNKNOWN',
    ...(!hasInput
      ? { notAnsweredBecause: 'Nothing was hashed on this record.' }
      : verdict?.contentIntact !== false && (!verdict || !hasOutput)
        ? { resolvedBy: !verdict ? 'Run verifyTrace() against the signing key.' : 'Record an output hash so a replay can confirm the result, not only the input.' }
        : {}),
    finding: !hasInput
      ? 'Nothing was hashed, so there is no evidence of what was processed.'
      : !verdict
        ? 'Input and output were hashed, but the record has not been verified, so the hashes prove nothing yet.'
        : !verdict.contentIntact
          ? 'The recorded content does not match its own hash. The evidence contradicts itself.'
          : hasOutput
            ? 'Input and output were hashed and the content matches those hashes, so a replay can confirm both.'
            : 'The input was hashed and matches, but no output hash was captured — a replay can confirm what went in, not what came out.',
    from: 'inputHash, outputHash, verifyTrace(): contentIntact',
  });

  // ── Governance: should it have? ───────────────────────────────────────────
  //
  // A capability answers "was this allowed?". The governing rule answers "under
  // what rule?" — and that is as far as a record can go. Even with a policy
  // recorded, ABSuite never says the decision was correct: it names the rule
  // that produced it, so a person can ask whether that rule should have existed.
  const governance = trace.governance;
  conditions.push({
    condition: 'Governance',
    answers: 'Under what rule?',
    state: !governance ? 'ABSENT'
      : verdict?.contentIntact === false ? 'FAILED'
      : verdict?.contentIntact ? 'DEMONSTRATED' : 'UNKNOWN',
    ...(!governance
      ? { notAnsweredBecause: 'This record carries no policy reference — either it predates governance, or the caller recorded none.' }
      : !verdict
        ? { resolvedBy: 'Verify the record, so the policy reference is checked along with everything else on it.' }
        : {}),
    finding: !governance
      ? 'Not recorded. A trace states the authority an action held, not the rule that decided it should hold it. ' +
        'Under what rule this was permitted cannot be answered from this record — only whether it was.'
      : !verdict
        ? `Policy ${governance.policyRef} (v${governance.policyVersion}) is recorded as ${governance.decision}, but the record has not been verified, so that claim is unchecked.`
        : !verdict.contentIntact
          ? `Policy ${governance.policyRef} is recorded, but the content does not match its hash, so the policy reference is as unproven as everything else on it.`
          : `Permitted under policy ${governance.policyRef} (v${governance.policyVersion}), which evaluated to ${governance.decision}` +
            `${governance.evaluatedBy ? ` by ${governance.evaluatedBy}` : ''}. ` +
            `Conditions checked: ${governance.evidence.join('; ')}. ` +
            'This states which rule permitted the action. Whether that rule should have existed is a judgement, and it is not ABSuite\'s.',
    from: 'governance.policyRef, policyVersion, decision, evidence',
  });

  // ── Time: when, and in what order? ────────────────────────────────────────
  const hasStart = Boolean(trace.startedAt);
  const chained = Boolean(trace.prevHash);
  conditions.push({
    condition: 'Time',
    answers: 'When, and after what?',
    state: !hasStart || !chained ? 'ABSENT' : chainIntact === true ? 'DEMONSTRATED' : chainIntact === false ? 'FAILED' : 'UNKNOWN',
    ...(!hasStart || !chained
      ? { notAnsweredBecause: 'The record carries no start time or no link to a predecessor.' }
      : chainIntact === undefined
        ? { resolvedBy: 'Run verifyChain() — ordering is asserted until the chain is walked.' }
        : {}),
    finding: !hasStart
      ? 'No start time is recorded.'
      : !chained
        ? 'The record carries a timestamp but no link to a predecessor, so its position in history rests on a claim anyone could write.'
        : chainIntact === true
          ? `Recorded at ${trace.startedAt} and linked to its predecessor in a chain that verifies, so its order cannot be rewritten after the fact.`
          : `Recorded at ${trace.startedAt} and linked to a predecessor, but the chain has not been verified, so the ordering is asserted rather than shown.`,
    from: 'startedAt, prevHash, verifyChain()',
  });

  const demonstrated = conditions.filter(condition => condition.state === 'DEMONSTRATED');
  const outstanding = conditions.filter(condition => condition.state !== 'DEMONSTRATED');

  const conclusion = outstanding.length === 0
    ? 'All necessary conditions for trust have been demonstrated. Whether that is sufficient is a judgement, and it is yours.'
    : `${demonstrated.length} of ${conditions.length} necessary conditions are demonstrated. ` +
      `${outstanding.map(condition => condition.condition).join(', ')} ${outstanding.length === 1 ? 'is' : 'are'} not. ` +
      'This is a statement about what the record can show, not a verdict on the subject.';

  return { conditions, conclusion, allDemonstrated: outstanding.length === 0 };
}

/** The report as plain text, for a terminal, an email or a ticket. */
export function renderConditions(report: ConditionsReport): string {
  const mark = (state: ConditionState) =>
    state === 'DEMONSTRATED' ? '✓' : state === 'FAILED' ? '✗' : state === 'UNKNOWN' ? '?' : '·';

  return [
    'Trust := f(Identity, Capability, Evidence, Governance, Time)',
    'f is undefined here on purpose. These are the inputs; the judgement is yours.',
    '',
    ...report.conditions.flatMap(condition => [
      `${mark(condition.state)} ${condition.condition} — ${condition.answers}  [${condition.state}]`,
      `    ${condition.finding}`,
      ...(condition.resolvedBy ? [`    resolved by: ${condition.resolvedBy}`] : []),
      ...(condition.notAnsweredBecause ? [`    not answered because: ${condition.notAnsweredBecause}`] : []),
      `    from: ${condition.from}`,
      '',
    ]),
    report.conclusion,
  ].join('\n');
}
