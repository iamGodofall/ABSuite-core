/**
 * Access-policy generation.
 *
 * Turns a plain-English description of what an agent should be allowed to do
 * into a concrete, least-privilege policy: capability scopes, a rate limit, a
 * content-filter level and an audit setting.
 *
 * This is deliberately rule-based and deterministic — the same description
 * always yields the same policy, it needs no API key, and it cannot invent a
 * permission that no rule grants. `source` reports this honestly so callers
 * never mistake it for a model-generated result.
 */

export type SensitivityLevel = 'low' | 'medium' | 'high';
export type FilterLevel = 'relaxed' | 'standard' | 'strict';

export interface GeneratedPolicy {
  policy: string;
  source: 'rule-based';
  scopes: string[];
  sensitivity: SensitivityLevel;
  rateLimitPerMinute: number;
  contentFilter: FilterLevel;
  auditRequired: boolean;
  warnings: string[];
}

interface ActionRule {
  scope: string;
  pattern: RegExp;
  /** Actions that widen blast radius push sensitivity up. */
  elevates?: boolean;
}

const ACTION_RULES: ActionRule[] = [
  { scope: 'read', pattern: /\b(read|view|list|fetch|get|query|search|inspect|monitor)\b/ },
  { scope: 'write', pattern: /\b(write|create|update|edit|modify|save|publish|post)\b/, elevates: true },
  { scope: 'delete', pattern: /\b(delete|remove|drop|purge|destroy|revoke)\b/, elevates: true },
  { scope: 'execute', pattern: /\b(execute|run|trigger|deploy|invoke|schedule|benchmark)\b/, elevates: true },
  { scope: 'notify', pattern: /\b(notify|alert|message|email|slack|discord|page)\b/ },
  { scope: 'admin', pattern: /\b(admin|administrator|root|superuser|full access|all permissions)\b/, elevates: true },
];

const RESOURCE_RULES: Array<{ resource: string; pattern: RegExp }> = [
  { resource: 'users', pattern: /\b(user|users|account|accounts|customer|customers)\b/ },
  { resource: 'tasks', pattern: /\b(task|tasks|job|jobs|workflow|workflows)\b/ },
  { resource: 'billing', pattern: /\b(billing|invoice|invoices|payment|payments|subscription)\b/ },
  { resource: 'secrets', pattern: /\b(secret|secrets|credential|credentials|token|tokens|key|keys)\b/ },
  { resource: 'logs', pattern: /\b(log|logs|audit|telemetry|metric|metrics)\b/ },
  { resource: 'repos', pattern: /\b(repo|repos|repository|repositories|github|code)\b/ },
];

/** Resources that always demand the strictest handling, whatever the verb. */
const SENSITIVE_RESOURCES = new Set(['secrets', 'billing', 'users']);

const RATE_LIMITS: Record<SensitivityLevel, number> = { low: 300, medium: 100, high: 30 };
const FILTERS: Record<SensitivityLevel, FilterLevel> = { low: 'relaxed', medium: 'standard', high: 'strict' };

export function generatePolicy(description: string): GeneratedPolicy {
  const text = description.toLowerCase();
  const warnings: string[] = [];

  const actions = ACTION_RULES.filter(rule => rule.pattern.test(text));
  const resources = RESOURCE_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.resource);

  // Default to read-only when the description implies no explicit action —
  // least privilege is the safe failure mode.
  const effectiveActions = actions.length > 0 ? actions : [ACTION_RULES[0]!];
  if (actions.length === 0) {
    warnings.push('No explicit action verbs were detected; defaulted to read-only access.');
  }

  const effectiveResources = resources.length > 0 ? resources : ['absuite'];
  if (resources.length === 0) {
    warnings.push('No specific resource was detected; scoped the policy to the generic "absuite" resource.');
  }

  const scopes = Array.from(
    new Set(
      effectiveActions.flatMap(action =>
        effectiveResources.map(resource => `${action.scope}:${resource}`)
      )
    )
  ).sort();

  const touchesSensitive = effectiveResources.some(resource => SENSITIVE_RESOURCES.has(resource));
  const elevating = effectiveActions.some(action => action.elevates);

  let sensitivity: SensitivityLevel = 'low';
  if (touchesSensitive || effectiveActions.some(action => action.scope === 'admin')) {
    sensitivity = 'high';
  } else if (elevating) {
    sensitivity = 'medium';
  }

  if (effectiveResources.includes('secrets')) {
    warnings.push('This policy touches secrets; require human approval before issuing it.');
  }
  if (effectiveActions.some(action => action.scope === 'admin')) {
    warnings.push('Admin scope requested — prefer narrowly scoped capabilities over blanket admin access.');
  }

  const rateLimitPerMinute = RATE_LIMITS[sensitivity];
  const contentFilter = FILTERS[sensitivity];
  const auditRequired = sensitivity !== 'low';

  const policy = [
    '# ABSuite Access Policy',
    `# Generated from: "${description.trim()}"`,
    '',
    `sensitivity: ${sensitivity}`,
    `audit_required: ${auditRequired}`,
    '',
    'scopes:',
    ...scopes.map(scope => `  - ${scope}`),
    '',
    'limits:',
    `  rate_limit_per_minute: ${rateLimitPerMinute}`,
    `  content_filter: ${contentFilter}`,
    '  max_token_lifetime: 24h',
    '',
    ...(warnings.length > 0
      ? ['warnings:', ...warnings.map(warning => `  - ${warning}`)]
      : ['warnings: []']),
  ].join('\n');

  return {
    policy,
    source: 'rule-based',
    scopes,
    sensitivity,
    rateLimitPerMinute,
    contentFilter,
    auditRequired,
    warnings,
  };
}
