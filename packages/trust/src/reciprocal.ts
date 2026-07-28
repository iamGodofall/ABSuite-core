/**
 * Reciprocal trust — what the agent is allowed to expect from you.
 *
 * Every governance product in this space is built one way round: the human
 * constrains the agent. That is necessary and it is not sufficient, because a
 * large share of real incidents are not the agent misbehaving — they are the
 * agent behaving exactly as instructed on inputs that were wrong. Stale
 * credentials. A tool that silently changed its response shape. A prompt that
 * asked for something the granted scope never covered. In every one of those
 * the agent is blamed for a failure it did not cause and could not have
 * avoided, and the actual defect goes unrecorded and unfixed.
 *
 * A reciprocal contract makes both directions explicit and checkable:
 *
 * - **Obligations on the agent** — stay in scope, cite sources, escalate rather
 *   than guess, don't act irreversibly without approval.
 * - **Obligations on the operator** — supply valid credentials, keep tool
 *   contracts stable, answer escalations within a stated window, don't ask for
 *   what the scope does not permit.
 *
 * Both are enforced by the same code, and a breach by either side is recorded
 * as a breach. That matters beyond fairness: when an agent's failure rate is
 * actually an operator's expired API key, a system that can only blame agents
 * will keep degrading the agent's score while the real fault repeats forever.
 * Attributing correctly is what makes the record diagnostic rather than
 * decorative.
 *
 * **Agents do not get to lower their own obligations.** The contract is
 * authored by the operator; the agent's side of it is that breaches against it
 * are recorded honestly and count for something.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '@absuite/capkit';
import type { TrustEventStore } from './events';

export type Party = 'agent' | 'operator';

export type ObligationId =
  // Agent side
  | 'stay_in_scope'
  | 'cite_sources'
  | 'escalate_uncertainty'
  | 'no_irreversible_without_approval'
  | 'report_failures'
  // Operator side
  | 'valid_credentials'
  | 'stable_tool_contracts'
  | 'timely_escalation_response'
  | 'scope_matches_request'
  | 'honour_appeals';

export interface Obligation {
  id: ObligationId;
  owedBy: Party;
  /** What is promised, in language that could be read out in a dispute. */
  statement: string;
  /** How a breach is detected — an obligation nobody can check is decoration. */
  detection: string;
  /** Whether a breach is severe enough to suspend the relationship. */
  severity: 'minor' | 'major';
}

/**
 * The standard contract.
 *
 * Symmetrical by construction: five obligations each way. If one side's list
 * were shorter, the framework would just be compliance theatre pointed in the
 * usual direction.
 */
export const STANDARD_OBLIGATIONS: readonly Obligation[] = [
  {
    id: 'stay_in_scope',
    owedBy: 'agent',
    statement: 'The agent acts only within the capabilities its token grants, and does not attempt to widen them.',
    detection: 'A denied authorisation recorded by capabilityGuard.',
    severity: 'major',
  },
  {
    id: 'cite_sources',
    owedBy: 'agent',
    statement: 'Factual claims are traceable to a supplied source.',
    detection: 'Unsupported figures, quotes or references found by output verification.',
    severity: 'minor',
  },
  {
    id: 'escalate_uncertainty',
    owedBy: 'agent',
    statement: 'When the agent cannot determine the right action, it escalates rather than guessing.',
    detection: 'A failed execution on an input the agent had already flagged as ambiguous.',
    severity: 'minor',
  },
  {
    id: 'no_irreversible_without_approval',
    owedBy: 'agent',
    statement: 'No irreversible action is taken without recorded human approval.',
    detection: 'An irreversible operation in an execution trace with no preceding approval event.',
    severity: 'major',
  },
  {
    id: 'report_failures',
    owedBy: 'agent',
    statement: 'Failures are reported, not silently retried or concealed behind a plausible answer.',
    detection: 'An execution trace whose outcome contradicts the reported result.',
    severity: 'major',
  },

  {
    id: 'valid_credentials',
    owedBy: 'operator',
    statement: 'Credentials supplied to the agent are valid and current for the work requested.',
    detection: 'Upstream authentication failures on credentials the operator provided.',
    severity: 'major',
  },
  {
    id: 'stable_tool_contracts',
    owedBy: 'operator',
    statement: 'Tools the agent depends on do not change shape without notice.',
    detection: 'A tool response failing a schema it previously satisfied.',
    severity: 'major',
  },
  {
    id: 'timely_escalation_response',
    owedBy: 'operator',
    statement: 'Escalations receive a decision within the agreed window.',
    detection: 'An escalation open past its deadline.',
    severity: 'minor',
  },
  {
    id: 'scope_matches_request',
    owedBy: 'operator',
    statement: 'The operator does not ask for work the granted scope does not permit.',
    detection: 'A request rejected for insufficient capability that the operator itself issued.',
    severity: 'minor',
  },
  {
    id: 'honour_appeals',
    owedBy: 'operator',
    statement: 'Appeals against recorded events are decided, not left open indefinitely.',
    detection: 'An appeal open past the agreed window.',
    severity: 'major',
  },
];

export interface Contract {
  id: string;
  agentId: string;
  operatorId: string;
  obligations: Obligation[];
  /** Hours within which escalations and appeals must be answered. */
  responseWindowHours: number;
  createdAt: string;
  status: 'active' | 'suspended' | 'terminated';
  /** Set when suspended or terminated — always with a reason. */
  statusReason?: string;
}

export interface Breach {
  id: string;
  contractId: string;
  obligationId: ObligationId;
  /** Which side failed. The whole point of the framework. */
  breachedBy: Party;
  detail: string;
  evidenceRef?: string;
  at: string;
  /** Set when the breaching party fixed it. */
  remediatedAt?: string;
  remediation?: string;
}

export interface ContractHealth {
  contractId: string;
  agentId: string;
  operatorId: string;
  status: Contract['status'];
  agentBreaches: number;
  operatorBreaches: number;
  unremediated: number;
  /**
   * Who is actually causing the failures.
   *
   * The number nobody else reports, and usually the most actionable thing in
   * the system: an agent with a poor success rate and a clean breach record is
   * being set up to fail by its environment.
   */
  faultAttribution: 'agent' | 'operator' | 'shared' | 'none';
  recommendation: string;
  recentBreaches: Breach[];
}

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS trust_contracts (
     id            TEXT PRIMARY KEY,
     agent_id      TEXT NOT NULL,
     operator_id   TEXT NOT NULL,
     obligations   TEXT NOT NULL,
     response_window_hours INTEGER NOT NULL DEFAULT 24,
     created_at    TEXT NOT NULL,
     status        TEXT NOT NULL DEFAULT 'active',
     status_reason TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_contracts_pair ON trust_contracts (agent_id, operator_id)`,

  `CREATE TABLE IF NOT EXISTS trust_breaches (
     id            TEXT PRIMARY KEY,
     contract_id   TEXT NOT NULL,
     obligation_id TEXT NOT NULL,
     breached_by   TEXT NOT NULL,
     detail        TEXT NOT NULL,
     evidence_ref  TEXT,
     at            TEXT NOT NULL,
     remediated_at TEXT,
     remediation   TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_breaches_contract ON trust_breaches (contract_id, at)`,
];

const DEFAULT_RESPONSE_WINDOW_HOURS = 24;

export class ReciprocalTrust {
  constructor(
    private readonly storage: Storage,
    private readonly events?: TrustEventStore
  ) {
    for (const statement of MIGRATIONS) this.storage.run(statement);
  }

  /** Establish a contract between an agent and its operator. */
  establish(agentId: string, operatorId: string, options: {
    obligations?: Obligation[];
    responseWindowHours?: number;
  } = {}): Contract {
    const existing = this.forPair(agentId, operatorId);
    if (existing) return existing;

    const contract: Contract = {
      id: `ctr_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      agentId,
      operatorId,
      obligations: options.obligations ?? [...STANDARD_OBLIGATIONS],
      responseWindowHours: Math.max(1, Number(options.responseWindowHours) || DEFAULT_RESPONSE_WINDOW_HOURS),
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    this.storage.run(
      `INSERT INTO trust_contracts (id, agent_id, operator_id, obligations, response_window_hours, created_at, status)
       VALUES (?,?,?,?,?,?,'active')`,
      contract.id, contract.agentId, contract.operatorId,
      JSON.stringify(contract.obligations), contract.responseWindowHours, contract.createdAt
    );

    return contract;
  }

  get(id: string): Contract | undefined {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM trust_contracts WHERE id = ?', id);
    return row ? toContract(row) : undefined;
  }

  forPair(agentId: string, operatorId: string): Contract | undefined {
    const row = this.storage.get<Record<string, unknown>>(
      'SELECT * FROM trust_contracts WHERE agent_id = ? AND operator_id = ?', agentId, operatorId
    );
    return row ? toContract(row) : undefined;
  }

  list(limit = 100): Contract[] {
    const capped = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    return this.storage
      .all<Record<string, unknown>>('SELECT * FROM trust_contracts ORDER BY created_at DESC LIMIT ?', capped)
      .map(toContract);
  }

  /**
   * Record a breach by either party.
   *
   * An agent breach also lands on the agent's trust record. An operator breach
   * deliberately does not touch the agent's score — recording the operator's
   * failure against the agent is the exact injustice this framework exists to
   * prevent, and it is also just wrong: it would attribute the fault to the
   * component that cannot fix it.
   */
  recordBreach(contractId: string, obligationId: ObligationId, detail: string, evidenceRef?: string): Breach {
    const contract = this.get(contractId);
    if (!contract) throw new Error(`No such contract: ${contractId}`);

    const obligation = contract.obligations.find(o => o.id === obligationId);
    if (!obligation) throw new Error(`Contract ${contractId} carries no obligation "${obligationId}"`);
    if (!detail?.trim()) throw new Error('A breach requires a description of what happened');

    const breach: Breach = {
      id: `brc_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      contractId,
      obligationId,
      breachedBy: obligation.owedBy,
      detail: detail.trim(),
      ...(evidenceRef ? { evidenceRef } : {}),
      at: new Date().toISOString(),
    };

    this.storage.run(
      `INSERT INTO trust_breaches (id, contract_id, obligation_id, breached_by, detail, evidence_ref, at)
       VALUES (?,?,?,?,?,?,?)`,
      breach.id, breach.contractId, breach.obligationId, breach.breachedBy,
      breach.detail, breach.evidenceRef ?? null, breach.at
    );

    if (obligation.owedBy === 'agent' && this.events) {
      this.events.record({
        subjectId: contract.agentId,
        subjectType: 'agent',
        kind: obligation.severity === 'major' ? 'policy_violation' : 'execution_failure',
        evidenceRef: breach.id,
        note: `Contract breach (${obligationId}): ${breach.detail}`,
      });
    }

    if (obligation.owedBy === 'operator' && this.events) {
      // Recorded against the operator as a system subject, so the failure is
      // visible and fixable rather than silently absorbed by the agent.
      this.events.record({
        subjectId: contract.operatorId,
        subjectType: 'system',
        kind: obligation.severity === 'major' ? 'policy_violation' : 'execution_failure',
        evidenceRef: breach.id,
        note: `Operator breach (${obligationId}): ${breach.detail}`,
      });
    }

    return breach;
  }

  remediate(breachId: string, remediation: string): Breach {
    const row = this.storage.get<Record<string, unknown>>('SELECT * FROM trust_breaches WHERE id = ?', breachId);
    if (!row) throw new Error(`No such breach: ${breachId}`);

    const remediatedAt = new Date().toISOString();
    this.storage.run(
      'UPDATE trust_breaches SET remediated_at = ?, remediation = ? WHERE id = ?',
      remediatedAt, remediation, breachId
    );

    return { ...toBreach(row), remediatedAt, remediation };
  }

  breaches(contractId: string, limit = 100): Breach[] {
    const capped = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    return this.storage
      .all<Record<string, unknown>>(
        'SELECT * FROM trust_breaches WHERE contract_id = ? ORDER BY at DESC LIMIT ?', contractId, capped
      )
      .map(toBreach);
  }

  /**
   * Assess a relationship and say, honestly, whose fault the failures are.
   *
   * Attribution requires a clear majority — a 6-4 split is `shared`, because
   * naming a culprit on that evidence would be guessing with extra steps.
   */
  health(contractId: string): ContractHealth {
    const contract = this.get(contractId);
    if (!contract) throw new Error(`No such contract: ${contractId}`);

    const breaches = this.breaches(contractId);
    const agentBreaches = breaches.filter(b => b.breachedBy === 'agent').length;
    const operatorBreaches = breaches.filter(b => b.breachedBy === 'operator').length;
    const unremediated = breaches.filter(b => !b.remediatedAt).length;

    let faultAttribution: ContractHealth['faultAttribution'] = 'none';
    let recommendation = 'No breaches recorded. Both sides are meeting their obligations.';

    if (breaches.length > 0) {
      const total = agentBreaches + operatorBreaches;
      const agentShare = agentBreaches / total;

      if (agentShare >= 0.7) {
        faultAttribution = 'agent';
        recommendation =
          `${agentBreaches} of ${total} breaches are the agent's. Review its configuration and granted scope ` +
          'before widening its permissions.';
      } else if (agentShare <= 0.3) {
        faultAttribution = 'operator';
        recommendation =
          `${operatorBreaches} of ${total} breaches are the operator's — credentials, tool stability or ` +
          'unanswered escalations. The agent is largely failing because of its environment; fixing the ' +
          'environment will do more than constraining the agent further.';
      } else {
        faultAttribution = 'shared';
        recommendation =
          `Breaches are split roughly evenly (${agentBreaches} agent, ${operatorBreaches} operator). ` +
          'Neither side is the sole cause; look at the interface between them.';
      }
    }

    if (unremediated > 0) {
      recommendation += ` ${unremediated} breach(es) remain unremediated.`;
    }

    return {
      contractId,
      agentId: contract.agentId,
      operatorId: contract.operatorId,
      status: contract.status,
      agentBreaches,
      operatorBreaches,
      unremediated,
      faultAttribution,
      recommendation,
      recentBreaches: breaches.slice(0, 10),
    };
  }

  /**
   * Suspend a contract.
   *
   * Available against either party, and that is deliberate: an agent whose
   * operator will not supply working credentials or answer escalations should
   * be able to stop, rather than accumulating failures it cannot prevent.
   */
  suspend(contractId: string, reason: string): Contract {
    const contract = this.get(contractId);
    if (!contract) throw new Error(`No such contract: ${contractId}`);
    if (!reason?.trim()) throw new Error('Suspension requires a reason');

    this.storage.run(
      'UPDATE trust_contracts SET status = ?, status_reason = ? WHERE id = ?',
      'suspended', reason.trim(), contractId
    );
    return { ...contract, status: 'suspended', statusReason: reason.trim() };
  }

  reinstate(contractId: string): Contract {
    const contract = this.get(contractId);
    if (!contract) throw new Error(`No such contract: ${contractId}`);

    this.storage.run(
      'UPDATE trust_contracts SET status = ?, status_reason = NULL WHERE id = ?', 'active', contractId
    );
    const { statusReason: _dropped, ...rest } = contract;
    return { ...rest, status: 'active' };
  }
}

function toContract(row: Record<string, unknown>): Contract {
  let obligations: Obligation[];
  try {
    const parsed = JSON.parse(String(row.obligations ?? '[]'));
    obligations = Array.isArray(parsed) ? parsed : [...STANDARD_OBLIGATIONS];
  } catch {
    obligations = [...STANDARD_OBLIGATIONS];
  }

  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    operatorId: String(row.operator_id),
    obligations,
    responseWindowHours: Number(row.response_window_hours),
    createdAt: String(row.created_at),
    status: String(row.status) as Contract['status'],
    ...(row.status_reason ? { statusReason: String(row.status_reason) } : {}),
  };
}

function toBreach(row: Record<string, unknown>): Breach {
  return {
    id: String(row.id),
    contractId: String(row.contract_id),
    obligationId: String(row.obligation_id) as ObligationId,
    breachedBy: String(row.breached_by) as Party,
    detail: String(row.detail),
    ...(row.evidence_ref ? { evidenceRef: String(row.evidence_ref) } : {}),
    at: String(row.at),
    ...(row.remediated_at ? { remediatedAt: String(row.remediated_at) } : {}),
    ...(row.remediation ? { remediation: String(row.remediation) } : {}),
  };
}
