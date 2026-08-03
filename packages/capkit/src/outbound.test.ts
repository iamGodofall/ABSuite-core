/**
 * The shared outbound-address classifier.
 *
 * It exists because the same SSRF was found in three packages, and three fixes
 * were about to become three copies of one guard — the defect this repository
 * keeps catching in itself, where fixing one copy leaves the others quietly
 * wrong.
 *
 * It classifies and does not decide, because the right policy genuinely differs:
 * `webhook.send` refuses private ranges (it posts to third parties), while
 * edge-run and quickbench allow them (calling your own internal service is
 * their primary job). A shared `isAllowed()` would have had to pick a side and
 * be wrong somewhere.
 */
import { classifyAddress, describeTarget, isMetadataHostname, resolveRanges, inAnyRange } from './outbound';

describe('classifying an address', () => {
  test.each([
    ['127.0.0.1', 'loopback'],
    ['127.53.1.9', 'loopback'],
    ['10.0.0.5', 'private'],
    ['192.168.1.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'carrier-grade-nat'],
    ['0.0.0.0', 'unspecified'],
    ['8.8.8.8', 'public'],
    ['::1', 'loopback'],
    ['fe80::1', 'link-local'],
    ['fd00::1', 'unique-local'],
    ['2606:4700::1111', 'public'],
  ])('%s is %s', (address, expected) => {
    expect(classifyAddress(address)).toBe(expected);
  });

  test('172.32.0.1 is public — the private range stops at 172.31', () => {
    // The 172.16/12 boundary is the one people get wrong, in both directions.
    expect(classifyAddress('172.15.0.1')).toBe('public');
    expect(classifyAddress('172.32.0.1')).toBe('public');
  });

  test('an IPv4 address wearing an IPv6 coat is still classified', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('link-local');
  });
});

describe('describing what matched', () => {
  /*
   * The reason string was wrong once, and the tests caught it during the
   * refactor that introduced it. A shared `RANGE_REASON['link-local']` read
   * "the cloud instance metadata range (169.254.0.0/16)" — true of one address
   * family and plainly false when printed about `fe80::1`.
   *
   * A shared classifier must not bake one caller's phrasing into every caller's
   * error message.
   */
  test('names the metadata range only when it really is that range', () => {
    expect(describeTarget('169.254.169.254')).toMatch(/169\.254\.0\.0\/16/);
    expect(describeTarget('fe80::1')).toMatch(/IPv6 link-local/);
    expect(describeTarget('fe80::1')).not.toMatch(/169\.254/);
  });

  test('a non-link-local address is described by its category', () => {
    expect(describeTarget('10.0.0.5')).toBe('a private address');
    expect(describeTarget('8.8.8.8')).toBe('a public address');
  });
});

describe('the metadata hostname', () => {
  /*
   * `metadata.google.internal` resolves to 169.254.169.254 on GCP and returns
   * ENOTFOUND everywhere else — verified, not assumed. A resolution-based check
   * therefore only works in the one environment where it is hardest to test,
   * which is why the name is matched directly.
   */
  test.each([
    'metadata.google.internal',
    'METADATA.GOOGLE.INTERNAL',
    'metadata.goog',
    'something.metadata.google.internal',
  ])('%s is recognised without a resolver', (host) => {
    expect(isMetadataHostname(host)).toBe(true);
  });

  test.each([
    'example.com',
    'metadata.example.com',
    'notmetadata.goog.example.com',
  ])('%s is not', (host) => {
    expect(isMetadataHostname(host)).toBe(false);
  });
});

describe('resolving a target', () => {
  test('a literal address needs no resolver', async () => {
    const resolved = await resolveRanges('169.254.169.254');

    expect(resolved).toHaveLength(1);
    expect(resolved![0]!.range).toBe('link-local');
    expect(resolved![0]!.why).toMatch(/169\.254\.0\.0\/16/);
  });

  test('the metadata hostname is caught by name, with its own reason', async () => {
    const resolved = await resolveRanges('metadata.google.internal');

    expect(resolved![0]!.range).toBe('link-local');
    expect(resolved![0]!.why).toMatch(/GCP metadata service/);
  });

  test('a name that will not resolve returns undefined rather than a refusal', async () => {
    // It fails at fetch anyway. Reporting a DNS outage as a security event
    // teaches operators to ignore security events.
    expect(await resolveRanges('no-such-host.invalid')).toBeUndefined();
  });

  test('bracketed IPv6 is unwrapped before classification', async () => {
    const resolved = await resolveRanges('[fe80::1]');
    expect(resolved![0]!.range).toBe('link-local');
  });
});

describe('inAnyRange', () => {
  test('finds the first match and carries its reason', async () => {
    const hit = inAnyRange(await resolveRanges('169.254.169.254'), ['link-local']);

    expect(hit).toBeDefined();
    expect(hit!.why).toMatch(/metadata/);
  });

  test('returns undefined for an allowed range, and for an unresolvable name', async () => {
    expect(inAnyRange(await resolveRanges('10.0.0.5'), ['link-local'])).toBeUndefined();
    expect(inAnyRange(undefined, ['link-local'])).toBeUndefined();
  });

  test('a caller may refuse several ranges at once', async () => {
    // What connector-starter does, and why the classifier does not decide.
    expect(inAnyRange(await resolveRanges('10.0.0.5'), ['link-local', 'private', 'loopback'])).toBeDefined();
  });
});
