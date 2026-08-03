#!/usr/bin/env node
/**
 * The whole stack, in one container, behind one address.
 *
 * docker-compose.yml runs seven containers on a private network, which is the
 * right shape for an installation someone operates. It is the wrong shape for
 * "I want to look at it": seven containers need an orchestrator, a network, a
 * volume and a host that can hold all of them, and every free tier that exists
 * gives you one process and one port.
 *
 * So this runs the same six processes side by side in a single container and
 * points the orchestrator at them over loopback. Nothing is stubbed and nothing
 * is special-cased — these are the same `dist/server.js` binaries the compose
 * file runs, reading the same SQLite file, answering the same routes. What
 * changes is only where they can be reached from, and that is set by the
 * environment rather than by the code, which is why no source file needed a
 * deployment branch in it.
 *
 * This trades isolation for reachability. One container means one failure
 * domain and no independent scaling, and that is an acceptable trade for a
 * public instance whose job is to be looked at. For an installation that holds
 * real records, run the compose file.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/**
 * The data directory, created before anything starts.
 *
 * Five services open the same SQLite file. If the directory does not exist the
 * first one to touch it fails on a path error rather than a database error,
 * which reads as a code fault and is not one.
 */
const DATA_DIR = process.env.ABSUITE_DATA_DIR || '/data';
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.ABSUITE_DB_PATH || `${DATA_DIR}/absuite.db`;

/**
 * The public port, and the five private ones.
 *
 * Hosts hand the public port in via PORT, and that variable is inherited by
 * every child unless it is overwritten. capkit reads `CAPKIT_PORT || PORT ||
 * 8081`, so an inherited PORT would put capkit on the dashboard's port and the
 * two would fight over the socket. Each child therefore gets PORT set
 * explicitly to its own value rather than merely being told its own variable.
 */
const PUBLIC_PORT = Number(process.env.PORT || 3001);

const SERVICES = [
  { name: 'capkit', dir: 'packages/capkit', port: 8081 },
  { name: 'edge-run', dir: 'packages/edge-run', port: 8082 },
  { name: 'quickbench', dir: 'packages/quickbench', port: 8083 },
  { name: 'connector-starter', dir: 'packages/connector-starter', port: 8084 },
  { name: 'trust', dir: 'packages/trust', port: 8085 },
];

const children = [];
let shuttingDown = false;

/**
 * Start one process, tagged, and treat its death as fatal.
 *
 * A supervisor that restarts a crashed child forever turns a broken build into
 * a container that looks healthy and serves errors. If a service cannot stay
 * up, the container should stop, because that is the state the platform's own
 * health check is designed to notice.
 */
function start(name, command, args, env, cwd) {
  const child = spawn(command, args, {
    cwd: cwd || process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const tag = name.padEnd(18);
  child.stdout.on('data', d => process.stdout.write(`${tag} ${d}`));
  child.stderr.on('data', d => process.stderr.write(`${tag} ${d}`));
  child.on('exit', code => {
    if (shuttingDown) return;
    console.error(`\n${tag} exited with ${code}. Stopping the container — a half-running stack would report health it does not have.`);
    stop(1);
  });
  children.push(child);
  return child;
}

function stop(code) {
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

/** Poll /health rather than sleeping, so slow starts are waited out and fast ones are not. */
async function answers(port, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Refuse to start on a configuration that cannot work, before spawning anything.
 *
 * Both of these were found by running this file for the first time rather than
 * by reading it, and neither is theoretical.
 *
 * capkit throws on a missing CAPKIT_HMAC_SECRET when NODE_ENV=production, which
 * is right — but the supervisor spawned six children first, so the operator got
 * a stack trace from a child process instead of a sentence about a variable.
 *
 * The trace key is worse, because nothing throws. Without it capkit signs with
 * an ephemeral key regenerated at every start. With a mounted volume — which is
 * exactly what fly.toml and render.yaml configure — the records outlive the key,
 * and after the first restart every one of them fails verification at once. The
 * instance would report its own chain as BROKEN, correctly, about records nobody
 * touched. For a product whose entire claim is that the record can be checked,
 * shipping a default that manufactures a false tampering result is not a rough
 * edge; it is the worst outcome available.
 *
 * So a durable volume without a durable key is refused. A container with no
 * volume may run without one, because there the records die with the key and
 * nothing is ever falsely reported.
 */
const required = [
  {
    name: 'CAPKIT_HMAC_SECRET',
    why: 'capkit refuses to start without it when NODE_ENV=production. It signs capability tokens.',
    when: () => true,
  },
  {
    name: 'CAPKIT_TRACE_PRIVATE_KEY',
    why:
      'Traces are persisted to a volume, so an ephemeral signing key would make every existing\n' +
      '      record fail verification after the first restart — the room would report the chain as\n' +
      '      BROKEN about records nobody altered.',
    when: () => Boolean(process.env.ABSUITE_PERSISTENT_DATA ?? true),
  },
  {
    name: 'ABSUITE_ADMIN_API_KEY',
    why:
      '42 routes sit behind it — executions, chain verification, the queue, the\n' +
      '      disputes, the unknowns. Without it the instance answers /status and returns 503 to\n' +
      '      everything else, so the room reports UNKNOWN everywhere while being perfectly healthy.',
    when: () => true,
  },
];

const missing = required.filter(entry => entry.when() && !(process.env[entry.name] || '').trim());
if (missing.length > 0) {
  console.error('\nRefusing to start. Missing configuration:\n');
  for (const entry of missing) console.error(`  ✗ ${entry.name}\n      ${entry.why}\n`);
  console.error('Generate all of them with:\n\n  node scripts/gen-deploy-secrets.mjs\n');
  process.exit(1);
}

console.log(`Starting ABSuite — five services on loopback, the room on :${PUBLIC_PORT}.\n`);

for (const service of SERVICES) {
  start(service.name, 'node', ['dist/server.js'], {
    PORT: String(service.port),
    ABSUITE_DB_PATH: DB_PATH,
    NODE_ENV: 'production',
  }, service.dir);
}

const results = await Promise.all(
  SERVICES.map(async service => ({ ...service, up: await answers(service.port) })),
);

console.log('');
for (const { name, port, up } of results) {
  console.log(`  ${up ? '✓' : '✗'} ${name.padEnd(18)} :${port}${up ? '' : '  did not answer'}`);
}

if (results.every(r => !r.up)) {
  console.error('\nNothing came up. The image did not build the services correctly.');
  stop(1);
}

/**
 * The orchestrator, pointed at loopback.
 *
 * server.ts resolves each service from an environment variable first and only
 * falls back to Docker's service names when the variable is absent. Setting
 * them here is what makes a single container work without a code change:
 * `inDocker` is true, so the defaults would be `http://capkit:8081`, and there
 * is no such host inside one container.
 *
 * ABSUITE_BIND is explicit rather than inherited from the `inDocker` default,
 * because binding every interface is the whole point here and it should be
 * stated where someone reading the deployment can see it.
 */
start('dashboard', 'node', ['--import', 'tsx', 'server.ts'], {
  PORT: String(PUBLIC_PORT),
  ABSUITE_BIND: '0.0.0.0',
  ABSUITE_DB_PATH: DB_PATH,
  CAPKIT_URL: 'http://127.0.0.1:8081',
  EDGE_RUN_URL: 'http://127.0.0.1:8082',
  QUICKBENCH_URL: 'http://127.0.0.1:8083',
  CONNECTOR_STARTER_URL: 'http://127.0.0.1:8084',
  TRUST_URL: 'http://127.0.0.1:8085',
  DASHBOARD_URL: `http://127.0.0.1:${PUBLIC_PORT}`,
  NODE_ENV: 'production',
}, 'packages/dashboard-ui');

if (await answers(PUBLIC_PORT)) {
  console.log(`  ✓ dashboard          :${PUBLIC_PORT}\n\nThe room is up.\n`);
} else {
  console.error('\nThe orchestrator did not answer.');
  stop(1);
}
