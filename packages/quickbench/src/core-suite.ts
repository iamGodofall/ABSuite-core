/**
 * The ABSuite core benchmark suite.
 *
 * These are the operations the whole product rests on: signing an execution
 * into the chain, verifying one, verifying a whole chain, issuing and checking
 * a capability, and explaining a record. If ABSuite is going to publish a
 * performance number anywhere — README, site, dashboard — it comes from this
 * file, on a stated machine, or it does not get published.
 *
 * Every operation runs against the real implementation. Nothing is stubbed,
 * nothing is mocked, and the storage is a real SQLite file with WAL on, because
 * an in-memory number would be true and useless — nobody runs a flight recorder
 * with the recorder switched off.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Storage,
  TraceStore,
  SigningKey,
  CapabilityToken,
  verifyTrace,
  explainTrace,
  renderExplanation,
  type ExecutionTrace,
} from '@absuitecore/capkit';
import { measureSuite, type BenchReport, type MeasureSpec } from './measure';

export interface CoreSuiteOptions {
  /** Timed iterations per operation. Lower is faster, noisier and still honest. */
  iterations?: number;
  /** Records in the chain used by the chain-verification measurement. */
  chainLength?: number;
  commit?: string;
  includeHost?: boolean;
}

const SUBJECT = 'agent:bench';
const SECRET = 'bench-secret-not-used-anywhere-else';

function sampleInput(i: number) {
  return { invoice: `INV-${i}`, amount: 1000 + i, currency: 'ZAR', lines: [{ sku: 'A-1', qty: 2 }] };
}

/**
 * Build the suite. Each entry owns its own storage so one measurement's writes
 * never change another's read cost — a verify benchmark running against a table
 * a previous benchmark grew to 100k rows would be measuring the wrong thing.
 */
export function coreSuiteSpecs(options: CoreSuiteOptions = {}): MeasureSpec[] {
  const iterations = Math.max(1, options.iterations ?? 2000);
  const chainLength = Math.max(1, options.chainLength ?? 1000);

  const scratch = () => mkdtempSync(join(tmpdir(), 'absuite-bench-'));
  const dbIn = (dir: string) => join(dir, 'bench.db');
  const cleanup = (dir: string | undefined) => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  };

  // ── record ────────────────────────────────────────────────────────────────
  let recordStore: TraceStore | undefined;
  let recordStorage: Storage | undefined;
  let recordDir: string | undefined;

  // ── verify one ────────────────────────────────────────────────────────────
  let verifyTraces: ExecutionTrace[] = [];
  let verifyPublicKey = '';
  let verifyStorage: Storage | undefined;
  let verifyDir: string | undefined;

  // ── verify chain ──────────────────────────────────────────────────────────
  let chainStore: TraceStore | undefined;
  let chainPublicKey = '';
  let chainStorage: Storage | undefined;
  let chainDir: string | undefined;

  // ── capability ────────────────────────────────────────────────────────────
  let issuedToken = '';

  // ── explain ───────────────────────────────────────────────────────────────
  let explainTarget: ExecutionTrace | undefined;
  let explainKey = '';
  let explainStorage: Storage | undefined;
  let explainDir: string | undefined;

  return [
    {
      operation: 'trace.record',
      description:
        'Hash an input and output, link to the previous record, Ed25519-sign the result and commit it to SQLite (WAL) in one transaction.',
      iterations,
      setup: () => {
        recordDir = scratch();
        recordStorage = new Storage(dbIn(recordDir));
        recordStore = new TraceStore(recordStorage, new SigningKey());
      },
      run: i =>
        recordStore!.record({
          subject: SUBJECT,
          scope: ['payment:approve'],
          module: 'payments',
          action: 'approve',
          input: sampleInput(i),
          output: { approved: true },
          outcome: 'success',
        }),
      teardown: () => {
        recordStorage?.close();
        cleanup(recordDir);
      },
    },

    {
      operation: 'trace.verify',
      description:
        'Re-canonicalise a stored record, recompute its hash and verify the Ed25519 signature against the public key.',
      iterations,
      setup: () => {
        verifyDir = scratch();
        verifyStorage = new Storage(dbIn(verifyDir));
        const key = new SigningKey();
        verifyPublicKey = key.publicKeyPem;
        const store = new TraceStore(verifyStorage, key);
        // Verify against a set rather than one record, so the measurement cannot
        // be a single object staying hot in cache.
        verifyTraces = Array.from({ length: 64 }, (_, i) =>
          store.record({
            subject: SUBJECT,
            scope: ['payment:approve'],
            module: 'payments',
            action: 'approve',
            input: sampleInput(i),
            output: { approved: true },
            outcome: 'success',
          })
        );
      },
      run: i => {
        const verdict = verifyTrace(verifyTraces[i % verifyTraces.length]!, verifyPublicKey);
        if (!verdict.valid) throw new Error(verdict.reason ?? 'verification failed');
      },
      teardown: () => {
        verifyStorage?.close();
        cleanup(verifyDir);
      },
    },

    {
      operation: 'chain.verify',
      description: `Walk a ${chainLength}-record chain end to end: every link checked against its predecessor and every record's signature verified.`,
      // A chain walk is thousands of verifications; a handful of passes is
      // already tens of thousands of signature checks.
      iterations: Math.max(3, Math.round(iterations / 200)),
      warmup: 1,
      setup: () => {
        chainDir = scratch();
        chainStorage = new Storage(dbIn(chainDir));
        const key = new SigningKey();
        chainPublicKey = key.publicKeyPem;
        chainStore = new TraceStore(chainStorage, key);
        for (let i = 0; i < chainLength; i++) {
          chainStore.record({
            subject: SUBJECT,
            scope: ['payment:approve'],
            module: 'payments',
            action: 'approve',
            input: sampleInput(i),
            output: { approved: true },
            outcome: 'success',
          });
        }
      },
      run: () => {
        const result = chainStore!.verifyChain(chainPublicKey);
        if (!result.valid) throw new Error(result.reason ?? 'chain broken');
      },
      teardown: () => {
        chainStorage?.close();
        cleanup(chainDir);
      },
    },

    {
      operation: 'capability.issue',
      description: 'Mint a scoped, expiring HS256 capability token.',
      iterations,
      run: i => {
        issuedToken = CapabilityToken.create(
          { sub: `${SUBJECT}-${i}`, scope: ['payment:approve', 'ledger:read'], expiresIn: '15m' },
          SECRET
        ).token;
      },
    },

    {
      operation: 'capability.validate',
      description:
        'Verify a token signature, check expiry and audience, and match the requested scope segment-wise.',
      iterations,
      setup: () => {
        issuedToken = CapabilityToken.create(
          { sub: SUBJECT, scope: ['payment:approve', 'ledger:read'], expiresIn: '15m' },
          SECRET
        ).token;
      },
      run: () => {
        const result = CapabilityToken.validate(issuedToken, SECRET, { requiredScope: 'payment:approve' });
        if (!result.valid) throw new Error(result.error ?? 'validation failed');
      },
    },

    {
      operation: 'explain.render',
      description:
        'Derive the plain-language explanation of a verified record from its signed fields and render it as text. No model involved.',
      iterations,
      setup: () => {
        explainDir = scratch();
        explainStorage = new Storage(dbIn(explainDir));
        const key = new SigningKey();
        explainKey = key.publicKeyPem;
        explainTarget = new TraceStore(explainStorage, key).record({
          subject: SUBJECT,
          scope: ['payment:approve'],
          module: 'payments',
          action: 'approve',
          input: sampleInput(1),
          output: { approved: true },
          outcome: 'success',
          steps: [
            { seq: 1, name: 'load_invoice', at: new Date().toISOString() },
            { seq: 2, name: 'check_limit', at: new Date().toISOString() },
          ],
        });
      },
      run: () => {
        const text = renderExplanation(explainTrace(explainTarget!, verifyTrace(explainTarget!, explainKey)));
        if (text.length === 0) throw new Error('empty explanation');
      },
      teardown: () => {
        explainStorage?.close();
        cleanup(explainDir);
      },
    },
  ];
}

/** Run the suite and return a report whose every number was measured here. */
export async function runCoreSuite(options: CoreSuiteOptions = {}): Promise<BenchReport> {
  return measureSuite(coreSuiteSpecs(options), {
    ...(options.commit ? { commit: options.commit } : {}),
    ...(options.includeHost ? { includeHost: options.includeHost } : {}),
    reproduce: 'pnpm bench:core',
  });
}
