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

/**
 * The same promise, made again for canonical form v2.
 *
 * v2 added cost. These three records were signed on the day it shipped and are
 * never regenerated, for exactly the reason above — and for one more that only
 * applies from v2 onward.
 *
 * v2 is the first form that is *chosen* rather than assumed. A record is written
 * as v1 unless it carries a cost, so the first record here is v1 and the other
 * two are v2, in one chain, verified by one walk. If a future change ever starts
 * writing v2 for everything, this fixture's first record still says v1 and every
 * old deployment's archive stays readable. That is the whole point of freezing a
 * mixed chain rather than three identical records.
 */
const v2 = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'frozen-chain-v2.json'), 'utf8')
) as { publicKeyPem: string; records: ExecutionTrace[] };

describe('records signed under canonical form v2', () => {
  test('still verify, content and signature', () => {
    expect(v2.records).toHaveLength(3);

    for (const record of v2.records) {
      const verdict = verifyTrace(record, v2.publicKeyPem);
      expect(verdict.contentIntact).toBe(true);
      expect(verdict.signatureValid).toBe(true);
      expect(verdict.valid).toBe(true);
    }
  });

  test('their hashes are byte-for-byte what was recorded', () => {
    for (const record of v2.records) {
      const { hash, signature, ...unhashed } = record;
      expect(signature).toBeTruthy();
      expect(hashTrace(unhashed)).toBe(hash);
    }
  });

  test('one chain holds both forms, and links across the boundary', () => {
    expect(v2.records.map(record => record.canonicalVersion ?? 1)).toEqual([1, 2, 2]);

    let expectedPrev = GENESIS_HASH;
    for (const record of v2.records) {
      expect(record.prevHash).toBe(expectedPrev);
      expectedPrev = record.hash;
    }
  });

  test('a record that carries no cost was written as v1, and must stay that way', () => {
    const uncosted = v2.records[0]!;

    // Upgrading capkit must not change the form of a record that uses nothing
    // new. If this ever fails, every existing deployment has just started
    // writing records their own auditors cannot read.
    expect(uncosted.cost).toBeUndefined();
    expect(uncosted.canonicalVersion).toBeUndefined();
  });

  test('the cost is inside the signature, not beside it', () => {
    const costed = v2.records[1]!;
    expect(costed.cost).toEqual({
      amount: 1420, currency: 'USD', source: 'provider-usage-api', unit: 'tokens', quantity: 8_200_000,
    });

    // Revising the figure after the fact must break the record.
    const cheaper = { ...costed, cost: { ...costed.cost!, amount: 1 } };
    expect(verifyTrace(cheaper as ExecutionTrace, v2.publicKeyPem).contentIntact).toBe(false);

    // So must deleting it. Spend that can be quietly dropped is not evidence.
    const { cost, ...stripped } = costed;
    expect(cost).toBeDefined();
    expect(verifyTrace(stripped as ExecutionTrace, v2.publicKeyPem).contentIntact).toBe(false);
  });

  test('a v2 record carries governance and cost at fixed slots, not by length', () => {
    const both = v2.records[2]!;
    expect(both.governance?.policyRef).toBe('finance.refunds.max-10000');
    expect(both.cost).toEqual({ amount: 3, currency: 'ZAR', source: 'internal-meter' });

    // Either one removed alone must break it. Under v1 the two would have shared
    // a slot by position; under v2 they cannot be confused for one another.
    const { governance, ...withoutRule } = both;
    const { cost, ...withoutCost } = both;
    expect(verifyTrace(withoutRule as ExecutionTrace, v2.publicKeyPem).contentIntact).toBe(false);
    expect(verifyTrace(withoutCost as ExecutionTrace, v2.publicKeyPem).contentIntact).toBe(false);
  });
});
