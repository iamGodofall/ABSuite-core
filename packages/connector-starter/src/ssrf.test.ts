/**
 * `webhook.send` must not be a way to read the machine it runs on.
 *
 * The action takes its URL from the caller and required only that it begin
 * `https://`. Probing it accepted every one of these and returned the response
 * body:
 *
 *     https://169.254.169.254/latest/meta-data/iam/security-credentials/
 *     https://metadata.google.internal/computeMetadata/v1/
 *     https://127.0.0.1:8081/executions
 *     https://[::1]/admin
 *
 * On a cloud VM the first is the instance metadata service, which is how a
 * machine's IAM credentials are stolen.
 *
 * The capability token is not a defence. The scope is `connector:execute` —
 * *send a webhook*. It does not say *read this machine's cloud credentials*,
 * and a capability that grants more than its name says is the defect this
 * project exists to prevent.
 */
import { runAction } from './connectors';

describe('webhook.send refuses to reach inward', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Stub the network so a regression cannot actually send anything, and so
    // an "accepted" verdict is unambiguous rather than a connection error.
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const send = (url: string, env: NodeJS.ProcessEnv = {}) =>
    runAction('webhook', 'send', { url, payload: { hello: 'world' } }, env);

  test.each([
    ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data/', /metadata service/],
    ['loopback by literal', 'https://127.0.0.1:8081/executions', /loopback/],
    ['loopback by name', 'https://localhost/admin', /loopback/],
    ['loopback over IPv6', 'https://[::1]/admin', /loopback/],
    ['a private range', 'https://10.0.0.5/internal', /private/],
    ['another private range', 'https://192.168.1.1/router', /private/],
    ['a carrier-grade NAT range', 'https://100.64.0.1/', /carrier-grade NAT/],
  ])('refuses %s', async (_label, url, expected) => {
    const result = await send(url);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(expected);
  });

  test('refuses credentials in the URL, which would end up in logs', async () => {
    const result = await send('https://user:pass@example.com/hook');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must not carry credentials/);
  });

  test('still refuses plain http', async () => {
    const result = await send('http://example.com/hook');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must be https/);
  });

  test('a URL that cannot be parsed is refused rather than passed through', async () => {
    const result = await send('not a url at all');

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be parsed/);
  });

  test('a legitimate public webhook still works', async () => {
    const result = await send('https://example.com/hooks/abc');

    expect(result.ok).toBe(true);
  });

  /*
   * The escape hatch has to work, or operators with genuinely internal
   * webhooks will patch it out and lose the protection everywhere.
   */
  test('ABSUITE_ALLOW_PRIVATE_WEBHOOKS=true restores internal delivery', async () => {
    const blocked = await send('https://10.0.0.5/internal');
    expect(blocked.ok).toBe(false);

    const allowed = await send('https://10.0.0.5/internal', {
      ABSUITE_ALLOW_PRIVATE_WEBHOOKS: 'true',
    });
    expect(allowed.ok).toBe(true);
  });
});

/**
 * A webhook URL is itself a credential — anyone holding a Slack or Discord
 * webhook URL can post as that integration. So a failed delivery must not put
 * it in an error string that lands in a log or an API response.
 *
 * This currently holds because Node keeps the URL in `error.cause` rather than
 * `error.message`. That is a property of the runtime, not a decision this code
 * made, which is exactly why it is worth pinning: appending `cause` to the
 * message later would look like an improvement to error reporting.
 */
describe('failed deliveries do not leak the webhook URL', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('a network failure reports the failure, not the secret', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;

    const result = await runAction(
      'slack',
      'postMessage',
      { text: 'hi' },
      { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T00/B11/SUPERSECRETTOKEN' }
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SUPERSECRETTOKEN');
  });
});
