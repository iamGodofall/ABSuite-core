import { Storage } from './storage';
import { TraceStore, SigningKey, verifyTrace } from './trace';
import { explainTrace, renderExplanation } from './explain';

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
    input: { batch: 'BATCH-8891', total: 250000 },
    output: { approved: true },
    outcome: 'success',
    startedAt: '2026-07-29T02:14:03.000Z',
    completedAt: '2026-07-29T02:14:07.000Z',
    steps: [
      { seq: 1, name: 'load_batch', at: '2026-07-29T02:14:03.000Z' },
      { seq: 2, name: 'check_policy_limit', at: '2026-07-29T02:14:04.000Z' },
    ],
    ...over,
  } as never);

describe('explaining a record without a language model', () => {
  test('every sentence traces to a field that was signed', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);
    const out = explainTrace(trace, verifyTrace(trace, key.publicKeyPem));

    // Nothing is attributed to a source that does not exist on the record.
    for (const finding of out.findings) {
      expect(finding.from.length).toBeGreaterThan(0);
      expect(finding.answer.length).toBeGreaterThan(0);
    }

    const text = renderExplanation(out);
    expect(text).toContain('agent:invoicing');
    expect(text).toContain('approve_batch');
    expect(text).toContain('payment:approve');
    expect(text).toContain('tok_991');
  });

  test('is deterministic — the same record always explains the same way', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);
    const verdict = verifyTrace(trace, key.publicKeyPem);

    // A generated explanation would drift between runs. A derived one cannot,
    // which is what lets a reader check the prose against the record.
    expect(renderExplanation(explainTrace(trace, verdict)))
      .toBe(renderExplanation(explainTrace(trace, verdict)));
  });

  test('never reveals the payload it is explaining', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);
    const text = renderExplanation(explainTrace(trace, verifyTrace(trace, key.publicKeyPem)));

    // Payloads are hashed and never stored; an explanation must not leak what
    // the record itself deliberately does not hold.
    expect(text).not.toContain('BATCH-8891');
    expect(text).not.toContain('250000');
  });

  test('a verified record and an unchecked one never read the same', () => {
    const { traces, key } = fresh();
    const trace = sample(traces);

    const checked = explainTrace(trace, verifyTrace(trace, key.publicKeyPem));
    const unchecked = explainTrace(trace);

    expect(checked.warrantsReview).toBe(false);
    // Silence about verification must never be mistaken for a pass.
    expect(unchecked.warrantsReview).toBe(true);
    expect(renderExplanation(unchecked)).toContain('Not checked');
    expect(renderExplanation(checked)).not.toContain('Not checked');
  });

  test('a tampered record says so, and withdraws everything above it', () => {
    const { traces, key, storage } = fresh();
    const trace = sample(traces);
    storage.run("UPDATE executions SET outcome = 'failure' WHERE id = ?", trace.id);
    const altered = traces.get(trace.id)!;

    const out = explainTrace(altered, verifyTrace(altered, key.publicKeyPem));

    expect(out.warrantsReview).toBe(true);
    const text = renderExplanation(out);
    expect(text).toMatch(/verification failed/i);
    expect(text).toMatch(/unproven/i);
  });

  test('a failure is reported as a failure, with its reason', () => {
    const { traces, key } = fresh();
    const trace = sample(traces, { outcome: 'failure', error: 'policy limit exceeded' });
    const out = explainTrace(trace, verifyTrace(trace, key.publicKeyPem));

    expect(out.headline).toContain('failed');
    expect(out.warrantsReview).toBe(true);
    expect(renderExplanation(out)).toContain('policy limit exceeded');
  });

  test('an absent scope is stated as unknown, not assumed permitted', () => {
    const { traces, key } = fresh();
    const trace = sample(traces, { scope: [] });
    const out = explainTrace(trace, verifyTrace(trace, key.publicKeyPem));

    // "No scope recorded" and "no restrictions" are opposite claims.
    expect(out.warrantsReview).toBe(true);
    expect(renderExplanation(out)).toMatch(/cannot be stated from the record/i);
  });

  test('the conclusion never tells anyone what to do', () => {
    const { traces, key } = fresh();
    for (const over of [{}, { outcome: 'failure' as const }]) {
      const trace = sample(traces, over);
      const out = explainTrace(trace, verifyTrace(trace, key.publicKeyPem));
      // ABSuite is the witness. It says what a person should look at, never
      // what should be done about it.
      expect(out.conclusion).not.toMatch(/\b(should be (revoked|suspended|blocked)|recommend|must (revoke|suspend|block))\b/i);
    }
  });
});
