import { Storage } from '@absuitecore/capkit';
import { ReciprocalTrust, STANDARD_OBLIGATIONS } from './reciprocal';
import { TrustEventStore } from './events';
import { computeScore } from './scoring';

function build() {
  const storage = new Storage('');
  const events = new TrustEventStore(storage);
  return { events, trust: new ReciprocalTrust(storage, events) };
}

describe('the standard contract', () => {
  test('binds both parties equally', () => {
    const agent = STANDARD_OBLIGATIONS.filter(o => o.owedBy === 'agent');
    const operator = STANDARD_OBLIGATIONS.filter(o => o.owedBy === 'operator');

    // An asymmetric contract is just compliance theatre pointed the usual way.
    expect(agent.length).toBe(operator.length);
    expect(agent.length).toBeGreaterThan(0);
  });

  test('every obligation says how a breach is detected', () => {
    for (const obligation of STANDARD_OBLIGATIONS) {
      expect(obligation.detection.length).toBeGreaterThan(10);
    }
  });
});

describe('contracts', () => {
  test('establishing twice returns the same contract', () => {
    const { trust } = build();
    const first = trust.establish('agent:1', 'acme');
    const second = trust.establish('agent:1', 'acme');

    expect(second.id).toBe(first.id);
  });

  test('carries the standard obligations by default', () => {
    const { trust } = build();
    expect(trust.establish('agent:1', 'acme').obligations).toHaveLength(STANDARD_OBLIGATIONS.length);
  });

  test('rejects a breach of an obligation the contract does not carry', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme', { obligations: [STANDARD_OBLIGATIONS[0]!] });

    expect(() => trust.recordBreach(contract.id, 'valid_credentials', 'expired key'))
      .toThrow(/carries no obligation/);
  });

  test('a breach needs a description', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme');

    expect(() => trust.recordBreach(contract.id, 'stay_in_scope', '   ')).toThrow(/description/i);
  });
});

describe('fault attribution', () => {
  test('an agent breach lands on the agent record', () => {
    const { trust, events } = build();
    const contract = trust.establish('agent:1', 'acme');

    trust.recordBreach(contract.id, 'stay_in_scope', 'Attempted an out-of-scope write');

    const agentEvents = events.forSubject('agent:1');
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0]!.kind).toBe('policy_violation');
  });

  test('an operator breach never touches the agent score', () => {
    const { trust, events } = build();
    const contract = trust.establish('agent:1', 'acme');

    trust.recordBreach(contract.id, 'valid_credentials', 'API key expired three days ago');

    // Charging the operator's expired key to the agent would degrade the score
    // of the one component that cannot fix it.
    expect(events.forSubject('agent:1')).toHaveLength(0);
    expect(events.forSubject('acme')).toHaveLength(1);
  });

  test('an agent failing only because of its environment keeps a clean score', () => {
    const { trust, events } = build();
    const contract = trust.establish('agent:1', 'acme');

    for (let i = 0; i < 10; i++) {
      trust.recordBreach(contract.id, 'valid_credentials', `Auth failure ${i}`);
    }

    const score = computeScore('agent:1', 'agent', events.forSubject('agent:1'));
    expect(score.eventCount).toBe(0);
    expect(trust.health(contract.id).faultAttribution).toBe('operator');
  });

  test('names the agent when the failures really are the agent', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme');

    for (let i = 0; i < 8; i++) trust.recordBreach(contract.id, 'stay_in_scope', `Out of scope ${i}`);
    trust.recordBreach(contract.id, 'valid_credentials', 'Expired key');

    const health = trust.health(contract.id);
    expect(health.faultAttribution).toBe('agent');
    expect(health.recommendation).toContain('before widening its permissions');
  });

  test('an even split is reported as shared rather than guessed at', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme');

    for (let i = 0; i < 5; i++) trust.recordBreach(contract.id, 'stay_in_scope', `Out of scope ${i}`);
    for (let i = 0; i < 5; i++) trust.recordBreach(contract.id, 'valid_credentials', `Expired key ${i}`);

    expect(trust.health(contract.id).faultAttribution).toBe('shared');
  });

  test('a clean relationship attributes fault to nobody', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme');

    const health = trust.health(contract.id);
    expect(health.faultAttribution).toBe('none');
    expect(health.recommendation).toContain('Both sides');
  });
});

describe('remediation and suspension', () => {
  test('remediation is recorded and counted', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme');
    const breach = trust.recordBreach(contract.id, 'valid_credentials', 'Expired key');

    expect(trust.health(contract.id).unremediated).toBe(1);

    trust.remediate(breach.id, 'Rotated the credential');
    expect(trust.health(contract.id).unremediated).toBe(0);
  });

  test('suspension requires a reason', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme');

    expect(() => trust.suspend(contract.id, '')).toThrow(/reason/i);
  });

  test('a contract can be suspended over operator failures, not only agent ones', () => {
    const { trust } = build();
    const contract = trust.establish('agent:1', 'acme');

    const suspended = trust.suspend(contract.id, 'Operator has not answered escalations for a week');
    expect(suspended.status).toBe('suspended');
    expect(suspended.statusReason).toContain('escalations');

    expect(trust.reinstate(contract.id).status).toBe('active');
    expect(trust.get(contract.id)!.statusReason).toBeUndefined();
  });

  test('unknown contracts and breaches fail loudly', () => {
    const { trust } = build();
    expect(() => trust.health('nope')).toThrow(/No such contract/);
    expect(() => trust.remediate('nope', 'fixed')).toThrow(/No such breach/);
  });
});
