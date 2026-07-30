import { Storage } from './storage';
import { TraceStore, SigningKey, verifyTrace } from './trace';
import { trustConditions, renderConditions } from './conditions';

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
    const report = trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true);

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
    const report = trustConditions(trace, verifyTrace(trace, key.publicKeyPem), true);

    expect(report.overall).toBe('DEMONSTRATED');
    expect(report.constrainedBy).toEqual([]);
    expect(report.allDemonstrated).toBe(true);
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
