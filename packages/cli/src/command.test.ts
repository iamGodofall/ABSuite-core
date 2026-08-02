import { parseCommand, DEFAULT_SCOPE, DEFAULT_EXPIRY } from './command';

/**
 * The CLI's whole test suite used to be three tests that proved the binary
 * builds and prints its own name. Not one command was exercised, and a real bug
 * was living in that gap for as long as the package has been published.
 *
 * These ask the only question worth asking of an argument parser: given exactly
 * what a person typed, what did we understand them to mean.
 */

describe('help', () => {
  test.each([[[]], [['--help']], [['-h']], [['help']]])('%j asks for help', args => {
    expect(parseCommand(args as string[]).kind).toBe('help');
  });

  test('an empty string is not a command', () => {
    // A shell expanding an unset variable produces one of these, and treating it
    // as a command name answers "Unknown command: " with a blank.
    expect(parseCommand(['']).kind).toBe('help');
  });
});

describe('compose commands', () => {
  test('start with no service means everything', () => {
    expect(parseCommand(['start'])).toEqual({ kind: 'compose', action: 'start', follow: false });
  });

  test('start names a single service when given one', () => {
    expect(parseCommand(['start', 'capkit'])).toEqual({ kind: 'compose', action: 'start', service: 'capkit', follow: false });
  });

  test.each(['stop', 'restart', 'status'])('%s is a compose action', action => {
    expect(parseCommand([action]).kind).toBe('compose');
  });

  test('logs -f edge-run follows edge-run', () => {
    expect(parseCommand(['logs', '-f', 'edge-run'])).toEqual({ kind: 'compose', action: 'logs', service: 'edge-run', follow: true });
  });

  test('logs edge-run -f means the same thing', () => {
    // People type both orders. One of them silently tailing nothing, or
    // following a service called "-f", is not acceptable.
    expect(parseCommand(['logs', 'edge-run', '-f'])).toEqual({ kind: 'compose', action: 'logs', service: 'edge-run', follow: true });
  });

  test('logs with no service is still a logs command, and the caller must object', () => {
    // Parsing says what was asked. Refusing is the runtime's job, and it does
    // refuse — the parser inventing a default service would be far worse.
    expect(parseCommand(['logs'])).toEqual({ kind: 'compose', action: 'logs', follow: false });
  });
});

describe('token create', () => {
  test('falls back to the documented defaults', () => {
    expect(parseCommand(['token', 'create'])).toEqual({
      kind: 'token-create', capabilities: DEFAULT_SCOPE, expires: DEFAULT_EXPIRY,
    });
  });

  test('reads long flags', () => {
    expect(parseCommand(['token', 'create', '--capabilities', 'pay:approve', '--expires', '8h'])).toEqual({
      kind: 'token-create', capabilities: 'pay:approve', expires: '8h',
    });
  });

  test('reads short flags', () => {
    expect(parseCommand(['token', 'create', '-c', 'ledger:read', '-e', '15m'])).toEqual({
      kind: 'token-create', capabilities: 'ledger:read', expires: '15m',
    });
  });

  test('reads --flag=value', () => {
    expect(parseCommand(['token', 'create', '--capabilities=a:b', '--expires=1h'])).toEqual({
      kind: 'token-create', capabilities: 'a:b', expires: '1h',
    });
  });

  test('a flag with no value falls back rather than eating the next flag', () => {
    // `--expires --capabilities x` must not produce an expiry of "--capabilities".
    expect(parseCommand(['token', 'create', '--expires', '--capabilities', 'x'])).toEqual({
      kind: 'token-create', capabilities: 'x', expires: DEFAULT_EXPIRY,
    });
  });
});

describe('token revoke', () => {
  /**
   * The bug this file was written for.
   *
   * `absuite token revoke abc123` read its id from `tokenArgs[1]` on an array
   * already sliced past the subcommand, so the id was always undefined, the
   * revoke branch never ran, and the command printed usage and exited zero.
   *
   * Someone withdrawing a leaked token saw no error and no revocation.
   */
  test('carries the token id', () => {
    expect(parseCommand(['token', 'revoke', 'tok_abc123'])).toEqual({ kind: 'token-revoke', id: 'tok_abc123' });
  });

  test('a revoke with no id asks for one instead of pretending to work', () => {
    expect(parseCommand(['token', 'revoke'])).toEqual({ kind: 'token-usage' });
  });

  test('bare token prints usage', () => {
    expect(parseCommand(['token'])).toEqual({ kind: 'token-usage' });
    expect(parseCommand(['token', 'wat'])).toEqual({ kind: 'token-usage' });
  });
});

describe('the rest', () => {
  test('build and test take no arguments', () => {
    expect(parseCommand(['build'])).toEqual({ kind: 'build' });
    expect(parseCommand(['test'])).toEqual({ kind: 'test' });
  });

  test('bench reads a model from a flag or a bare word', () => {
    expect(parseCommand(['bench'])).toEqual({ kind: 'bench' });
    expect(parseCommand(['bench', '--model', 'llama3'])).toEqual({ kind: 'bench', model: 'llama3' });
    expect(parseCommand(['bench', 'llama3'])).toEqual({ kind: 'bench', model: 'llama3' });
  });

  test.each(['version', '--version', '-v'])('%s reports the version', arg => {
    expect(parseCommand([arg]).kind).toBe('version');
  });

  test('an unknown command names itself back', () => {
    expect(parseCommand(['frobnicate'])).toEqual({ kind: 'unknown', command: 'frobnicate' });
  });

  test('parsing never touches the world', () => {
    // No filesystem, no subprocess, no network — which is what makes every case
    // above cheap enough to actually write.
    expect(() => parseCommand(['start', 'capkit'])).not.toThrow();
    expect(parseCommand(['start', 'capkit'])).toEqual(parseCommand(['start', 'capkit']));
  });
});

describe('every command in the help text is a command', () => {
  /**
   * Help that lists a command the parser does not know is a documented promise
   * the software does not keep — and it is how `token revoke` stayed advertised
   * and broken. Read from the source of the help text itself.
   */
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'index.ts'), 'utf8') as string;

  // Bounded to the command list itself. Scanning the whole file swept in the
  // examples block and every line of prose, and asked the parser what "Docker
  // Compose" meant — a check that fails for reasons unrelated to the thing it
  // is checking is worse than no check.
  const block = source.slice(source.indexOf("console.log('Commands:')"), source.indexOf("console.log('\\nExamples:"));

  const advertised = [...block.matchAll(/console\.log\('\s{2}([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/g)]
    .map(match => [match[1]!, match[2]].filter(Boolean) as string[]);

  test('the help text advertises commands', () => {
    expect(advertised.length).toBeGreaterThan(5);
  });

  test('none of them parse as unknown', () => {
    const broken = advertised
      .map(parts => ({ typed: parts.join(' '), parsed: parseCommand(parts) }))
      .filter(entry => entry.parsed.kind === 'unknown');

    expect(broken).toEqual([]);
  });
});

/**
 * `absuite doctor`, borrowed in shape from `agent-reach doctor`.
 *
 * Theirs asks whether an agent can still reach the outside world. This one asks
 * whether the evidence a deployment produces is worth anything — and the
 * parsing matters because a doctor that can only examine localhost cannot be
 * pointed at the deployment you are actually worried about.
 */
describe('doctor', () => {
  test('defaults to the local capkit', () => {
    expect(parseCommand(['doctor'])).toEqual({ kind: 'doctor', url: 'http://localhost:8081' });
  });

  test('takes a url as a flag or a positional', () => {
    expect(parseCommand(['doctor', '--url', 'https://absuite.example'])).toEqual(
      { kind: 'doctor', url: 'https://absuite.example' }
    );
    expect(parseCommand(['doctor', '-u', 'https://absuite.example'])).toEqual(
      { kind: 'doctor', url: 'https://absuite.example' }
    );
    expect(parseCommand(['doctor', 'https://absuite.example'])).toEqual(
      { kind: 'doctor', url: 'https://absuite.example' }
    );
  });
});
