import { Storage } from './storage';
import { TraceStore, SigningKey, verifyTrace } from './trace';
import { finding, determineTrace, renderFinding } from './determination';

describe('unknown is not the same as false — or true', () => {
  test('an unknown that offers no way out is refused at construction', () => {
    // A dead end dressed as an answer. Within a week a reader treats it as a pass.
    expect(() => finding('UNKNOWN', 'Something could not be checked.')).toThrow(/must state what would resolve it/i);
    expect(() => finding('UNKNOWN', 'Something could not be checked.', 'Run the check.')).not.toThrow();
  });

  test('an absence that does not say why the record is silent is refused', () => {
    // "Not recorded" and "recorded as nothing" are different claims, and a
    // reader deserves to know which.
    expect(() => finding('ABSENT', 'No policy is recorded.')).toThrow(/must say why the record does not answer/i);
    expect(finding('ABSENT', 'No policy is recorded.', 'This record predates governance.').notAnsweredBecause)
      .toBe('This record predates governance.');
  });

  test('demonstrated and failed carry no detail, because there is nothing outstanding', () => {
    expect(finding('DEMONSTRATED', 'It holds.').resolvedBy).toBeUndefined();
    expect(finding('FAILED', 'It does not.').resolvedBy).toBeUndefined();
    expect(finding('DEMONSTRATED', 'It holds.').notAnsweredBecause).toBeUndefined();
  });

  test('the states speak about evidence, never about truth', () => {
    // DEMONSTRATED means the evidence for this is present and holds. It does
    // not mean the thing is true, and the vocabulary has to stop implying it.
    const states = ['DEMONSTRATED', 'FAILED', 'UNKNOWN', 'ABSENT'];
    expect(states).not.toContain('TRUE');
    expect(states).not.toContain('FALSE');
    expect(states).not.toContain('VALID');
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

    // One bit was carrying two independent questions. Integrity was answered;
    // authorship never was.
    expect(result.integrity.determination).toBe('DEMONSTRATED');
    expect(result.authorship.determination).toBe('UNKNOWN');
    expect(result.authorship.resolvedBy).toMatch(/public/i);
    // The overall answer is the weaker of the two, never the friendlier.
    expect(result.overall.determination).toBe('UNKNOWN');
  });

  test('a fully checked record is VERIFIED', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success' });

    const result = determineTrace(verifyTrace(trace, key.publicKeyPem));
    expect(result.overall.determination).toBe('DEMONSTRATED');
    expect(result.integrity.determination).toBe('DEMONSTRATED');
    expect(result.authorship.determination).toBe('DEMONSTRATED');
  });

  test('an edited record is FAILED, and a wrong key is FAILED — but neither is UNKNOWN', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success' });

    const edited = determineTrace(verifyTrace({ ...trace, outcome: 'failure' }, key.publicKeyPem));
    expect(edited.overall.determination).toBe('FAILED');
    expect(edited.integrity.determination).toBe('FAILED');

    // A wrong key fails authorship while integrity still holds — the content
    // was not edited, it was signed by someone else.
    const wrongKey = determineTrace(verifyTrace(trace, new SigningKey().publicKeyPem));
    expect(wrongKey.overall.determination).toBe('FAILED');
    expect(wrongKey.integrity.determination).toBe('DEMONSTRATED');
    expect(wrongKey.authorship.determination).toBe('FAILED');
  });

  test('a record this build cannot read is UNKNOWN, with an upgrade path', () => {
    const key = new SigningKey();
    const traces = new TraceStore(new Storage(':memory:'), key);
    const trace = traces.record({ subject: 'a', scope: ['x'], module: 'm', action: 'y', input: 1, outcome: 'success' });

    const result = determineTrace(verifyTrace({ ...trace, canonicalVersion: 9 }, key.publicKeyPem));

    // The single most important case: our limitation must never be reported as
    // their failure.
    expect(result.overall.determination).toBe('UNKNOWN');
    expect(result.integrity.determination).not.toBe('FAILED');
    expect(result.overall.resolvedBy).toMatch(/upgrade/i);
  });

  test('the four states never render in the same words', () => {
    const rendered = [
      renderFinding(finding('DEMONSTRATED', 'It holds.')),
      renderFinding(finding('FAILED', 'It does not.')),
      renderFinding(finding('UNKNOWN', 'Nobody checked.', 'Check it.')),
      renderFinding(finding('ABSENT', 'The record is silent.', 'It predates the field.')),
    ];

    expect(new Set(rendered).size).toBe(4);
    expect(rendered[2]).toContain('resolved by:');
    expect(rendered[3]).toContain('not answered because:');
    expect(rendered[0]).not.toContain('resolved by:');
  });
});
