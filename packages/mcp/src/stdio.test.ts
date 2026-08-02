/**
 * The stdio transport — the code path every MCP client actually uses.
 *
 * It was the least-covered part of the package, which is an odd place for a
 * gap: a host never calls `handle()` directly, it speaks newline-delimited
 * JSON-RPC down a pipe, and everything the package does passes through here.
 *
 * The rule this transport lives by is stated in `cli.ts`: **nothing may be
 * written to stdout except protocol messages.** A stray `console.log` anywhere
 * in the package does not degrade the experience — it corrupts the stream and
 * every client disconnects. That is asserted at the bottom of this file,
 * because it is a property of the whole package rather than of one function.
 */
import { PassThrough } from 'node:stream';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AbsuiteMcpServer, runStdio } from './server';

/** Drive the transport and collect whatever it writes. */
const speak = async (chunks: string[]): Promise<any[]> => {
  const input = new PassThrough();
  const written: string[] = [];
  const output = { write: (line: string) => { written.push(line); return true; } };

  runStdio(new AbsuiteMcpServer({ token: 'test-token' }), input as any, output as any);

  for (const chunk of chunks) input.write(chunk);
  // Responses resolve on the microtask queue after `handle` settles.
  await new Promise(resolve => setTimeout(resolve, 30));

  return written.join('').split('\n').filter(Boolean).map(line => JSON.parse(line));
};

const initialize = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {} },
});

describe('the stdio transport', () => {
  test('answers a complete message', async () => {
    const [response] = await speak([initialize + '\n']);

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toBeDefined();
  });

  test('a message split across two writes is still answered once', async () => {
    // A pipe does not respect message boundaries. This is the case that breaks
    // a transport written against a test that always sends whole lines.
    const half = Math.floor(initialize.length / 2);
    const responses = await speak([initialize.slice(0, half), initialize.slice(half) + '\n']);

    expect(responses).toHaveLength(1);
    expect(responses[0].id).toBe(1);
  });

  test('two messages in one write are both answered', async () => {
    const second = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const responses = await speak([initialize + '\n' + second + '\n']);

    expect(responses.map(r => r.id).sort()).toEqual([1, 2]);
  });

  test('a partial trailing message is buffered, not answered early', async () => {
    const responses = await speak([initialize + '\n' + '{"jsonrpc":"2.0","id":9']);

    // The complete one is answered; the fragment waits for its newline rather
    // than being parsed as broken JSON.
    expect(responses).toHaveLength(1);
    expect(responses[0].id).toBe(1);
  });

  test('malformed JSON produces a parse error rather than silence or a crash', async () => {
    const responses = await speak(['this is not json\n']);

    expect(responses).toHaveLength(1);
    expect(responses[0].error).toBeDefined();
    expect(responses[0].error.message).toMatch(/Invalid JSON/);
  });

  test('a notification gets no reply, because JSON-RPC says so', async () => {
    // No `id` means a notification. Answering one is a protocol violation.
    const notification = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const responses = await speak([notification + '\n']);

    expect(responses).toHaveLength(0);
  });

  test('blank lines between messages are ignored', async () => {
    const responses = await speak(['\n\n' + initialize + '\n\n']);

    expect(responses).toHaveLength(1);
  });
});

/**
 * The package-wide rule, asserted rather than trusted.
 *
 * stdout belongs to the protocol. Diagnostics go to stderr — `cli.ts` writes
 * its two startup lines with `console.error` for exactly this reason — and one
 * `console.log` added later would corrupt every client's stream while looking
 * entirely reasonable in review.
 */
describe('stdout belongs to the protocol', () => {
  test('no source file in this package writes to stdout', () => {
    const dir = join(__dirname);
    const offenders: string[] = [];

    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      readFileSync(join(dir, name), 'utf8').split('\n').forEach((line, index) => {
        if (/\bconsole\.log\b|\bprocess\.stdout\.write\b/.test(line)) {
          offenders.push(`${name}:${index + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }

    // `runStdio` writes through the injected `output`, never `process.stdout`
    // directly, which is what makes this assertable at all.
    expect(offenders).toEqual([]);
  });
});
