import { CapabilityToken, KeyRing, Storage, TraceStore, SigningKey } from '@absuite/capkit';
import { AbsuiteMcpServer, TOOLS } from './server';
import { parseRequest, splitMessages, PROTOCOL_VERSION, ErrorCode } from './protocol';

const SECRET = 'mcp-test-secret-at-least-32-characters-long';
const ring = new KeyRing([{ kid: 'k1', secret: SECRET, status: 'active' }]);

const tokenWith = (scope: string[]) =>
  CapabilityToken.create({ sub: 'agent-mcp', scope, expiresIn: '1h', kid: 'k1' }, SECRET).token;

const rpc = (method: string, params?: Record<string, unknown>, id: number | string = 1) => ({
  jsonrpc: '2.0' as const, id, method, ...(params ? { params } : {}),
});

describe('protocol framing', () => {
  test('keeps a partial message for the next chunk', () => {
    const { messages, rest } = splitMessages('{"a":1}\n{"b":2}\n{"partial":');
    expect(messages).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"partial":');
  });

  test('ignores blank lines', () => {
    expect(splitMessages('{"a":1}\n\n\n').messages).toEqual(['{"a":1}']);
  });

  test('distinguishes notifications from requests', () => {
    const request = parseRequest(rpc('tools/list'));
    expect(request.ok && request.isNotification).toBe(false);

    const notification = parseRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notification.ok && notification.isNotification).toBe(true);
  });

  test('rejects malformed messages', () => {
    expect(parseRequest(null).ok).toBe(false);
    expect(parseRequest({ jsonrpc: '1.0', method: 'x' }).ok).toBe(false);
    expect(parseRequest({ jsonrpc: '2.0' }).ok).toBe(false);
  });
});

describe('handshake', () => {
  test('reports protocol version and tool capability', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    const response = await server.handle(rpc('initialize'));

    const result = response!.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe('absuite');
  });

  test('never answers a notification', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(server.ready).toBe(true);
  });

  test('answers ping', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    expect((await server.handle(rpc('ping')))!.error).toBeUndefined();
  });

  test('reports unknown methods properly', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    const response = await server.handle(rpc('does/not/exist'));
    expect(response!.error?.code).toBe(ErrorCode.MethodNotFound);
  });
});

describe('capability-filtered tool discovery', () => {
  test('lists only what the token permits', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['queue:write']), key: ring, traces: null });
    const response = await server.handle(rpc('tools/list'));

    const names = (response!.result as { tools: Array<{ name: string }> }).tools.map(t => t.name);
    expect(names).toContain('absuite_queue_task');
    expect(names).not.toContain('absuite_run_benchmark');
  });

  test('a wildcard token sees everything', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    const response = await server.handle(rpc('tools/list'));

    expect((response!.result as { tools: unknown[] }).tools).toHaveLength(TOOLS.length);
  });

  test('does not leak the internal requiredScope field to the agent', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    const response = await server.handle(rpc('tools/list'));

    const tools = (response!.result as { tools: Array<Record<string, unknown>> }).tools;
    expect(tools.every(tool => !('requiredScope' in tool))).toBe(true);
  });

  test('every tool declares a usable input schema', () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe('authorisation on tool calls', () => {
  /** Fails the test if the network is touched. */
  const forbiddenFetch = (() => {
    throw new Error('network must not be reached');
  }) as unknown as typeof fetch;

  test('refuses a tool the token does not permit, without calling out', async () => {
    const server = new AbsuiteMcpServer({
      token: tokenWith(['queue:read']), key: ring, traces: null, fetchImpl: forbiddenFetch,
    });

    const response = await server.handle(rpc('tools/call', {
      name: 'absuite_run_benchmark', arguments: { provider: 'http', url: 'http://x' },
    }));

    expect(response!.error?.code).toBe(ErrorCode.Unauthorized);
    expect(response!.error?.message).toMatch(/bench:run/);
  });

  test('refuses an expired token', async () => {
    const expired = CapabilityToken.create({ sub: 'a', scope: ['queue:write'], expiresIn: 1, kid: 'k1' }, SECRET).token;
    const server = new AbsuiteMcpServer({ token: expired, key: ring, traces: null, fetchImpl: forbiddenFetch });

    const realNow = Date.now;
    Date.now = () => realNow() + 5000;
    try {
      const response = await server.handle(rpc('tools/call', {
        name: 'absuite_queue_task', arguments: { url: 'https://x.test' },
      }));
      expect(response!.error?.code).toBe(ErrorCode.Unauthorized);
    } finally {
      Date.now = realNow;
    }
  });

  test('rejects an unknown tool', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null, fetchImpl: forbiddenFetch });
    const response = await server.handle(rpc('tools/call', { name: 'not_a_tool', arguments: {} }));

    expect(response!.error?.code).toBe(ErrorCode.InvalidParams);
  });

  test('validates required arguments before calling out', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null, fetchImpl: forbiddenFetch });
    const response = await server.handle(rpc('tools/call', { name: 'absuite_queue_task', arguments: {} }));

    expect(response!.error?.code).toBe(ErrorCode.InvalidParams);
    expect(response!.error?.message).toMatch(/url/);
  });
});

describe('execution and attestation', () => {
  const okFetch = (async () => new Response(JSON.stringify({ id: 'task-1', status: 'queued' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;

  test('a permitted call succeeds and is attested with a signed trace', async () => {
    const storage = new Storage(':memory:');
    const traces = new TraceStore(storage, new SigningKey());

    const server = new AbsuiteMcpServer({
      token: tokenWith(['queue:write']), key: ring, traces, fetchImpl: okFetch,
    });

    const response = await server.handle(rpc('tools/call', {
      name: 'absuite_queue_task', arguments: { url: 'https://api.test/hook' },
    }));

    const result = response!.result as { _absuiteTrace?: { id: string; signature?: string } };
    expect(result._absuiteTrace?.id).toMatch(/^exec_/);
    expect(result._absuiteTrace?.signature).toBeTruthy();

    const recorded = traces.get(result._absuiteTrace!.id)!;
    expect(recorded.action).toBe('mcp:absuite_queue_task');
    expect(recorded.subject).toBe('agent-mcp');
    expect(recorded.outcome).toBe('success');
  });

  test('a failing call is reported as a tool error, not a protocol error', async () => {
    const failing = (async () => new Response(JSON.stringify({ error: { message: 'upstream exploded' } }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

    const server = new AbsuiteMcpServer({
      token: tokenWith(['queue:write']), key: ring, traces: null, fetchImpl: failing,
    });

    const response = await server.handle(rpc('tools/call', {
      name: 'absuite_queue_task', arguments: { url: 'https://api.test/hook' },
    }));

    // MCP convention: tool failures surface as isError content, not JSON-RPC errors.
    expect(response!.error).toBeUndefined();
    const result = response!.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/upstream exploded/);
  });

  test('a failed call is still attested', async () => {
    const storage = new Storage(':memory:');
    const traces = new TraceStore(storage, new SigningKey());
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;

    const server = new AbsuiteMcpServer({
      token: tokenWith(['queue:write']), key: ring, traces, fetchImpl: failing,
    });

    await server.handle(rpc('tools/call', {
      name: 'absuite_queue_task', arguments: { url: 'https://api.test/hook' },
    }));

    const recorded = traces.list();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.outcome).toBe('failure');
  });

  test('attestation failure never masks the tool result', async () => {
    const broken = {
      record: () => { throw new Error('trace store down'); },
      get: () => undefined,
      list: () => [],
    } as unknown as TraceStore;

    const server = new AbsuiteMcpServer({
      token: tokenWith(['queue:write']), key: ring, traces: broken, fetchImpl: okFetch,
    });

    const response = await server.handle(rpc('tools/call', {
      name: 'absuite_queue_task', arguments: { url: 'https://api.test/hook' },
    }));

    expect(response!.error).toBeUndefined();
    expect((response!.result as { _absuiteTrace?: unknown })._absuiteTrace).toBeUndefined();
  });
});
