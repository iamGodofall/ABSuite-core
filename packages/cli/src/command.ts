/**
 * What the user asked for, separated from doing it.
 *
 * The CLI's dispatch lived inside `main()`, next to the code that shells out to
 * Docker. That made it effectively untestable — you cannot check how an argument
 * is read without also starting containers — and the whole package's test suite
 * had shrunk to three tests that only proved the binary builds and prints its
 * own name. Nothing exercised a single command.
 *
 * A bug had been sitting in that gap:
 *
 *     absuite token revoke <id>
 *
 * read its id from `tokenArgs[1]`, on an array that had already been sliced past
 * the subcommand. The id was always `undefined`, the revoke branch never ran, and
 * the command printed usage and exited zero. Somebody revoking a leaked token
 * would have seen no error at all.
 *
 * So parsing is a pure function over `argv` with no side effects, no filesystem
 * and no subprocess, and `main()` does nothing but act on what it returns. Every
 * command below is covered by a test that asks what a string of arguments means.
 */

export type Command =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'compose'; action: 'start' | 'stop' | 'restart' | 'status' | 'logs'; service?: string; follow: boolean }
  | { kind: 'build' }
  | { kind: 'test' }
  | { kind: 'bench'; model?: string }
  | { kind: 'token-create'; capabilities: string; expires: string }
  | { kind: 'token-revoke'; id: string }
  | { kind: 'token-usage' }
  | { kind: 'unknown'; command: string };

export const COMPOSE_ACTIONS = ['start', 'stop', 'restart', 'status', 'logs'] as const;

/** Defaults live here, once, so help text and behaviour cannot drift apart. */
export const DEFAULT_SCOPE = 'read,write';
export const DEFAULT_EXPIRY = '24h';

/**
 * Read a `--flag value` or `--flag=value` pair, plus its short form.
 *
 * Written out rather than delegated to `parseArgs`, because `parseArgs` throws
 * on an unknown option and a CLI that crashes on a typo instead of saying which
 * flag it did not recognise is worse than one that ignores it.
 */
function flag(args: string[], long: string, short?: string): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === `--${long}` || (short && arg === `-${short}`)) {
      const next = args[i + 1];
      // A flag at the end of the line has no value; treating the following
      // flag as its value is how `--expires --verbose` becomes an 8h token.
      return next && !next.startsWith('-') ? next : undefined;
    }
    if (arg.startsWith(`--${long}=`)) return arg.slice(long.length + 3) || undefined;
  }
  return undefined;
}

/** The first argument that is not a flag or a flag's value. */
function firstPositional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg.startsWith('-')) {
      // Skip its value too, unless the flag used `=` or stands alone.
      if (!arg.includes('=') && args[i + 1] && !args[i + 1]!.startsWith('-')) i += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}

export function parseCommand(argv: string[]): Command {
  const args = argv.filter(arg => arg !== '');

  if (args.length === 0 || ['--help', '-h', 'help'].includes(args[0]!)) return { kind: 'help' };

  const [command, ...rest] = args;

  if ((COMPOSE_ACTIONS as readonly string[]).includes(command!)) {
    // `logs -f edge-run` and `logs edge-run -f` mean the same thing. A person
    // types both, and one of them silently tailing nothing is not acceptable.
    const follow = rest.includes('-f') || rest.includes('--follow');
    const service = rest.find(arg => !arg.startsWith('-'));
    return {
      kind: 'compose',
      action: command as 'start' | 'stop' | 'restart' | 'status' | 'logs',
      ...(service ? { service } : {}),
      follow,
    };
  }

  switch (command) {
    case 'build': return { kind: 'build' };
    case 'test': return { kind: 'test' };
    case 'bench': {
      const model = flag(rest, 'model', 'm') ?? firstPositional(rest);
      return { kind: 'bench', ...(model ? { model } : {}) };
    }
    case 'token': {
      const sub = rest[0];
      const tail = rest.slice(1);
      if (sub === 'create') {
        return {
          kind: 'token-create',
          capabilities: flag(tail, 'capabilities', 'c') ?? flag(tail, 'scope') ?? DEFAULT_SCOPE,
          expires: flag(tail, 'expires', 'e') ?? DEFAULT_EXPIRY,
        };
      }
      if (sub === 'revoke') {
        // `tail[0]`, not `tail[1]`. The off-by-one here meant every revoke
        // silently became a usage message, on the one command whose whole job
        // is to withdraw authority in a hurry.
        const id = firstPositional(tail);
        return id ? { kind: 'token-revoke', id } : { kind: 'token-usage' };
      }
      return { kind: 'token-usage' };
    }
    case 'version':
    case '--version':
    case '-v':
      return { kind: 'version' };
    default:
      return { kind: 'unknown', command: command! };
  }
}
