/**
 * Minimal Model Context Protocol implementation.
 *
 * MCP is how agents discover and call tools. Implementing the JSON-RPC subset
 * directly — rather than depending on an SDK — keeps this package dependency-free
 * and keeps the wire format auditable, which matters when every call through it
 * is going to be capability-checked and cryptographically attested.
 */

/**
 * The protocol revision this server speaks by preference.
 *
 * MCP changed SHAPE at `2026-07-28`, not just version. Revisions up to and
 * including `2025-11-25` establish a session with an `initialize` handshake;
 * the spec calls those **legacy**. From `2026-07-28` there is no handshake at
 * all: every request declares its own version in `_meta` and the server
 * accepts or rejects each one independently, which makes a server stateless
 * and lets one process serve clients speaking different revisions.
 *
 * This package shipped pinned to `2025-06-18` — two revisions and one era
 * behind. A modern client talking to it does not get a graceful downgrade;
 * the spec's own compatibility matrix says that combination FAILS, because a
 * legacy server may reject the request, stay silent, or worse, "process an
 * era-ambiguous method under legacy semantics".
 *
 * See https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 */
export const PROTOCOL_VERSION = '2026-07-28';

/**
 * Every revision this server will serve, newest first.
 *
 * Reported verbatim in `server/discover` and in the `supported` list of an
 * `UnsupportedProtocolVersionError`, so a client can pick from it and retry.
 * Order is the preference order: the first LEGACY entry is what an
 * `initialize` handshake falls back to when the client asks for a revision
 * this server does not know.
 */
export const SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18'] as const;

/**
 * The revisions that use per-request `_meta` rather than a handshake.
 *
 * Split out rather than inferred from a date comparison. A string date sorts
 * correctly today and says nothing about WHY the boundary is where it is —
 * and the day a revision lands that is newer than `2026-07-28` but still
 * legacy, or a legacy revision is dropped, a comparison silently gets it
 * wrong while a list has to be edited on purpose.
 */
export const MODERN_VERSIONS: readonly string[] = ['2026-07-28'];

/** Revisions served through the `initialize` handshake. Newest first. */
export const LEGACY_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18'];

/**
 * `_meta` keys defined by the spec.
 *
 * Named constants because they are wire format: a typo in a string literal
 * used in two places is a server that reads a version nobody sent, which
 * presents exactly as a client that forgot to send one.
 */
export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC reserved codes, plus the application range MCP servers use. */
export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** Application: the caller's capability token does not permit this tool. */
  Unauthorized: -32001,
  /**
   * Spec-defined: the request declared a protocol revision this server does
   * not serve. Its `data` MUST carry `supported` and `requested` so the client
   * can choose a mutually supported revision and retry rather than give up.
   */
  UnsupportedProtocolVersion: -32022,
} as const;

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** ABSuite extension: the capability scope this tool requires. */
  requiredScope?: string;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /** ABSuite extension: id of the signed trace attesting this call. */
  _absuiteTrace?: { id: string; hash: string; signature?: string };
}

export function success(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function failure(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** Wrap a value as MCP tool content. */
export function textResult(value: unknown, isError = false): ToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/**
 * Validate a decoded message as a JSON-RPC request.
 *
 * Notifications (no `id`) are legal in MCP and must not be answered, so the
 * distinction is preserved rather than normalised away.
 */
export function parseRequest(raw: unknown): { ok: true; request: JsonRpcRequest; isNotification: boolean } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Message is not an object' };

  const message = raw as Record<string, unknown>;
  if (message.jsonrpc !== '2.0') return { ok: false, error: 'Missing or invalid jsonrpc version' };
  if (typeof message.method !== 'string' || !message.method) return { ok: false, error: 'Missing method' };

  const hasId = 'id' in message && message.id !== null && message.id !== undefined;

  return {
    ok: true,
    request: {
      jsonrpc: '2.0',
      id: hasId ? (message.id as string | number) : null,
      method: message.method,
      params: (message.params as Record<string, unknown>) ?? {},
    },
    isNotification: !hasId,
  };
}

/**
 * Split a stream buffer into complete newline-delimited JSON messages.
 *
 * Returns the unconsumed remainder so a partial message spanning two chunks is
 * not dropped — the failure mode that makes stdio transports flaky.
 */
export function splitMessages(buffer: string): { messages: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { messages: parts.map(part => part.trim()).filter(Boolean), rest };
}

/**
 * The protocol revision a request declares, or null if it declares none.
 *
 * Absence is the era signal and must stay distinguishable from a version this
 * server happens not to like: a request with no `_meta` version is a LEGACY
 * client and belongs on the handshake path, while a request carrying an
 * unknown one is a modern client that should be told what is on offer. Folding
 * the two together would answer a legacy `initialize` with a modern error it
 * has no way to act on — the spec is explicit that legacy clients have no
 * fall-forward mechanism.
 */
export function requestedVersion(request: JsonRpcRequest): string | null {
  const meta = request.params?._meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') return null;
  const version = meta[META_PROTOCOL_VERSION];
  return typeof version === 'string' && version ? version : null;
}

/**
 * The spec's `UnsupportedProtocolVersionError`, verbatim in shape.
 *
 * `supported` is the full list rather than the closest match, because the
 * client is the party that knows which revisions IT can speak.
 */
export function unsupportedVersion(id: string | number | null, requested: string): JsonRpcResponse {
  return failure(id, ErrorCode.UnsupportedProtocolVersion, 'Unsupported protocol version', {
    supported: [...SUPPORTED_VERSIONS],
    requested,
  });
}
