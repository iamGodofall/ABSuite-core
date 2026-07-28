/**
 * LLM provider adapters.
 *
 * Each adapter issues one completion and reports latency, token counts and
 * time-to-first-token where the provider exposes it. Adapters normalise onto a
 * single shape so benchmarks compare like with like across providers.
 */

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

async function timedFetch(url: string, init: RequestInit, timeoutMs: number) {
  const startedAt = performance.now();
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  const latencyMs = performance.now() - startedAt;
  return { response, text, latencyMs };
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
    try {
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
    } catch (error) {
      return { ok: false, latencyMs: 0, error: (error as Error).message };
    }
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
    if (!this.configured) return { ok: false, latencyMs: 0, error: 'OPENAI_API_KEY is not set' };

    try {
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
    } catch (error) {
      return { ok: false, latencyMs: 0, error: (error as Error).message };
    }
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
    if (!this.configured) return { ok: false, latencyMs: 0, error: 'ANTHROPIC_API_KEY is not set' };

    try {
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
    } catch (error) {
      return { ok: false, latencyMs: 0, error: (error as Error).message };
    }
  }
}

/** HTTP endpoint benchmarking — for measuring an agent service, not a model. */
export class HttpProvider implements Provider {
  readonly name = 'http';
  readonly configured = true;

  constructor(private readonly url: string, private readonly method = 'GET') {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    try {
      const { response, latencyMs } = await timedFetch(
        this.url,
        { method: this.method },
        request.timeoutMs ?? 30_000
      );
      return response.ok
        ? { ok: true, latencyMs }
        : { ok: false, latencyMs, error: `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, latencyMs: 0, error: (error as Error).message };
    }
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
