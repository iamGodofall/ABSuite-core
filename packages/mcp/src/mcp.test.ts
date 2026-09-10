import { CapabilityToken, KeyRing, Storage, TraceStore, SigningKey } from '@absuitecore/capkit';
import { AbsuiteMcpServer, TOOLS } from './server';
import {
  parseRequest, splitMessages, PROTOCOL_VERSION, SUPPORTED_VERSIONS, LEGACY_VERSIONS,
  META_PROTOCOL_VERSION, META_SERVER_INFO, ErrorCode,
} from './protocol';

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

/**
 * A request as a MODERN client sends one: the revision travels in `_meta` and
 * there is no handshake before it.
 */
const modern = (
  method: string,
  params: Record<string, unknown> = {},
  version: string = PROTOCOL_VERSION,
  id: number | string = 1,
) => ({
  jsonrpc: '2.0' as const, id, method,
  params: { ...params, _meta: { [META_PROTOCOL_VERSION]: version } },
});

describe('handshake (legacy clients)', () => {
  /*
   * `initialize` answers with a LEGACY revision, never with PROTOCOL_VERSION.
   *
   * This assertion used to read `toBe(PROTOCOL_VERSION)` and it was correct
   * only while the two were the same string. From 2026-07-28 they are not:
   * reaching `initialize` at all means the client speaks the handshake era, so
   * answering with the modern revision would name one it cannot speak.
   */
  test('answers a legacy revision, not the modern one', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    const response = await server.handle(rpc('initialize'));

    const result = response!.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(LEGACY_VERSIONS).toContain(result.protocolVersion);
    expect(result.protocolVersion).not.toBe(PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe('absuite');
  });

  test('echoes the revision the client asked for when it is served', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    for (const asked of LEGACY_VERSIONS) {
      const response = await server.handle(rpc('initialize', { protocolVersion: asked }));
      expect((response!.result as { protocolVersion: string }).protocolVersion).toBe(asked);
    }
  });

  /*
   * A legacy client has no fall-forward mechanism, so an unknown ask must get
   * this server's best legacy offer rather than an error it cannot act on.
   */
  test('offers the newest legacy revision when the ask is unknown', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    const response = await server.handle(rpc('initialize', { protocolVersion: '1900-01-01' }));
    expect(response!.error).toBeUndefined();
    expect((response!.result as { protocolVersion: string }).protocolVersion).toBe(LEGACY_VERSIONS[0]);
  });

  test('a legacy client still gets tools with no _meta anywhere', async () => {
    const server = new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });
    await server.handle(rpc('initialize'));
    const response = await server.handle(rpc('tools/list'));
    expect(response!.error).toBeUndefined();
    expect((response!.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
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

describe('modern era: per-request version, no handshake', () => {
  const server = () => new AbsuiteMcpServer({ token: tokenWith(['*']), key: ring, traces: null });

  /*
   * THE HEADLINE BEHAVIOUR. From 2026-07-28 there is no `initialize` at all,
   * so a server that only worked after a handshake is a server a modern client
   * cannot use. This must succeed with nothing sent before it.
   */
  test('serves a request that never handshook', async () => {
    const response = await server().handle(modern('tools/list'));
    expect(response!.error).toBeUndefined();
    expect((response!.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
  });

  test('serves every revision it claims to support', async () => {
    const s = server();
    for (const version of SUPPORTED_VERSIONS) {
      const response = await s.handle(modern('ping', {}, version));
      expect(response!.error).toBeUndefined();
    }
  });

  /*
   * The spec's UnsupportedProtocolVersionError, checked field by field: the
   * client is expected to READ `supported`, pick from it and retry, so a bare
   * error code would leave it with nowhere to go.
   */
  test('refuses an unknown revision with -32022 and says what it does serve', async () => {
    const response = await server().handle(modern('tools/list', {}, '1900-01-01'));
    expect(response!.error!.code).toBe(ErrorCode.UnsupportedProtocolVersion);
    expect(response!.error!.code).toBe(-32022);
    const data = response!.error!.data as { supported: string[]; requested: string };
    expect(data.requested).toBe('1900-01-01');
    expect(data.supported).toEqual([...SUPPORTED_VERSIONS]);
  });

  /*
   * The gate is ABOVE the switch, so it covers the methods that DO something
   * as well as the ones that only describe. A version check that only ran on
   * tools/list would let an unknown-era client execute a tool.
   */
  test('the version gate covers tools/call, not only listing', async () => {
    const response = await server().handle(
      modern('tools/call', { name: 'absuite_verify_trace', arguments: {} }, '1900-01-01'),
    );
    expect(response!.error!.code).toBe(ErrorCode.UnsupportedProtocolVersion);
  });

  test('server/discover reports versions, capabilities and identity', async () => {
    const response = await server().handle(modern('server/discover'));
    const result = response!.result as {
      resultType: string; supportedVersions: string[];
      capabilities: Record<string, unknown>; _meta: Record<string, { name: string; version: string }>;
      instructions: string;
    };
    expect(result.resultType).toBe('complete');
    expect(result.supportedVersions).toEqual([...SUPPORTED_VERSIONS]);
    expect(result.supportedVersions[0]).toBe(PROTOCOL_VERSION);
    expect(result.capabilities.tools).toBeDefined();
    expect(result._meta[META_SERVER_INFO].name).toBe('absuite');
    expect(result.instructions.length).toBeGreaterThan(0);
  });

  /*
   * server/discover is the stdio backward-compatibility PROBE: a dual-era
   * client sends it to find out what this server speaks. Refusing it for
   * naming a revision we do not serve would make it useless to the only client
   * that needs it — so it answers whatever it is asked in.
   */
  test('discover answers even when the probe names a revision we do not serve', async () => {
    const response = await server().handle(modern('server/discover', {}, '1900-01-01'));
    expect(response!.error).toBeUndefined();
    expect((response!.result as { supportedVersions: string[] }).supportedVersions)
      .toEqual([...SUPPORTED_VERSIONS]);
  });

  test('discover answers a bare probe with no _meta at all', async () => {
    const response = await server().handle(rpc('server/discover'));
    expect(response!.error).toBeUndefined();
    expect((response!.result as { resultType: string }).resultType).toBe('complete');
  });

  /*
   * The eras must not contaminate one another. A modern request is served
   * statelessly — it must not require, or leave behind, handshake state.
   */
  test('a modern request neither needs nor sets the handshake flag', async () => {
    const s = server();
    expect(s.ready).toBe(false);
    const response = await s.handle(modern('tools/list'));
    expect(response!.error).toBeUndefined();
    expect(s.ready).toBe(false);
  });

  test('capability filtering still applies in the modern era', async () => {
    const narrow = new AbsuiteMcpServer({ token: tokenWith(['trace:verify']), key: ring, traces: null });
    const all = await narrow.handle(modern('tools/list'));
    const names = (all!.result as { tools: { name: string }[] }).tools.map(t => t.name);
    expect(names.length).toBeLessThan(TOOLS.length);
  });
});
