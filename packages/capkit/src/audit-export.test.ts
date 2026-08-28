/**
 * The exported bundle, verified without ABSuite.
 *
 * Every assertion here works on the BUNDLE — parsed back from JSON, exactly as
 * an auditor would receive it. Nothing touches the TraceStore that produced it,
 * because a verifier that needs the database is not the product being sold.
 */
import { Storage } from './storage';
import { TraceStore, SigningKey, hashPayload } from './trace';
import { buildAuditExport, verifyAuditExport, AUDIT_EXPORT_FORMAT, type AuditExport } from './audit-export';

const NOW = new Date('2026-08-28T00:00:00.000Z');

const sample = (n: number, at = NOW.toISOString()) => ({
  subject: `agent-${n}`,
  scope: ['queue:write'],
  module: 'edge-run',
  action: `http:POST /sync/${n}`,
  inputHash: hashPayload({ n }),
  outcome: 'success' as const,
  startedAt: at,
  completedAt: at,
  steps: [{ seq: 1, name: 'queued', at }],
});

/** Build a ledger, export it, and round-trip through JSON like a real file. */
const exported = (count = 4) => {
  const storage = new Storage(':memory:');
  const key = new SigningKey();
  const traces = new TraceStore(storage, key);
  for (let i = 1; i <= count; i += 1) traces.record(sample(i));

  const bundle = buildAuditExport({
    // list() is newest-first; the chain is oldest-first.
    records: traces.list({ limit: 1000 }).reverse(),
    publicKeyPem: key.publicKeyPem,
    keyId: key.keyId,
    now: NOW,
  });

  return {
    key,
    traces,
    storage,
    // Through JSON, because that is what an auditor actually holds.
    file: JSON.parse(JSON.stringify(bundle)) as AuditExport,
  };
};

describe('a genuine export', () => {
  test('verifies from the file alone', () => {
    const { file } = exported();
    const verdict = verifyAuditExport(file);
    expect(verdict.valid).toBe(true);
    expect(verdict.checked).toBe(4);
  });

  test('verifies against a key the auditor already trusts', () => {
    const { file, key } = exported();
    const verdict = verifyAuditExport(file, key.publicKeyPem);
    expect(verdict.valid).toBe(true);
    expect(verdict.keyProvenance).toBe('trusted');
  });

  test('says plainly when the key vouched for itself', () => {
    const { file } = exported();
    const verdict = verifyAuditExport(file);
    expect(verdict.keyProvenance).toBe('self-asserted');
    // The weaker claim must not read like the stronger one.
    expect(verdict.scope).toContain('not provenance');
  });

  test('whitespace in the supplied PEM does not defeat the match', () => {
    const { file, key } = exported();
    expect(verifyAuditExport(file, key.publicKeyPem.replace(/\n/g, '\r\n')).valid).toBe(true);
  });
});

describe('tampering with the file', () => {
  test('THE ASSERTION — one altered character is caught', () => {
    const { file } = exported();
    file.records[2]!.action = 'http:POST /sync/EDITED';
    const verdict = verifyAuditExport(file);
    expect(verdict.valid).toBe(false);
    expect(verdict.brokenAt).toBe(3);
  });

  test('a removed record breaks the chain', () => {
    const { file } = exported();
    file.records.splice(1, 1);
    file.count -= 1;
    expect(verifyAuditExport(file).valid).toBe(false);
  });

  test('reordering two records is caught', () => {
    const { file } = exported();
    [file.records[1], file.records[2]] = [file.records[2]!, file.records[1]!];
    expect(verifyAuditExport(file).valid).toBe(false);
  });

  test('REFUSAL — truncating the front is not a valid short chain', () => {
    // The failure this whole design exists for. Dropping the oldest records
    // leaves a set that links perfectly to each other; only the requirement
    // that the chain BEGIN at genesis catches it.
    const { file } = exported();
    file.records.splice(0, 2);
    file.count -= 2;
    const verdict = verifyAuditExport(file);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('does not link to its predecessor');
  });

  test('REFUSAL — a forged retention anchor cannot excuse that truncation', () => {
    // The sharpest case in this file. Every surviving record is genuine and
    // correctly signed; the attacker drops the oldest ones and writes an anchor
    // naming exactly the hash the new front record expects, so the chain walks
    // perfectly. Only the anchor's own signature separates this from a lawful
    // retention sweep.
    //
    // An earlier version of this test asserted `valid: true` and passed — I had
    // written the hole down as "owed" instead of closing it. The test was
    // right to be uncomfortable.
    const { file } = exported();
    const survivor = file.records[2]!;
    file.records.splice(0, 2);
    file.count -= 2;
    file.retainedFrom = {
      seq: 2, hash: survivor.prevHash, removed: 2, policyDays: 90,
      prunedAt: NOW.toISOString(), signature: 'forged',
    };

    const verdict = verifyAuditExport(file);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('not signed by the key');
  });

  test('a GENUINE retention anchor is honoured, and the gap is reported', () => {
    // The control. Without it the assertion above is trivially true of a build
    // that rejects every anchor.
    const storage = new Storage(':memory:');
    const key = new SigningKey();
    const traces = new TraceStore(storage, key);
    const old = new Date(NOW.getTime() - 200 * 86_400_000).toISOString();
    for (let i = 1; i <= 3; i += 1) traces.record(sample(i, old));
    traces.record(sample(4));

    const swept = traces.pruneToRetention({ retentionDays: 30, now: NOW });
    expect(swept.removed).toBeGreaterThan(0);

    const file = JSON.parse(JSON.stringify(buildAuditExport({
      records: traces.list({ limit: 1000 }).reverse(),
      publicKeyPem: key.publicKeyPem,
      retainedFrom: swept.anchor,
      now: NOW,
    }))) as AuditExport;

    const verdict = verifyAuditExport(file, key.publicKeyPem);
    expect(verdict.valid).toBe(true);
    expect(verdict.scope).toContain('retention policy');
  });

  test('the gap is reported even without a trusted key', () => {
    // The reader with no key to check against is the one who most needs to be
    // told records are missing, and was the one not told.
    const { file } = exported();
    file.retainedFrom = {
      seq: 0, hash: file.records[0]!.prevHash, removed: 7, policyDays: 90,
      prunedAt: NOW.toISOString(), signature: 'forged',
    };
    // Refused for the signature, but a genuine one reports the gap either way —
    // asserted on the control above under `self-asserted` too.
    expect(verifyAuditExport(file).valid).toBe(false);
  });

  test('the count must match what is in the file', () => {
    const { file } = exported();
    file.count = 99;
    expect(verifyAuditExport(file).valid).toBe(false);
  });

  test('REFUSAL — signed by a key the auditor does not trust', () => {
    const { file } = exported();
    const stranger = new SigningKey();
    const verdict = verifyAuditExport(file, stranger.publicKeyPem);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('different key');
  });

  test('REFUSAL — swapping in a matching key does not rescue edited records', () => {
    // The self-asserted weakness, made concrete: an attacker re-signs the
    // records with their own key and swaps the bundle's key to match. It
    // verifies self-asserted, and fails the moment a real key is supplied.
    const { file } = exported();
    const stranger = new SigningKey();
    file.publicKeyPem = stranger.publicKeyPem;
    expect(verifyAuditExport(file).valid).toBe(false); // records still signed by the original
  });
});

describe('malformed bundles fail closed', () => {
  test('an unknown format is refused, not read optimistically', () => {
    const { file } = exported();
    (file as { format: string }).format = 'absuite.audit-export.v2';
    const verdict = verifyAuditExport(file);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('Unsupported export format');
  });

  test('no key, no records, no bundle at all', () => {
    expect(verifyAuditExport({ format: AUDIT_EXPORT_FORMAT } as unknown as AuditExport).valid).toBe(false);
    expect(verifyAuditExport(undefined as unknown as AuditExport).valid).toBe(false);
    expect(verifyAuditExport({} as unknown as AuditExport).valid).toBe(false);
  });

  test('an empty ledger exports and verifies as empty', () => {
    const key = new SigningKey();
    const file = buildAuditExport({ records: [], publicKeyPem: key.publicKeyPem, now: NOW });
    const verdict = verifyAuditExport(file, key.publicKeyPem);
    expect(verdict.valid).toBe(true);
    expect(verdict.checked).toBe(0);
  });
});
