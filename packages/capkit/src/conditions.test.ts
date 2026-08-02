import { Storage } from './storage';
import { TraceStore, SigningKey, verifyTrace } from './trace';
import { trustConditions, renderConditions } from './conditions';
import type { IdentityAttestation } from './identity';

/**
 * What the identity registry reports for a subject that enrolled a key and
 * proved it holds the private half.
 *
 * Supplied explicitly in these tests, and that is the point. Identity used to
 * reach DEMONSTRATED from the record's own signature — which proves this server
 * wrote the record, not that the named subject acted. A trace on its own can no
 * longer earn the word, so a test that wants it has to say where the proof came
 * from, exactly as a deployment does.
 */
const proven: IdentityAttestation = {
  state: 'DEMONSTRATED',
  enrolled: true,
  because: 'agent-001 is enrolled, and the token that authorised this was issued only after it signed a challenge with the key on file.',
};

const fresh = () => {
  const key = new SigningKey();
  const storage = new Storage(':memory:');
  return { key, storage, traces: new TraceStore(storage, key) };
};

const sample = (traces: TraceStore, over: Record<string, unknown> = {}) =>
  traces.record({
    subject: 'agent:invoicing',
    jti: 'tok_991',
    scope: ['payment:approve'],
    module: 'payments',
    action: 'approve_batch',
    input: { batch: 'BATCH-8891' },
    output: { approved: true },
    outcome: 'success',
    ...over,
  } as never);

describe('the necessary conditions for trust', () => {
  test('never produces a score, a percentage or a grade', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);
    const text = renderConditions(trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true));

    // The entire point of f() being undefined. "Trust: 96.4%" replaces evidence
    // with a number, and nobody audits a 96.4 — they act on it.
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(text).not.toMatch(/\bscore\b/i);
    expect(text).not.toMatch(/\b(grade|rating|confidence)\b/i);
    expect(text).not.toMatch(/\b(trustworthy|untrustworthy)\b/i);
    // It says so out loud, so nobody adds one later thinking it was an oversight.
    expect(text).toContain('f is undefined here on purpose');
  });

  test('states all five conditions demonstrated when they are', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);
    const report = trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true, proven);

    // Governance is honestly absent: a trace records the authority an action
    // held, never the rule that decided it should hold it.
    const governance = report.conditions.find(c => c.condition === 'Governance')!;
    expect(governance.state).toBe('ABSENT');
    expect(report.allDemonstrated).toBe(false);

    for (const condition of report.conditions.filter(c => c.condition !== 'Governance')) {
      expect(condition.state).toBe('DEMONSTRATED');
    }
  });

  test('the conclusion is a statement about the record, not about the subject', () => {
    const { traces, key } = fresh();
    const report = trustConditions(sample(traces), verifyTrace(sample(traces), key.publicKeyPem), true);

    expect(report.conclusion).toMatch(/statement about what the record can show/i);
    expect(report.conclusion).not.toMatch(/\b(should be|recommend|suspend|revoke)\b/i);
  });

  test('an unverified record leaves identity and evidence unproven', () => {
    const { traces } = fresh();
    const report = trustConditions(sample(traces));

    const identity = report.conditions.find(c => c.condition === 'Identity')!;
    const evidence = report.conditions.find(c => c.condition === 'Evidence')!;

    // Silence about verification must never read as a pass.
    expect(identity.state).toBe('UNKNOWN');
    expect(evidence.state).toBe('UNKNOWN');
    expect(evidence.finding).toMatch(/has not been verified/i);
  });

  test('an unverified chain makes ordering asserted rather than shown', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);

    const unchecked = trustConditions(trace, verifyTrace(trace, key.publicKeyPem));
    const checked = trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true);

    expect(unchecked.conditions.find(c => c.condition === 'Time')!.state).toBe('UNKNOWN');
    expect(checked.conditions.find(c => c.condition === 'Time')!.state).toBe('DEMONSTRATED');
    expect(renderConditions(unchecked)).toMatch(/asserted rather than shown/i);
  });

  test('a missing scope makes capability absent, not permitted', () => {
    const { traces, key } = fresh();
    const trace = sample(traces, { scope: [] });
    const report = trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true);

    const capability = report.conditions.find(c => c.condition === 'Capability')!;
    expect(capability.state).toBe('ABSENT');
    expect(capability.finding).toMatch(/cannot be stated from the record/i);
  });

  test('every unknown states what would resolve it, and every absence says why', () => {
    const { traces, key } = fresh();
    // A record with gaps in several conditions at once.
    const trace = sample(traces, { scope: [] });

    for (const report of [trustConditions(trace), trustConditions(trace, verifyTrace(trace, key.publicKeyPem))]) {
      for (const condition of report.conditions) {
        // Uncertainty without a next step is paralysis. Uncertainty with one is
        // work — and an unknown nobody can act on gets read as a pass.
        if (condition.state === 'UNKNOWN') expect(condition.resolvedBy).toBeTruthy();
        if (condition.state === 'ABSENT') expect(condition.notAnsweredBecause).toBeTruthy();
      }
    }
  });

  test('a record whose content contradicts its hash FAILS rather than being unknown', () => {
    const { traces, key, storage } = fresh();
    const trace = sample(traces);
    storage.run("UPDATE executions SET outcome = 'failure' WHERE id = ?", trace.id);
    const altered = traces.get(trace.id)!;

    const report = trustConditions(altered, verifyTrace(altered, key.publicKeyPem), false);
    const evidence = report.conditions.find(c => c.condition === 'Evidence')!;

    // Evidence that contradicts itself is not merely unproven.
    expect(evidence.state).toBe('FAILED');
  });

  test('nothing composes upward — the overall is the weakest condition', () => {
    const { traces, key } = fresh();

    // Four conditions in good order and one gap. This is not "mostly fine".
    const withGap = trustConditions(sample(traces, { scope: [] }), verifyTrace(sample(traces), key.publicKeyPem), true);
    expect(withGap.overall).not.toBe('DEMONSTRATED');
    expect(withGap.constrainedBy).toContain('Capability');
    expect(withGap.conclusion).toMatch(/do not compensate for the/i);
  });

  test('a failure dominates every other state', () => {
    const { traces, key, storage } = fresh();
    const trace = sample(traces);
    storage.run("UPDATE executions SET outcome = 'failure' WHERE id = ?", trace.id);
    const altered = traces.get(trace.id)!;

    const report = trustConditions(altered, verifyTrace(altered, key.publicKeyPem), false);

    // Whatever else holds, a contradiction in the evidence is the answer.
    expect(report.overall).toBe('FAILED');
  });

  test('constrainedBy names every condition holding the answer down, not just one', () => {
    const { traces } = fresh();
    // Unverified and unscoped: several conditions short at once.
    const report = trustConditions(sample(traces, { scope: [] }));

    expect(report.constrainedBy.length).toBeGreaterThan(1);
    // Nobody has to accept the severity ordering to read the report.
    for (const name of report.constrainedBy) {
      expect(report.conditions.find(c => c.condition === name)!.state).not.toBe('DEMONSTRATED');
    }
  });

  test('every condition demonstrated makes the overall demonstrated', () => {
    const { traces, key } = fresh();
    const trace = sample(traces, {
      governance: { policyRef: 'p', policyVersion: '1', decision: 'PERMITTED', evidence: ['checked'] },
    });
    const report = trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true, proven);

    expect(report.overall).toBe('DEMONSTRATED');
    expect(report.constrainedBy).toEqual([]);
    expect(report.allDemonstrated).toBe(true);
  });

  test('a perfect record with an unproven subject is not all demonstrated', () => {
    const { traces, key } = fresh();
    const trace = sample(traces, {
      governance: { policyRef: 'p', policyVersion: '1', decision: 'PERMITTED', evidence: ['checked'] },
    });

    /*
     * The regression guard for the whole Identity layer.
     *
     * Signed, chained, scoped, governed, verified — and the subject is still a
     * string somebody typed. This exact record answered DEMONSTRATED on all five
     * conditions before identity existed, because Identity was reading the
     * record's own signature. Every other condition here is genuinely met; the
     * one that is not must hold the answer down, or nothing composes upward.
     */
    const report = trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true);

    expect(report.conditions.find(c => c.condition === 'Identity')!.state).toBe('UNKNOWN');
    expect(report.overall).not.toBe('DEMONSTRATED');
    expect(report.constrainedBy).toContain('Identity');
    expect(report.allDemonstrated).toBe(false);
  });

  test('every finding names the field it was read from', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);

    for (const condition of trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true).conditions) {
      expect(condition.from.length).toBeGreaterThan(0);
      expect(condition.finding.length).toBeGreaterThan(0);
    }
  });

  test('does not leak the payload it is assessing', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);
    const text = renderConditions(trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true));

    expect(text).not.toContain('BATCH-8891');
  });
});

/**
 * The three decisions a policy can record, and what each one means for the
 * Governance condition.
 *
 * Until the approval workflow existed, all three read the same way: a policy was
 * *named*, the hash checked, so Governance was DEMONSTRATED. Two of the three
 * were wrong in the direction that matters.
 */
describe('governance decisions are not all the same decision', () => {
  const governed = (decision: string, over: Record<string, unknown> = {}) => {
    const { traces, key } = fresh();
    const trace = sample(traces, {
      governance: {
        policyRef: 'finance.refunds.max-10000',
        policyVersion: '3',
        decision,
        evidence: ['amount <= 10000', 'customer is not flagged'],
        evaluatedBy: 'policy-engine',
      },
      ...over,
    });
    return { trace, verdict: verifyTrace(trace, key.publicKeyPem) };
  };

  const governanceOf = (...args: Parameters<typeof trustConditions>) =>
    trustConditions(...args).conditions.find(condition => condition.condition === 'Governance')!;

  test('PERMITTED, with the content intact, is demonstrated', () => {
    const { trace, verdict } = governed('PERMITTED');
    const condition = governanceOf(trace, verdict, true, proven);

    expect(condition.state).toBe('DEMONSTRATED');
    expect(condition.finding).toMatch(/Permitted under policy finance\.refunds\.max-10000/);
  });

  test('DENIED, with the action succeeding anyway, is a failure', () => {
    // The rule was consulted. It refused. The action happened. This used to
    // report DEMONSTRATED, because the only question asked was whether a policy
    // had been named.
    const { trace, verdict } = governed('DENIED', { outcome: 'success' });
    const condition = governanceOf(trace, verdict, true, proven);

    expect(condition.state).toBe('FAILED');
    expect(condition.finding).toMatch(/evaluated to DENIED.*and this execution succeeded anyway/s);
    expect(condition.finding).toMatch(/somebody built the check and something went around it/);
  });

  test('DENIED, with the action not succeeding, is governance working', () => {
    const { trace, verdict } = governed('DENIED', { outcome: 'failure', error: 'refused by policy' });
    const condition = governanceOf(trace, verdict, true, proven);

    expect(condition.state).toBe('DEMONSTRATED');
    expect(condition.finding).toMatch(/The rule held/);
  });

  test('REQUIRES_APPROVAL with nothing consulted is UNKNOWN, never demonstrated', () => {
    const { trace, verdict } = governed('REQUIRES_APPROVAL');
    const condition = governanceOf(trace, verdict, true, proven);

    // A demand for human judgement that satisfies itself is not governance.
    expect(condition.state).toBe('UNKNOWN');
    expect(condition.resolvedBy).toMatch(/POST \/approvals\/attest/);
    expect(condition.finding).toMatch(/a person had to decide before this ran/);
  });

  test('REQUIRES_APPROVAL with an approval that holds is demonstrated', () => {
    const { trace, verdict } = governed('REQUIRES_APPROVAL');
    const condition = governanceOf(trace, verdict, true, proven, {
      state: 'DEMONSTRATED',
      approvalState: 'CONSUMED',
      assurance: 'PROVEN',
      finding: 'Approved by alice, who signed the decision with their enrolled key.',
      limits: [],
    });

    expect(condition.state).toBe('DEMONSTRATED');
    expect(condition.finding).toMatch(/an approval holds/);
    expect(condition.from).toMatch(/approval record/);
  });

  /*
   * The gate a regulated buyer presses on.
   *
   * Separation of duties is enforced on names: an approval refuses
   * `decidedBy === requestedBy`, but one holder of an admin key can supply two
   * names and play both parties. `assurance` already told you which kind of
   * decision it was; these tests are the difference between telling and
   * enforcing.
   */
  describe('requiring signed approvals', () => {
    const assertedApproval = {
      state: 'DEMONSTRATED' as const,
      approvalState: 'CONSUMED' as const,
      assurance: 'ASSERTED' as const,
      finding: 'Approved by alice, attributed by the name the operator supplied.',
      limits: [],
    };

    test('an ASSERTED approval is demonstrated by default, and says which kind it is', () => {
      const { trace, verdict } = governed('REQUIRES_APPROVAL');
      const condition = governanceOf(trace, verdict, true, proven, assertedApproval);

      // The default has to stay permissive: flipping it would retroactively
      // fail every approval recorded before the option existed, which is a
      // claim about those records that the records do not support.
      expect(condition.state).toBe('DEMONSTRATED');
      expect(condition.finding).toMatch(/attributed by the name the operator supplied/);
    });

    test('the same approval FAILS when this deployment requires PROVEN', () => {
      const { trace, verdict } = governed('REQUIRES_APPROVAL');
      const condition = governanceOf(trace, verdict, true, proven, assertedApproval, 'PROVEN');

      expect(condition.state).toBe('FAILED');
      expect(condition.finding).toMatch(/this deployment requires PROVEN/);
      // The record is not accused of being fake. It is accused of not proving
      // who decided, which is a narrower and truer complaint.
      expect(condition.finding).toMatch(/The approval is real and it is recorded/);
      expect(condition.from).toMatch(/assurance/);
    });

    test('a PROVEN approval passes the gate that the ASSERTED one failed', () => {
      const { trace, verdict } = governed('REQUIRES_APPROVAL');
      const condition = governanceOf(trace, verdict, true, proven, {
        ...assertedApproval,
        assurance: 'PROVEN',
        finding: 'Approved by alice, who signed the decision with their enrolled key.',
      }, 'PROVEN');

      expect(condition.state).toBe('DEMONSTRATED');
      expect(condition.finding).toMatch(/an approval holds/);
    });

    test('the gate does not rescue an approval that was already failing', () => {
      // Requiring PROVEN must not change *why* a bad approval failed, or the
      // finding would name the wrong problem.
      const { trace, verdict } = governed('REQUIRES_APPROVAL');
      const condition = governanceOf(trace, verdict, true, proven, {
        state: 'ABSENT',
        finding: 'No approval was ever requested for this action.',
        limits: [],
      }, 'PROVEN');

      expect(condition.state).toBe('FAILED');
      expect(condition.finding).toMatch(/satisfied by nobody being asked, is not governance/);
      expect(condition.finding).not.toMatch(/requires PROVEN/);
    });

    test('the gate touches nothing but REQUIRES_APPROVAL', () => {
      const { trace, verdict } = governed('PERMITTED');
      const condition = governanceOf(trace, verdict, true, proven, assertedApproval, 'PROVEN');

      expect(condition.state).toBe('DEMONSTRATED');
    });
  });

  test('REQUIRES_APPROVAL with no approval ever requested is a failure, not an absence', () => {
    const { trace, verdict } = governed('REQUIRES_APPROVAL');
    const condition = governanceOf(trace, verdict, true, proven, {
      state: 'ABSENT',
      finding: 'No approval was ever requested for this action.',
      limits: [],
    });

    expect(condition.state).toBe('FAILED');
    expect(condition.finding).toMatch(/satisfied by nobody being asked, is not governance/);
  });

  test('REQUIRES_APPROVAL with an approval spent elsewhere is a failure', () => {
    const { trace, verdict } = governed('REQUIRES_APPROVAL');
    const condition = governanceOf(trace, verdict, true, proven, {
      state: 'FAILED',
      approvalState: 'CONSUMED',
      finding: 'That approval was spent on execution exec_other, not this one.',
      limits: [],
    });

    expect(condition.state).toBe('FAILED');
    expect(condition.finding).toMatch(/spent on execution exec_other/);
  });

  test('REQUIRES_APPROVAL with a request still open stays UNKNOWN and carries its next step', () => {
    const { trace, verdict } = governed('REQUIRES_APPROVAL');
    const condition = governanceOf(trace, verdict, true, proven, {
      state: 'UNKNOWN',
      approvalState: 'PENDING',
      finding: 'Nobody has decided yet.',
      resolvedBy: 'Grant or refuse apr_x. It lapses at 2026-01-01T00:00:00.000Z.',
      limits: [],
    });

    expect(condition.state).toBe('UNKNOWN');
    expect(condition.resolvedBy).toMatch(/Grant or refuse apr_x/);
  });

  test('a broken hash still dominates every decision', () => {
    // Content that contradicts its own hash makes the policy reference as
    // unproven as everything else, whatever the decision said.
    const { trace, verdict } = governed('REQUIRES_APPROVAL');
    const broken = { ...verdict, contentIntact: false };
    const condition = governanceOf(trace, broken, true, proven, {
      state: 'DEMONSTRATED', finding: 'Approved.', limits: [],
    });

    expect(condition.state).toBe('FAILED');
    expect(condition.finding).toMatch(/does not match its hash/);
  });

  test('an ungoverned record is still absent, and says why', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);
    const condition = governanceOf(trace, verifyTrace(trace, key.publicKeyPem), true, proven);

    expect(condition.state).toBe('ABSENT');
    expect(condition.notAnsweredBecause).toMatch(/carries no policy reference/);
  });
});
