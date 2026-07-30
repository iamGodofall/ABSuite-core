import { Storage } from './storage';
import { TraceStore, SigningKey, verifyTrace } from './trace';
import { finding, determineTrace, renderFinding } from './determination';

describe('unknown is not the same as false', () => {
  test('an unknown that offers no way out is refused at construction', () => {
    // A dead end dressed as an answer. Within a week a reader treats it as a pass.
    expect(() => finding('UNKNOWN', 'Something could not be checked.')).toThrow(/must state what would resolve it/i);
    expect(() => finding('UNKNOWN', 'Something could not be checked.', 'Run the check.')).not.toThrow();
  });

  test('verified and failed carry no resolution, because there is nothing to resolve', () => {
    expect(finding('VERIFIED', 'It holds.').resolvedBy).toBeUndefined();
    expect(finding('FAILED', 'It does not.').resolvedBy).toBeUndefined();
  });

  test('a record checked without a public key is UNKNOWN, not verified', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success' });

    const verdict = verifyTrace(trace);
    // The legacy boolean says true — the content does match its hash, which is
    // all it was asked. It has been read as "this record is genuine" ever since,
    // and nobody checked who wrote it.
    expect(verdict.valid).toBe(true);
    expect(verdict.signatureValid).toBeNull();

    const result = determineTrace(verdict);
    expect(result.determination).toBe('UNKNOWN');
    expect(result.statement).toMatch(/who wrote this record is unproven/i);
    expect(result.resolvedBy).toMatch(/public/i);
  });

  test('a fully checked record is VERIFIED', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success' });

    expect(determineTrace(verifyTrace(trace, key.publicKeyPem)).determination).toBe('VERIFIED');
  });

  test('an edited record is FAILED, and a wrong key is FAILED — but neither is UNKNOWN', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success' });

    const edited = determineTrace(verifyTrace({ ...trace, outcome: 'failure' }, key.publicKeyPem));
    expect(edited.determination).toBe('FAILED');

    const wrongKey = determineTrace(verifyTrace(trace, new SigningKey().publicKeyPem));
    expect(wrongKey.determination).toBe('FAILED');
  });

  test('a record this build cannot read is UNKNOWN, with an upgrade path', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success' });

    const result = determineTrace(verifyTrace({ ...trace, canonicalVersion: 9 }, key.publicKeyPem));

    // The single most important case: our limitation must never be reported as
    // their failure.
    expect(result.determination).toBe('UNKNOWN');
    expect(result.determination).not.toBe('FAILED');
    expect(result.resolvedBy).toMatch(/upgrade/i);
  });

  test('the three states never render in the same words', () => {
    const rendered = [
      renderFinding(finding('VERIFIED', 'It holds.')),
      renderFinding(finding('FAILED', 'It does not.')),
      renderFinding(finding('UNKNOWN', 'Nobody checked.', 'Check it.')),
    ];

    expect(new Set(rendered).size).toBe(3);
    expect(rendered[2]).toContain('resolved by:');
    expect(rendered[0]).not.toContain('resolved by:');
  });
});
