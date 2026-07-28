/**
 * LLM provider inspection.
 *
 * Reports which providers this deployment is actually configured to reach,
 * derived from environment variables only. Nothing here claims a provider is
 * available unless its credentials are genuinely present — the dashboard
 * renders this directly, so an optimistic answer would be a lie on screen.
 */

export interface ProviderOption {
  name: string;
  label: string;
  type: 'local' | 'hosted';
  available: boolean;
  configured: boolean;
  defaultModel: string;
  description: string;
}

interface ProviderDefinition {
  name: string;
  label: string;
  type: 'local' | 'hosted';
  defaultModel: string;
  description: string;
  /** Env vars that, if any is set, mean the provider is configured. */
  envKeys: string[];
}

const DEFINITIONS: ProviderDefinition[] = [
  {
    name: 'anthropic',
    label: 'Anthropic',
    type: 'hosted',
    defaultModel: 'claude-sonnet-4-5',
    description: 'Claude models via the Anthropic API.',
    envKeys: ['ANTHROPIC_API_KEY'],
  },
  {
    name: 'openai',
    label: 'OpenAI',
    type: 'hosted',
    defaultModel: 'gpt-4o',
    description: 'GPT models via the OpenAI API.',
    envKeys: ['OPENAI_API_KEY'],
  },
  {
    name: 'ollama',
    label: 'Ollama',
    type: 'local',
    defaultModel: 'llama3.2',
    description: 'Sovereign local inference via Ollama.',
    envKeys: ['OLLAMA_URL', 'QUICKBENCH_OLLAMA_URL'],
  },
];

export function describeProviders(env: NodeJS.ProcessEnv = process.env): {
  providers: ProviderOption[];
  recommended: string;
} {
  const providers = DEFINITIONS.map<ProviderOption>(definition => {
    const configured = definition.envKeys.some(key => Boolean((env[key] || '').trim()));
    return {
      name: definition.name,
      label: definition.label,
      type: definition.type,
      configured,
      // We can confirm configuration from env, but not live reachability
      // without a network round-trip, so the two track together here.
      available: configured,
      defaultModel: definition.defaultModel,
      description: definition.description,
    };
  });

  // Prefer a configured local provider (no per-token cost), then hosted.
  const recommended =
    providers.find(provider => provider.configured && provider.type === 'local')?.name ??
    providers.find(provider => provider.configured)?.name ??
    'none';

  return { providers, recommended };
}
