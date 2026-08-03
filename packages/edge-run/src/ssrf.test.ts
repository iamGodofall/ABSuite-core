/**
 * An `http` task must not be a way to read the machine's cloud credentials.
 *
 * `EDGERUN_ALLOWED_HOSTS` empty means *any host*, and empty is the documented
 * default. So out of the box, probing found every one of these reachable, with
 * the response body returned in `output`:
 *
 *     http://169.254.169.254/latest/meta-data/iam/security-credentials/
 *     http://metadata.google.internal/computeMetadata/v1/
 *
 * Plain `http:` is accepted, and that detail is the whole difference from the
 * sibling defect in connector-starter: **AWS IMDSv1 is HTTP-only.** Requiring
 * https there incidentally blocked the classic credential-theft path. Here
 * nothing did.
 *
 * A `queue:write` scope means *queue a task*. It does not mean *read this
 * machine's IAM credentials*.
 *
 * ## Why private ranges are deliberately still allowed
 *
 * edge-run is a task runner inside your own infrastructure. *Call
 * `http://10.0.0.5/reindex` every fifteen minutes* is the product's primary
 * job, not an attack. Blocking `10.x` by default would break real deployments
 * to prevent nothing — and a control that breaks the main use case gets
 * switched off, which protects nobody. Link-local is different: never a
 * legitimate scheduled-task target, and the highest-value one there is.
 */
import { TaskRuntime } from './runtime';

describe('http tasks refuse the cloud metadata service', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Stub the network so a regression cannot actually reach anything, and so
    // "reached" is unambiguous rather than a connection error.
    globalThis.fetch = (async () => new Response('{"creds":"stolen"}', { status: 200 })) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const run = (url: string, allowedHosts?: string[]) =>
    new TaskRuntime(allowedHosts ? { allowedHosts } : {}).execute({ type: 'http', url });

  test.each([
    ['the AWS/GCP/Azure metadata address', 'http://169.254.169.254/latest/meta-data/', /metadata range/],
    ['anything else in link-local', 'http://169.254.1.1/', /metadata range/],
    ['IPv6 link-local', 'http://[fe80::1]/admin', /IPv6 link-local/],
  ])('refuses %s', async (_label, url, expected) => {
    const result = await run(url);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(expected);
  });

  /*
   * By name, not only by address.
   *
   * `metadata.google.internal` resolves to 169.254.169.254 on GCP and returns
   * ENOTFOUND everywhere else — verified, not assumed. So a DNS-based check
   * catches it only in the one environment where it is hardest to test, which
   * is why the name is refused outright.
   */
  test.each([
    ['metadata.google.internal', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['metadata.goog', 'http://metadata.goog/computeMetadata/v1/'],
  ])('refuses %s by name, without depending on the resolver', async (_label, url) => {
    const result = await run(url);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GCP metadata service/);
  });

  test('still refuses a protocol that is not http or https', async () => {
    const result = await run('file:///etc/passwd');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unsupported protocol/);
  });
});

describe('the task runner keeps doing its job', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const run = (url: string, allowedHosts?: string[]) =>
    new TaskRuntime(allowedHosts ? { allowedHosts } : {}).execute({ type: 'http', url });

  test.each([
    ['a private address, which is the primary use case', 'http://10.0.0.5/reindex'],
    ['another private range', 'http://192.168.1.10/webhook'],
    ['loopback, for a sidecar', 'http://127.0.0.1:8081/health'],
    ['an ordinary public host', 'https://example.com/hook'],
  ])('still calls %s', async (_label, url) => {
    const result = await run(url);

    expect(result.ok).toBe(true);
  });

  test('an explicit allowlist entry wins, because the operator said what they meant', async () => {
    const refused = await run('http://169.254.169.254/x');
    expect(refused.ok).toBe(false);

    const allowed = await run('http://169.254.169.254/x', ['169.254.169.254']);
    expect(allowed.ok).toBe(true);
  });

  test('an allowlist still excludes everything not on it', async () => {
    const result = await run('https://example.com/hook', ['internal.example.net']);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Host not allowed/);
  });
});
