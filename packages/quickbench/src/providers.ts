/**
 * LLM provider adapters.
 *
 * Each adapter issues one completion and reports latency, token counts and
 * time-to-first-token where the provider exposes it. Adapters normalise onto a
 * single shape so benchmarks compare like with like across providers.
 */
import { resolveRanges, inAnyRange } from '@absuitecore/capkit';


export interface CompletionRequest {
  model: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  ok: boolean;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  text?: string;
  error?: string;
}

export interface Provider {
  readonly name: string;
  readonly configured: boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

const DEFAULT_TIMEOUT = 120_000;

/**
 * Refuse the cloud metadata service, and nothing else.
 *
 * The classifier lives in capkit because the identical SSRF was found in three
 * packages; the *policy* lives here because the right policy differs per
 * caller. See `capkit/src/outbound.ts`.
 */
async function refuseMetadataTarget(url: string): Promise<string | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Invalid benchmark URL: ${url}`;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `Unsupported protocol for a benchmark target: ${parsed.protocol}`;
  }

  // Unresolvable is not a refusal — it fails at fetch, and reporting a DNS
  // outage as a security event teaches people to ignore security events.
  const blocked = inAnyRange(await resolveRanges(parsed.hostname), ['link-local']);
  return blocked
    ? `Refusing to benchmark ${parsed.hostname}: it is ${blocked.why}.`
    : undefined;
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number) {
  const startedAt = performance.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  const latencyMs = performance.now() - startedAt;
  return { response, text, latencyMs };
}

/**
 * Time an attempt, including the attempts that fail.
 *
 * Every provider's `catch` used to return `latencyMs: 0`, which is a number no
 * measurement produced. A request that aborted after the full 120-second
 * timeout was reported as having taken no time at all — in a benchmarking tool,
 * whose entire job is to report how long things take.
 *
 * It was invisible because `runner.ts` filters to successes before computing
 * latency, so the fabricated zero never reached a percentile. That makes it a
 * latent lie rather than a live one: harmless until somebody calls a provider
 * directly, and wrong the whole time.
 *
 * **How long the failures took is often the number that matters.** A provider
 * degrading under load fails slowly, and "every request errored" tells you far
 * less than "every request errored after 119 seconds".
 */
async function attempt(
  startedAt: number,
  run: () => Promise<CompletionResult>
): Promise<CompletionResult> {
  try {
    return await run();
  } catch (error) {
    return {
      ok: false,
      latencyMs: performance.now() - startedAt,
      error: (error as Error).message,
    };
  }
}

/** Ollama — local inference, no API key, so it is the default for CI. */
export class OllamaProvider implements Provider {
  readonly name = 'ollama';
  private readonly baseUrl: string;

  constructor(baseUrl = process.env.QUICKBENCH_OLLAMA_URL || process.env.OLLAMA_URL || 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const startedAt = performance.now();
    return attempt(startedAt, async () => {
      const { response, text, latencyMs } = await timedFetch(
        `${this.baseUrl}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            prompt: request.prompt,
            stream: false,
            options: { num_predict: request.maxTokens ?? 128 },
          }),
        },
        request.timeoutMs ?? DEFAULT_TIMEOUT
      );

      if (!response.ok) {
        return { ok: false, latencyMs, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
      }

      const data = JSON.parse(text) as {
        response?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const promptTokens = data.prompt_eval_count ?? 0;
      const completionTokens = data.eval_count ?? 0;

      return {
        ok: true,
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        text: data.response ?? '',
      };
    });
  }
}

export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey = process.env.OPENAI_API_KEY || '', baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') {
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // Zero is the measurement here, not a placeholder: no request was made.
    if (!this.configured) return { ok: false, latencyMs: 0, error: 'OPENAI_API_KEY is not set' };

    const startedAt = performance.now();
    return attempt(startedAt, async () => {
      const { response, text, latencyMs } = await timedFetch(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: request.model,
            messages: [{ role: 'user', content: request.prompt }],
            max_tokens: request.maxTokens ?? 128,
          }),
        },
        request.timeoutMs ?? DEFAULT_TIMEOUT
      );

      if (!response.ok) {
        return { ok: false, latencyMs, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
      }

      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      return {
        ok: true,
        latencyMs,
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        text: data.choices?.[0]?.message?.content ?? '',
      };
    });
  }
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY || '', baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1') {
    this.apiKey = apiKey.trim();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // Zero is the measurement here, not a placeholder: no request was made.
    if (!this.configured) return { ok: false, latencyMs: 0, error: 'ANTHROPIC_API_KEY is not set' };

    const startedAt = performance.now();
    return attempt(startedAt, async () => {
      const { response, text, latencyMs } = await timedFetch(
        `${this.baseUrl}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxTokens ?? 128,
            messages: [{ role: 'user', content: request.prompt }],
          }),
        },
        request.timeoutMs ?? DEFAULT_TIMEOUT
      );

      if (!response.ok) {
        return { ok: false, latencyMs, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
      }

      const data = JSON.parse(text) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const promptTokens = data.usage?.input_tokens ?? 0;
      const completionTokens = data.usage?.output_tokens ?? 0;

      return {
        ok: true,
        latencyMs,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        text: data.content?.[0]?.text ?? '',
      };
    });
  }
}

/**
 * HTTP endpoint benchmarking — for measuring an agent service, not a model.
 *
 * ## The one target it refuses
 *
 * `POST /run` takes `url` from the request body under a `bench:run` scope, so
 * an agent chooses what gets benchmarked. Probing found it would reach
 * `http://169.254.169.254/` — the cloud instance metadata service.
 *
 * **This is the least severe of the three places that defect was found, and
 * saying so matters more than making it sound worse.** Measured: the provider
 * returns `{ ok, latencyMs }` and never the response body, so nothing is
 * exfiltrated. Volume is capped at 500 runs and 32 concurrent. What remains is
 * real but narrower — an existence and latency oracle for mapping an internal
 * network, and a bounded amount of traffic aimed at a host of the caller's
 * choosing.
 *
 * Private and loopback addresses are deliberately still allowed. Benchmarking
 * your own service at `http://10.0.0.5/` is the entire point of this provider,
 * and a guard that broke the primary use case would be switched off, which
 * protects nobody. Link-local is refused because it is never a benchmark
 * target and is the only one that leaks something about the machine itself.
 */
export class HttpProvider implements Provider {
  readonly name = 'http';
  readonly configured = true;

  constructor(private readonly url: string, private readonly method = 'GET') {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const startedAt = performance.now();

    const refusal = await refuseMetadataTarget(this.url);
    if (refusal) return { ok: false, latencyMs: performance.now() - startedAt, error: refusal };

    return attempt(startedAt, async () => {
      const { response, latencyMs } = await timedFetch(
        this.url,
        { method: this.method },
        request.timeoutMs ?? 30_000
      );
      return response.ok
        ? { ok: true, latencyMs }
        : { ok: false, latencyMs, error: `HTTP ${response.status}` };
    });
  }
}

export function createProvider(name: string, options: { url?: string } = {}): Provider {
  switch (name.toLowerCase()) {
    case 'ollama': return new OllamaProvider();
    case 'openai': return new OpenAIProvider();
    case 'anthropic': return new AnthropicProvider();
    case 'http': {
      if (!options.url) throw new Error('The http provider requires a url');
      return new HttpProvider(options.url);
    }
    default: throw new Error(`Unknown provider: ${name}`);
  }
}

export function availableProviders(): Array<{ name: string; configured: boolean }> {
  return [new OllamaProvider(), new OpenAIProvider(), new AnthropicProvider()].map(provider => ({
    name: provider.name,
    configured: provider.configured,
  }));
}
