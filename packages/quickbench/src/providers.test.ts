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
import { HttpProvider, OllamaProvider, OpenAIProvider, AnthropicProvider, createProvider } from './providers';

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

  /*
   * Token counts, per provider.
   *
   * These matter more than they look: `runner.ts` divides completion tokens by
   * elapsed seconds to report tokens-per-second, so a provider that parses the
   * wrong field does not fail — it reports a confident throughput figure that
   * is wrong by whatever the mis-parse costs. Each provider names its counts
   * differently, which is exactly the kind of difference that rots silently.
   */
  const respondWith = (body: unknown) => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  };

  test('ollama reads prompt_eval_count and eval_count', async () => {
    respondWith({ response: 'hello', prompt_eval_count: 7, eval_count: 11 });

    const result = await new OllamaProvider('http://localhost:11434').complete({
      model: 'llama3', prompt: 'hi',
    });

    expect(result.ok).toBe(true);
    expect(result.promptTokens).toBe(7);
    expect(result.completionTokens).toBe(11);
    expect(result.totalTokens).toBe(18);   // ollama sends no total; it is derived
    expect(result.text).toBe('hello');
  });

  test('openai reads usage.prompt_tokens and usage.completion_tokens', async () => {
    respondWith({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 },
    });

    const result = await new OpenAIProvider('sk-test').complete({ model: 'gpt-4o', prompt: 'hi' });

    expect(result.ok).toBe(true);
    expect(result.promptTokens).toBe(7);
    expect(result.completionTokens).toBe(11);
    expect(result.text).toBe('hello');
  });

  test('anthropic reads usage.input_tokens and usage.output_tokens', async () => {
    respondWith({
      content: [{ text: 'hello' }],
      usage: { input_tokens: 7, output_tokens: 11 },
    });

    const result = await new AnthropicProvider('sk-ant-test').complete({
      model: 'claude-opus-5', prompt: 'hi',
    });

    expect(result.ok).toBe(true);
    expect(result.promptTokens).toBe(7);
    expect(result.completionTokens).toBe(11);
    expect(result.text).toBe('hello');
  });

  test('a response missing its usage block reports zero rather than NaN', async () => {
    // A provider that omits usage must not poison arithmetic downstream:
    // NaN tokens-per-second is worse than a stated zero, because it propagates.
    respondWith({ choices: [{ message: { content: 'hello' } }] });

    const result = await new OpenAIProvider('sk-test').complete({ model: 'gpt-4o', prompt: 'hi' });

    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(Number.isNaN(result.completionTokens)).toBe(false);
  });

  test('a body that is not JSON is an error, not a crash', async () => {
    globalThis.fetch = (async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })) as typeof fetch;

    const result = await new OpenAIProvider('sk-test').complete({ model: 'gpt-4o', prompt: 'hi' });

    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  test('createProvider refuses an http provider with no url rather than inventing one', () => {
    expect(() => createProvider('http')).toThrow(/requires a url/);
    expect(() => createProvider('nonesuch')).toThrow(/Unknown provider/);
  });
});
