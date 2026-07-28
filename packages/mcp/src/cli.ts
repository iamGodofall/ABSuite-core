#!/usr/bin/env node
/**
 * Entry point MCP clients launch.
 *
 * Speaks JSON-RPC over stdio, so nothing may be written to stdout except
 * protocol messages — diagnostics go to stderr or they corrupt the stream.
 */
import { AbsuiteMcpServer, runStdio } from './server';

const server = new AbsuiteMcpServer();

if (!process.env.ABSUITE_TOKEN) {
  console.error('[absuite-mcp] No ABSUITE_TOKEN set — calls will be rejected by the services.');
}

console.error('[absuite-mcp] ready on stdio');
runStdio(server);
