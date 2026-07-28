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
} from './capability';

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

export { AuditLog, type AuditEntry, type AuditQuery, type AuditResult } from './audit';

export { generatePolicy, type GeneratedPolicy, type SensitivityLevel, type FilterLevel } from './ai-policy-generator';

export { describeProviders, type ProviderOption } from './llm-provider';
