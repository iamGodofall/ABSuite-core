import { CapabilityToken, RevocationList, hasCapability, scopeSatisfies } from './capability';
import { signJwt, verifyJwt, parseDuration, base64UrlEncode } from './jwt';
import { AuditLog } from './audit';
import { generatePolicy } from './ai-policy-generator';
import { describeProviders } from './llm-provider';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

describe('jwt primitives', () => {
  test('signs and verifies a round trip', () => {
    const token = signJwt({ sub: 'agent-1', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    const result = verifyJwt(token, SECRET);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('agent-1');
    }
  });

  test('rejects a token signed with a different secret', () => {
    const token = signJwt({ sub: 'agent-1' }, SECRET);
    const result = verifyJwt(token, 'a-completely-different-secret-value');

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('TOKEN_INVALID');
  });

  test('rejects a tampered payload', () => {
    const token = signJwt({ sub: 'agent-1', scope: ['read:users'] }, SECRET);
    const [header, , signature] = token.split('.');
    const forgedPayload = base64UrlEncode(JSON.stringify({ sub: 'agent-1', scope: ['*'] }));
    const forged = `${header}.${forgedPayload}.${signature}`;

    const result = verifyJwt(forged, SECRET);
    expect(result.valid).toBe(false);
  });

  test('rejects the "alg: none" downgrade', () => {
    const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = base64UrlEncode(JSON.stringify({ sub: 'attacker', scope: ['*'] }));
    const result = verifyJwt(`${header}.${payload}.`, SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('TOKEN_INVALID');
  });

  test('rejects an expired token', () => {
    const token = signJwt({ sub: 'agent-1', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    const result = verifyJwt(token, SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('TOKEN_EXPIRED');
  });

  test('rejects malformed tokens', () => {
    expect(verifyJwt('not-a-token', SECRET).valid).toBe(false);
    expect(verifyJwt('', SECRET).valid).toBe(false);
  });

  test('parses duration strings', () => {
    expect(parseDuration('30s')).toBe(30);
    expect(parseDuration('15m')).toBe(900);
    expect(parseDuration('8h')).toBe(28800);
    expect(parseDuration('7d')).toBe(604800);
    expect(parseDuration(120)).toBe(120);
    expect(() => parseDuration('soon')).toThrow();
    expect(() => parseDuration('0h')).toThrow();
  });
});

describe('scope matching', () => {
  test('matches exact scopes', () => {
    expect(scopeSatisfies('read:users', 'read:users')).toBe(true);
    expect(scopeSatisfies('read:users', 'write:users')).toBe(false);
  });

  test('honours wildcards', () => {
    expect(scopeSatisfies('*', 'anything:at:all')).toBe(true);
    expect(scopeSatisfies('read:*', 'read:users')).toBe(true);
    expect(scopeSatisfies('*:users', 'write:users')).toBe(true);
  });

  test('does not let a shorter scope grant a deeper one', () => {
    expect(scopeSatisfies('read:users', 'read:users:delete')).toBe(false);
    expect(scopeSatisfies('read:*', 'read:users:delete')).toBe(false);
  });

  test('checks a set of granted scopes', () => {
    expect(hasCapability(['read:users', 'write:tasks'], 'write:tasks')).toBe(true);
    expect(hasCapability(['read:users'], 'delete:users')).toBe(false);
  });
});

describe('capability tokens', () => {
  test('creates a token carrying its scopes', () => {
    const created = CapabilityToken.create({ sub: 'agent-1', scope: ['read:users'], expiresIn: '1h' }, SECRET);
    const result = CapabilityToken.validate(created.token, SECRET);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.claims.sub).toBe('agent-1');
      expect(result.claims.scope).toEqual(['read:users']);
      expect(result.claims.jti).toBe(created.jti);
    }
  });

  test('requires a subject and at least one scope', () => {
    expect(() => CapabilityToken.create({ sub: '', scope: ['read:users'] }, SECRET)).toThrow();
    expect(() => CapabilityToken.create({ sub: 'agent-1', scope: [] }, SECRET)).toThrow();
  });

  test('enforces a required scope at validation time', () => {
    const created = CapabilityToken.create({ sub: 'agent-1', scope: ['read:users'] }, SECRET);
    const result = CapabilityToken.validate(created.token, SECRET, { requiredScope: 'write:users' });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('CAPABILITY_INSUFFICIENT');
  });

  test('enforces audience when one is required', () => {
    const created = CapabilityToken.create({ sub: 'agent-1', scope: ['read:users'], aud: 'absuite://prod' }, SECRET);
    const result = CapabilityToken.validate(created.token, SECRET, { audience: 'absuite://staging' });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('TOKEN_AUDIENCE_MISMATCH');
  });

  test('honours the revocation list', () => {
    const revocations = new RevocationList();
    const created = CapabilityToken.create({ sub: 'agent-1', scope: ['read:users'] }, SECRET);

    expect(CapabilityToken.validate(created.token, SECRET, { isRevoked: jti => revocations.isRevoked(jti) }).valid).toBe(true);

    revocations.revoke(created.jti, created.exp);
    const afterRevoke = CapabilityToken.validate(created.token, SECRET, { isRevoked: jti => revocations.isRevoked(jti) });

    expect(afterRevoke.valid).toBe(false);
    if (!afterRevoke.valid) expect(afterRevoke.error).toBe('TOKEN_REVOKED');
  });

  test('prunes revocations for tokens that already expired', () => {
    const revocations = new RevocationList();
    revocations.revoke('stale-jti', Math.floor(Date.now() / 1000) - 60);
    expect(revocations.isRevoked('stale-jti')).toBe(false);
  });
});

describe('audit log', () => {
  test('records and returns entries newest first', () => {
    const log = new AuditLog();
    log.record({ subject: 'agent-1', action: 'GET /a', resource: '/a', result: 'allow' });
    log.record({ subject: 'agent-2', action: 'GET /b', resource: '/b', result: 'deny' });

    const { entries, total } = log.query();
    expect(total).toBe(2);
    expect(entries[0]?.subject).toBe('agent-2');
  });

  test('filters by subject and result', () => {
    const log = new AuditLog();
    log.record({ subject: 'agent-1', action: 'GET /a', resource: '/a', result: 'allow' });
    log.record({ subject: 'agent-2', action: 'GET /b', resource: '/b', result: 'deny' });

    expect(log.query({ subject: 'agent-1' }).total).toBe(1);
    expect(log.query({ result: 'deny' }).total).toBe(1);
  });

  test('clamps the limit to a sane range', () => {
    const log = new AuditLog();
    log.record({ subject: 'a', action: 'x', resource: 'x', result: 'allow' });

    expect(log.query({ limit: 100000 }).limit).toBe(500);
    expect(log.query({ limit: -5 }).limit).toBe(50);
  });
});

describe('policy generation', () => {
  test('derives scopes from a description', () => {
    const policy = generatePolicy('Read and update tasks for the sync agent');
    expect(policy.scopes).toContain('read:tasks');
    expect(policy.scopes).toContain('write:tasks');
    expect(policy.source).toBe('rule-based');
  });

  test('defaults to read-only when no action is stated', () => {
    const policy = generatePolicy('something vague about tasks');
    expect(policy.scopes).toEqual(['read:tasks']);
    expect(policy.warnings.join(' ')).toMatch(/read-only/);
  });

  test('raises sensitivity for secrets and tightens the limits', () => {
    const policy = generatePolicy('read and delete credentials from the secrets store');
    expect(policy.sensitivity).toBe('high');
    expect(policy.contentFilter).toBe('strict');
    expect(policy.rateLimitPerMinute).toBe(30);
    expect(policy.auditRequired).toBe(true);
    expect(policy.warnings.join(' ')).toMatch(/human approval/);
  });

  test('is deterministic', () => {
    const description = 'Create and execute deployment workflows';
    expect(generatePolicy(description)).toEqual(generatePolicy(description));
  });
});

describe('provider inspection', () => {
  test('reports providers as unconfigured when no keys are present', () => {
    const { providers, recommended } = describeProviders({});
    expect(providers.every(provider => !provider.configured)).toBe(true);
    expect(recommended).toBe('none');
  });

  test('detects a configured hosted provider', () => {
    const { providers, recommended } = describeProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(providers.find(provider => provider.name === 'anthropic')?.configured).toBe(true);
    expect(recommended).toBe('anthropic');
  });

  test('prefers a configured local provider over a hosted one', () => {
    const { recommended } = describeProviders({ ANTHROPIC_API_KEY: 'sk-ant-test', OLLAMA_URL: 'http://localhost:11434' });
    expect(recommended).toBe('ollama');
  });
});
