/**
 * @absuitecore/mcp — Model Context Protocol server for ABSuite.
 *
 * Gives any MCP-speaking agent runtime capability-checked, cryptographically
 * attested tool calls.
 */
export { AbsuiteMcpServer, TOOLS, runStdio, type AbsuiteMcpOptions } from './server';

export {
  PROTOCOL_VERSION,
  SUPPORTED_VERSIONS,
  MODERN_VERSIONS,
  LEGACY_VERSIONS,
  META_PROTOCOL_VERSION,
  META_CLIENT_INFO,
  META_CLIENT_CAPABILITIES,
  META_SERVER_INFO,
  ErrorCode,
  requestedVersion,
  unsupportedVersion,
  parseRequest,
  splitMessages,
  success,
  failure,
  textResult,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ToolDefinition,
  type ToolResult,
} from './protocol';
