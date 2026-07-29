/**
 * @absuitecore/mcp — Model Context Protocol server for ABSuite.
 *
 * Gives any MCP-speaking agent runtime capability-checked, cryptographically
 * attested tool calls.
 */
export { AbsuiteMcpServer, TOOLS, runStdio, type AbsuiteMcpOptions } from './server';

export {
  PROTOCOL_VERSION,
  ErrorCode,
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
