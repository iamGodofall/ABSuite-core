#!/usr/bin/env node
/**
 * The two-minute demo, as a program rather than a description of one.
 *
 * ROADMAP calls this the entire marketing budget, and it is one sequence:
 * record an action, verify it, alter one byte, watch the chain name the exact
 * record that broke. Everything else this project does is downstream of a
 * stranger believing that last step.
 *
 * ## Why it is a script and not a video
 *
 * A video is a claim about what happened on somebody else's machine. This runs
 * on yours, in about fifteen seconds, and needs no services, no Docker, no
 * account and no network — an in-memory database and the same Ed25519 code path
 * a production record takes. Watching it is the demo; recording it is a
 * screen capture of a terminal.
 *
 * ## What is real and what is invented
 *
 * Every signature is real, every hash is real, the chain is real, and the
 * tamper detection is the ordinary `verifyChain` a deployment runs. The
 * business events — an invoicing agent, a batch, an amount — are invented, the
 * way the contents of any demonstration are invented.
 *
 * That distinction is the point rather than a hedge: **a signature over
 * fictional content is a real signature.** The claim was never "these events
 * occurred". It is "whatever was recorded cannot be altered without detection",
 * and that claim is exercised here in full.
 *
 *   pnpm demo              # paced for watching, and for recording
 *   pnpm demo --fast       # no pauses, for CI and for the impatient
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { Storage, TraceStore, SigningKey, verifyTrace } = require(join(root, 'packages/capkit/dist/index.js'));

const FAST = process.argv.includes('--fast');
const wait = (ms) => new Promise(resolve => setTimeout(resolve, FAST ? 0 : ms));

/* Colour, but never as the carrier of meaning — every state is also a word. */
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[38;2;0;245;140m${s}\x1b[0m`,
  red: (s) => `\x1b[38;2;239;68;68m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  mono: (s) => `\x1b[38;5;245m${s}\x1b[0m`,
};

const line = (text = '') => console.log(text);
const beat = async (n, title) => {
  await wait(700);
  line();
  line(c.dim(`──  ${n}  ${'─'.repeat(62)}`));
  line(c.bold(title));
  line();
  await wait(400);
};

async function main() {
  line();
  line(c.bold('  ABSuite — what your agents actually did, provable by a stranger'));
  line(c.dim('  No services, no Docker, no network. Real Ed25519 the whole way.'));
  await wait(900);

  /* ── 1 ─────────────────────────────────────────────────────────────────── */
  await beat(1, 'Record what an agent did');

  const storage = new Storage(':memory:');
  const { key, publicKeyPem } = SigningKey.createPair();
  const traces = new TraceStore(storage, key);

  const actions = [
    { subject: 'agent:invoicing', module: 'payments', action: 'approve_batch',
      input: { batch: 'BATCH-8891', total: 250000 }, outcome: 'success' },
    { subject: 'agent:support',   module: 'email',    action: 'send_reply',
      input: { ticket: 'T-4417' }, outcome: 'success' },
    { subject: 'agent:deploy',    module: 'ci',       action: 'promote_release',
      input: { sha: 'a1b9f04' }, outcome: 'success' },
  ];

  const recorded = [];
  for (const a of actions) {
    const trace = traces.record({ ...a, scope: ['payment:approve'], output: { ok: true } });
    recorded.push(trace);
    line(`  ${c.green('recorded')}  ${a.subject.padEnd(17)} ${a.module}.${a.action}`);
    line(`            ${c.mono(trace.hash.slice(0, 48) + '…')}`);
    await wait(500);
  }

  await wait(400);
  line();
  line(c.dim('  Inputs were hashed and dropped. The record proves what was processed'));
  line(c.dim('  without being a copy of it.'));

  /* ── 2 ─────────────────────────────────────────────────────────────────── */
  await beat(2, 'Verify it — holding nothing but a public key');

  const verdict = verifyTrace(recorded[0], publicKeyPem);
  line(`  ${'content matches its hash'.padEnd(26)} ${verdict.contentIntact ? c.green('yes') : c.red('no')}`);
  await wait(350);
  line(`  ${'signature verifies'.padEnd(26)} ${verdict.signatureValid ? c.green('yes') : c.red('no')}`);
  await wait(350);
  const chain = traces.verifyChain(publicKeyPem);
  line(`  ${`chain of ${chain.checked} records`.padEnd(26)} ${chain.valid ? c.green('intact') : c.red('broken')}`);
  await wait(500);
  line();
  line(c.dim('  Ed25519, not a shared secret. Whoever checks this cannot also forge it —'));
  line(c.dim('  which is what makes an auditor independent rather than trusted.'));

  /* ── 3 ─────────────────────────────────────────────────────────────────── */
  await beat(3, 'Now alter one byte');

  line(c.dim('  Straight into the database, the way an intruder or a careless script'));
  line(c.dim('  would. Nothing goes through the API.'));
  await wait(700);
  line();
  line(`  ${c.mono("UPDATE executions SET action = 'approve_batch_v2' WHERE seq = 2")}`);
  storage.run("UPDATE executions SET action = 'approve_batch_v2' WHERE seq = 2");
  await wait(900);

  /* ── 4 ─────────────────────────────────────────────────────────────────── */
  await beat(4, 'The chain names the record that broke');

  const broken = traces.verifyChain(publicKeyPem);
  line(`  chain            ${broken.valid ? c.green('intact') : c.red('BROKEN')}`);
  await wait(400);
  line(`  first bad record ${c.red('#' + broken.brokenAt)}`);
  await wait(400);
  line(`  id               ${c.mono(broken.brokenId ?? '—')}`);
  await wait(400);
  line(`  reason           ${broken.reason}`);
  await wait(400);
  line(`  content intact   ${broken.contentIntact === false ? c.red('no — the record was edited') : c.dim(String(broken.contentIntact))}`);
  await wait(700);

  line();
  line(c.dim('  Not "something looks wrong". The sequence number, the id, and whether'));
  line(c.dim('  the edit was to the content or to the signature — because a rotated key'));
  line(c.dim('  and an intrusion must never arrive in the same words.'));

  /* ── close ─────────────────────────────────────────────────────────────── */
  await wait(900);
  line();
  line(c.dim('  ' + '─'.repeat(68)));
  line();
  line(`  ${c.bold('Everything above is reproducible.')} No fixture, no mock, no recorded output.`);
  line(`  ${c.dim('npm install @absuitecore/capkit')}`);
  line();
  line(c.dim('  The events were invented. The signatures over them were not — which is'));
  line(c.dim('  the only claim this product has ever made.'));
  line();

  /*
   * The demo asserts its own result. A demonstration that printed a reassuring
   * story while the code underneath had stopped working would be the exact
   * thing this project exists to refuse, and it is the failure mode nobody
   * notices — because a demo is watched, not tested.
   */
  if (chain.valid !== true || broken.valid !== false || broken.brokenAt !== 2) {
    console.error(c.red('\n  This demo did not do what it just claimed. That is a defect in ABSuite.'));
    console.error(c.red(`  expected: intact then broken at 2 — got ${chain.valid} then ${broken.valid} at ${broken.brokenAt}\n`));
    process.exit(1);
  }
}

main().catch(error => {
  console.error(`\n  The demo failed to run: ${error.message}\n`);
  process.exit(1);
});
