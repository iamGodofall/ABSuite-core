/**
 * Providers must time the attempts that fail, not only the ones that succeed.
 *
 * Every provider's `catch` returned `latencyMs: 0` — a number no measurement
 * produced, in the package whose entire job is reporting how long things take.
 * A request aborting after the full 120-second timeout was reported as having
 * taken no time at all.
 *
 * It never reached a percentile, because `runner.ts` filters to successes
 * before summarising latency. That is what made it survive: a latent lie, wrong
 * the whole time and visible only to somebody calling a provider directly.
 */
import { HttpProvider, OpenAIProvider, AnthropicProvider, createProvider } from './providers';

describe('providers report what they measured', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test('a request that fails slowly reports how long it took', async () => {
    // The shape of a degraded provider: it does not refuse quickly, it hangs
    // and then throws. Reporting 0ms for this is the defect.
    globalThis.fetch = (async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      throw new Error('socket hang up');
    }) as typeof fetch;

    const result = await new HttpProvider('http://example.invalid').complete({
      model: 'n/a', prompt: 'n/a',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/socket hang up/);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  test('an HTTP error status is timed, because the server did answer', async () => {
    globalThis.fetch = (async () => new Response('rate limited', { status: 429 })) as typeof fetch;

    const result = await new HttpProvider('http://example.invalid').complete({
      model: 'n/a', prompt: 'n/a',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/429/);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  test('a successful request reports its own latency, not the wrapper timing', async () => {
    globalThis.fetch = (async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const result = await new HttpProvider('http://example.invalid').complete({
      model: 'n/a', prompt: 'n/a',
    });

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  /*
   * The one place zero is honest.
   *
   * No request is made when the key is absent, so nothing was measured and
   * nothing is claimed. This is asserted so that a future pass tightening the
   * rule above does not "fix" a number that is already correct.
   */
  test.each([
    ['openai', () => new OpenAIProvider(''), /OPENAI_API_KEY/],
    ['anthropic', () => new AnthropicProvider(''), /ANTHROPIC_API_KEY/],
  ])('%s reports 0ms when unconfigured, because no call was made', async (_name, make, message) => {
    const result = await make().complete({ model: 'n/a', prompt: 'n/a' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(message);
    expect(result.latencyMs).toBe(0);
  });

  test('createProvider refuses an http provider with no url rather than inventing one', () => {
    expect(() => createProvider('http')).toThrow(/requires a url/);
    expect(() => createProvider('nonesuch')).toThrow(/Unknown provider/);
  });
});
