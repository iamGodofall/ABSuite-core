/**
 * @absuitecore/trust — evidence-based trust for multi-agent systems.
 *
 * Five capabilities, each built around the same rule: a judgement about a
 * subject must be traceable to a recorded, verifiable event, and must be
 * contestable by whoever it is about.
 *
 * - **Events** — the evidence store, with appeals.
 * - **Scoring** — explainable, decaying, confidence-bounded, advisory by default.
 * - **Verification** — grounding and contradiction signals, not a truth oracle.
 * - **Monitoring** — structural facts about agent-to-agent chains.
 * - **Arbitration** — correlation-aware dispute resolution that escalates
 *   rather than guessing.
 * - **Reciprocal contracts** — obligations that run both ways, so an operator's
 *   failures stop being recorded as the agent's.
 */
export {
  TrustEventStore,
  EVENT_WEIGHTS,
  MIGRATIONS as TRUST_EVENT_MIGRATIONS,
  type TrustEvent,
  type TrustEventKind,
  type SubjectType,
  type Appeal,
} from './events';

export {
  TrustScorer,
  computeScore,
  evidenceRecord,
  bandFor,
  BASELINE_SCORE,
  type TrustScore,
  type TrustBand,
  type Contribution,
  type EvidenceRecord,
  type ScoringOptions,
  type TrustScorerOptions,
} from './scoring';

export {
  verifyOutput,
  segmentClaims,
  contentTerms,
  significantNumbers,
  quotedSpans,
  identifiers,
  findInternalContradictions,
  findingsToEventKinds,
  renderReport,
  type VerificationReport,
  type ClaimStatus,
  type EvidenceItem,
  type ClaimAssessment,
  type Finding,
  type FindingKind,
  type Severity,
  type VerifyOptions,
} from './verification';

export {
  InteractionMonitor,
  MIGRATIONS as MONITORING_MIGRATIONS,
  type Interaction,
  type InteractionKind,
  type Observation,
  type ObservationVerdict,
  type Anomaly,
  type AnomalyKind,
  type ChainSummary,
  type MonitorOptions,
} from './monitoring';

export {
  ArbitrationStore,
  arbitrate,
  normaliseAnswer,
  MIGRATIONS as ARBITRATION_MIGRATIONS,
  type Dispute,
  type Position,
  type ArbitrationResult,
  type ArbitrationOutcome,
  type ArbitrationOptions,
  type WeightedPosition,
} from './arbitration';

export {
  ReciprocalTrust,
  STANDARD_OBLIGATIONS,
  MIGRATIONS as RECIPROCAL_MIGRATIONS,
  type Contract,
  type Obligation,
  type ObligationId,
  type Breach,
  type ContractHealth,
  type Party,
} from './reciprocal';
