/**
 * Connector scaffolding.
 *
 * Turns a plain-English description into a connector spec and emits compilable
 * TypeScript plus a config manifest. Generation is deterministic and rule-based
 * — no model call, no API key, and the same description always produces the
 * same output, which matters when the result is committed to a repository.
 */

export interface ConnectorSpec {
  name: string;
  className: string;
  description: string;
  integrations: string[];
  capabilities: string[];
  actions: Array<{ name: string; method: 'GET' | 'POST'; description: string }>;
  schedule?: string;
  envVars: string[];
}

const INTEGRATION_ENV: Record<string, string[]> = {
  github: ['GITHUB_TOKEN'],
  slack: ['SLACK_BOT_TOKEN'],
  discord: ['DISCORD_WEBHOOK_URL'],
  jira: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
  notion: ['NOTION_TOKEN'],
  linear: ['LINEAR_API_KEY'],
  stripe: ['STRIPE_API_KEY'],
  sendgrid: ['SENDGRID_API_KEY'],
};

const CAPABILITY_PATTERNS: Array<{ capability: string; pattern: RegExp }> = [
  { capability: 'read', pattern: /\b(read|list|fetch|get|sync|pull|watch|monitor)\b/ },
  { capability: 'write', pattern: /\b(write|create|update|post|open|publish|push|send)\b/ },
  { capability: 'delete', pattern: /\b(delete|remove|close|archive)\b/ },
  { capability: 'notify', pattern: /\b(notify|alert|message|email|ping)\b/ },
];

const SCHEDULE_PATTERNS: Array<{ cron: string; pattern: RegExp }> = [
  { cron: '*/5 * * * *', pattern: /\bevery\s+(5|five)\s+min/ },
  { cron: '*/15 * * * *', pattern: /\bevery\s+(15|fifteen)\s+min/ },
  { cron: '0 * * * *', pattern: /\b(hourly|every\s+hour)\b/ },
  { cron: '0 0 * * *', pattern: /\b(daily|every\s+day|nightly)\b/ },
  { cron: '0 0 * * 1', pattern: /\b(weekly|every\s+week)\b/ },
];

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function toPascalCase(value: string): string {
  const pascal = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  // A class name cannot start with a digit.
  return /^[0-9]/.test(pascal) ? `Connector${pascal}` : pascal || 'GeneratedConnector';
}

export function analyse(description: string): ConnectorSpec {
  const text = description.toLowerCase();

  const integrations = Object.keys(INTEGRATION_ENV).filter(name => text.includes(name));
  const capabilities = CAPABILITY_PATTERNS.filter(rule => rule.pattern.test(text)).map(rule => rule.capability);
  if (capabilities.length === 0) capabilities.push('read');

  const schedule = SCHEDULE_PATTERNS.find(rule => rule.pattern.test(text))?.cron;

  const actions: ConnectorSpec['actions'] = [];
  if (capabilities.includes('read')) {
    actions.push({ name: 'fetch', method: 'GET', description: 'Fetch source records' });
  }
  if (capabilities.includes('write') || capabilities.includes('notify')) {
    actions.push({ name: 'push', method: 'POST', description: 'Send records downstream' });
  }
  if (actions.length === 0) {
    actions.push({ name: 'run', method: 'POST', description: 'Execute the connector' });
  }

  const name = slugify(description) || 'absuite-connector';
  const envVars = [...new Set(integrations.flatMap(integration => INTEGRATION_ENV[integration] ?? []))];

  return {
    name,
    className: toPascalCase(name),
    description: description.trim(),
    integrations,
    capabilities,
    actions,
    ...(schedule ? { schedule } : {}),
    envVars,
  };
}

/** YAML manifest describing the connector. */
export function toManifest(spec: ConnectorSpec): string {
  return [
    '# ABSuite Connector Manifest',
    `name: ${spec.name}`,
    `description: ${JSON.stringify(spec.description)}`,
    '',
    'capabilities:',
    ...spec.capabilities.map(capability => `  - ${capability}`),
    '',
    'integrations:',
    ...(spec.integrations.length > 0 ? spec.integrations.map(name => `  - ${name}`) : ['  []']),
    '',
    'env:',
    ...(spec.envVars.length > 0 ? spec.envVars.map(name => `  - ${name}`) : ['  []']),
    '',
    'actions:',
    ...spec.actions.flatMap(action => [`  - name: ${action.name}`, `    method: ${action.method}`]),
    '',
    ...(spec.schedule ? ['schedule:', `  cron: "${spec.schedule}"`, ''] : []),
    'runtime:',
    '  retries: 3',
    '  timeout_ms: 30000',
    '  logging: structured',
  ].join('\n');
}

/**
 * Emit a compilable TypeScript connector.
 *
 * The generated module reads its credentials from the environment, exposes one
 * method per detected action, and fails loudly on missing configuration rather
 * than silently no-opping.
 */
export function toTypeScript(spec: ConnectorSpec): string {
  const envChecks = spec.envVars.length > 0
    ? spec.envVars.map(name => `      ${name}: requireEnv('${name}'),`).join('\n')
    : '';

  const methods = spec.actions
    .map(action => {
      const body = action.method === 'GET'
        ? `    const response = await fetch(this.endpoint, {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });`
        : `    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });`;

      const signature = action.method === 'GET'
        ? `  /** ${action.description} */\n  async ${action.name}(): Promise<unknown> {`
        : `  /** ${action.description} */\n  async ${action.name}(payload?: Record<string, unknown>): Promise<unknown> {`;

      return `${signature}
${body}

    if (!response.ok) {
      throw new Error(\`${spec.name}.${action.name} failed: HTTP \${response.status}\`);
    }
    return response.json();
  }`;
    })
    .join('\n\n');

  return `/**
 * ${spec.className} — generated by ABSuite Connector Starter.
 *
 * Source description: ${JSON.stringify(spec.description)}
 * Capabilities: ${spec.capabilities.join(', ')}
 */

function requireEnv(name: string): string {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(\`\${name} is required by the ${spec.name} connector\`);
  }
  return value;
}

export interface ${spec.className}Options {
  endpoint: string;
  timeoutMs?: number;
}

export class ${spec.className} {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
${spec.envVars.length > 0 ? `  private readonly credentials: Record<string, string>;\n` : ''}
  constructor(options: ${spec.className}Options) {
    this.endpoint = options.endpoint;
    this.timeoutMs = options.timeoutMs ?? 30_000;
${spec.envVars.length > 0 ? `    this.credentials = {\n${envChecks}\n    };` : ''}
  }

  private headers(): Record<string, string> {
${spec.envVars.length > 0
  ? `    return { Authorization: \`Bearer \${this.credentials['${spec.envVars[0]}']}\` };`
  : '    return {};'}
  }

${methods}
}
${spec.schedule ? `\n// Suggested schedule for @absuite/edge-run:\n// { id: '${spec.name}', cron: '${spec.schedule}', task: { type: 'http', url: '<endpoint>' } }\n` : ''}`;
}

export function generate(description: string) {
  if (!description || !description.trim()) {
    throw new Error('A description is required');
  }

  const spec = analyse(description);
  return {
    spec,
    manifest: toManifest(spec),
    typescript: toTypeScript(spec),
    source: 'rule-based' as const,
  };
}
