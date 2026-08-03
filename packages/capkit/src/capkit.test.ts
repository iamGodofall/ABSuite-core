import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapabilityToken, RevocationList, hasCapability, scopeSatisfies } from './capability';
import { signJwt, verifyJwt, parseDuration, base64UrlEncode } from './jwt';
import { AuditLog } from './audit';
import { MemoryRevocationStore, FileRevocationStore, revocationStoreFromEnv } from './revocation-store';
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

describe('tamper-evident audit chain', () => {
  test('links entries and verifies clean', () => {
    const log = new AuditLog();
    log.record({ subject: 'a', action: 'x', resource: 'r', result: 'allow' });
    log.record({ subject: 'b', action: 'y', resource: 'r', result: 'deny' });
    log.record({ subject: 'c', action: 'z', resource: 'r', result: 'allow' });

    const verified = log.verifyChain();
    expect(verified.valid).toBe(true);
    expect(verified.checked).toBe(3);
    expect(log.headHash).toHaveLength(64);
  });

  test('detects an edited historical entry', () => {
    const log = new AuditLog();
    log.record({ subject: 'a', action: 'x', resource: 'r', result: 'deny' });
    log.record({ subject: 'b', action: 'y', resource: 'r', result: 'allow' });

    // Someone rewrites a denial into an approval after the fact.
    const entries = log.query().entries;
    const tampered = entries.find(entry => entry.subject === 'a')!;
    tampered.result = 'allow';

    const verified = log.verifyChain();
    expect(verified.valid).toBe(false);
    expect(verified.brokenAt).toBe(0);
    expect(verified.reason).toMatch(/does not match its hash/i);
  });

  test('detects a deleted entry breaking the links', () => {
    const log = new AuditLog();
    log.record({ subject: 'a', action: 'x', resource: 'r', result: 'allow' });
    log.record({ subject: 'b', action: 'y', resource: 'r', result: 'allow' });
    log.record({ subject: 'c', action: 'z', resource: 'r', result: 'allow' });

    // Splice out the middle entry, as an attacker covering their tracks would.
    (log as unknown as { entries: unknown[] }).entries.splice(1, 1);

    const verified = log.verifyChain();
    expect(verified.valid).toBe(false);
    expect(verified.reason).toMatch(/predecessor/i);
  });

  test('an empty log is trivially valid', () => {
    expect(new AuditLog().verifyChain()).toEqual({ valid: true, checked: 0 });
  });
});

describe('revocation stores', () => {
  test('memory store revokes and prunes', async () => {
    const store = new MemoryRevocationStore();
    const future = Math.floor(Date.now() / 1000) + 3600;

    expect(await store.isRevoked('a')).toBe(false);
    await store.revoke('a', future);
    expect(await store.isRevoked('a')).toBe(true);

    await store.revoke('stale', Math.floor(Date.now() / 1000) - 10);
    expect(await store.isRevoked('stale')).toBe(false);
  });

  test('file store makes a revocation visible to a second instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'absuite-revoke-'));
    const path = join(dir, 'revocations.jsonl');
    const future = Math.floor(Date.now() / 1000) + 3600;

    const writer = new FileRevocationStore(path);
    await writer.revoke('shared-jti', future);

    // A separate replica reading the same file must see the revocation.
    const reader = new FileRevocationStore(path);
    expect(await reader.isRevoked('shared-jti')).toBe(true);
    expect(await reader.isRevoked('other-jti')).toBe(false);
  });

  test('file store picks up a revocation written after it started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'absuite-revoke-'));
    const path = join(dir, 'revocations.jsonl');

    const reader = new FileRevocationStore(path);
    expect(await reader.isRevoked('later')).toBe(false);

    const writer = new FileRevocationStore(path);
    await writer.revoke('later', Math.floor(Date.now() / 1000) + 3600);

    expect(await reader.isRevoked('later')).toBe(true);
  });

  test('env selects the file store only when configured', () => {
    expect(revocationStoreFromEnv({})).toBeInstanceOf(MemoryRevocationStore);
    const dir = mkdtempSync(join(tmpdir(), 'absuite-revoke-'));
    expect(revocationStoreFromEnv({ CAPKIT_REVOCATION_FILE: join(dir, 'r.jsonl') })).toBeInstanceOf(FileRevocationStore);
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

describe('the admin key is compared in constant time', () => {
  /**
   * Found by auditing rather than by a failure.
   *
   * The dashboard's admin check has used timingSafeEqual since it was written;
   * this one used `===`, so the two halves of the same product disagreed about
   * the same secret — and the weaker check guarded the stronger capability,
   * since this is the one that decides whether a caller may mint capability
   * tokens for any subject they like.
   *
   * A unit test cannot measure nanoseconds reliably in CI, so this asserts the
   * property that actually matters and can be checked deterministically: the
   * source uses a constant-time primitive, and no early-exit comparison of the
   * admin key survives in it.
   */
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'middleware.ts'), 'utf8'
  ) as string;

  test('uses timingSafeEqual rather than string equality', () => {
    expect(source).toContain('timingSafeEqual');
    // The exact shape that was there before, in any spacing.
    expect(source).not.toMatch(/providedAdminKey\s*===\s*adminKey/);
    expect(source).not.toMatch(/adminKey\s*===\s*providedAdminKey/);
  });

  test('a wrong key of the right length is still refused', async () => {
    const { capabilityGuard } = require('./middleware') as typeof import('./middleware');
    const guard = capabilityGuard({ adminKey: 'a'.repeat(32), secret: 'x'.repeat(48) })('any:scope');

    const refused = await new Promise<number>(resolve => {
      const req = { header: (name: string) => (name === 'x-absuite-admin-key' ? 'b'.repeat(32) : '') } as never;
      const res = {
        status(code: number) { resolve(code); return { json: () => undefined }; },
      } as never;
      void guard(req, res, () => resolve(200));
    });

    expect(refused).not.toBe(200);
  });

  test('the correct key is still accepted', async () => {
    const { capabilityGuard } = require('./middleware') as typeof import('./middleware');
    const guard = capabilityGuard({ adminKey: 'a'.repeat(32), secret: 'x'.repeat(48) })('any:scope');

    const allowed = await new Promise<boolean>(resolve => {
      const req = { header: (name: string) => (name === 'x-absuite-admin-key' ? 'a'.repeat(32) : '') } as never;
      const res = { status() { resolve(false); return { json: () => undefined }; } } as never;
      void guard(req, res, () => resolve(true));
    });

    expect(allowed).toBe(true);
  });
});

/**
 * The eight rejection codes, and what a default token actually carries.
 *
 * The package README listed four of the eight, so a caller switching on
 * `result.error` fell through on half of them — including
 * `TOKEN_AUDIENCE_MISMATCH`, which is the one that matters if you thought
 * audience binding was protecting you.
 *
 * `docs/SECURITY-MODEL.md` separately showed `kid` and `aud` as unconditional
 * fields of every token. Both are opt-in and absent by default, which was found
 * by decoding a minted token rather than by reading the interface.
 */
describe('what the documentation publishes about a token', () => {
  const SECRET = 'x'.repeat(32);

  const decode = (token: string) =>
    token.split('.').slice(0, 2).map(part => JSON.parse(Buffer.from(part, 'base64url').toString()));

  test('a default token carries sub, scope, iat, exp and jti — and nothing else', () => {
    const { token } = CapabilityToken.create(
      { sub: 'agent-42', scope: ['read:users'], expiresIn: '8h' }, SECRET);
    const [header, payload] = decode(token);

    expect(Object.keys(payload as object).sort()).toEqual(['exp', 'iat', 'jti', 'scope', 'sub']);
    // Not in the header either. The document showed it as always present.
    expect(header).not.toHaveProperty('kid');
  });

  test('kid and aud appear only when supplied', () => {
    const { token } = CapabilityToken.create(
      { sub: 'agent-42', scope: ['read:users'], expiresIn: '8h',
        aud: 'absuite://production', kid: 'key-2026-08' }, SECRET);
    const [header, payload] = decode(token);

    expect((header as { kid?: string }).kid).toBe('key-2026-08');
    expect((payload as { aud?: string }).aud).toBe('absuite://production');
  });

  test('a mismatched audience is refused, with the code the docs now list', () => {
    const { token } = CapabilityToken.create(
      { sub: 'agent-42', scope: ['read:users'], expiresIn: '8h', aud: 'absuite://production' }, SECRET);

    const result = CapabilityToken.validate(token, SECRET, { audience: 'absuite://staging' });

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('unreachable — narrows the union');
    expect(result.error).toBe('TOKEN_AUDIENCE_MISMATCH');
  });

  /*
   * The enumeration itself. If a ninth code is added, this fails and whoever
   * adds it has to decide what the documents should say — which is the only
   * mechanism that would have caught the list going stale at four.
   */
  test('there are exactly eight rejection codes', () => {
    const documented = [
      'TOKEN_MISSING', 'TOKEN_MALFORMED', 'TOKEN_INVALID', 'TOKEN_EXPIRED',
      'TOKEN_NOT_ACTIVE', 'TOKEN_AUDIENCE_MISMATCH', 'TOKEN_REVOKED',
      'CAPABILITY_INSUFFICIENT',
    ];

    const sources = ['capability.ts', 'jwt.ts', 'middleware.ts']
      .map(name => readFileSync(join(__dirname, name), 'utf8'))
      .join('\n');

    const found = new Set(
      [...sources.matchAll(/'(TOKEN_[A-Z_]+|CAPABILITY_[A-Z_]+)'/g)].map(match => match[1]!)
    );

    expect([...found].sort()).toEqual([...documented].sort());
  });
});
