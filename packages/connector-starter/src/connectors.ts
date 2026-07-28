/**
 * Built-in connectors.
 *
 * Each connector declares the environment it needs, can verify its own
 * credentials, and exposes a small set of actions. Declaring requirements makes
 * "is this configured?" answerable without attempting a live call, which is
 * what the dashboard needs to render honest status.
 */

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
      if (!/^https:\/\//i.test(url)) {
        return { ok: false, error: 'Webhook URL must be https' };
      }
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
