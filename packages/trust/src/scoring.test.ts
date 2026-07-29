import { Storage } from '@absuitecore/capkit';
import { TrustEventStore } from './events';
import { computeScore, bandFor, evidenceRecord, TrustScorer, BASELINE_SCORE } from './scoring';

function store(): TrustEventStore {
  return new TrustEventStore(new Storage(''));
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe('computeScore', () => {
  test('an unknown subject sits at the baseline, unproven', () => {
    const score = computeScore('agent:new', 'agent', []);

    expect(score.score).toBe(BASELINE_SCORE);
    expect(score.band).toBe('unproven');
    expect(score.explanation).toContain('not untrusted');
  });

  test('thin evidence is reported as unproven, never as a precise number to act on', () => {
    const events = store();
    for (let i = 0; i < 4; i++) {
      events.record({ subjectId: 'a', subjectType: 'agent', kind: 'execution_success' });
    }

    const score = computeScore('a', 'agent', events.forSubject('a'));
    expect(score.confidence).toBeLessThan(0.5);
    expect(score.band).toBe('unproven');
  });

  test('every score shows the events that produced it', () => {
    const events = store();
    events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation', evidenceRef: 'trace_1' });

    const score = computeScore('a', 'agent', events.forSubject('a'));
    expect(score.contributions).toHaveLength(1);
    expect(score.contributions[0]!.evidenceRef).toBe('trace_1');
    expect(score.contributions[0]!.rawWeight).toBeLessThan(0);
  });

  test('old events count less than recent ones', () => {
    const events = store();
    events.record({ subjectId: 'old', subjectType: 'agent', kind: 'policy_violation', at: daysAgo(120) });
    events.record({ subjectId: 'new', subjectType: 'agent', kind: 'policy_violation', at: daysAgo(0) });

    const stale = computeScore('old', 'agent', events.forSubject('old'));
    const fresh = computeScore('new', 'agent', events.forSubject('new'));

    expect(stale.score).toBeGreaterThan(fresh.score);
  });

  test('a violation four half-lives old barely moves the score', () => {
    const events = store();
    events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation', at: daysAgo(120) });

    const score = computeScore('a', 'agent', events.forSubject('a'));
    expect(Math.abs(score.score - BASELINE_SCORE)).toBeLessThanOrEqual(2);
  });

  test('trust is slow to earn and quick to lose', () => {
    const events = store();
    for (let i = 0; i < 25; i++) {
      events.record({ subjectId: 'good', subjectType: 'agent', kind: 'execution_success' });
    }
    for (let i = 0; i < 25; i++) {
      events.record({ subjectId: 'bad', subjectType: 'agent', kind: 'execution_success' });
    }
    events.record({ subjectId: 'bad', subjectType: 'agent', kind: 'policy_violation' });

    const good = computeScore('good', 'agent', events.forSubject('good'));
    const bad = computeScore('bad', 'agent', events.forSubject('bad'));

    expect(bad.score).toBeLessThan(good.score);
  });

  test('neutralised events stop counting but stay visible', () => {
    const events = store();
    const event = events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    const appeal = events.appeal(event.id, 'owner', 'Caused by an expired operator credential');
    events.decideAppeal(appeal.id, 'reviewer', true, 'Upheld — operator fault');

    const score = computeScore('a', 'agent', events.forSubject('a'));
    expect(score.neutralisedCount).toBe(1);
    expect(score.contributions.some(c => c.kind === 'policy_violation')).toBe(false);
    expect(score.contributions.some(c => c.kind === 'appeal_upheld')).toBe(true);
  });

  test('an upheld appeal leaves the subject no worse off', () => {
    const events = store();
    const event = events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });

    const before = computeScore('a', 'agent', events.forSubject('a')).score;

    const appeal = events.appeal(event.id, 'owner', 'Wrongly attributed');
    events.decideAppeal(appeal.id, 'reviewer', true, 'Upheld');

    const after = computeScore('a', 'agent', events.forSubject('a')).score;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(BASELINE_SCORE);
  });

  test('is deterministic — the same events and clock give the same score', () => {
    const events = store();
    for (let i = 0; i < 30; i++) {
      events.record({ subjectId: 'a', subjectType: 'agent', kind: 'execution_success', at: daysAgo(i) });
    }

    const now = new Date('2026-01-01T00:00:00.000Z');
    const first = computeScore('a', 'agent', events.forSubject('a'), { now });
    const second = computeScore('a', 'agent', events.forSubject('a'), { now });

    expect(first).toEqual(second);
  });

  test('scores stay inside 0-100 under extreme input', () => {
    const events = store();
    for (let i = 0; i < 500; i++) {
      events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    }

    const score = computeScore('a', 'agent', events.forSubject('a'));
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
  });

  test('gating is off unless asked for', () => {
    expect(computeScore('a', 'agent', []).gating).toBe(false);
    expect(computeScore('a', 'agent', [], { gating: true }).gating).toBe(true);
  });
});

describe('bandFor', () => {
  test('confidence gates the band before the score does', () => {
    expect(bandFor(95, 0.2)).toBe('unproven');
    expect(bandFor(5, 0.2)).toBe('unproven');
  });

  test('bands apply once there is enough evidence', () => {
    expect(bandFor(90, 1)).toBe('high');
    expect(bandFor(50, 1)).toBe('moderate');
    expect(bandFor(20, 1)).toBe('low');
  });
});

describe('evidence records — facts, never conclusions', () => {
  test('reports counts with no score, band or verdict anywhere in the object', () => {
    const events = store();
    for (let i = 0; i < 12; i++) {
      events.record({ subjectId: 'person:1', subjectType: 'human', kind: 'execution_success' });
    }
    events.record({ subjectId: 'person:1', subjectType: 'human', kind: 'policy_violation' });
    events.record({ subjectId: 'person:1', subjectType: 'human', kind: 'manual_override' });

    const record = evidenceRecord('person:1', 'human', events.forSubject('person:1'));

    expect(record.actionsRecorded).toBe(14);
    expect(record.policyViolations).toBe(1);
    expect(record.manualOverrides).toBe(1);
    expect(record.auditFindings).toBe(0);

    // "John has a trust score of 42" is a conclusion a machine reached about a
    // person. This object must never be able to express one.
    expect(record).not.toHaveProperty('score');
    expect(record).not.toHaveProperty('band');
    expect(record).not.toHaveProperty('confidence');
    expect(record.note).toContain('not an assessment');
  });

  test('needs no flag, for any subject type including humans', () => {
    const events = store();
    events.record({ subjectId: 'person:1', subjectType: 'human', kind: 'human_approval' });

    // Counting what happened is not the same act as rating a person, so this
    // has no off switch.
    const scorer = new TrustScorer(events, { scoreHumans: false });
    expect(scorer.evidence('person:1', 'human').actionsRecorded).toBe(1);
  });

  test('neutralised events are excluded from the counts but reported separately', () => {
    const events = store();
    const event = events.record({ subjectId: 'person:1', subjectType: 'human', kind: 'policy_violation' });
    const appeal = events.appeal(event.id, 'person:1', 'Wrongly attributed');
    events.decideAppeal(appeal.id, 'reviewer', true, 'Upheld');

    const record = evidenceRecord('person:1', 'human', events.forSubject('person:1'));
    expect(record.policyViolations).toBe(0);
    expect(record.neutralised).toBe(1);
  });

  test('an unknown subject reports zeroes, not an absence of trust', () => {
    const record = evidenceRecord('person:new', 'human', []);
    expect(record.actionsRecorded).toBe(0);
    expect(record.firstRecorded).toBeUndefined();
  });
});

describe('TrustScorer', () => {
  test('refuses to score humans by default', () => {
    const scorer = new TrustScorer(store(), { scoreHumans: false });
    expect(() => scorer.score('person:1', 'human')).toThrow(/disabled/i);
  });

  test('the refusal points at the endpoint that answers honestly', () => {
    const scorer = new TrustScorer(store(), { scoreHumans: false });
    expect(() => scorer.score('person:1', 'human')).toThrow(/evidenceRecord/);
  });

  test('the refusal explains how to enable it and what it means', () => {
    const scorer = new TrustScorer(store(), { scoreHumans: false });
    expect(() => scorer.score('person:1', 'human')).toThrow(/ABSUITE_TRUST_SCORE_HUMANS/);
    expect(() => scorer.score('person:1', 'human')).toThrow(/automated decision-making/);
  });

  test('scores humans when a deployment opts in deliberately', () => {
    const events = store();
    events.record({ subjectId: 'person:1', subjectType: 'human', kind: 'human_approval' });

    const scorer = new TrustScorer(events, { scoreHumans: true });
    expect(scorer.score('person:1', 'human').subjectId).toBe('person:1');
  });

  test('scoreAll skips humans when scoring them is disabled', () => {
    const events = store();
    events.record({ subjectId: 'agent:1', subjectType: 'agent', kind: 'execution_success' });
    events.record({ subjectId: 'person:1', subjectType: 'human', kind: 'human_approval' });

    const scores = new TrustScorer(events, { scoreHumans: false }).scoreAll();
    expect(scores.map(s => s.subjectId)).toEqual(['agent:1']);
  });

  test('check allows access when gating is off, whatever the score', () => {
    const events = store();
    for (let i = 0; i < 30; i++) {
      events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    }

    const verdict = new TrustScorer(events).check('a', 'agent', 90);
    expect(verdict.allowed).toBe(true);
    expect(verdict.advisory).toBe(true);
    expect(verdict.reason).toContain('gating is disabled');
  });

  test('with gating on, a poor record is denied — but contestably', () => {
    const events = store();
    for (let i = 0; i < 30; i++) {
      events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    }

    const verdict = new TrustScorer(events, { gating: true }).check('a', 'agent', 60);
    expect(verdict.allowed).toBe(false);
    expect(verdict.advisory).toBe(false);
    expect(verdict.reason).toContain('contestable');
  });

  test('never gates on evidence too thin to justify it', () => {
    const events = store();
    events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });

    const verdict = new TrustScorer(events, { gating: true }).check('a', 'agent', 90);
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toContain('Insufficient evidence');
  });
});
