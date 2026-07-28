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

  private assertHostAllowed(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid task URL: ${url}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    if (this.allowedHosts.length > 0 && !this.allowedHosts.includes(parsed.hostname)) {
      throw new Error(`Host not allowed: ${parsed.hostname}`);
    }

    return parsed;
  }

  private async executeHttp(task: HttpTask, timeoutMs: number, startedAt: number): Promise<TaskResult> {
    this.assertHostAllowed(task.url);

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
