#!/usr/bin/env node
/**
 * "Our AI agent approved $250,000 of transactions at 2:14 AM. What happened?"
 *
 * That question is the reason this project exists, and answering it is worth
 * more than any feature list. Below is the whole investigation, start to
 * finish, using only published packages.
 *
 *   npm install @absuitecore/capkit@^1.1.0 @absuitecore/trust@^1.1.0
 *   node incident-forensics.mjs
 *
 * Nothing here is mocked. The signatures are real Ed25519 signatures, the
 * chain is really hash-linked, and the tamper detection really fails when the
 * record is edited.
 */
import { SigningKey, TraceStore, Storage, verifyTrace, CapabilityToken } from '@absuitecore/capkit';
import { TrustEventStore, evidenceRecord, verifyOutput, renderReport } from '@absuitecore/trust';

const line = (t) => console.log(`\n\x1b[1m${t}\x1b[0m\n${'─'.repeat(t.length)}`);

// ── The setup ────────────────────────────────────────────────────────────────
// One signing key, one store. In production the key lives in your secret
// manager and the store is a file on a volume you back up.
const { key, publicKeyPem } = SigningKey.createPair();
const storage = new Storage('');
const traces = new TraceStore(storage, key);
const events = new TrustEventStore(storage);

const SECRET = process.env.CAPKIT_HMAC_SECRET || 'x'.repeat(48);

line('02:14 — the agent acts');

// The agent was issued a capability token. Note what it is *not* allowed to do.
const { token, jti } = CapabilityToken.create(
  { sub: 'agent:invoicing', scope: ['payment:approve'], expiresIn: '1h' },
  SECRET
);
console.log(`Token ${jti} issued to agent:invoicing with scope payment:approve`);

// Every real action produces a signed, hash-chained trace.
const approval = traces.record({
  subject: 'agent:invoicing',
  jti,
  scope: ['payment:approve'],
  module: 'payments',
  action: 'approve_batch',
  // Payloads are hashed on the way in and dropped. The record proves what was
  // processed without becoming a copy of your customers' data.
  input: { batch: 'BATCH-8891', total: 250000, currency: 'USD', count: 47 },
  output: { approved: true, reference: 'PAY-2214-8891' },
  outcome: 'success',
  startedAt: new Date('2026-07-29T02:14:03Z').toISOString(),
  steps: [
    { seq: 1, name: 'load_batch', at: new Date('2026-07-29T02:14:03Z').toISOString() },
    { seq: 2, name: 'check_policy_limit', at: new Date('2026-07-29T02:14:04Z').toISOString() },
    { seq: 3, name: 'approve', at: new Date('2026-07-29T02:14:05Z').toISOString() },
  ],
});
console.log(`Trace  ${approval.id} recorded and signed`);

line('09:00 — someone notices');

// Question 1: did this actually happen, or is the log fabricated?
const verdict = verifyTrace(approval, publicKeyPem);
console.log(`Signature valid?            ${verdict.valid}`);
console.log(`Chain intact?               ${traces.verifyChain(publicKeyPem).valid}`);

// Question 2: what was the agent *permitted* to do?
const allowed = CapabilityToken.validate(token, SECRET, { requiredScope: 'payment:approve' });
const refunds = CapabilityToken.validate(token, SECRET, { requiredScope: 'payment:refund' });
console.log(`Was approval authorised?    ${allowed.valid}`);
console.log(`Could it have refunded?     ${refunds.valid} (${refunds.valid ? '' : refunds.error})`);

// Question 3: what did it claim, and was any of it backed by evidence?
line('The agent\'s written justification');

const justification =
  'The CEO approved this batch. Total exposure is $250,000 across 47 invoices, ' +
  'all under the $300,000 limit set in the Q3 policy.';

const sources = [
  'Q3 payments policy: automated approval is permitted up to $300,000 per batch. ' +
  'Batches above $100,000 require a named human approver recorded in the ticket.',
];

console.log(renderReport(verifyOutput(justification, sources)));

line('What the record shows about this agent');

// Facts, not a score. Counts you can check line by line.
events.record({ subjectId: 'agent:invoicing', subjectType: 'agent', kind: 'execution_success', evidenceRef: approval.id });
events.record({ subjectId: 'agent:invoicing', subjectType: 'agent', kind: 'unsupported_claim', evidenceRef: approval.id,
  note: 'Claimed CEO approval with nothing to support it' });

const record = evidenceRecord('agent:invoicing', 'agent', events.forSubject('agent:invoicing'));
console.log(`Events recorded             ${record.eventsRecorded}`);
console.log(`Policy violations           ${record.policyViolations}`);
console.log(`Audit findings              ${record.auditFindings}`);

line('Could someone have quietly edited the log?');

// Tamper with the stored record and re-verify. This is the guarantee.
storage.run("UPDATE executions SET input_hash = 'forged' WHERE id = ?", approval.id);
const after = traces.verifyChain(publicKeyPem);
console.log(`Chain intact after edit?    ${after.valid}`);
if (!after.valid) console.log(`First broken record:        sequence ${after.brokenAt}`);

line('The answer');

// Read this against the report printed above. An earlier draft of these
// closing lines claimed the $250,000 figure was "supported by the policy"
// while the tool was printing `missing: $250,000` three inches higher up.
// A demo for an evidence product must not contain an unsupported claim.
console.log(`The approval is cryptographically proven to have happened, by
agent:invoicing, at ${approval.startedAt}, within a capability that
permitted approvals and not refunds. Editing the stored record broke the
chain immediately and named the offending sequence number.

Of the agent's justification: the $300,000 limit traces to the policy. The
$250,000 batch total does not — it came from the batch data, which was never
supplied as a source, so it is UNVERIFIED rather than wrong. And the claim
that the CEO approved it has nothing behind it at all, while the policy
required a named human approver above $100,000.

So the agent did not exceed its permissions. It exceeded its evidence.

That distinction took five minutes rather than two days, and every line of
it is checkable by someone who has no reason to trust you.`);
