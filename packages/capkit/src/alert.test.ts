/**
 * Chain alerting.
 *
 * The decision is pure and is tested exhaustively here, because every mistake
 * this feature could make lives in WHEN it sends rather than in how. An alerter
 * that sends too often gets muted, and a muted alert is worse than none —
 * everybody still believes it is working.
 */
import { alertForTransition, ChainAlerter, type ChainState } from './alert';

const AT = '2026-08-28T03:00:00.000Z';
const broken = { brokenAt: 42, brokenId: 'exec_abc', reason: 'Trace content does not match its hash', at: AT };

describe('alertForTransition', () => {
  test('whole -> broken sends, and carries the evidence', () => {
    const alert = alertForTransition('whole', 'broken', broken)!;
    expect(alert.event).toBe('chain.broken');
    expect(alert.brokenAt).toBe(42);
    expect(alert.brokenId).toBe('exec_abc');
    expect(alert.reason).toContain('does not match its hash');
  });

  test('broken -> whole sends a RECOVERY', () => {
    // A person told at 3am and never told it was fixed does not trust the next
    // one. The recovery is not optional politeness.
    const alert = alertForTransition('broken', 'whole', { at: AT })!;
    expect(alert.event).toBe('chain.recovered');
    expect(alert.brokenAt).toBeUndefined();
  });

  test('SILENCE while a state persists — broken stays broken', () => {
    // The whole design. Sending every sweep would put an alert every five
    // minutes from Monday to Friday, and by Wednesday there is a mail filter.
    expect(alertForTransition('broken', 'broken', broken)).toBeUndefined();
  });

  test('SILENCE while a state persists — whole stays whole', () => {
    expect(alertForTransition('whole', 'whole', { at: AT })).toBeUndefined();
  });

  test('the first sweep does NOT announce good news', () => {
    // Every restart would otherwise report a healthy chain nobody asked about.
    expect(alertForTransition(undefined, 'whole', { at: AT })).toBeUndefined();
  });

  test('the first sweep DOES announce a broken one', () => {
    // The alternative is silence about a broken ledger until it changes state,
    // which on a ledger nobody writes to is never.
    expect(alertForTransition(undefined, 'broken', broken)?.event).toBe('chain.broken');
  });

  test('the instance is carried on both events', () => {
    const detail = { ...broken, instance: 'absuite-prod' };
    expect(alertForTransition('whole', 'broken', detail)?.instance).toBe('absuite-prod');
    expect(alertForTransition('broken', 'whole', detail)?.instance).toBe('absuite-prod');
  });
});

describe('ChainAlerter over a run of sweeps', () => {
  test('one alert per transition, not per sweep', () => {
    const alerter = new ChainAlerter();
    const sweeps: ChainState[] = ['whole', 'whole', 'broken', 'broken', 'broken', 'whole', 'whole', 'broken'];

    const sent = sweeps
      .map(state => alerter.observe(state, { at: AT }))
      .filter(Boolean)
      .map(a => a!.event);

    // Eight sweeps, three changes of state.
    expect(sent).toEqual(['chain.broken', 'chain.recovered', 'chain.broken']);
  });

  test('a run that is broken from the first sweep alerts once', () => {
    const alerter = new ChainAlerter();
    const sent = (['broken', 'broken', 'broken'] as ChainState[])
      .map(s => alerter.observe(s, broken))
      .filter(Boolean);
    expect(sent).toHaveLength(1);
  });

  test('lastSeen reports only what it has actually observed', () => {
    const alerter = new ChainAlerter();
    // A status page must not claim health it has never measured.
    expect(alerter.lastSeen).toBeUndefined();
    alerter.observe('whole', { at: AT });
    expect(alerter.lastSeen).toBe('whole');
  });
});
