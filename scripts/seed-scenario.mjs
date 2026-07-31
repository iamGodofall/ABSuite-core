#!/usr/bin/env node
/**
 * A working day, recorded properly, so an empty instance has something to show.
 *
 * The interface reports ABSENT for everything until records exist, which is
 * correct and is also the worst possible first impression: someone evaluating
 * this product sees a beautifully honest report that nothing has happened. The
 * two ways out of that are to fake data or to make real data easy. This is the
 * second one.
 *
 * WHAT IS REAL: every trace here is signed with the instance's own Ed25519 key,
 * hash-chained to the one before it, and verifiable by the same routes and the
 * same `verifyChain` a production record goes through. Nothing is inserted
 * behind the API. If you tamper with one of these afterwards, the chain reports
 * it, naming the sequence number — because they are ordinary records.
 *
 * WHAT IS FICTIONAL: the business events. There is no BATCH-8891 and no
 * customer. The subjects, modules and amounts are invented, the way the
 * contents of any demonstration are invented.
 *
 * That distinction is the whole point, and it is not a fudge: a signature over
 * fictional content is a real signature. The product's claim was never "these
 * events occurred" — it is "whatever was recorded cannot be altered without
 * detection", and that claim is fully exercised here.
 *
 * Steps carry real timestamps, seconds apart, because the timeline in the
 * interface reads them and a record with no steps has nothing to show.
 *
 *   node scripts/seed-scenario.mjs                  # into ABSUITE_DB_PATH
 *   node scripts/seed-scenario.mjs --clear          # start from empty first
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { TraceStore, getStorage, SigningKey } = require('../packages/capkit/dist/index.js');

const key = new SigningKey(process.env.CAPKIT_TRACE_PRIVATE_KEY, process.env.CAPKIT_TRACE_KEY_ID);
const storage = getStorage();
const traces = new TraceStore(storage, key);

if (key.ephemeral) {
  console.warn(
    'CAPKIT_TRACE_PRIVATE_KEY is not set, so these records are signed with a key that dies\n' +
    'with this process. They will verify now and fail after a restart. Fine for a look,\n' +
    'wrong for anything you intend to keep.\n',
  );
}

/** A fixed morning, so runs are comparable and the timeline is legible. */
const T0 = Date.parse('2026-07-30T08:14:00Z');
const at = (offsetSeconds) => new Date(T0 + offsetSeconds * 1000).toISOString();

/**
 * Nine actions across four agents.
 *
 * Deliberately not all successful and not all tidy: one payment fails on a
 * limit, one action is recorded without a scope, and one runs with no steps at
 * all. An instance where everything is green teaches nothing about how the
 * interface reports trouble, and trouble is what it is for.
 */
const DAY = [
  {
    subject: 'agent:invoicing', scope: ['payment:approve'], module: 'payments',
    action: 'approve_batch', outcome: 'success', offset: 0,
    input: { batch: 'BATCH-8891', total: 250000, currency: 'USD', count: 47 },
    output: { approved: true, reference: 'PAY-2214-8891' },
    steps: ['load_batch', 'check_policy_limit', 'verify_counterparty', 'approve'],
  },
  {
    subject: 'agent:invoicing', scope: ['payment:approve'], module: 'payments',
    action: 'approve_batch', outcome: 'success', offset: 96,
    input: { batch: 'BATCH-8892', total: 18400, currency: 'USD', count: 6 },
    output: { approved: true, reference: 'PAY-2214-8892' },
    steps: ['load_batch', 'check_policy_limit', 'approve'],
  },
  {
    // Refused at the limit. The record of a refusal is as important as the
    // record of an action, and is the thing most systems never keep.
    subject: 'agent:invoicing', scope: ['payment:approve'], module: 'payments',
    action: 'approve_batch', outcome: 'failure', offset: 214,
    input: { batch: 'BATCH-8893', total: 4100000, currency: 'USD', count: 1 },
    output: { approved: false, reason: 'exceeds_single_batch_limit' },
    steps: ['load_batch', 'check_policy_limit', 'refuse'],
  },
  {
    subject: 'agent:support', scope: ['crm:write'], module: 'crm',
    action: 'update_contact', outcome: 'success', offset: 331,
    input: { contactId: 'C-55021', fields: ['email', 'timezone'] },
    output: { updated: true },
    steps: ['fetch_contact', 'apply_changes', 'write'],
  },
  {
    subject: 'agent:support', scope: ['crm:write', 'crm:read'], module: 'crm',
    action: 'merge_duplicates', outcome: 'success', offset: 402,
    input: { primary: 'C-55021', merged: ['C-55044', 'C-55098'] },
    output: { merged: 2 },
    steps: ['scan_candidates', 'score_similarity', 'merge', 'reindex'],
  },
  {
    subject: 'agent:research', scope: ['search:read'], module: 'search',
    action: 'web_query', outcome: 'success', offset: 505,
    input: { query: 'supplier insolvency filings Q3' },
    output: { results: 12 },
    steps: ['plan_query', 'fetch', 'rank'],
  },
  {
    // No scope recorded. Govern reports this as unscoped rather than hiding it,
    // which is what the "N UNSCOPED" reading in the masthead is counting.
    subject: 'agent:research', scope: [], module: 'search',
    action: 'summarise_findings', outcome: 'success', offset: 588,
    input: { documents: 12 },
    output: { summary: 'sha256-only' },
    steps: ['collect', 'summarise'],
  },
  {
    // No steps. A record can be honest and still be thin, and the timeline
    // says so rather than inventing a shape for it.
    subject: 'agent:reconciler', scope: ['ledger:read'], module: 'ledger',
    action: 'daily_reconcile', outcome: 'success', offset: 702,
    input: { day: '2026-07-29' },
    output: { discrepancies: 0 },
    steps: [],
  },
  {
    subject: 'agent:reconciler', scope: ['ledger:read', 'ledger:flag'], module: 'ledger',
    action: 'flag_variance', outcome: 'success', offset: 771,
    input: { account: 'ACC-3391', variance: 118.4 },
    output: { flagged: true, ticket: 'REC-8812' },
    steps: ['load_ledger', 'compare', 'flag'],
  },
];

if (process.argv.includes('--clear')) {
  // Only the executions table, and only when asked. Clearing a record store is
  // not something to do as a side effect of seeding one.
  storage.db.prepare('DELETE FROM executions').run();
  console.log('Cleared existing executions.\n');
}

let n = 0;
for (const act of DAY) {
  traces.record({
    subject: act.subject,
    scope: act.scope,
    module: act.module,
    action: act.action,
    outcome: act.outcome,
    input: act.input,
    output: act.output,
    startedAt: at(act.offset),
    // Steps land a few seconds apart, so the gaps between them are real
    // intervals a timeline can show rather than evenly spaced decoration.
    steps: act.steps.map((name, i) => ({ seq: i + 1, name, at: at(act.offset + i * 3 + 1) })),
  });
  n += 1;
}

const chain = traces.verifyChain(key.publicKeyPem);
console.log(`Recorded ${n} signed executions across 4 agents.`);
console.log(`  outcomes  : ${DAY.filter(a => a.outcome === 'success').length} success, ${DAY.filter(a => a.outcome === 'failure').length} failure`);
console.log(`  unscoped  : ${DAY.filter(a => a.scope.length === 0).length}`);
console.log(`  steps      : ${DAY.reduce((t, a) => t + a.steps.length, 0)} across ${DAY.filter(a => a.steps.length).length} records`);
console.log(`  chain     : ${chain.valid ? 'valid' : 'BROKEN'}, ${chain.checked} verified`);
console.log(`\nThe events are fictional. The signatures are not — edit any record and the chain names it.`);
