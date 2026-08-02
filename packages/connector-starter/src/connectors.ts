/**
 * Built-in connectors.
 *
 * Each connector declares the environment it needs, can verify its own
 * credentials, and exposes a small set of actions. Declaring requirements makes
 * "is this configured?" answerable without attempting a live call, which is
 * what the dashboard needs to render honest status.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface ConnectorAction {
  name: string;
  description: string;
  /** Required input fields, used to validate before making a call. */
  inputs: string[];
}

export interface ConnectorDefinition {
  id: string;
  label: string;
  description: string;
  /** All must be present for the connector to be usable. */
  requiredEnv: string[];
  /** Any one of these satisfies the connector (e.g. token OR webhook). */
  anyOfEnv?: string[][];
  actions: ConnectorAction[];
}

export interface ConnectorResult {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export const CONNECTORS: ConnectorDefinition[] = [
  {
    id: 'github',
    label: 'GitHub',
    description: 'Read and create issues, and inspect repositories.',
    requiredEnv: ['GITHUB_TOKEN'],
    actions: [
      { name: 'listIssues', description: 'List open issues on a repository', inputs: ['owner', 'repo'] },
      { name: 'createIssue', description: 'Open a new issue', inputs: ['owner', 'repo', 'title'] },
    ],
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Post messages to a channel via bot token or incoming webhook.',
    requiredEnv: [],
    anyOfEnv: [['SLACK_BOT_TOKEN'], ['SLACK_WEBHOOK_URL']],
    actions: [{ name: 'postMessage', description: 'Post a message', inputs: ['text'] }],
  },
  {
    id: 'discord',
    label: 'Discord',
    description: 'Post messages through a Discord webhook.',
    requiredEnv: [],
    anyOfEnv: [['DISCORD_WEBHOOK_URL'], ['DISCORD_BOT_TOKEN']],
    actions: [{ name: 'postMessage', description: 'Post a message', inputs: ['content'] }],
  },
  {
    id: 'webhook',
    label: 'Generic Webhook',
    description: 'POST a JSON payload to any HTTPS endpoint.',
    requiredEnv: [],
    actions: [{ name: 'send', description: 'POST a JSON payload', inputs: ['url', 'payload'] }],
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Query and create Linear issues via GraphQL.',
    requiredEnv: ['LINEAR_API_KEY'],
    actions: [{ name: 'viewer', description: 'Fetch the authenticated user', inputs: [] }],
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Read and update Notion pages and databases.',
    requiredEnv: ['NOTION_TOKEN'],
    actions: [{ name: 'me', description: 'Fetch the authenticated bot user', inputs: [] }],
  },
];

export function getConnector(id: string): ConnectorDefinition | undefined {
  return CONNECTORS.find(connector => connector.id === id.toLowerCase());
}

/** Is every requirement satisfied by the current environment? */
export function isConfigured(connector: ConnectorDefinition, env: NodeJS.ProcessEnv = process.env): boolean {
  const hasAllRequired = connector.requiredEnv.every(key => Boolean((env[key] || '').trim()));
  if (!hasAllRequired) return false;

  if (!connector.anyOfEnv || connector.anyOfEnv.length === 0) return true;

  // Each group is an alternative; one fully-satisfied group is enough.
  return connector.anyOfEnv.some(group => group.every(key => Boolean((env[key] || '').trim())));
}

export function missingEnv(connector: ConnectorDefinition, env: NodeJS.ProcessEnv = process.env): string[] {
  const missing = connector.requiredEnv.filter(key => !(env[key] || '').trim());

  if (connector.anyOfEnv && connector.anyOfEnv.length > 0) {
    const satisfied = connector.anyOfEnv.some(group => group.every(key => Boolean((env[key] || '').trim())));
    if (!satisfied) {
      missing.push(...connector.anyOfEnv.map(group => group.join('+')).map(option => `one of: ${option}`));
    }
  }
  return missing;
}

export function describeConnectors(env: NodeJS.ProcessEnv = process.env) {
  return CONNECTORS.map(connector => ({
    id: connector.id,
    label: connector.label,
    description: connector.description,
    configured: isConfigured(connector, env),
    missing: missingEnv(connector, env),
    actions: connector.actions,
  }));
}

/**
 * Whether an address is somewhere a caller-supplied webhook may not reach.
 *
 * ## Why this exists
 *
 * `webhook.send` takes its URL from the caller and required only that it begin
 * `https://`. That accepted every one of these:
 *
 *     https://169.254.169.254/latest/meta-data/iam/security-credentials/
 *     https://metadata.google.internal/computeMetadata/v1/
 *     https://127.0.0.1:8081/executions
 *     https://[::1]/admin
 *
 * …and returned the response body in `data`. On a cloud VM the first of those
 * is the instance metadata service, which is how a machine's IAM credentials
 * are stolen.
 *
 * The action is behind a capability token, and that is not a defence. The
 * scope is `connector:execute` — *send a webhook*. It does not say *read this
 * machine's cloud credentials and anything else on its loopback interface*, and
 * **a capability that grants more than its name says is precisely the defect
 * this project exists to prevent.** An agent holding a narrow, legitimate grant
 * could reach the whole internal network through it.
 */
const BLOCKED_V4 = [
  [/^127\./, 'loopback'],
  [/^10\./, 'private'],
  [/^192\.168\./, 'private'],
  [/^172\.(1[6-9]|2\d|3[01])\./, 'private'],
  [/^169\.254\./, 'link-local (the cloud metadata range)'],
  [/^0\./, 'unspecified'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'carrier-grade NAT'],
] as const;

function blockedReason(address: string): string | undefined {
  const family = isIP(address);

  if (family === 4) {
    for (const [pattern, why] of BLOCKED_V4) {
      if (pattern.test(address)) return why;
    }
    return undefined;
  }

  const normalised = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalised === '::1' || normalised === '::') return 'loopback';
  if (/^f[cd]/.test(normalised)) return 'unique-local';
  if (/^fe[89ab]/.test(normalised)) return 'link-local';
  // ::ffff:127.0.0.1 — an IPv4 address wearing an IPv6 coat.
  const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return blockedReason(mapped[1]);
  return undefined;
}

/**
 * Check a caller-supplied URL before anything is sent to it.
 *
 * ## What this does not do, said plainly
 *
 * The hostname is resolved and the resulting address checked, so
 * `https://localhost` and a domain that merely *points* at 127.0.0.1 are both
 * refused. It is still not airtight: between this lookup and the one `fetch`
 * performs, a hostile DNS server can return a different answer — the classic
 * rebinding race. Closing that needs a custom agent that pins the resolved
 * address, which is a larger change than this package should carry alone.
 *
 * So this raises the cost substantially and does not eliminate the class, and
 * saying otherwise would be the kind of claim this project refuses. An operator
 * whose threat model includes hostile DNS should not expose `webhook.send` to
 * untrusted callers at all.
 *
 * `ABSUITE_ALLOW_PRIVATE_WEBHOOKS=true` turns the check off for deployments
 * whose webhooks genuinely live on an internal network. It is off by default
 * because the safe choice must be the one you get without reading anything.
 */
async function refuseUnsafeTarget(
  raw: string,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Webhook URL could not be parsed';
  }

  if (url.protocol !== 'https:') return 'Webhook URL must be https';

  // Credentials in a URL end up in logs, proxies and error messages.
  if (url.username || url.password) {
    return 'Webhook URL must not carry credentials in the userinfo section';
  }

  if (/^(1|true|yes|on)$/i.test((env.ABSUITE_ALLOW_PRIVATE_WEBHOOKS || '').trim())) {
    return undefined;
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    const why = blockedReason(host);
    return why ? `Webhook URL resolves to a ${why} address, which this connector will not call` : undefined;
  }

  // A name can point anywhere. `metadata.google.internal` is the obvious case,
  // and `localhost` is the one everybody forgets.
  try {
    const resolved = await lookup(host, { all: true });
    for (const { address } of resolved) {
      const why = blockedReason(address);
      if (why) {
        return `Webhook URL resolves to a ${why} address (${address}), which this connector will not call`;
      }
    }
  } catch {
    return `Webhook URL host could not be resolved: ${host}`;
  }

  return undefined;
}

async function request(url: string, init: RequestInit, timeoutMs = 15_000): Promise<ConnectorResult> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();

    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Some webhooks reply with a bare "ok"; keep the raw text.
    }

    return response.ok
      ? { ok: true, status: response.status, data }
      : { ok: false, status: response.status, error: `HTTP ${response.status}`, data };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Verify a connector's credentials with a cheap, read-only call.
 *
 * Deliberately never performs a write: an operator clicking "test" must not
 * post a message or open an issue as a side effect.
 */
export async function verifyConnector(id: string, env: NodeJS.ProcessEnv = process.env): Promise<ConnectorResult> {
  const connector = getConnector(id);
  if (!connector) return { ok: false, error: `Unknown connector: ${id}` };

  if (!isConfigured(connector, env)) {
    return { ok: false, error: `Not configured. Missing: ${missingEnv(connector, env).join(', ')}` };
  }

  switch (connector.id) {
    case 'github':
      return request('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
      });

    case 'slack':
      if ((env.SLACK_BOT_TOKEN || '').trim()) {
        const result = await request('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
        });
        // Slack returns HTTP 200 with {ok:false} on a bad token.
        const body = result.data as { ok?: boolean; error?: string } | null;
        if (result.ok && body && body.ok === false) {
          return { ok: false, error: body.error ?? 'Slack rejected the token' };
        }
        return result;
      }
      // A webhook URL cannot be verified without posting, so report shape only.
      return { ok: true, data: { note: 'Webhook configured; not called to avoid posting a message.' } };

    case 'discord':
      if ((env.DISCORD_BOT_TOKEN || '').trim()) {
        return request('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
        });
      }
      return { ok: true, data: { note: 'Webhook configured; not called to avoid posting a message.' } };

    case 'linear':
      return request('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: String(env.LINEAR_API_KEY) },
        body: JSON.stringify({ query: '{ viewer { id name } }' }),
      });

    case 'notion':
      return request('https://api.notion.com/v1/users/me', {
        headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' },
      });

    case 'webhook':
      return { ok: true, data: { note: 'Generic webhook takes its URL per call; nothing to verify.' } };

    default:
      return { ok: false, error: `No verification implemented for ${connector.id}` };
  }
}

/** Execute a connector action. Writes happen only through this path. */
export async function runAction(
  id: string,
  action: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env
): Promise<ConnectorResult> {
  const connector = getConnector(id);
  if (!connector) return { ok: false, error: `Unknown connector: ${id}` };

  const definition = connector.actions.find(candidate => candidate.name === action);
  if (!definition) return { ok: false, error: `Unknown action "${action}" for ${id}` };

  const missing = definition.inputs.filter(field => input[field] === undefined || input[field] === '');
  if (missing.length > 0) return { ok: false, error: `Missing required input: ${missing.join(', ')}` };

  if (!isConfigured(connector, env)) {
    return { ok: false, error: `Not configured. Missing: ${missingEnv(connector, env).join(', ')}` };
  }

  switch (`${id}.${action}`) {
    case 'github.listIssues':
      return request(
        `https://api.github.com/repos/${encodeURIComponent(String(input.owner))}/${encodeURIComponent(String(input.repo))}/issues`,
        { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } }
      );

    case 'github.createIssue':
      return request(
        `https://api.github.com/repos/${encodeURIComponent(String(input.owner))}/${encodeURIComponent(String(input.repo))}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: input.title, body: input.body ?? '' }),
        }
      );

    case 'slack.postMessage': {
      const webhook = (env.SLACK_WEBHOOK_URL || '').trim();
      if (webhook) {
        return request(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: input.text }),
        });
      }
      return request('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: input.channel ?? env.SLACK_DEFAULT_CHANNEL, text: input.text }),
      });
    }

    case 'discord.postMessage':
      return request(String(env.DISCORD_WEBHOOK_URL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input.content }),
      });

    case 'webhook.send': {
      const url = String(input.url);
      const refusal = await refuseUnsafeTarget(url, env);
      if (refusal) return { ok: false, error: refusal };
      return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.payload ?? {}),
      });
    }

    case 'linear.viewer':
    case 'notion.me':
      return verifyConnector(id, env);

    default:
      return { ok: false, error: `Action not implemented: ${id}.${action}` };
  }
}
