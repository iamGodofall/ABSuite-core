import { Storage } from '@absuitecore/capkit';
import { arbitrate, ArbitrationStore, normaliseAnswer, type Dispute, type Position } from './arbitration';
import { TrustEventStore } from './events';
import { TrustScorer } from './scoring';

function dispute(positions: Position[], extra: Partial<Dispute> = {}): Dispute {
  return {
    id: 'dsp_test',
    question: 'Should we proceed?',
    positions,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

describe('answer normalisation', () => {
  test('formatting differences do not read as disagreement', () => {
    expect(normaliseAnswer('Yes.')).toBe(normaliseAnswer('  yes  '));
    expect(normaliseAnswer('No!')).toBe(normaliseAnswer('no'));
  });

  test('genuinely different answers stay different', () => {
    expect(normaliseAnswer('yes')).not.toBe(normaliseAnswer('no'));
  });
});

describe('correlated agreement', () => {
  test('five participants from one family do not outvote two independent ones', () => {
    const result = arbitrate(dispute([
      { agentId: 'a1', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'a2', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'a3', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'a4', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'a5', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'b1', answer: 'no', family: 'anthropic:claude' },
      { agentId: 'c1', answer: 'no', family: 'google:gemini' },
    ]));

    // A naive 5-2 vote says "yes" decisively. After discounting, "yes" is one
    // voice against two independent ones.
    const yes = result.tally.find(t => normaliseAnswer(t.answer) === 'yes')!;
    const no = result.tally.find(t => normaliseAnswer(t.answer) === 'no')!;
    expect(no.weight).toBeGreaterThan(yes.weight);
  });

  test('the discount is explained per participant', () => {
    const result = arbitrate(dispute([
      { agentId: 'a1', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'a2', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'b1', answer: 'no', family: 'anthropic:claude' },
    ]));

    const discounted = result.positions.filter(p => p.discounted);
    expect(discounted).toHaveLength(1);
    expect(discounted[0]!.discountReason).toContain('Shares model family');
  });

  test('participants with no declared family are treated as independent', () => {
    const result = arbitrate(dispute([
      { agentId: 'a1', answer: 'yes' },
      { agentId: 'a2', answer: 'yes' },
      { agentId: 'a3', answer: 'yes' },
    ]));

    expect(result.independentSupport).toBe(3);
    expect(result.outcome).toBe('resolved');
  });

  test('unanimity within a single family is not treated as settled', () => {
    const result = arbitrate(dispute([
      { agentId: 'a1', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'a2', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'a3', answer: 'yes', family: 'openai:gpt-4' },
    ]));

    expect(result.outcome).toBe('escalate');
    expect(result.requiresHuman).toBe(true);
    expect(result.escalationBrief).toContain('correlated');
  });
});

describe('escalation', () => {
  test('an irreversible dispute always escalates, however strong the consensus', () => {
    const result = arbitrate(dispute([
      { agentId: 'a', answer: 'delete it', family: 'openai:gpt-4' },
      { agentId: 'b', answer: 'delete it', family: 'anthropic:claude' },
      { agentId: 'c', answer: 'delete it', family: 'google:gemini' },
    ], { irreversible: true }));

    expect(result.outcome).toBe('escalate');
    expect(result.requiresHuman).toBe(true);
    expect(result.reasoning.join(' ')).toContain('cannot be undone');
  });

  test('a near-even split returns no consensus rather than picking a side', () => {
    const result = arbitrate(dispute([
      { agentId: 'a', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'b', answer: 'no', family: 'anthropic:claude' },
    ]));

    expect(result.outcome).toBe('no_consensus');
    expect(result.requiresHuman).toBe(true);
    expect(result.answer).toBeUndefined();
  });

  test('weight without independence escalates', () => {
    const result = arbitrate(dispute([
      { agentId: 'a1', answer: 'yes', family: 'openai:gpt-4', confidence: 1 },
      { agentId: 'a2', answer: 'yes', family: 'openai:gpt-4', confidence: 1 },
      { agentId: 'a3', answer: 'yes', family: 'openai:gpt-4', confidence: 1 },
      { agentId: 'b', answer: 'no', family: 'anthropic:claude', confidence: 0.1 },
    ]));

    expect(result.independentSupport).toBe(1);
    expect(result.requiresHuman).toBe(true);
  });

  test('an escalation brief is written for a human, not a machine', () => {
    const result = arbitrate(dispute([
      { agentId: 'a', answer: 'yes', family: 'openai:gpt-4', rationale: 'The invoice is past due' },
      { agentId: 'b', answer: 'no', family: 'anthropic:claude', rationale: 'The invoice was disputed' },
    ]));

    expect(result.escalationBrief).toContain('Question:');
    expect(result.escalationBrief).toContain('The invoice was disputed');
    expect(result.escalationBrief).toContain('No action has been taken');
  });

  test('an empty dispute never resolves', () => {
    const result = arbitrate(dispute([]));
    expect(result.outcome).toBe('no_consensus');
    expect(result.requiresHuman).toBe(true);
  });
});

describe('resolution', () => {
  test('a clear, independently backed majority resolves', () => {
    const result = arbitrate(dispute([
      { agentId: 'a', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'b', answer: 'yes', family: 'anthropic:claude' },
      { agentId: 'c', answer: 'yes', family: 'google:gemini' },
      { agentId: 'd', answer: 'no', family: 'meta:llama' },
    ]));

    expect(result.outcome).toBe('resolved');
    expect(normaliseAnswer(result.answer!)).toBe('yes');
    expect(result.requiresHuman).toBe(false);
  });

  test('the minority position is retained in the reasoning', () => {
    const result = arbitrate(dispute([
      { agentId: 'a', answer: 'yes', family: 'openai:gpt-4' },
      { agentId: 'b', answer: 'yes', family: 'anthropic:claude' },
      { agentId: 'c', answer: 'yes', family: 'google:gemini' },
      { agentId: 'd', answer: 'no', family: 'meta:llama' },
    ]));

    expect(result.reasoning.join(' ')).toContain('Dissent recorded');
  });

  test('self-reported confidence cannot swing an outcome on its own', () => {
    const confident = arbitrate(dispute([
      { agentId: 'a', answer: 'yes', family: 'f1', confidence: 1 },
      { agentId: 'b', answer: 'no', family: 'f2', confidence: 0 },
    ]));

    // Certainty is uncorrelated with accuracy and trivially gamed by whoever
    // writes the prompt, so a maximally confident participant must not carry a
    // one-against-one split — even though its extra weight clears the margin.
    expect(confident.margin).toBeGreaterThan(0.6);
    expect(confident.outcome).toBe('no_consensus');
    expect(confident.requiresHuman).toBe(true);
  });

  test('a leader needs more independent support than the runner-up, not just more weight', () => {
    const events = new TrustEventStore(new Storage(''));
    for (let i = 0; i < 30; i++) {
      events.record({ subjectId: 'trusted', subjectType: 'agent', kind: 'verification_passed' });
    }

    const result = arbitrate(dispute([
      { agentId: 'trusted', answer: 'yes', family: 'f1' },
      { agentId: 'unknown', answer: 'no', family: 'f2' },
    ]), { scorer: new TrustScorer(events) });

    // A strong record earns weight, but one well-behaved agent does not get to
    // overrule another single agent unopposed.
    expect(result.outcome).toBe('no_consensus');
  });

  test('is deterministic', () => {
    const positions: Position[] = [
      { agentId: 'a', answer: 'yes', family: 'f1' },
      { agentId: 'b', answer: 'yes', family: 'f2' },
      { agentId: 'c', answer: 'no', family: 'f3' },
    ];
    const now = new Date('2026-01-01T00:00:00.000Z');

    expect(arbitrate(dispute(positions), { now })).toEqual(arbitrate(dispute(positions), { now }));
  });
});

describe('trust-weighted arbitration', () => {
  test('a participant with a poor record carries less weight', () => {
    const events = new TrustEventStore(new Storage(''));
    for (let i = 0; i < 30; i++) {
      events.record({ subjectId: 'unreliable', subjectType: 'agent', kind: 'policy_violation' });
    }
    for (let i = 0; i < 30; i++) {
      events.record({ subjectId: 'reliable', subjectType: 'agent', kind: 'verification_passed' });
    }

    const scorer = new TrustScorer(events);
    const result = arbitrate(dispute([
      { agentId: 'unreliable', answer: 'yes', family: 'f1' },
      { agentId: 'reliable', answer: 'no', family: 'f2' },
    ]), { scorer });

    const yes = result.positions.find(p => p.agentId === 'unreliable')!;
    const no = result.positions.find(p => p.agentId === 'reliable')!;
    expect(no.weight).toBeGreaterThan(yes.weight);
  });

  test('an unproven participant sits at the baseline rather than being penalised', () => {
    const scorer = new TrustScorer(new TrustEventStore(new Storage('')));
    const result = arbitrate(dispute([{ agentId: 'nobody', answer: 'yes', family: 'f1' }]), { scorer });

    expect(result.positions[0]!.trustScore).toBe(50);
    expect(result.positions[0]!.trustBand).toBe('unproven');
  });
});

describe('ArbitrationStore', () => {
  test('stores, resolves and records reasoning', () => {
    const store = new ArbitrationStore(new Storage(''));
    const opened = store.open({
      question: 'Refund the customer?',
      positions: [
        { agentId: 'a', answer: 'yes', family: 'f1' },
        { agentId: 'b', answer: 'yes', family: 'f2' },
        { agentId: 'c', answer: 'yes', family: 'f3' },
      ],
    });

    const result = store.resolve(opened.id);
    expect(result.outcome).toBe('resolved');
    expect(store.get(opened.id)!.resolvedAnswer).toBe('yes');
  });

  test('escalated disputes appear in the pending queue', () => {
    const store = new ArbitrationStore(new Storage(''));
    const opened = store.open({
      question: 'Delete the archive?',
      positions: [{ agentId: 'a', answer: 'yes', family: 'f1' }, { agentId: 'b', answer: 'yes', family: 'f2' }],
      irreversible: true,
    });

    store.resolve(opened.id);
    expect(store.pending().map(d => d.id)).toContain(opened.id);
  });

  test('a human decision clears the queue and is attributed', () => {
    const store = new ArbitrationStore(new Storage(''));
    const opened = store.open({
      question: 'Delete the archive?',
      positions: [{ agentId: 'a', answer: 'yes', family: 'f1' }],
      irreversible: true,
    });

    store.resolve(opened.id);
    const decided = store.decide(opened.id, 'ops@example.com', 'no');

    expect(decided.decidedBy).toBe('ops@example.com');
    expect(decided.resolvedAnswer).toBe('no');
    expect(store.pending().map(d => d.id)).not.toContain(opened.id);
  });

  test('a dispute needs a question', () => {
    const store = new ArbitrationStore(new Storage(''));
    expect(() => store.open({ question: '  ', positions: [] })).toThrow(/question/i);
  });
});
