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
import type { IdentityAttestation } from './identity';
import type { ApprovalAttestation, ApprovalAssurance } from './approval';

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
  /**
   * The weakest condition's state, because nothing composes upward.
   *
   * Four demonstrated conditions and one failure is not "mostly trustworthy" —
   * it is a record with a failure in it. The strongest parts of a system do not
   * compensate for the weakest; they are limited by them.
   */
  overall: ConditionState;
  /** Which conditions are holding the overall answer down. Never just one. */
  constrainedBy: string[];
  /** Convenience for a caller that must branch. Not a measure of anything. */
  allDemonstrated: boolean;
}

/**
 * Severity order, weakest first. FAILED dominates everything.
 *
 * UNKNOWN is ranked below ABSENT deliberately, and it is a judgement rather
 * than a fact: an unknown might still resolve to FAILED, so nothing can be
 * claimed until it is checked, whereas an absence is a known and bounded gap —
 * the record simply never spoke to it. Somebody could argue the reverse, which
 * is exactly why `constrainedBy` lists every condition that is not
 * DEMONSTRATED. Nobody has to accept this ordering to read the report.
 */
const SEVERITY: ConditionState[] = ['FAILED', 'UNKNOWN', 'ABSENT', 'DEMONSTRATED'];

function weakest(states: ConditionState[]): ConditionState {
  for (const state of SEVERITY) {
    if (states.includes(state)) return state;
  }
  return 'DEMONSTRATED';
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
  chainIntact?: boolean,
  /**
   * What the identity registry can show about this subject.
   *
   * Optional, and its absence is not a failure: a deployment with no registry
   * reports Identity as UNKNOWN, which is exactly what it is. Passing a
   * fabricated attestation here would be the only way to make this lie, and
   * that is a deliberate act rather than a default.
   */
  identity?: IdentityAttestation,
  /**
   * What the approval record can show about this action.
   *
   * Optional in the same way and for the same reason. Its absence never turns a
   * `REQUIRES_APPROVAL` record green — an unchecked approval reads as UNKNOWN,
   * which is what it is.
   */
  approval?: ApprovalAttestation,
  /**
   * How strictly a human approval must be evidenced.
   *
   * `ASSERTED` — the default — accepts a decision attributed by the name the
   * operator supplied, and says `ASSERTED` in the finding so nobody mistakes it
   * for proof. `PROVEN` requires a decision signed by an enrolled key, and reads
   * an unsigned one as FAILED.
   *
   * Default is deliberately the permissive one, and not out of timidity:
   * defaulting to `PROVEN` would turn every approval recorded before this option
   * existed into a failure overnight, which is a claim about those records that
   * the records do not support. Nothing about them changed. What changes is how
   * strictly this deployment reads them, and that is the operator's decision to
   * make — see AUDIT.md §3, "separation of duties is enforced on names".
   *
   * This never alters what is recorded. `assurance` is a signed field either
   * way; this decides whether the reader treats `ASSERTED` as sufficient.
   */
  requiredAssurance: ApprovalAssurance = 'ASSERTED'
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
      overall: 'UNKNOWN',
      constrainedBy: ['All'],
      allDemonstrated: false,
    };
  }

  const conditions: TrustCondition[] = [];

  /*
   * ── Identity: who? ───────────────────────────────────────────────────────
   *
   * This answered DEMONSTRATED whenever the record's own signature verified,
   * which is a fact about *this server* — it proves we wrote the record. It was
   * being read as attribution of the act, and `subject` was a string the caller
   * typed. Anyone with an admin key could record `subject: "agent:cfo"` and this
   * line called it demonstrated.
   *
   * A false DEMONSTRATED, on the strongest word the product has, in the layer
   * every other layer rests on.
   *
   * The check is now possession of a key: an enrolled subject signs a single-use
   * challenge before any token is issued in its name. Without an identity
   * registry the honest answer is UNKNOWN — the name may well be true, and
   * nothing here shows it.
   */
  const hasSubject = Boolean(trace.subject && trace.subject.trim());
  conditions.push({
    condition: 'Identity',
    answers: 'Who?',
    state: identity ? identity.state : hasSubject ? 'UNKNOWN' : 'ABSENT',
    ...(!hasSubject ? { notAnsweredBecause: 'No subject was recorded on this execution.' } : {}),
    ...(hasSubject && (!identity || identity.state === 'UNKNOWN')
      ? { resolvedBy: 'Enrol this subject against a public key, and require proof of possession when its tokens are issued.' }
      : {}),
    finding: !hasSubject
      ? 'No subject is recorded, so there is nothing to attribute this action to.'
      : identity
        ? identity.because
        : `The action names ${trace.subject}. Nothing here shows the actor was that subject — the record's signature proves who wrote the record, not who acted.`,
    from: 'subject, jti, identity registry: enrolment and proof of possession',
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
  conditions.push(governanceCondition(trace, governance, verdict, approval, requiredAssurance));

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

  const limit = weakest(conditions.map(condition => condition.state));

  const conclusion = outstanding.length === 0
    ? 'All necessary conditions for trust have been demonstrated. Whether that is sufficient is a judgement, and it is yours.'
    : `${demonstrated.length} of ${conditions.length} necessary conditions are demonstrated, but the strongest claim ` +
      `this record supports is ${limit}, because ${outstanding.map(condition => condition.condition).join(', ')} ` +
      `${outstanding.length === 1 ? 'is' : 'are'} not. The strongest parts of a record do not compensate for the ` +
      'weakest. This is a statement about what the record can show, not a verdict on the subject.';

  return {
    conditions,
    conclusion,
    overall: weakest(conditions.map(condition => condition.state)),
    constrainedBy: outstanding.map(condition => condition.condition),
    allDemonstrated: outstanding.length === 0,
  };
}

/**
 * Under what rule — and, when the rule demanded a person, whether one appeared.
 *
 * Pulled out of `trustConditions` because it stopped being one expression. Two
 * decisions a policy can record were previously reported the same way as
 * `PERMITTED`, and both were wrong in the direction that matters:
 *
 * **`DENIED` with a successful outcome.** The record says the rule refused, and
 * the action happened anyway. That was reading DEMONSTRATED as soon as the hash
 * checked, because the check only asked whether a policy was *named*. It is a
 * governance failure, and it is the single most serious thing this file can
 * find — a rule that was consulted, answered no, and was overridden.
 *
 * **`REQUIRES_APPROVAL` with nothing to show for it.** The record says a person
 * had to decide. Until the approval record is consulted, nobody knows whether
 * one did, so it is UNKNOWN — never DEMONSTRATED on the strength of a hash. A
 * demand for human judgement that satisfies itself is not governance.
 */
function governanceCondition(
  trace: ExecutionTrace,
  governance: ExecutionTrace['governance'],
  verdict: TraceVerdict | undefined,
  approval: ApprovalAttestation | undefined,
  requiredAssurance: ApprovalAssurance
): TrustCondition {
  const from = 'governance.policyRef, policyVersion, decision, evidence';

  if (!governance) {
    return {
      condition: 'Governance',
      answers: 'Under what rule?',
      state: 'ABSENT',
      notAnsweredBecause: 'This record carries no policy reference — either it predates governance, or the caller recorded none.',
      finding:
        'Not recorded. A trace states the authority an action held, not the rule that decided it should hold it. ' +
        'Under what rule this was permitted cannot be answered from this record — only whether it was.',
      from,
    };
  }

  const named = `policy ${governance.policyRef} (v${governance.policyVersion})`;

  if (!verdict) {
    return {
      condition: 'Governance',
      answers: 'Under what rule?',
      state: 'UNKNOWN',
      resolvedBy: 'Verify the record, so the policy reference is checked along with everything else on it.',
      finding: `Policy ${governance.policyRef} (v${governance.policyVersion}) is recorded as ${governance.decision}, but the record has not been verified, so that claim is unchecked.`,
      from,
    };
  }

  if (!verdict.contentIntact) {
    return {
      condition: 'Governance',
      answers: 'Under what rule?',
      state: 'FAILED',
      finding: `Policy ${governance.policyRef} is recorded, but the content does not match its hash, so the policy reference is as unproven as everything else on it.`,
      from,
    };
  }

  const evaluated = `${governance.evaluatedBy ? ` by ${governance.evaluatedBy}` : ''}`;
  const checked = `Conditions checked: ${governance.evidence.join('; ')}.`;

  if (governance.decision === 'DENIED') {
    // The rule answered no. Whether that is a finding depends entirely on
    // whether the action then happened.
    if (trace.outcome === 'success') {
      return {
        condition: 'Governance',
        answers: 'Under what rule?',
        state: 'FAILED',
        finding:
          `${named} evaluated to DENIED${evaluated}, and this execution succeeded anyway. ${checked} ` +
          'A rule was consulted, it refused, and the action was carried out — which is a stronger finding than no rule at all, ' +
          'because somebody built the check and something went around it.',
        from,
      };
    }
    return {
      condition: 'Governance',
      answers: 'Under what rule?',
      state: 'DEMONSTRATED',
      finding:
        `${named} evaluated to DENIED${evaluated}, and the execution did not succeed. ${checked} ` +
        'The rule held. This is what governance working looks like in the record, and it is worth being able to point at.',
      from,
    };
  }

  if (governance.decision === 'REQUIRES_APPROVAL') {
    if (!approval) {
      return {
        condition: 'Governance',
        answers: 'Under what rule?',
        state: 'UNKNOWN',
        resolvedBy: 'Ask the approval record — POST /approvals/attest with this record\'s subject, module, action and inputHash.',
        finding:
          `${named} evaluated to REQUIRES_APPROVAL${evaluated}, so a person had to decide before this ran. ${checked} ` +
          'Nothing here says whether one did. The policy reference is intact; the approval behind it has not been looked at.',
        from: `${from}, approval record`,
      };
    }

    if (approval.state === 'DEMONSTRATED') {
      /*
       * The gate this deployment asked for.
       *
       * Separation of duties here is enforced on names: an approval refuses
       * `decidedBy === requestedBy`, but one holder of an admin key can supply
       * two different names and play both parties. The product already tells
       * you which kind of decision it is — `PROVEN` for a signature checked
       * against an enrolled key, `ASSERTED` for a name the operator typed — and
       * until now that distinction lived in a field rather than in a gate.
       *
       * This is the gate. It changes nothing about the record and everything
       * about the reading: a deployment that requires PROVEN says so, and an
       * unsigned decision fails rather than passing with a caveat nobody read.
       */
      if (requiredAssurance === 'PROVEN' && approval.assurance !== 'PROVEN') {
        return {
          condition: 'Governance',
          answers: 'Under what rule?',
          state: 'FAILED',
          finding:
            `${named} evaluated to REQUIRES_APPROVAL${evaluated}, and an approval exists — but it is ` +
            `${approval.assurance ?? 'unsigned'}, and this deployment requires PROVEN. ${approval.finding} ${checked} ` +
            'A decision attributed by a name the operator supplied is not a decision proven to have come from that person. ' +
            'The approval is real and it is recorded; what it is not is evidence of who made it.',
          from: `${from}, approval record: assurance`,
        };
      }

      return {
        condition: 'Governance',
        answers: 'Under what rule?',
        state: 'DEMONSTRATED',
        finding:
          `${named} evaluated to REQUIRES_APPROVAL${evaluated}, and an approval holds: ${approval.finding} ${checked} ` +
          'Which rule demanded a person, and that a person answered. Whether they answered well is a judgement, and it is not ABSuite\'s.',
        from: `${from}, approval record`,
      };
    }

    if (approval.state === 'UNKNOWN') {
      return {
        condition: 'Governance',
        answers: 'Under what rule?',
        state: 'UNKNOWN',
        resolvedBy: approval.resolvedBy ?? 'Settle the open approval request.',
        finding: `${named} evaluated to REQUIRES_APPROVAL${evaluated}. ${approval.finding}`,
        from: `${from}, approval record`,
      };
    }

    // ABSENT and FAILED both land here, and both are failures of *this* record:
    // the rule demanded a person and the approval record cannot show one. An
    // absent approval is not a quiet gap when a policy specifically called for it.
    return {
      condition: 'Governance',
      answers: 'Under what rule?',
      state: 'FAILED',
      finding:
        `${named} evaluated to REQUIRES_APPROVAL${evaluated}, and the approval record does not support it: ${approval.finding} ` +
        (approval.state === 'ABSENT'
          ? 'A rule that demands human judgement, satisfied by nobody being asked, is not governance.'
          : ''),
      from: `${from}, approval record`,
    };
  }

  return {
    condition: 'Governance',
    answers: 'Under what rule?',
    state: 'DEMONSTRATED',
    finding:
      `Permitted under ${named}, which evaluated to ${governance.decision}${evaluated}. ${checked} ` +
      'This states which rule permitted the action. Whether that rule should have existed is a judgement, and it is not ABSuite\'s.',
    from,
  };
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
