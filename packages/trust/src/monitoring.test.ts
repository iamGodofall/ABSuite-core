import { Storage } from '@absuitecore/capkit';
import { InteractionMonitor } from './monitoring';

function monitor(options = {}): InteractionMonitor {
  return new InteractionMonitor(new Storage(''), options);
}

describe('recording interactions', () => {
  test('derives depth from the chain rather than trusting the caller', () => {
    const m = monitor();
    m.record({ chainId: 'c1', sourceAgent: 'root', targetAgent: 'a', kind: 'invoke' });
    const second = m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'delegate' });
    const third = m.record({ chainId: 'c1', sourceAgent: 'b', targetAgent: 'c', kind: 'delegate' });

    expect(second.depth).toBe(1);
    expect(third.depth).toBe(2);
  });

  test('stores a payload hash, never the payload', () => {
    const m = monitor();
    const interaction = m.record({
      chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke', payloadHash: 'abc123',
    });

    expect(interaction.payloadHash).toBe('abc123');
    expect(JSON.stringify(interaction)).not.toContain('payload"');
  });
});

describe('anomaly detection', () => {
  test('finds a cycle in the call graph', () => {
    const m = monitor();
    m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke' });
    m.record({ chainId: 'c1', sourceAgent: 'b', targetAgent: 'c', kind: 'delegate' });
    m.record({ chainId: 'c1', sourceAgent: 'c', targetAgent: 'a', kind: 'delegate' });

    const summary = m.summarise('c1')!;
    const cycle = summary.anomalies.find(a => a.kind === 'cycle');

    expect(cycle).toBeDefined();
    expect(cycle!.severity).toBe('critical');
  });

  test('finds a self-loop', () => {
    const m = monitor();
    m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'a', kind: 'invoke' });

    expect(m.summarise('c1')!.anomalies.some(a => a.kind === 'cycle')).toBe(true);
  });

  test('a straight chain has no cycle', () => {
    const m = monitor();
    m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke' });
    m.record({ chainId: 'c1', sourceAgent: 'b', targetAgent: 'c', kind: 'delegate' });
    m.record({ chainId: 'c1', sourceAgent: 'c', targetAgent: 'd', kind: 'respond' });

    expect(m.summarise('c1')!.anomalies.some(a => a.kind === 'cycle')).toBe(false);
  });

  test('flags excessive depth', () => {
    const m = monitor({ maxDepth: 3 });
    const agents = ['root', 'a', 'b', 'c', 'd', 'e', 'f'];
    for (let i = 0; i < agents.length - 1; i++) {
      m.record({ chainId: 'c1', sourceAgent: agents[i]!, targetAgent: agents[i + 1]!, kind: 'delegate' });
    }

    expect(m.summarise('c1')!.anomalies.some(a => a.kind === 'excessive_depth')).toBe(true);
  });

  test('flags a runaway fan-out', () => {
    const m = monitor({ maxFanOut: 5 });
    for (let i = 0; i < 10; i++) {
      m.record({ chainId: 'c1', sourceAgent: 'busy', targetAgent: `t${i}`, kind: 'invoke' });
    }

    const anomaly = m.summarise('c1')!.anomalies.find(a => a.kind === 'fan_out');
    expect(anomaly).toBeDefined();
    expect(anomaly!.agents).toEqual(['busy']);
  });

  test('flags a stalled chain that never responded', () => {
    const m = monitor({ stalledAfterMs: 1000 });
    m.record({
      chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke',
      at: new Date(Date.now() - 3_600_000).toISOString(),
    });

    expect(m.summarise('c1')!.anomalies.some(a => a.kind === 'stalled')).toBe(true);
  });

  test('a completed chain is never stalled', () => {
    const m = monitor({ stalledAfterMs: 1000 });
    const old = new Date(Date.now() - 3_600_000).toISOString();
    m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke', at: old });
    m.record({ chainId: 'c1', sourceAgent: 'b', targetAgent: 'a', kind: 'respond', at: old });

    expect(m.summarise('c1')!.anomalies.some(a => a.kind === 'stalled')).toBe(false);
  });

  test('an unknown chain summarises to nothing rather than throwing', () => {
    expect(monitor().summarise('nope')).toBeUndefined();
  });
});

describe('observations', () => {
  test('an observation requires a reason', () => {
    const m = monitor();
    const interaction = m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke' });

    expect(() => m.observe({
      interactionId: interaction.id, observerAgent: 'watcher', verdict: 'violation', reason: '  ', confidence: 1,
    })).toThrow(/reason/i);
  });

  test('cannot observe an interaction that does not exist', () => {
    expect(() => monitor().observe({
      interactionId: 'nope', observerAgent: 'watcher', verdict: 'ok', reason: 'fine', confidence: 1,
    })).toThrow(/No such interaction/);
  });

  test('confidence is clamped to 0-1', () => {
    const m = monitor();
    const interaction = m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke' });

    const observation = m.observe({
      interactionId: interaction.id, observerAgent: 'w', verdict: 'ok', reason: 'looks fine', confidence: 99,
    });
    expect(observation.confidence).toBe(1);
  });

  test('disagreement between observers is surfaced, not resolved', () => {
    const m = monitor();
    const interaction = m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke' });

    m.observe({ interactionId: interaction.id, observerAgent: 'w1', verdict: 'ok', reason: 'within scope', confidence: 0.9 });
    m.observe({ interactionId: interaction.id, observerAgent: 'w2', verdict: 'violation', reason: 'exceeded scope', confidence: 0.8 });
    m.observe({ interactionId: interaction.id, observerAgent: 'w3', verdict: 'ok', reason: 'within scope', confidence: 0.7 });

    const anomaly = m.summarise('c1')!.anomalies.find(a => a.kind === 'observer_disagreement');

    // A majority vote would silently call this "ok" 2-1 and discard the only
    // interesting signal in the chain.
    expect(anomaly).toBeDefined();
    expect(anomaly!.detail).toContain('needs a human');
    expect(anomaly!.agents).toHaveLength(3);
  });

  test('observers that agree raise nothing', () => {
    const m = monitor();
    const interaction = m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke' });

    m.observe({ interactionId: interaction.id, observerAgent: 'w1', verdict: 'ok', reason: 'fine', confidence: 1 });
    m.observe({ interactionId: interaction.id, observerAgent: 'w2', verdict: 'ok', reason: 'fine', confidence: 1 });

    expect(m.summarise('c1')!.anomalies.some(a => a.kind === 'observer_disagreement')).toBe(false);
  });
});

describe('chain summary', () => {
  test('reports where claims entered the chain', () => {
    const m = monitor();
    m.record({ chainId: 'c1', sourceAgent: 'root', targetAgent: 'researcher', kind: 'invoke', introducedClaim: true });
    m.record({ chainId: 'c1', sourceAgent: 'researcher', targetAgent: 'summariser', kind: 'handoff' });

    // Blame belongs at the origin, not with the last agent to repeat it.
    expect(m.summarise('c1')!.claimOrigins).toEqual(['researcher']);
  });

  test('scan aggregates anomalies across chains', () => {
    const m = monitor();
    m.record({ chainId: 'c1', sourceAgent: 'a', targetAgent: 'a', kind: 'invoke' });
    m.record({ chainId: 'c2', sourceAgent: 'x', targetAgent: 'y', kind: 'invoke' });
    m.record({ chainId: 'c2', sourceAgent: 'y', targetAgent: 'x', kind: 'delegate' });

    expect(m.scan().filter(a => a.kind === 'cycle')).toHaveLength(2);
  });

  test('lists chains newest first', () => {
    const m = monitor();
    m.record({ chainId: 'old', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke', at: '2026-01-01T00:00:00.000Z' });
    m.record({ chainId: 'new', sourceAgent: 'a', targetAgent: 'b', kind: 'invoke', at: '2026-06-01T00:00:00.000Z' });

    expect(m.chains()[0]).toBe('new');
  });
});
