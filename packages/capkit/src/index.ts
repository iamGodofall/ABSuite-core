/**
 * @absuitecore/capkit — capability tokens, JWT primitives, audit logging and
 * access-policy generation for ABSuite agents.
 */
export {
  CapabilityToken,
  RevocationList,
  hasCapability,
  scopeSatisfies,
  type CapabilityClaims,
  type CapabilityValidation,
  type CreateCapabilityOptions,
  type CreatedCapability,
  type VerificationKey,
} from './capability';

export { KeyRing, type SigningKeyEntry, type KeyStatus } from './keyring';

export {
  signJwt,
  verifyJwt,
  parseDuration,
  base64UrlEncode,
  base64UrlDecode,
  type JwtHeader,
  type JwtPayload,
  type JwtErrorCode,
  type VerifyResult,
} from './jwt';

export { AuditLog, hashEntry, type AuditEntry, type AuditQuery, type AuditResult } from './audit';

export {
  capabilityGuard,
  type CapabilityGuardOptions,
  type CapabilityRequest,
} from './middleware';

export {
  MemoryRevocationStore,
  FileRevocationStore,
  SqliteRevocationStore,
  revocationStoreFromEnv,
  type RevocationStore,
} from './revocation-store';

export { Storage, getStorage, resetStorage } from './storage';

export {
  TenantStore,
  MeterStore,
  TenantService,
  hashApiKey,
  currentPeriod,
  type Tenant,
  type CreatedTenant,
  type TenantStatus,
} from './tenancy';

export {
  PLANS,
  getPlan,
  isPlanId,
  checkQuota,
  verifyStripeSignature,
  planFromStripeEvent,
  type Plan,
  type PlanId,
  type QuotaMetric,
  type QuotaVerdict,
} from './billing';

export { MetricsRegistry, createServiceMetrics, type LabelSet } from './metrics';

export {
  TokenBucket,
  TenantRateLimiter,
  type RateLimitVerdict,
  type TenantRateLimiterOptions,
} from './rate-limit';

export { SIGNUP_PAGE, SignupThrottle, validateSignup, type SignupLimits } from './signup';

export {
  IdentityRegistry,
  IdentityError,
  generateIdentityKeypair,
  suggestSubjectId,
  IDENTITY_KINDS,
  CHALLENGE_TTL_MS,
  type Identity,
  type IdentityKind,
  type IdentityStatus,
  type IdentityAttestation,
} from './identity';

export {
  ProvenanceGraph,
  lineageOf,
  type Lineage,
  type LineageNode,
  type LineageEdge,
} from './provenance';

export {
  ModelRegistry,
  ModelIdentityError,
  fingerprintHash,
  type ModelFingerprint,
  type ApprovedModel,
  type ModelAttestation,
  type ModelDrift,
} from './model-identity';

export {
  ApprovalRegistry,
  ApprovalError,
  approvalActionHash,
  approvalStatement,
  verifyApprovalSignature,
  APPROVAL_STATEMENT_VERSION,
  DEFAULT_APPROVAL_TTL_MS,
  MAX_APPROVAL_TTL_MS,
  type Approval,
  type ApprovalAction,
  type ApprovalState,
  type ApprovalStoredState,
  type ApprovalAssurance,
  type ApprovalAttestation,
} from './approval';

export {
  Watch,
  type Notice,
  type NoticeKind,
  type NoticeState,
  type WatchCoverage,
  type SweepResult,
} from './watch';

/*
 * Outbound-address classification, shared because the same SSRF was found in
 * three packages that each take a URL from a caller and fetch it. This answers
 * *what kind of address is this*; each caller decides policy, because the right
 * answer genuinely differs — see the module header.
 */
export {
  classifyAddress,
  describeTarget,
  isMetadataHostname,
  resolveRanges,
  inAnyRange,
  RANGE_REASON,
  type AddressRange,
  type ResolvedTarget,
} from './outbound';

export {
  TraceStore,
  SigningKey,
  hashPayload,
  hashTrace,
  canonicalTrace,
  verifyTrace,
  verifySignature,
  replayManifest,
  compareReplay,
  GENESIS_HASH,
  CANONICAL_VERSION,
  SUPPORTED_CANONICAL_VERSIONS,
  canonicalVersionOf,
  minimumCanonicalVersion,
  normaliseCost,
  UnsupportedCanonicalVersion,
  MalformedCanonicalRecord,
  InvalidCost,
  type GovernanceRecord,
  type CostRecord,
  type ExecutionTrace,
  type ExecutionStep,
  type ExecutionOutcome,
  type TraceVerdict,
  type RecordExecutionInput,
} from './trace';

export {
  finding,
  determineTrace,
  renderFinding,
  type Determination,
  type Finding,
} from './determination';

export {
  trustConditions,
  renderConditions,
  type ConditionsReport,
  type TrustCondition,
  type ConditionState,
} from './conditions';

export {
  explainTrace,
  renderExplanation,
  type TraceExplanation,
  type Explanation,
} from './explain';

export { generatePolicy, type GeneratedPolicy, type SensitivityLevel, type FilterLevel } from './ai-policy-generator';

export { describeProviders, type ProviderOption } from './llm-provider';
