/**
 * Task execution.
 *
 * Two executors ship: `http` (call a URL) and `script` (spawn a process).
 *
 * Script execution is an obvious remote-code-execution vector when it is
 * driven by an HTTP API, so it is **disabled by default** and, when enabled,
 * restricted to an allowlisted directory. Enabling it is a deliberate operator
 * decision, not a default anyone can stumble into.
 */
import { spawn } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type TaskType = 'http' | 'script';

export interface HttpTask {
  type: 'http';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ScriptTask {
  type: 'script';
  script: string;
  args?: string[];
}

export type TaskDefinition = HttpTask | ScriptTask;

export interface TaskResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  statusCode?: number;
}

export interface RuntimeOptions {
  /** Absolute directory scripts must live under. Unset disables scripts. */
  scriptRoot?: string;
  /** Hosts an http task may target. Empty means any host is allowed. */
  allowedHosts?: string[];
  defaultTimeoutMs?: number;
}

export class TaskRuntime {
  private readonly scriptRoot: string;
  private readonly allowedHosts: string[];
  private readonly defaultTimeoutMs: number;

  constructor(options: RuntimeOptions = {}) {
    this.scriptRoot = (options.scriptRoot ?? process.env.EDGERUN_SCRIPT_ROOT ?? '').trim();
    this.allowedHosts = options.allowedHosts
      ?? (process.env.EDGERUN_ALLOWED_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? Number(process.env.EDGERUN_TASK_TIMEOUT_MS || 30_000);
  }

  get scriptsEnabled(): boolean {
    return this.scriptRoot.length > 0;
  }

  async execute(task: TaskDefinition, timeoutMs?: number): Promise<TaskResult> {
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const startedAt = Date.now();

    try {
      if (task.type === 'http') return await this.executeHttp(task, timeout, startedAt);
      if (task.type === 'script') return await this.executeScript(task, timeout, startedAt);
      return { ok: false, error: `Unsupported task type: ${(task as { type: string }).type}`, durationMs: Date.now() - startedAt };
    } catch (error) {
      return { ok: false, error: (error as Error).message, durationMs: Date.now() - startedAt };
    }
  }

  /**
   * Whether an address is the cloud metadata range.
   *
   * `169.254.0.0/16` is link-local, and every major cloud puts its instance
   * metadata service at `169.254.169.254` — AWS, GCP, Azure, DigitalOcean,
   * Oracle. `metadata.google.internal` resolves there. Reading it returns the
   * machine's IAM credentials.
   *
   * Deliberately narrow. **Private ranges are not blocked**, and that is the
   * whole judgement in this function: edge-run is a task runner inside your own
   * infrastructure, so *call `http://10.0.0.5/reindex` every fifteen minutes*
   * is the product's primary job, not an attack. Refusing `10.x` by default
   * would break real deployments to stop nothing, and a control that breaks the
   * main use case gets switched off, which protects nobody.
   *
   * Link-local is different: it is never a legitimate scheduled-task target,
   * and it is the single highest-value one.
   */
  private static metadataReason(address: string): string | undefined {
    if (isIP(address) === 4 && /^169\.254\./.test(address)) {
      return 'the cloud instance metadata range (169.254.0.0/16)';
    }
    const v6 = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (/^fe[89ab]/.test(v6)) return 'an IPv6 link-local address';
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped?.[1] ? TaskRuntime.metadataReason(mapped[1]) : undefined;
  }

  /**
   * Check a task URL before anything is sent to it.
   *
   * ## What was wrong
   *
   * `EDGERUN_ALLOWED_HOSTS` empty means *any host*, and empty is the default —
   * so out of the box an `http` task reached
   * `http://169.254.169.254/latest/meta-data/iam/security-credentials/` and
   * returned the body in `output`. Plain `http:` is accepted, which matters
   * because AWS IMDSv1 is HTTP-only: the sibling defect in connector-starter
   * required https and incidentally blocked that path. This one did not.
   *
   * A `queue:write` scope means *queue a task*. It does not mean *read this
   * machine's cloud credentials*, and a capability that grants more than its
   * name says is the defect this project exists to prevent.
   *
   * ## The limit, stated
   *
   * The hostname is resolved and the result checked, so a name pointing at the
   * metadata address is refused too. It does not close DNS rebinding — between
   * this lookup and the one `fetch` performs, a hostile resolver can answer
   * differently. Closing that needs an agent that pins the resolved address.
   *
   * An explicit `EDGERUN_ALLOWED_HOSTS` entry always wins: an operator who
   * names `169.254.169.254` has said what they mean, and this does not argue.
   */
  private async assertHostAllowed(url: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid task URL: ${url}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const host = parsed.hostname.replace(/^\[|\]$/g, '');

    if (this.allowedHosts.length > 0 && !this.allowedHosts.includes(parsed.hostname)) {
      throw new Error(`Host not allowed: ${parsed.hostname}`);
    }
    // Named explicitly, so it was meant.
    if (this.allowedHosts.includes(parsed.hostname)) return parsed;

    const direct = TaskRuntime.metadataReason(host);
    if (direct) {
      throw new Error(`Refusing to call ${direct}. Add it to EDGERUN_ALLOWED_HOSTS if that is genuinely intended.`);
    }

    /*
     * By name as well as by address, and the difference is not belt-and-braces.
     *
     * `metadata.google.internal` resolves to 169.254.169.254 **on GCP** and
     * nowhere else — it returns ENOTFOUND on any other machine, which was
     * verified rather than assumed. So the DNS check below cannot catch it
     * anywhere except the one environment where it matters, and a guard that
     * only works where it is hardest to test is a guard nobody should trust.
     */
    if (/(^|\.)metadata\.(google\.internal|goog)$/i.test(host)) {
      throw new Error(
        `Refusing to call ${parsed.hostname}: it is the GCP metadata service. ` +
        'Add it to EDGERUN_ALLOWED_HOSTS if that is genuinely intended.'
      );
    }

    if (!isIP(host)) {
      try {
        for (const { address } of await lookup(host, { all: true })) {
          const reason = TaskRuntime.metadataReason(address);
          if (reason) {
            throw new Error(
              `Refusing to call ${parsed.hostname}: it resolves to ${address}, ${reason}. ` +
              'Add it to EDGERUN_ALLOWED_HOSTS if that is genuinely intended.'
            );
          }
        }
      } catch (error) {
        // A name that will not resolve fails at fetch anyway; only re-throw our
        // own refusal, so a DNS outage does not masquerade as a security event.
        if ((error as Error).message.startsWith('Refusing to call')) throw error;
      }
    }

    return parsed;
  }

  private async executeHttp(task: HttpTask, timeoutMs: number, startedAt: number): Promise<TaskResult> {
    await this.assertHostAllowed(task.url);

    const response = await fetch(task.url, {
      method: task.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(task.headers ?? {}) },
      ...(task.body !== undefined ? { body: typeof task.body === 'string' ? task.body : JSON.stringify(task.body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    let output: unknown = text;
    try {
      output = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON bodies are returned as-is.
    }

    return {
      ok: response.ok,
      output,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  }

  /**
   * Resolve a script path and refuse anything outside the allowlisted root.
   *
   * Resolving first and then comparing prefixes is what stops `../` escapes;
   * the trailing separator stops `/srv/scripts-evil` passing as `/srv/scripts`.
   */
  private resolveScriptPath(script: string): string {
    if (!this.scriptsEnabled) {
      throw new Error('Script tasks are disabled. Set EDGERUN_SCRIPT_ROOT to enable them.');
    }

    const root = resolve(this.scriptRoot);
    const target = resolve(root, script);

    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error('Script path escapes the allowed script root');
    }
    return target;
  }

  private executeScript(task: ScriptTask, timeoutMs: number, startedAt: number): Promise<TaskResult> {
    const scriptPath = this.resolveScriptPath(task.script);

    return new Promise<TaskResult>(resolvePromise => {
      // No shell: arguments are passed as an array so nothing is re-parsed.
      const child = spawn(process.execPath, [scriptPath, ...(task.args ?? [])], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });

      let stdout = '';
      let stderr = '';
      const MAX_OUTPUT = 64 * 1024;

      child.stdout.on('data', chunk => {
        if (stdout.length < MAX_OUTPUT) stdout += String(chunk);
      });
      child.stderr.on('data', chunk => {
        if (stderr.length < MAX_OUTPUT) stderr += String(chunk);
      });

      child.on('error', error => {
        resolvePromise({ ok: false, error: error.message, durationMs: Date.now() - startedAt });
      });

      child.on('close', code => {
        resolvePromise({
          ok: code === 0,
          output: stdout.trim(),
          durationMs: Date.now() - startedAt,
          ...(code === 0 ? {} : { error: stderr.trim() || `Script exited with code ${code}` }),
        });
      });
    });
  }
}
