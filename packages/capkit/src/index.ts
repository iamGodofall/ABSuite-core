/**
 * @absuite/capkit — capability tokens, JWT primitives, audit logging and
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
  type ExecutionTrace,
  type ExecutionStep,
  type ExecutionOutcome,
  type TraceVerdict,
} from './trace';

export { generatePolicy, type GeneratedPolicy, type SensitivityLevel, type FilterLevel } from './ai-policy-generator';

export { describeProviders, type ProviderOption } from './llm-provider';
