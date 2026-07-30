import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyTrace, hashTrace, GENESIS_HASH, type ExecutionTrace } from './trace';

/**
 * History must survive improvement.
 *
 * These records were signed once, in January 2026, and committed. They are never
 * regenerated. Every future version of ABSuite must still verify them, using
 * nothing but the public key stored beside them.
 *
 * This is the executable form of a promise that is otherwise easy to make and
 * easy to break: any change to the canonical form — a reordered field, a new
 * element, a "harmless" null placeholder — silently invalidates every record
 * ever written, and nobody finds out until an auditor's chain reports as
 * tampered. Unit tests that generate a trace and verify it in the same process
 * cannot catch that: both sides move together, and the suite stays green while
 * the archive rots.
 *
 * If this file fails, do not update the fixture. The fixture is the historical
 * record; a change that breaks it is the thing that is wrong.
 *
 * The chain deliberately mixes shapes: two records from before governance
 * existed, and one carrying a signed policy reference. Both must verify under
 * the same code, forever.
 */
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'frozen-chain.json'), 'utf8')
) as { publicKeyPem: string; records: ExecutionTrace[] };

describe('records signed by an earlier version of ABSuite', () => {
  test('still verify, content and signature', () => {
    expect(fixture.records).toHaveLength(3);

    for (const record of fixture.records) {
      const verdict = verifyTrace(record, fixture.publicKeyPem);

      // A failure here means today's canonical form disagrees with the one that
      // signed these. That is a breaking change to every deployment's archive.
      expect(verdict.contentIntact).toBe(true);
      expect(verdict.signatureValid).toBe(true);
      expect(verdict.valid).toBe(true);
    }
  });

  test('their hashes are byte-for-byte what was recorded', () => {
    for (const record of fixture.records) {
      const { hash, signature, ...unhashed } = record;
      expect(signature).toBeTruthy();
      expect(hashTrace(unhashed)).toBe(hash);
    }
  });

  test('the chain still links, across the governance boundary', () => {
    let expectedPrev = GENESIS_HASH;
    for (const record of fixture.records) {
      expect(record.prevHash).toBe(expectedPrev);
      expectedPrev = record.hash;
    }
  });

  test('a record written before governance existed carries none, and is still valid', () => {
    const legacy = fixture.records[0]!;

    // Not backfilled, not defaulted to null, not inferred from scope. Absent.
    expect(legacy.governance).toBeUndefined();
    expect(verifyTrace(legacy, fixture.publicKeyPem).valid).toBe(true);
  });

  test('a governed record carries its policy inside the signature', () => {
    const governed = fixture.records[2]!;
    expect(governed.governance?.policyRef).toBe('finance.refunds.max-10000');
    expect(governed.governance?.policyVersion).toBe('2.1.4');

    // Removing the rule that permitted an action must break the record, or the
    // rule was never really part of the evidence.
    const { governance, ...stripped } = governed;
    expect(governance).toBeDefined();
    expect(verifyTrace(stripped as ExecutionTrace, fixture.publicKeyPem).contentIntact).toBe(false);
  });
});
