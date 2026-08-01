import { createHash } from 'node:crypto';
import { Storage } from './storage';
import { TraceStore, SigningKey } from './trace';
import { ApprovalRegistry } from './approval';
import { Watch } from './watch';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const fresh = (options: Record<string, unknown> = {}) => {
  const key = new SigningKey();
  const storage = new Storage(':memory:');
  const traces = new TraceStore(storage, key);
  const approvals = new ApprovalRegistry(storage);
  const watch = new Watch(storage, traces, approvals, { publicKeyPem: key.publicKeyPem, ...options });
  return { key, storage, traces, approvals, watch };
};

const run = (traces: TraceStore, over: Record<string, unknown> = {}) =>
  traces.record({
    subject: 'agent:invoicing',
    jti: 'tok_1',
    scope: ['payment:approve'],
    module: 'payments',
    action: 'refund',
    input: { amount: 1000 },
    outcome: 'success',
    ...over,
  } as never);

describe('a watch that has never run', () => {
  /**
   * The reason this class exists.
   *
   * An empty list of notices from a monitor that never started looks exactly
   * like an empty list from one that swept a clean record a minute ago. The
   * second is reassuring; the first is the most dangerous state a monitoring
   * system can be in, because the system looks watched and is not.
   */
  test('says so, rather than showing an empty list', () => {
    const { watch } = fresh();

    expect(watch.notices()).toEqual([]);
    const coverage = watch.coverage();
    expect(coverage.everRun).toBe(false);
    expect(coverage.sweeps).toBe(0);
    expect(coverage.because).toMatch(/never run/);
    expect(coverage.because).toMatch(/not the same as nothing being wrong/);
  });

  test('a clean sweep says something different from a sweep that never happened', () => {
    const { watch } = fresh();
    watch.sweep();

    const coverage = watch.coverage();
    expect(coverage.everRun).toBe(true);
    expect(coverage.because).toMatch(/found none — not that the system is well/);
  });

  test('records held above the high-water mark are reported as not yet covered', () => {
    const { traces, watch } = fresh({ batchSize: 1 });
    run(traces, { input: { a: 1 } });
    run(traces, { input: { a: 2 } });
    run(traces, { input: { a: 3 } });

    watch.sweep();
    const coverage = watch.coverage();

    expect(coverage.highWaterSeq).toBe(1);
    expect(coverage.behind).toBe(2);
    expect(coverage.because).toMatch(/2 record\(s\) held have not been examined/);
  });

  test('a sweep that throws is reported, not swallowed', () => {
    const { storage, watch } = fresh();
    storage.run(
      'INSERT INTO watch_state (id, sweeps, high_water_seq, last_sweep_read, last_sweep_failed) VALUES (?,?,?,?,?)',
      'watch', 3, 0, 0, 'database is locked'
    );

    const coverage = watch.coverage();
    expect(coverage.lastSweepFailed).toBe('database is locked');
    expect(coverage.because).toMatch(/The last sweep failed: database is locked/);
    expect(coverage.because).toMatch(/the record has moved on since/);
  });
});

describe('what a sweep raises', () => {
  test('a policy that said no, and an action that succeeded anyway', () => {
    const { traces, watch } = fresh();
    run(traces, {
      governance: {
        policyRef: 'finance.refunds.max-10000', policyVersion: '3',
        decision: 'DENIED', evidence: ['amount exceeds the limit'],
      },
    });

    const result = watch.sweep();
    const notice = result.raised.find(n => n.kind === 'DENIED_BUT_SUCCEEDED')!;

    expect(notice).toBeDefined();
    expect(notice.finding).toMatch(/something went around it/);
    expect(notice.from).toBe('governance.decision, outcome');
    expect(notice.subject).toBe('agent:invoicing');
  });

  test('a policy that demanded a person, and a record with nobody behind it', () => {
    const { traces, watch } = fresh();
    run(traces, {
      governance: {
        policyRef: 'finance.refunds.max-10000', policyVersion: '3',
        decision: 'REQUIRES_APPROVAL', evidence: ['amount exceeds the automatic limit'],
      },
    });

    const notice = watch.sweep().raised.find(n => n.kind === 'UNAPPROVED_EXECUTION')!;
    expect(notice).toBeDefined();
    expect(notice.finding).toMatch(/required a person to decide before payments\.refund ran/);
    expect(notice.from).toMatch(/approval record/);
  });

  test('an approved execution raises nothing', () => {
    const { traces, approvals, watch } = fresh();
    const input = { amount: 1000 };
    const inputHash = sha256(JSON.stringify(input));

    const request = approvals.request({
      action: { subject: 'agent:invoicing', module: 'payments', action: 'refund', inputHash },
      context: 'Refund R10.00.',
      policyRef: 'finance.refunds.max-10000', policyVersion: '3',
      requestedBy: 'agent:invoicing',
    });
    approvals.decide(request.id, { decision: 'GRANTED', decidedBy: 'alice', basis: 'confirmed' });

    const trace = run(traces, {
      input,
      governance: {
        policyRef: 'finance.refunds.max-10000', policyVersion: '3',
        decision: 'REQUIRES_APPROVAL', evidence: ['amount exceeds the automatic limit'],
      },
    });
    approvals.consume(request.id, trace.id);

    expect(watch.sweep().raised.filter(n => n.kind === 'UNAPPROVED_EXECUTION')).toHaveLength(0);
  });

  test('an execution carrying no authority at all', () => {
    const { traces, watch } = fresh();
    run(traces, { scope: [] });

    const notice = watch.sweep().raised.find(n => n.kind === 'NO_RECORDED_AUTHORITY')!;
    expect(notice).toBeDefined();
    // The distinction the whole product turns on: absent evidence is not
    // contrary evidence, and the wording must not blur them.
    expect(notice.finding).toMatch(/not proof it was unauthorised/);
  });

  test('an approval request nobody answered', async () => {
    const { approvals, watch } = fresh();
    approvals.request({
      action: { subject: 'agent:invoicing', module: 'payments', action: 'refund', inputHash: sha256('x') },
      context: 'Refund R10.00 to customer 4471.',
      policyRef: 'finance.refunds.max-10000', policyVersion: '3',
      requestedBy: 'agent:invoicing',
      ttlMs: 20,
    });

    await new Promise(resolve => setTimeout(resolve, 40));

    const notice = watch.sweep().raised.find(n => n.kind === 'APPROVAL_LAPSED')!;
    // Nothing ran, which is precisely why nobody would have noticed.
    expect(notice).toBeDefined();
    expect(notice.finding).toMatch(/lapsed at .* with nobody deciding/);
    expect(notice.finding).toMatch(/Refund R10\.00 to customer 4471/);
  });

  test('a signing key that dies with the process', () => {
    const { watch } = fresh({ signingKeyEphemeral: true });
    const notice = watch.sweep().raised.find(n => n.kind === 'EPHEMERAL_SIGNING_KEY')!;

    expect(notice).toBeDefined();
    expect(notice.finding).toMatch(/keep looking valid until somebody checks/);
  });

  test('a broken chain is raised, and says the rest rests on it', () => {
    const { storage, traces, watch } = fresh();
    run(traces);
    run(traces, { input: { amount: 2000 } });
    // Rewrite a record's content without touching its hash — internally
    // contradictory, which is exactly what verifyChain is for.
    storage.run('UPDATE executions SET input_hash = ? WHERE seq = 1', sha256('tampered'));

    const notice = watch.sweep().raised.find(n => n.kind === 'CHAIN_BROKEN')!;
    expect(notice).toBeDefined();
    expect(notice.finding).toMatch(/every other finding below rests on records whose order is in question/);
  });

  test('it makes no claim it cannot support — no severity, no incident, no score', () => {
    const { traces, watch } = fresh();
    run(traces, { scope: [], governance: {
      policyRef: 'p', policyVersion: '1', decision: 'DENIED', evidence: ['no'],
    } });

    const text = JSON.stringify(watch.sweep());
    expect(text).not.toMatch(/\bincident\b|\bseverity\b|\bcritical\b|\bscore\b/i);
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%/);
    // And nothing recommending an action, because that is a person's decision.
    expect(text).not.toMatch(/\brecommend|\bshould immediately|\bremediat/i);
  });
});

describe('a standing problem is one notice, not a thousand', () => {
  test('sweeping the same records again touches rather than duplicates', () => {
    const { traces, watch } = fresh();
    run(traces, { scope: [] });

    const first = watch.sweep();
    expect(first.raised).toHaveLength(1);

    // The high-water mark means the record is not re-read, but the chain and
    // lapsed-approval checks run every time — so the dedup has to hold anyway.
    run(traces, { scope: [] });
    const second = watch.sweep();

    expect(second.raised).toHaveLength(1);
    expect(watch.notices()).toHaveLength(2);
  });

  test('a re-seen notice increments seen rather than resetting raisedAt', async () => {
    const { watch } = fresh({ signingKeyEphemeral: true });
    const first = watch.sweep().raised[0]!;
    await new Promise(resolve => setTimeout(resolve, 5));
    const second = watch.sweep();

    expect(second.raised).toHaveLength(0);
    expect(second.reRaised).toBe(1);

    const notice = watch.notices()[0]!;
    expect(notice.seen).toBe(2);
    expect(notice.raisedAt).toBe(first.raisedAt);
    expect(notice.lastSeenAt > first.lastSeenAt).toBe(true);
  });
});

describe('acknowledging', () => {
  test('takes a name and a reason, and keeps both', () => {
    const { traces, watch } = fresh();
    run(traces, { scope: [] });
    const notice = watch.sweep().raised[0]!;

    const acknowledged = watch.acknowledge(notice.id, 'alice', 'Legacy importer; scope added in the next release.');
    expect(acknowledged.state).toBe('ACKNOWLEDGED');
    expect(acknowledged.acknowledgedBy).toBe('alice');
    expect(acknowledged.basis).toMatch(/Legacy importer/);

    expect(watch.notices({ state: 'OPEN' })).toHaveLength(0);
    expect(watch.notices({ state: 'ACKNOWLEDGED' })).toHaveLength(1);
  });

  test('a cleared alert with no reason is refused', () => {
    const { traces, watch } = fresh();
    run(traces, { scope: [] });
    const notice = watch.sweep().raised[0]!;

    expect(() => watch.acknowledge(notice.id, 'alice', '')).toThrow(/teaches nobody anything/);
    expect(() => watch.acknowledge(notice.id, '', 'fine')).toThrow(/takes who and why/);
    expect(() => watch.acknowledge('ntc_nope', 'alice', 'fine')).toThrow(/No notice ntc_nope/);
  });

  test('acknowledging does not delete — the history survives', () => {
    const { traces, watch } = fresh();
    run(traces, { scope: [] });
    const notice = watch.sweep().raised[0]!;
    watch.acknowledge(notice.id, 'alice', 'known');

    const kept = watch.notices()[0]!;
    expect(kept.id).toBe(notice.id);
    expect(kept.finding).toBe(notice.finding);
    expect(kept.raisedAt).toBe(notice.raisedAt);
  });

  test('an acknowledged notice whose cause persists keeps counting, and is not re-opened', () => {
    const { watch } = fresh({ signingKeyEphemeral: true });
    const notice = watch.sweep().raised[0]!;
    watch.acknowledge(notice.id, 'alice', 'staging, key is deliberately ephemeral');

    watch.sweep();
    watch.sweep();

    const after = watch.notices()[0]!;
    // Visible without overriding a decision somebody made deliberately.
    expect(after.seen).toBe(3);
    expect(after.state).toBe('ACKNOWLEDGED');
  });
});

describe('the interval is scheduling, not behaviour', () => {
  test('start and stop are idempotent and hold no process open', () => {
    const { watch } = fresh({ intervalMs: 1_000 });

    expect(watch.running).toBe(false);
    watch.start().start();
    expect(watch.running).toBe(true);
    watch.stop().stop();
    expect(watch.running).toBe(false);
  });

  test('a started watch sweeps on its own', async () => {
    const { traces, watch } = fresh({ intervalMs: 1_000 });
    run(traces, { scope: [] });

    watch.start();
    await new Promise(resolve => setTimeout(resolve, 1_200));
    watch.stop();

    expect(watch.coverage().everRun).toBe(true);
    expect(watch.notices({ state: 'OPEN' }).length).toBeGreaterThan(0);
  }, 5_000);
});
