#!/usr/bin/env node
/**
 * Everything, running, in one command.
 *
 * The Trust Operations Center is not a mock-up and never has been — it reads
 * six services over HTTP and a socket, and it shows UNKNOWN for every figure it
 * cannot reach. Which means the difference between "the room is broken" and
 * "the room has nothing to talk to" is entirely a matter of whether the stack
 * behind it is up, and until now bringing that stack up meant either Docker or
 * six terminals.
 *
 * `pnpm room` starts all of it, waits until each part actually answers rather
 * than guessing at a delay, and tells you what did not come up if something did
 * not. Ctrl-C stops the lot.
 *
 * A published copy of this interface — a single file with no backend — can
 * never be live. There is nothing on the far side to answer it. That is not a
 * fault in the build; it is what a console with no instance behind it looks
 * like, and the room says so in those words.
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each service, the port it answers on, and the package that provides it. */
const SERVICES = [
  { name: 'capkit', pkg: '@absuitecore/capkit', port: 8081 },
  { name: 'edge-run', pkg: '@absuitecore/edge-run', port: 8082 },
  { name: 'quickbench', pkg: '@absuitecore/quickbench', port: 8083 },
  { name: 'connector-starter', pkg: '@absuitecore/connector-starter', port: 8084 },
  { name: 'trust', pkg: '@absuitecore/trust', port: 8085 },
];

const ORCHESTRATOR = { name: 'dashboard', pkg: '@absuitecore/dashboard-ui', port: 3001 };

/** The package manager, named the way this platform can actually launch it. */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const children = [];

function start({ name, pkg }) {
  // `pnpm` on Windows is a .cmd shim, and Node's spawn will not resolve it
  // without the extension — the whole one-command path died with ENOENT there.
  // `shell: true` also matters: without it, spawning a .cmd throws EINVAL when
  // the path contains characters cmd treats specially, which a folder called
  // "ABSuite-core-main (ROOM)" does.
  const child = spawn(PNPM, ['--filter', pkg, 'start'], {
    shell: process.platform === 'win32',
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Without an admin key capkit refuses to mint the first token, which
      // means nothing can ever be recorded and every layer stays empty. A local
      // default is fine here and nowhere else; override it in any deployment.
      CAPKIT_ADMIN_KEY: process.env.CAPKIT_ADMIN_KEY || 'absuite-local-dev-key',
    },
  });
  const tag = name.padEnd(18);
  child.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
  child.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));
  children.push(child);
  return child;
}

async function answers(port, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 750));
  }
  return false;
}

process.on('SIGINT', () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
});

console.log('Starting the stack.\n');
for (const service of SERVICES) start(service);

const results = await Promise.all(
  SERVICES.map(async service => ({ ...service, up: await answers(service.port) })),
);

console.log('');
for (const { name, port, up } of results) {
  console.log(`  ${up ? '✓' : '✗'} ${name.padEnd(18)} :${port}${up ? '' : '  did not answer'}`);
}

const down = results.filter(r => !r.up);
if (down.length === SERVICES.length) {
  console.error('\nNothing came up. Run `pnpm build` first — the services run from dist/.');
  process.exit(1);
}

start(ORCHESTRATOR);
const orchestrator = await answers(ORCHESTRATOR.port);
console.log(`  ${orchestrator ? '✓' : '✗'} ${ORCHESTRATOR.name.padEnd(18)} :${ORCHESTRATOR.port}\n`);

if (orchestrator) {
  console.log(`The room is at http://localhost:${ORCHESTRATOR.port}`);
  if (down.length > 0) {
    console.log(`${down.length} service(s) did not answer; the room will report them as unreachable rather than hiding them.`);
  }
  console.log('Ctrl-C to stop everything.\n');
} else {
  console.error('The orchestrator did not answer. The room has nothing to serve it.\n');
}
