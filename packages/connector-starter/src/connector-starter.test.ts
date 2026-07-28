import { getConnector, isConfigured, missingEnv, describeConnectors, runAction, verifyConnector } from './connectors';
import { analyse, generate, toManifest, toTypeScript, slugify } from './scaffold';

describe('connector registry', () => {
  test('looks connectors up case-insensitively', () => {
    expect(getConnector('GitHub')?.id).toBe('github');
    expect(getConnector('nope')).toBeUndefined();
  });

  test('requires all mandatory env vars', () => {
    const github = getConnector('github')!;
    expect(isConfigured(github, {})).toBe(false);
    expect(isConfigured(github, { GITHUB_TOKEN: 'ghp_x' })).toBe(true);
  });

  test('treats anyOf groups as alternatives', () => {
    const slack = getConnector('slack')!;
    expect(isConfigured(slack, {})).toBe(false);
    expect(isConfigured(slack, { SLACK_BOT_TOKEN: 'xoxb-x' })).toBe(true);
    expect(isConfigured(slack, { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/x' })).toBe(true);
  });

  test('reports what is missing', () => {
    expect(missingEnv(getConnector('github')!, {})).toContain('GITHUB_TOKEN');
    expect(missingEnv(getConnector('slack')!, {}).join(' ')).toMatch(/one of/);
  });

  test('describes every connector with its configuration state', () => {
    const described = describeConnectors({});
    expect(described.length).toBeGreaterThan(0);

    // Credential-bearing connectors are unconfigured on an empty environment.
    expect(described.filter(c => c.id !== 'webhook').every(c => c.configured === false)).toBe(true);
    expect(described.find(c => c.id === 'github')?.actions.length).toBeGreaterThan(0);
  });

  test('the generic webhook needs no credentials, so it is always usable', () => {
    // Its URL is supplied per call, so there is nothing to configure up front.
    expect(describeConnectors({}).find(c => c.id === 'webhook')?.configured).toBe(true);
  });
});

describe('connector actions', () => {
  test('rejects an unknown connector', async () => {
    const result = await runAction('nope', 'x', {}, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown connector/i);
  });

  test('rejects an unknown action', async () => {
    const result = await runAction('github', 'notARealAction', {}, { GITHUB_TOKEN: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown action/i);
  });

  test('validates required inputs before calling out', async () => {
    const result = await runAction('github', 'createIssue', { owner: 'a' }, { GITHUB_TOKEN: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing required input/i);
    expect(result.error).toMatch(/repo/);
  });

  test('refuses to run when the connector is unconfigured', async () => {
    const result = await runAction('github', 'listIssues', { owner: 'a', repo: 'b' }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  test('refuses a non-https webhook target', async () => {
    const result = await runAction('webhook', 'send', { url: 'http://insecure.example.com', payload: {} }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/https/i);
  });

  test('verification of an unconfigured connector does not call out', async () => {
    const result = await verifyConnector('notion', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
  });

  test('webhook verification never performs a write', async () => {
    const result = await verifyConnector('webhook', {});
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.data)).toMatch(/nothing to verify/i);
  });
});

describe('scaffold analysis', () => {
  test('detects integrations and capabilities', () => {
    const spec = analyse('Sync GitHub issues and post updates to Slack every 15 minutes');
    expect(spec.integrations).toEqual(expect.arrayContaining(['github', 'slack']));
    expect(spec.capabilities).toEqual(expect.arrayContaining(['read', 'write']));
    expect(spec.schedule).toBe('*/15 * * * *');
  });

  test('collects the env vars the integrations need', () => {
    const spec = analyse('read from github and notify slack');
    expect(spec.envVars).toEqual(expect.arrayContaining(['GITHUB_TOKEN', 'SLACK_BOT_TOKEN']));
  });

  test('defaults to read-only when no verb is present', () => {
    expect(analyse('something about data').capabilities).toEqual(['read']);
  });

  test('recognises common schedule phrasings', () => {
    expect(analyse('run this daily').schedule).toBe('0 0 * * *');
    expect(analyse('check hourly').schedule).toBe('0 * * * *');
    expect(analyse('no cadence mentioned').schedule).toBeUndefined();
  });

  test('produces a valid class name even from an awkward description', () => {
    expect(analyse('123 go!').className).toMatch(/^[A-Za-z]/);
    expect(slugify('Hello, World!! 2026')).toBe('hello-world-2026');
  });
});

describe('scaffold output', () => {
  const spec = analyse('Read GitHub issues and post them to Slack daily');

  test('manifest lists capabilities, integrations and env', () => {
    const manifest = toManifest(spec);
    expect(manifest).toContain('name: read-github-issues-and-post-them-to-slack-daily');
    expect(manifest).toContain('- github');
    expect(manifest).toContain('- GITHUB_TOKEN');
    expect(manifest).toContain('cron: "0 0 * * *"');
  });

  test('typescript output is syntactically plausible and self-validating', () => {
    const code = toTypeScript(spec);
    expect(code).toContain('export class');
    expect(code).toContain('function requireEnv');
    expect(code).toContain('async fetch()');
    // Braces should balance in generated code.
    expect((code.match(/\{/g) ?? []).length).toBe((code.match(/\}/g) ?? []).length);
  });

  test('generation is deterministic', () => {
    expect(generate('Sync github to slack daily')).toEqual(generate('Sync github to slack daily'));
  });

  test('rejects an empty description', () => {
    expect(() => generate('   ')).toThrow(/description is required/i);
  });

  test('generates code with no credentials when no integration is detected', () => {
    const plain = analyse('just run something');
    expect(plain.envVars).toEqual([]);
    expect(toTypeScript(plain)).toContain('return {};');
  });
});
