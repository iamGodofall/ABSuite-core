import { Storage } from '@absuite/capkit';
import { TrustEventStore, EVENT_WEIGHTS } from './events';

function store(): TrustEventStore {
  return new TrustEventStore(new Storage(''));
}

describe('event weights', () => {
  test('negative evidence outweighs positive', () => {
    // Trust is slow to earn and quick to lose. A system where one success
    // cancels one violation lets an agent grind away its own record.
    const worstPositive = Math.max(...Object.values(EVENT_WEIGHTS).filter(w => w > 0));
    const worstNegative = Math.min(...Object.values(EVENT_WEIGHTS));

    expect(Math.abs(worstNegative)).toBeGreaterThan(worstPositive);
  });

  test('an upheld appeal repairs rather than merely stopping the penalty', () => {
    expect(EVENT_WEIGHTS.appeal_upheld).toBeGreaterThan(0);
  });
});

describe('recording', () => {
  test('assigns an id and timestamp', () => {
    const event = store().record({ subjectId: 'a', subjectType: 'agent', kind: 'execution_success' });

    expect(event.id).toMatch(/^tev_/);
    expect(Date.parse(event.at)).not.toBeNaN();
  });

  test('round-trips through storage intact', () => {
    const events = store();
    const written = events.record({
      subjectId: 'a', subjectType: 'agent', kind: 'policy_violation',
      evidenceRef: 'trace_1', note: 'Wrote outside the granted scope',
    });

    expect(events.get(written.id)).toEqual(written);
  });

  test('filters by subject and time', () => {
    const events = store();
    events.record({ subjectId: 'a', subjectType: 'agent', kind: 'execution_success', at: '2026-01-01T00:00:00.000Z' });
    events.record({ subjectId: 'a', subjectType: 'agent', kind: 'execution_success', at: '2026-06-01T00:00:00.000Z' });
    events.record({ subjectId: 'b', subjectType: 'agent', kind: 'execution_success' });

    expect(events.forSubject('a')).toHaveLength(2);
    expect(events.forSubject('a', { since: '2026-03-01T00:00:00.000Z' })).toHaveLength(1);
  });

  test('lists subjects by type', () => {
    const events = store();
    events.record({ subjectId: 'a', subjectType: 'agent', kind: 'execution_success' });
    events.record({ subjectId: 'p', subjectType: 'human', kind: 'human_approval' });

    expect(events.subjects('agent').map(s => s.subjectId)).toEqual(['a']);
    expect(events.subjects()).toHaveLength(2);
  });
});

describe('appeals', () => {
  test('cannot appeal an event that does not exist', () => {
    expect(() => store().appeal('nope', 'owner', 'wrong')).toThrow(/No such trust event/);
  });

  test('an appeal needs a reason', () => {
    const events = store();
    const event = events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });

    expect(() => events.appeal(event.id, 'owner', '   ')).toThrow(/reason/i);
  });

  test('upholding neutralises the original without deleting it', () => {
    const events = store();
    const event = events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    const appeal = events.appeal(event.id, 'owner', 'Caused by an operator credential failure');

    events.decideAppeal(appeal.id, 'reviewer', true, 'Upheld — operator fault');

    // The record of what happened, including the mistake, has to survive.
    const original = events.get(event.id)!;
    expect(original.neutralised).toBe(true);
    expect(original.neutralisedReason).toContain('operator fault');
    expect(events.forSubject('a').some(e => e.kind === 'appeal_upheld')).toBe(true);
  });

  test('rejecting leaves the original counting', () => {
    const events = store();
    const event = events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    const appeal = events.appeal(event.id, 'owner', 'Disagree');

    events.decideAppeal(appeal.id, 'reviewer', false, 'Rejected — the trace confirms it');

    expect(events.get(event.id)!.neutralised).toBeUndefined();
    expect(events.forSubject('a').some(e => e.kind === 'appeal_upheld')).toBe(false);
  });

  test('an appeal cannot be decided twice', () => {
    const events = store();
    const event = events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    const appeal = events.appeal(event.id, 'owner', 'Disagree');

    events.decideAppeal(appeal.id, 'reviewer', true, 'Upheld');
    expect(() => events.decideAppeal(appeal.id, 'reviewer', false, 'Changed my mind'))
      .toThrow(/already been decided/);
  });

  test('appeals are listed against their event', () => {
    const events = store();
    const event = events.record({ subjectId: 'a', subjectType: 'agent', kind: 'policy_violation' });
    events.appeal(event.id, 'owner', 'First');

    const listed = events.appealsFor(event.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.status).toBe('open');
  });
});
