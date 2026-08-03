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
import { resolveRanges, inAnyRange, guardedFetch } from '@absuitecore/capkit';

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
  /** Permit the cloud metadata endpoints. Off unless explicitly asked for. */
  allowMetadata?: boolean;
  defaultTimeoutMs?: number;
}

export class TaskRuntime {
  private readonly scriptRoot: string;
  private readonly allowedHosts: string[];
  private readonly allowMetadata: boolean;
  private readonly defaultTimeoutMs: number;

  constructor(options: RuntimeOptions = {}) {
    this.scriptRoot = (options.scriptRoot ?? process.env.EDGERUN_SCRIPT_ROOT ?? '').trim();
    this.allowedHosts = options.allowedHosts
      ?? (process.env.EDGERUN_ALLOWED_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean);
    this.allowMetadata = options.allowMetadata
      ?? /^(1|true|yes|on)$/i.test((process.env.EDGERUN_ALLOW_METADATA || '').trim());
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
   * metadata address is refused too. Requests go through `guardedFetch`, which
   * pins the connection to the address it classified. This pre-flight check
   * exists for the message; the guard is what enforces. Formerly: between
   * this lookup and the one `fetch` performs, a hostile resolver can answer
   * differently. Closing that needs an agent that pins the resolved address.
   *
   * An explicit `EDGERUN_ALLOWED_HOSTS` entry wins for every range — an
   * operator who names an internal host has said what they mean.
   *
   * It no longer wins for the metadata endpoints themselves. Those two
   * statements were conflated, and they are not the same: *restrict which hosts
   * this may call* is a scoping decision, while *yes, read this machine's cloud
   * credentials* is not, and a knob named for the first should not quietly be
   * the one that does the second. `EDGERUN_ALLOW_METADATA=true` does that, and
   * says so. The override exists at all because a control an operator cannot
   * turn off gets patched out, and a patched-out control protects nobody.
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

    if (this.allowedHosts.length > 0 && !this.allowedHosts.includes(parsed.hostname)) {
      throw new Error(`Host not allowed: ${parsed.hostname}`);
    }

    /*
     * Link-local only. Private and loopback stay allowed on purpose — calling
     * your own internal service on a schedule is what edge-run is for, and a
     * guard that broke the primary use case would be switched off.
     *
     * `resolveRanges` returns undefined when the name will not resolve, and
     * that is not a refusal: it fails at fetch anyway, and reporting a DNS
     * outage as a security event teaches operators to ignore security events.
     */
    const resolved = await resolveRanges(parsed.hostname);
    const metadata = resolved?.find(entry => entry.metadata);
    if (metadata && !this.allowMetadata) {
      throw new Error(
        `Refusing to call ${parsed.hostname}: it is ${metadata.why}. ` +
        'Set EDGERUN_ALLOW_METADATA=true if that is genuinely intended.'
      );
    }

    // Named explicitly, so it was meant — but only now that the metadata
    // endpoints have been ruled out above.
    if (this.allowedHosts.includes(parsed.hostname)) return parsed;

    const blocked = inAnyRange(resolved, ['link-local']);
    if (blocked) {
      throw new Error(
        `Refusing to call ${parsed.hostname}: it is ${blocked.why}. ` +
        'Add it to EDGERUN_ALLOWED_HOSTS if that is genuinely intended.'
      );
    }

    return parsed;
  }

  /**
   * The allowlist, as `guardedFetch` needs it.
   *
   * An empty `EDGERUN_ALLOWED_HOSTS` means *any host*, so there is nothing to
   * pass; a populated one has already been enforced for hop zero above, and is
   * passed on so a named host keeps winning at every later hop too.
   */
  private get guardOptions() {
    return {
      refuse: ['link-local'] as const,
      allow: this.allowedHosts,
      // Binds every hop. `assertHostAllowed` enforces the allowlist on the URL
      // that was queued; without this a permitted host answering a 302 reached
      // anywhere, which is the allowlist not being an allowlist.
      only: this.allowedHosts.length > 0 ? this.allowedHosts : undefined,
      allowMetadata: this.allowMetadata,
      protocols: ['http:', 'https:'],
      verb: 'call',
    };
  }

  private async executeHttp(task: HttpTask, timeoutMs: number, startedAt: number): Promise<TaskResult> {
    await this.assertHostAllowed(task.url);

    /*
     * `guardedFetch` rather than `fetch`, because `assertHostAllowed` above can
     * only see hop zero. A permitted host answering `302 Location:
     * http://169.254.169.254/...` was demonstrated to reach the metadata
     * service with the body returned in `output` — past a check that had
     * classified the first hop entirely correctly.
     */
    const response = await guardedFetch(task.url, {
      method: task.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(task.headers ?? {}) },
      ...(task.body !== undefined ? { body: typeof task.body === 'string' ? task.body : JSON.stringify(task.body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    }, { ...this.guardOptions, refuse: ['link-local'] });

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
