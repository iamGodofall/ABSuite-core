#!/usr/bin/env node
/**
 * ABSuite CLI — Agent Builder Suite
 * Single unified command-line interface for managing the ABSuite platform.
 */

import { parseCommand } from './command.js'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawn } from 'child_process'

// ---- Config ----

// This package is ESM ("type": "module"), where __dirname does not exist. Using
// it threw `ReferenceError: __dirname is not defined in ES module scope` on the
// very first line of every command, so the CLI could never run at all once
// installed from the registry.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yml')
const CLI_DIR = path.join(ROOT, 'packages', 'cli')

// ---- Helpers ----

function getDockerComposeCmd(service?: string): string {
  const base = `docker compose -p absuite-core -f "${COMPOSE_FILE}"`
  return service ? `${base} ${service}` : base
}

/** Commands that drive the suite through Docker Compose. */
// The list of Docker-backed commands now lives with the parser, so there is one
// place that decides what needs a container and one place that checks for one.

/**
 * Explain the situation when the compose file is not there.
 *
 * Checked in the dispatcher rather than thrown from deeper down, because each
 * command catches broadly and substitutes its own message — `status` was
 * answering a global install with "Run: pnpm start", which is advice for a
 * directory the user does not have.
 *
 * The published tarball is dist, README and LICENSE. The compose file lives in
 * the repository, so a global install legitimately cannot run these commands.
 */
function composeAvailable(): boolean {
  if (fs.existsSync(COMPOSE_FILE)) return true

  logError('This command needs the ABSuite repository, which is not present here.')
  console.log(`\n  Looked for: ${COMPOSE_FILE}\n`)
  console.log('  start, stop, restart, status and logs drive the suite through')
  console.log('  Docker Compose, which needs the repo checked out:\n')
  console.log('    git clone https://github.com/iamGodofall/ABSuite-core')
  console.log('    cd ABSuite-core && pnpm install && pnpm start\n')
  console.log('  To use the libraries directly, install what you need:\n')
  console.log('    npm install @absuitecore/capkit')
  console.log('    npm install @absuitecore/trust\n')
  return false
}

function run(cmd: string, options: { cwd?: string; stdio?: 'inherit' | 'pipe' } = {}): string {
  try {
    return execSync(cmd, {
      cwd: options.cwd || ROOT,
      stdio: options.stdio || 'pipe',
      encoding: 'utf-8',
    }).trim()
  } catch (e: any) {
    throw new Error(`Command failed: ${cmd}\n${e.stderr || e.message}`)
  }
}

function log(msg: string) {
  console.log(`[ABSuite] ${msg}`)
}

function logSuccess(msg: string) {
  console.log(`[ABSuite] ✅ ${msg}`)
}

function logError(msg: string) {
  console.error(`[ABSuite] ❌ ${msg}`)
}

function banner() {
  console.log(`
   ██▓ ██▓███      ▄▄▄█████▓ ██▀███   ███▄    █  ███▄    █ ▓█████ 
  ▓██▒▓██░  ██▒    ▓  ██▒ ▓▒▓██ ▒ ██▒ ██ ▀█   █  ██ ▀█   █ ▓█   ▀ 
  ▒██▒▓██░ ██▓▒    ▒ ▓██░ ▒░▓██ ░▄█ ▒▓██  ▀█ ██▒▓██  ▀█ ██▒▒███   
  ░██░▒██▄█▓▒ ▒    ░ ▓██▓ ░ ▒██▀▀█▄  ▓██▒  ▐▌██▒▓██▒  ▐▌██▒▒▓█  ▄ 
  ░██░▒██▒ ░  ░      ▒██▒ ░ ░██▓ ▒██▒▒██░   ▓██░▒██░   ▓██░░▒████▒
  ░▓  ▒▓▒░ ░  ░      ▒ ░░   ░ ▒▓ ░▒▓░░ ▒░   ▒ ▒ ░ ▒░   ▒ ▒ ░░ ▒░ ░
   ▒ ░░▒ ░             ░      ░▒ ░ ▒░░ ░░   ░ ▒░░ ░░   ░ ▒░ ░ ░  ░
   ▒ ░░░              ░        ░░   ░    ░   ░ ░   ░   ░ ░    ░   
   ░                          ░                  ░           ░  ░
                                                              
  Agent Builder Suite — Production AI Infrastructure
`)
}

// ---- Commands ----

async function cmdStart(service?: string) {
  banner()
  if (service) {
    log(`Starting service: ${service}`)
    const cmd = getDockerComposeCmd(`up -d ${service}`)
    run(cmd)
    logSuccess(`${service} started`)
  } else {
    log('Starting all services...')
    run(`${getDockerComposeCmd()} up -d`)
    logSuccess('All services started')
    console.log('\n  Dashboard → http://localhost:3001\n')
  }
}

async function cmdStop(service?: string) {
  if (service) {
    log(`Stopping service: ${service}`)
    run(`${getDockerComposeCmd()} stop ${service}`)
    logSuccess(`${service} stopped`)
  } else {
    log('Stopping all services...')
    run(`${getDockerComposeCmd()} down`)
    logSuccess('All services stopped')
  }
}

async function cmdRestart(service?: string) {
  if (service) {
    log(`Restarting service: ${service}`)
    run(`${getDockerComposeCmd()} restart ${service}`)
    logSuccess(`${service} restarted`)
  } else {
    log('Restarting all services...')
    run(`${getDockerComposeCmd()} restart`)
    logSuccess('All services restarted')
  }
}

async function cmdStatus() {
  banner()
  console.log('Service Status\n')
  try {
    const output = run(`${getDockerComposeCmd()} ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"`)
    console.log(output)
  } catch {
    logError('Docker not running or no services found')
    console.log('\n  Run: pnpm start\n')
  }
}

async function cmdLogs(service: string, follow = false) {
  const cmd = follow
    ? `${getDockerComposeCmd()} logs -f ${service}`
    : `${getDockerComposeCmd()} logs ${service}`
  console.log(`[ABSuite] Following logs for ${service} (Ctrl+C to stop)\n`)
  spawn(cmd, [], { cwd: ROOT, stdio: 'inherit', shell: true })
}

async function cmdBuild() {
  banner()
  log('Building all packages...')
  run('pnpm build', { cwd: ROOT })
  logSuccess('Build complete')
}

async function cmdTest() {
  banner()
  log('Running tests...')
  run('pnpm test', { cwd: ROOT, stdio: 'inherit' })
}

async function cmdBench(options: { model?: string; providers?: string[] }) {
  banner()
  log('Running benchmark suite...')

  const model = options.model || 'llama3'
  const provider = options.providers?.[0] || 'ollama'

  console.log(`\n  Provider: ${provider}`)
  console.log(`  Model:    ${model}\n`)

  try {
    const result = run(`docker compose -p absuite-core -f "${COMPOSE_FILE}" exec quickbench node dist/benchmark.js --model ${model} --provider ${provider}`, { cwd: ROOT })
    console.log(result)
    logSuccess('Benchmark complete')
  } catch {
    // Fallback: run quickbench locally
    log('QuickBench service not running — starting it...')
    run(`${getDockerComposeCmd()} up -d quickbench`)
    await new Promise(r => setTimeout(r, 3000))
    const result = run(`docker compose -p absuite-core -f "${COMPOSE_FILE}" exec quickbench node dist/benchmark.js --model ${model} --provider ${provider}`, { cwd: ROOT })
    console.log(result)
    logSuccess('Benchmark complete')
  }
}

async function cmdToken(options: { create?: boolean; capabilities?: string; expires?: string; revoke?: string }) {
  if (options.create) {
    const scope = options.capabilities || 'read,write'
    const expires = options.expires || '24h'

    log(`Generating capability token (scope: ${scope}, expires: ${expires})...`)
    try {
      const result = run(`docker compose -p absuite-core -f "${COMPOSE_FILE}" exec -T capkit node dist/cli.js token create --scope "${scope}" --expires ${expires}`, { cwd: ROOT })
      console.log('\n' + result)
      logSuccess('Token created')
    } catch {
      // Fallback to local build
      log('Running token creation locally...')
      const result = run(`node packages/capkit/dist/cli.js token create --scope "${scope}" --expires ${expires}`, { cwd: ROOT })
      console.log('\n' + result)
      logSuccess('Token created')
    }
  } else if (options.revoke) {
    log(`Revoking token: ${options.revoke}`)
    run(`docker compose -p absuite-core -f "${COMPOSE_FILE}" exec -T capkit node dist/cli.js token revoke ${options.revoke}`, { cwd: ROOT })
    logSuccess('Token revoked')
  } else {
    console.log('\nUsage:\n')
    console.log('  absuite token create --capabilities read,write --expires 24h')
    console.log('  absuite token revoke <token-id>\n')
  }
}

/**
 * `absuite doctor` — is the evidence this deployment produces worth anything?
 *
 * The idea is borrowed from `agent-reach doctor`, and only the idea. Theirs
 * answers "can my agent still reach Reddit?" — a question about the outside
 * world. This one asks a question about the deployment itself, and every check
 * is one this product can already answer but has never gathered in one place:
 * a chain that verifies, a key that survives a restart, approvals that were
 * actually given, and a watch that has actually run.
 *
 * Two rules make this a doctor rather than a dashboard.
 *
 * It never invents a verdict. Each check lands in the same four words used
 * everywhere else, and a check that could not run reports UNKNOWN with the
 * reason — never a green tick because the request failed quietly.
 *
 * It exits non-zero only on FAILED. An UNKNOWN is not a failure; it is a thing
 * nobody has checked, and a doctor that fails CI on "I could not tell" gets
 * removed from CI within a week.
 */
async function cmdDoctor(base: string) {
  const key = process.env.CAPKIT_ADMIN_KEY || process.env.ABSUITE_ADMIN_API_KEY || ''
  const headers: Record<string, string> = key ? { 'x-absuite-admin-key': key } : {}

  const findings: { state: 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT'; what: string; detail: string }[] = []
  const add = (state: typeof findings[number]['state'], what: string, detail: string) =>
    findings.push({ state, what, detail })

  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, { headers })
    const text = await res.text()
    let body: any = {}
    try { body = text ? JSON.parse(text) : {} } catch { throw new Error(`${path} did not return JSON (${res.status})`) }
    if (!res.ok) throw new Error(body?.error?.message ?? `${path} returned ${res.status}`)
    return body
  }

  console.log(`\n  Examining ${base}\n`)

  // Reachability first. Every check below is UNKNOWN if this one fails, and
  // reporting eight unknowns would bury the one finding that explains them.
  try {
    const health = await get('/health')
    add('DEMONSTRATED', 'Service', `${health.status}, version ${health.version}`)
  } catch (err: any) {
    add('FAILED', 'Service', `Not reachable: ${err.message}`)
    report(findings)
    return
  }

  // The signing key. An ephemeral key with a durable database is the worst
  // state this product can run in, and it looks perfectly healthy until a
  // restart invalidates every record ever written.
  try {
    const pk = await get('/executions/public-key')
    if (pk.ephemeral) {
      add('FAILED', 'Signing key', 'Generated for this process. Every record written since the last restart stops verifying at the next one. Set CAPKIT_TRACE_PRIVATE_KEY.')
    } else {
      add('DEMONSTRATED', 'Signing key', `${pk.keyId}, durable across restarts`)
    }
  } catch (err: any) {
    add('UNKNOWN', 'Signing key', err.message)
  }

  try {
    const stats = await get('/executions/stats?verify=full')
    const chain = stats.chain ?? {}
    if (chain.valid === false) {
      add('FAILED', 'Chain', `Broken${chain.brokenAt !== undefined ? ` at record ${chain.brokenAt}` : ''}. ${chain.reason ?? ''}`.trim())
    } else if (chain.valid === true) {
      add('DEMONSTRATED', 'Chain', `${stats.total ?? 0} record(s), content, linkage and signatures all check`)
    } else {
      add('UNKNOWN', 'Chain', 'The chain was not walked.')
    }
    if ((stats.total ?? 0) === 0) {
      add('ABSENT', 'Evidence', 'Nothing has been recorded. An empty instance is not a healthy one or an unhealthy one — it is empty.')
    }
  } catch (err: any) {
    add('UNKNOWN', 'Chain', err.message)
  }

  try {
    const identities = await get('/identities')
    const list = identities.identities ?? identities ?? []
    const count = Array.isArray(list) ? list.length : 0
    if (count === 0) {
      add('ABSENT', 'Identity', 'No subject is enrolled, so every condition report reads Identity: UNKNOWN. The name on a record is a string somebody typed.')
    } else {
      add('DEMONSTRATED', 'Identity', `${count} subject(s) enrolled against a public key`)
    }
  } catch (err: any) {
    add('UNKNOWN', 'Identity', err.message)
  }

  try {
    const pending = await get('/approvals?state=PENDING')
    const waiting = (pending.approvals ?? []).length
    if (waiting > 0) {
      add('UNKNOWN', 'Approvals', `${waiting} request(s) waiting on a person. Nothing runs until somebody decides.`)
    } else {
      add('DEMONSTRATED', 'Approvals', 'Nothing is waiting on a decision')
    }
  } catch (err: any) {
    add('UNKNOWN', 'Approvals', err.message)
  }

  try {
    const watch = await get('/watch?state=OPEN')
    const coverage = watch.coverage ?? {}
    const open = (watch.notices ?? []).length
    if (!coverage.everRun) {
      add('FAILED', 'Watch', 'Has never swept. There are no findings because nothing has looked, which is not the same as nothing being wrong.')
    } else if (coverage.lastSweepFailed) {
      add('FAILED', 'Watch', `The last sweep failed: ${coverage.lastSweepFailed}`)
    } else if (open > 0) {
      add('UNKNOWN', 'Watch', `${open} open notice(s). ${coverage.because}`)
    } else {
      add('DEMONSTRATED', 'Watch', coverage.because)
    }
  } catch (err: any) {
    add('UNKNOWN', 'Watch', err.message)
  }

  try {
    const unknowns = await get('/executions/unknowns')
    const n = unknowns.count ?? (unknowns.items ?? []).length
    if (n > 0) {
      add('UNKNOWN', 'Unresolved', `${n} record(s) carry something nobody has settled. Each names the step that would settle it.`)
    } else {
      add('DEMONSTRATED', 'Unresolved', 'Nothing in the examined window is unresolved')
    }
  } catch (err: any) {
    add('UNKNOWN', 'Unresolved', err.message)
  }

  report(findings)
}

/**
 * The four words, in a column, and a conclusion in prose.
 *
 * No score, no percentage, no "7/8 healthy" — the same refusal the rest of the
 * product holds to. A doctor that summed these into a number would be inviting
 * somebody to act on the number instead of the findings.
 */
function report(findings: { state: string; what: string; detail: string }[]) {
  const mark = (s: string) => s === 'DEMONSTRATED' ? '\x1b[32m✓\x1b[0m'
    : s === 'FAILED' ? '\x1b[31m✗\x1b[0m'
    : s === 'UNKNOWN' ? '\x1b[33m?\x1b[0m' : '\x1b[90m·\x1b[0m'

  for (const f of findings) {
    console.log(`  ${mark(f.state)} ${f.what.padEnd(12)} ${f.detail}`)
  }

  const failed = findings.filter(f => f.state === 'FAILED')
  const unknown = findings.filter(f => f.state === 'UNKNOWN')

  console.log('')
  if (failed.length > 0) {
    console.log(`  ${failed.length} finding(s) contradict the evidence this deployment is producing:`)
    for (const f of failed) console.log(`    - ${f.what}`)
    console.log('')
    process.exitCode = 1
    return
  }
  if (unknown.length > 0) {
    console.log(`  Nothing failed. ${unknown.length} thing(s) are unchecked or waiting on a person —`)
    console.log('  which is a different statement from "everything is fine", and is not an error.\n')
    return
  }
  console.log('  Every check this build knows how to run came back demonstrated.')
  console.log('  That is a statement about these checks, not about the system.\n')
}

async function cmdVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
  console.log(`ABSuite v${pkg.version}`)
}

// ---- CLI Entry Point ----

/**
 * Print usage.
 *
 * Reachable from `--help`, `-h`, `help` and no arguments alike. `--help` is the
 * first thing anyone types after installing a CLI, and answering it with
 * "Unknown command" and a non-zero exit is a poor first impression that also
 * breaks any script probing for support.
 */
function showHelp(): void {
  {
    banner()
    console.log('Usage: absuite <command> [options]\n')
    console.log('Commands:')
    console.log('  start [service]      Start all services or a specific service')
    console.log('  stop [service]       Stop all services or a specific service')
    console.log('  restart [service]    Restart all services or a specific service')
    console.log('  status              Show service status')
    console.log('  logs <service>       View logs for a service')
    console.log('  logs -f <service>    Follow logs in real-time')
    console.log('  build               Build all packages')
    console.log('  test                Run all tests')
    console.log('  bench [--model]      Run performance benchmark')
    console.log('  token create        Create a capability token')
    console.log('  token revoke <id>    Revoke a capability token')
    console.log('  version             Show version')
    console.log('\nExamples:\n')
    console.log('  absuite start                # Start everything')
    console.log('  absuite start capkit          # Start only capkit')
    console.log('  absuite logs -f edge-run      # Follow edge-run logs')
    console.log('  absuite bench --model llama3  # Benchmark llama3')
    console.log('  absuite token create --capabilities read,write --expires 8h\n')
  }
}

async function main() {
  const command = parseCommand(process.argv.slice(2))

  if (command.kind === 'help') {
    showHelp()
    return
  }

  // Compose is checked once, against the parsed intent, rather than against a
  // raw string. A command that needs Docker and cannot find it should say so
  // before anything else runs.
  if (command.kind === 'compose' && !composeAvailable()) {
    process.exitCode = 1
    return
  }

  try {
    switch (command.kind) {
      case 'compose': {
        switch (command.action) {
          case 'start':   await cmdStart(command.service); break
          case 'stop':    await cmdStop(command.service); break
          case 'restart': await cmdRestart(command.service); break
          case 'status':  await cmdStatus(); break
          case 'logs': {
            if (!command.service) {
              logError('Usage: absuite logs [-f] <service>')
              process.exit(1)
            }
            await cmdLogs(command.service, command.follow)
            break
          }
        }
        break
      }
      case 'build': await cmdBuild(); break
      case 'test': await cmdTest(); break
      case 'bench': await cmdBench({ ...(command.model ? { model: command.model } : {}) }); break
      case 'token-create':
        await cmdToken({ create: true, capabilities: command.capabilities, expires: command.expires })
        break
      case 'token-revoke':
        await cmdToken({ revoke: command.id })
        break
      case 'token-usage':
        await cmdToken({})
        break
      case 'doctor': await cmdDoctor(command.url); break
      case 'version': await cmdVersion(); break
      case 'unknown':
        logError(`Unknown command: ${command.command}`)
        console.log('\nRun: absuite (with no args for help)\n')
        process.exit(1)
    }
  } catch (err: any) {
    logError(err.message)
    process.exit(1)
  }
}

main()
