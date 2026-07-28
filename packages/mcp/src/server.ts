/**
 * ABSuite MCP server.
 *
 * Exposes ABSuite as MCP tools, so any agent runtime that speaks MCP gets
 * capability-checked, cryptographically attested tool calls with no integration
 * work. This is the point where ABSuite stops being adjacent to the agent stack
 * and sits inside it: every call is authorised against a capability token
 * before it runs, and every completed call produces a signed execution trace.
 */
import {
  CapabilityToken,
  KeyRing,
  TraceStore,
  SigningKey,
  hashPayload,
  getStorage,
  type VerificationKey,
  type ExecutionTrace,
} from '@absuite/capkit';
import {
  ErrorCode,
  PROTOCOL_VERSION,
  failure,
  parseRequest,
  splitMessages,
  success,
  textResult,
  type JsonRpcResponse,
  type ToolDefinition,
  type ToolResult,
} from './protocol';

export interface AbsuiteMcpOptions {
  /** Capability token the agent presents. Defaults to ABSUITE_TOKEN. */
  token?: string;
  key?: VerificationKey;
  /** Base URLs of the ABSuite services this server fronts. */
  services?: Partial<Record<'capkit' | 'edge-run' | 'quickbench' | 'connector-starter', string>>;
  traces?: TraceStore | null;
  fetchImpl?: typeof fetch;
}

const DEFAULT_SERVICES = {
  capkit: process.env.CAPKIT_URL || 'http://localhost:8081',
  'edge-run': process.env.EDGE_RUN_URL || 'http://localhost:8082',
  quickbench: process.env.QUICKBENCH_URL || 'http://localhost:8083',
  'connector-starter': process.env.CONNECTOR_STARTER_URL || 'http://localhost:8084',
};

export const TOOLS: ToolDefinition[] = [
  {
    name: 'absuite_schedule_task',
    title: 'Schedule a recurring task',
    description: 'Schedule a task to run on a cron expression via Edge-Run. Requires the schedule:create capability.',
    requiredScope: 'schedule:create',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique schedule id' },
        cron: { type: 'string', description: 'Five-field cron expression, e.g. */15 * * * *' },
        url: { type: 'string', description: 'HTTPS endpoint to call' },
        method: { type: 'string', description: 'HTTP method', default: 'POST' },
      },
      required: ['id', 'cron', 'url'],
    },
  },
  {
    name: 'absuite_queue_task',
    title: 'Queue a one-off task',
    description: 'Enqueue a task for immediate or delayed execution, with retries and circuit breaking. Requires queue:write.',
    requiredScope: 'queue:write',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTPS endpoint to call' },
        method: { type: 'string', default: 'GET' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'], default: 'normal' },
        delay: { type: 'number', description: 'Milliseconds to wait before running' },
      },
      required: ['url'],
    },
  },
  {
    name: 'absuite_run_benchmark',
    title: 'Benchmark a model or service',
    description: 'Measure latency percentiles and throughput for an LLM provider or HTTP service. Requires bench:run.',
    requiredScope: 'bench:run',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['ollama', 'openai', 'anthropic', 'http'] },
        model: { type: 'string' },
        url: { type: 'string', description: 'Required when provider is http' },
        testRuns: { type: 'number', default: 10 },
      },
      required: ['provider'],
    },
  },
  {
    name: 'absuite_list_connectors',
    title: 'List available connectors',
    description: 'List integration connectors and whether each is configured. Requires connector:read.',
    requiredScope: 'connector:read',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'absuite_verify_execution',
    title: 'Verify an execution trace',
    description: 'Cryptographically verify that a recorded execution has not been altered. Requires execution:read.',
    requiredScope: 'execution:read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Execution trace id' } },
      required: ['id'],
    },
  },
];

export class AbsuiteMcpServer {
  private readonly token: string;
  private readonly key: VerificationKey | null;
  private readonly services: Record<string, string>;
  private readonly traces: TraceStore | null;
  private readonly fetchImpl: typeof fetch;
  private initialised = false;
  private subject = 'mcp-agent';
  private scopes: string[] = [];

  constructor(options: AbsuiteMcpOptions = {}) {
    this.token = (options.token ?? process.env.ABSUITE_TOKEN ?? '').trim();
    this.services = { ...DEFAULT_SERVICES, ...(options.services ?? {}) };
    this.fetchImpl = options.fetchImpl ?? fetch;

    // Verifying locally lets the server refuse a call before it reaches the
    // network, and lets it report the caller's real scopes in tools/list.
    let key: VerificationKey | null = options.key ?? null;
    if (!key) {
      try {
        key = KeyRing.fromEnv();
      } catch {
        key = null;
      }
    }
    this.key = key;

    if (options.traces !== undefined) {
      this.traces = options.traces;
    } else {
      this.traces = (process.env.ABSUITE_DB_PATH || '').trim()
        ? new TraceStore(getStorage(), new SigningKey(process.env.CAPKIT_TRACE_PRIVATE_KEY))
        : null;
    }

    this.readToken();
  }

  /** Extract subject and scopes so tools can be filtered to what is permitted. */
  private readToken(): void {
    if (!this.token || !this.key) return;

    const result = CapabilityToken.validate(this.token, this.key);
    if (result.valid) {
      this.subject = result.claims.sub || 'mcp-agent';
      this.scopes = result.claims.scope;
    }
  }

  /**
   * Tools the caller may actually use.
   *
   * Advertising tools an agent cannot call wastes its context and invites
   * failed attempts, so the list is filtered by capability up front. With no
   * verification key configured we cannot filter, so everything is listed and
   * the service enforces.
   */
  private visibleTools(): ToolDefinition[] {
    if (!this.key || this.scopes.length === 0) return TOOLS;

    return TOOLS.filter(tool =>
      !tool.requiredScope ||
      this.scopes.some(granted => scopeGrants(granted, tool.requiredScope!))
    );
  }

  async handle(raw: unknown): Promise<JsonRpcResponse | null> {
    const parsed = parseRequest(raw);
    if (!parsed.ok) return failure(null, ErrorCode.InvalidRequest, parsed.error);

    const { request, isNotification } = parsed;

    // Notifications must never be answered.
    if (isNotification) {
      if (request.method === 'notifications/initialized') this.initialised = true;
      return null;
    }

    switch (request.method) {
      case 'initialize':
        this.initialised = true;
        return success(request.id!, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'absuite', version: '1.0.0' },
          instructions:
            'ABSuite governs agent actions. Every tool call is checked against a capability token before it runs, and completed calls produce a signed execution trace that can be verified independently.',
        });

      case 'ping':
        return success(request.id!, {});

      case 'tools/list':
        return success(request.id!, {
          tools: this.visibleTools().map(({ requiredScope, ...tool }) => tool),
        });

      case 'tools/call':
        return this.callTool(request.id!, request.params ?? {});

      default:
        return failure(request.id!, ErrorCode.MethodNotFound, `Unknown method: ${request.method}`);
    }
  }

  private async callTool(id: string | number, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const name = String(params.name ?? '');
    const args = (params.arguments as Record<string, unknown>) ?? {};

    const tool = TOOLS.find(candidate => candidate.name === name);
    if (!tool) return failure(id, ErrorCode.InvalidParams, `Unknown tool: ${name}`);

    // Authorise before doing anything. A refusal must never reach the network.
    if (tool.requiredScope && this.key) {
      const result = CapabilityToken.validate(this.token, this.key, { requiredScope: tool.requiredScope });
      if (!result.valid) {
        return failure(id, ErrorCode.Unauthorized, `Not permitted: ${tool.requiredScope} (${result.error})`);
      }
    }

    const missing = (tool.inputSchema.required ?? []).filter(field => args[field] === undefined);
    if (missing.length > 0) {
      return failure(id, ErrorCode.InvalidParams, `Missing required argument(s): ${missing.join(', ')}`);
    }

    const startedAt = new Date().toISOString();
    const startedMs = Date.now();

    try {
      const result = await this.execute(name, args);
      const trace = this.attest(tool, args, result, 'success', startedAt, startedMs);
      return success(id, { ...result, ...(trace ? { _absuiteTrace: trace } : {}) });
    } catch (error) {
      const message = (error as Error).message;
      this.attest(tool, args, null, 'failure', startedAt, startedMs, message);
      return success(id, textResult(`Tool failed: ${message}`, true));
    }
  }

  /**
   * Record a signed trace for a completed tool call.
   *
   * Attestation failure must never mask the tool's own result, so it is
   * best-effort and returns undefined rather than throwing.
   */
  private attest(
    tool: ToolDefinition,
    args: unknown,
    result: unknown,
    outcome: 'success' | 'failure',
    startedAt: string,
    startedMs: number,
    error?: string
  ): { id: string; hash: string; signature?: string } | undefined {
    if (!this.traces) return undefined;

    try {
      const trace: ExecutionTrace = this.traces.record({
        subject: this.subject,
        scope: tool.requiredScope ? [tool.requiredScope] : [],
        module: 'mcp',
        action: `mcp:${tool.name}`,
        inputHash: hashPayload(args),
        ...(result !== null ? { outputHash: hashPayload(result) } : {}),
        outcome,
        ...(error ? { error } : {}),
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        steps: [{ seq: 1, name: 'tools/call', at: startedAt, detail: tool.name }],
      });

      return { id: trace.id, hash: trace.hash, ...(trace.signature ? { signature: trace.signature } : {}) };
    } catch (error) {
      // Never mask the tool result — but never fail silently either, or a
      // deployment can lose its attestation trail without anyone noticing.
      // stderr, not stdout: stdout carries the JSON-RPC stream.
      console.error(`[absuite-mcp] Attestation failed for ${tool.name}: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async request(service: string, path: string, init: RequestInit = {}): Promise<unknown> {
    const base = this.services[service];
    if (!base) throw new Error(`Unknown service: ${service}`);

    const response = await this.fetchImpl(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });

    const text = await response.text();
    const data = text ? safeJson(text) : null;

    if (!response.ok) {
      const detail = (data as { error?: { message?: string } })?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return data;
  }

  private async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case 'absuite_schedule_task':
        return textResult(await this.request('edge-run', '/schedule', {
          method: 'POST',
          body: JSON.stringify({
            id: args.id,
            cron: args.cron,
            task: { type: 'http', url: args.url, method: args.method ?? 'POST' },
          }),
        }));

      case 'absuite_queue_task':
        return textResult(await this.request('edge-run', '/queue', {
          method: 'POST',
          body: JSON.stringify({
            priority: args.priority ?? 'normal',
            ...(args.delay !== undefined ? { delay: args.delay } : {}),
            task: { type: 'http', url: args.url, method: args.method ?? 'GET' },
          }),
        }));

      case 'absuite_run_benchmark':
        return textResult(await this.request('quickbench', '/run', {
          method: 'POST',
          body: JSON.stringify({
            provider: args.provider,
            ...(args.model ? { model: args.model } : {}),
            ...(args.url ? { url: args.url } : {}),
            testRuns: args.testRuns ?? 10,
          }),
        }));

      case 'absuite_list_connectors':
        return textResult(await this.request('connector-starter', '/connectors'));

      case 'absuite_verify_execution': {
        const trace = this.traces?.get(String(args.id));
        if (!trace) return textResult(`No execution found with id ${args.id}`, true);
        return textResult(this.traces!.verifyChain());
      }

      default:
        throw new Error(`Tool not implemented: ${name}`);
    }
  }

  get ready(): boolean {
    return this.initialised;
  }
}

/** Segment-wise scope match, mirroring CapKit's own rule. */
function scopeGrants(granted: string, required: string): boolean {
  if (granted === '*' || granted === '*:*') return true;
  if (granted === required) return true;

  const g = granted.split(':');
  const r = required.split(':');
  return g.length === r.length && g.every((part, index) => part === '*' || part === r[index]);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Run the server over stdio, the transport MCP clients launch by default. */
export function runStdio(server: AbsuiteMcpServer, input = process.stdin, output = process.stdout): void {
  let buffer = '';
  input.setEncoding('utf8');

  input.on('data', chunk => {
    buffer += chunk;
    const { messages, rest } = splitMessages(buffer);
    buffer = rest;

    for (const message of messages) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(message);
      } catch {
        output.write(JSON.stringify(failure(null, ErrorCode.ParseError, 'Invalid JSON')) + '\n');
        continue;
      }

      void server.handle(decoded).then(response => {
        if (response) output.write(JSON.stringify(response) + '\n');
      });
    }
  });
}
