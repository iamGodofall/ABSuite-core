/**
 * Minimal Model Context Protocol implementation.
 *
 * MCP is how agents discover and call tools. Implementing the JSON-RPC subset
 * directly — rather than depending on an SDK — keeps this package dependency-free
 * and keeps the wire format auditable, which matters when every call through it
 * is going to be capability-checked and cryptographically attested.
 */

export const PROTOCOL_VERSION = '2025-06-18';

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
