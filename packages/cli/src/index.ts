#!/usr/bin/env node
/**
 * ABSuite CLI — Agent Builder Suite
 * Single unified command-line interface for managing the ABSuite platform.
 */

import * as fs from 'fs'
import * as path from 'path'
import { execSync, spawn } from 'child_process'
import { parseArgs } from 'util'

// ---- Config ----

const ROOT = path.resolve(__dirname, '..')
const COMPOSE_FILE = path.join(ROOT, 'docker-compose.yml')
const CLI_DIR = path.join(ROOT, 'packages', 'cli')

// ---- Helpers ----

function getDockerComposeCmd(service?: string): string {
  const base = `docker compose -p absuite-core -f "${COMPOSE_FILE}"`
  return service ? `${base} ${service}` : base
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

async function cmdVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
  console.log(`ABSuite v${pkg.version}`)
}

// ---- CLI Entry Point ----

async function main() {
  const args = process.argv.slice(2)

  // Handle no arguments gracefully
  if (args.length === 0) {
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
    return
  }

  const [command, ...rest] = args

  // Parse global flags
  const { values: globalFlags } = parseArgs({
    args: rest,
    options: { },
    allowPositionals: true,
  })

  try {
    switch (command) {
      case 'start': {
        const service = rest[0]
        await cmdStart(service)
        break
      }
      case 'stop': {
        const service = rest[0]
        await cmdStop(service)
        break
      }
      case 'restart': {
        const service = rest[0]
        await cmdRestart(service)
        break
      }
      case 'status': {
        await cmdStatus()
        break
      }
      case 'logs': {
        const isFollow = rest[0] === '-f'
        const service = isFollow ? rest[1] : rest[0]
        if (!service) {
          logError('Usage: absuite logs [-f] <service>')
          process.exit(1)
        }
        await cmdLogs(service, isFollow)
        break
      }
      case 'build': {
        await cmdBuild()
        break
      }
      case 'test': {
        await cmdTest()
        break
      }
      case 'bench': {
        const { values } = parseArgs({
          args: rest,
          options: {
            model: { type: 'string', short: 'm' },
            provider: { type: 'string', short: 'p' },
          },
          allowPositionals: true,
        })
        await cmdBench(values)
        break
      }
      case 'token': {
        const sub = rest[0]
        const tokenArgs = rest.slice(1)
        const { values } = parseArgs({
          args: tokenArgs,
          options: {
            capabilities: { type: 'string', short: 'c' },
            expires: { type: 'string', short: 'e' },
          },
          allowPositionals: true,
        })
        if (sub === 'create') {
          await cmdToken({ create: true, capabilities: values.capabilities, expires: values.expires })
        } else if (sub === 'revoke') {
          await cmdToken({ revoke: tokenArgs[1] })
        } else {
          await cmdToken({})
        }
        break
      }
      case 'version':
      case '--version':
      case '-v': {
        await cmdVersion()
        break
      }
      default:
        logError(`Unknown command: ${command}`)
        console.log('\nRun: absuite (with no args for help)\n')
        process.exit(1)
    }
  } catch (err: any) {
    logError(err.message)
    process.exit(1)
  }
}

main()
