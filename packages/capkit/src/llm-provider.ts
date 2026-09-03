/**
 * LLM provider inspection.
 *
 * Reports which providers this deployment is actually configured to reach,
 * derived from environment variables only. Nothing here claims a provider is
 * available unless its credentials are genuinely present — the dashboard
 * renders this directly, so an optimistic answer would be a lie on screen.
 *
 * ## THERE IS A SECOND PROVIDER REGISTRY, AND THE TWO HAVE ALREADY DRIFTED
 *
 * `A.I.A.N.` carries its own at `src/ai/catalog.ts` — richer than this one,
 * with per-million pricing, free-tier flags, a budget ceiling and automatic
 * fallback. Both export a function called `describeProviders`. Neither knows
 * the other exists.
 *
 * They are already out of step, measured rather than assumed:
 *
 *     provider     here                      A.I.A.N.'s catalogue
 *     ---------------------------------------------------------------------
 *     zhipu        glm-4                     glm-4.6, glm-4.5-air
 *     anthropic    claude-sonnet-4-5         claude-sonnet-5, claude-opus-5,
 *                                            claude-haiku-4-5, claude-fable-5
 *     gemini       gemini-2.0-flash          gemini-2.5-flash-lite,
 *                                            gemini-2.5-flash
 *     moonshot     kimi-k2                   kimi-k2-turbo-preview,
 *                                            kimi-k2-0905-preview
 *     groq         llama-3.3-70b-versatile   (agrees)
 *     deepseek     deepseek-chat             (agrees)
 *
 * Four of six disagree, and the defaults here are a generation behind. This is
 * the trap the sibling repositories both open with — `mandalorian-project`'s
 * "the same function defined twice, with the linker choosing", and Flappy Bird
 * Galaxy's "two systems drawing the same thing" — arrived at across two repos
 * rather than inside one, which is why neither repository's own checks can see
 * it.
 *
 * FOUR OF THOSE ROWS HAVE SINCE BEEN CORRECTED, and the provenance of each
 * matters more than the value:
 *
 *   anthropic, bedrock  claude-opus-5 — the flagship, from Anthropic's current
 *                       model table. Unversioned by construction: these ids
 *                       never carry a date suffix, so the name tracks the
 *                       model rather than a snapshot of it.
 *   zhipu               glm-5.3
 *   moonshot            kimi-k3
 *   vertex              gemini-3.8-flash
 *   minimax             minimax-m3
 *
 * Those four came from a public catalogue of what each vendor is currently
 * serving, read by `scripts/check-model-ids.mjs --survey`. Two of them had
 * ALREADY been corrected once in this repository, from a sibling project's
 * hand-maintained table, and were still a generation behind when asked —
 * `glm-4.6` against `glm-5.3`, `kimi-k2-turbo-preview` against `kimi-k3`.
 * Adopting from another hand-kept list inherits its staleness; that is the
 * whole argument for asking instead, made at this file's expense.
 *
 * `gpt-4o` was LEFT ALONE, which is a decision rather than an oversight. It is
 * plainly behind — OpenAI's current generation is the 5.6 line — but that line
 * carries several differently-named flagships at the same price, and picking
 * between them by tiebreak would be a coin flip presented as a finding. An
 * operator running OpenAI will set their own; `defaultModel` is a starting
 * suggestion, never an approval.
 *
 * ## AND THE REAL ANSWER TO "KEEP THEM CURRENT" IS NOT AN EDIT
 *
 * Every id here is a string typed by a person, retired on somebody else's
 * schedule. Correcting four of them today buys a few months. Two things carry
 * further:
 *
 * PREFER AN ALIAS THE PROVIDER MAINTAINS, and the evidence for this is now
 * unusually clean: surveyed against what vendors actually serve, EVERY PINNED
 * VERSION IN THIS FILE HAD DRIFTED AND NO ALIAS HAD. `claude-opus-5`,
 * `mistral-large-latest`, `qwen-max`, `deepseek-chat` and `openrouter/auto`
 * resolve to whatever is current on the provider's side and cannot go stale
 * here at all; `glm-4`, `kimi-k2`, `gemini-2.0-flash`, `minimax-text` and
 * `gpt-4o` were every one of them behind. Where a provider offers an alias it
 * belongs in this column ahead of any pinned snapshot — including ahead of a
 * pinned snapshot that happens to be current today.
 *
 * The survey cannot see aliases (it reads a catalogue of concrete models), so
 * it reports them as BEHIND. That is a false negative and the script says so:
 * never trade an alias for a pin on the strength of it.
 *
 * AND ASK. `scripts/check-model-ids.mjs` queries each provider a deployment is
 * configured for and reports whether the id set here is still served — OK,
 * STALE, or UNKNOWN, and never OK for something it could not reach. Verified
 * against a live list of 424 models: passes on a served id, exits 1 on a
 * retired one. That turns a table kept in step by hand into one that says when
 * it has drifted, which is the whole objection this file raised.
 *
 * See docs/PROVIDERS.md for which registry should survive.
 */

export interface ProviderOption {
  name: string;
  label: string;
  type: 'local' | 'hosted';
  available: boolean;
  configured: boolean;
  defaultModel: string;
  description: string;
  /**
   * The environment variables that would configure this provider.
   *
   * The interface rendered `not configured` and stopped there — a state with no
   * route out of it. A reader learned that something was missing and not what,
   * where, or who sets it, which is the one thing they needed.
   *
   * This repository already had the answer twice over: `envKeys` existed on the
   * server-side definition and was never sent, and the connector panel beside
   * this one has carried `missing: string[]` all along. The fix existed; it had
   * simply not reached here.
   *
   * Named for the constitutional rule it restores: a determination carries the
   * step that would settle it. `UNKNOWN` without a next step is a dead end
   * wearing the costume of a finding.
   */
  missing: string[];
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

/*
 * Every provider a deployment might actually be using.
 *
 * This list held three entries: Anthropic, OpenAI and Ollama. Two American APIs
 * and a local runner — and it was written by someone whose default sample of
 * "the AI industry" is American, which is a description of the author rather
 * than of the world.
 *
 * That is not a cosmetic gap in a governance product. A European buyer subject
 * to the AI Act is often running Mistral. Deployments across Asia run Qwen,
 * DeepSeek, Kimi and GLM. A tool that claims to record what your AI did, and
 * recognises two vendors from one country, is not a governance tool for anyone
 * outside that country — it is a governance tool for the market its author
 * happened to picture.
 *
 * Most of these speak the OpenAI wire format, so the cost of including them is
 * a name and an environment variable. The cost of omitting them was telling a
 * whole hemisphere that their models were not real enough to appear in a list.
 *
 * `defaultModel` is a starting suggestion, never an approval: an approved model
 * is a row somebody wrote in `approved_models`, and appearing here confers
 * nothing. Aggregators are included because a deployment reaching Kimi through
 * OpenRouter is still accountable for what Kimi did.
 */
const DEFINITIONS: ProviderDefinition[] = [
  // ---- Local and self-hosted. Listed first: sovereignty is the default, not
  // the fallback, and everything below can also be run this way.
  {
    name: 'ollama',
    label: 'Ollama',
    type: 'local',
    defaultModel: 'llama3.2',
    description: 'Local inference. Runs Llama, Qwen, DeepSeek, Mistral, Gemma and others on your own hardware.',
    envKeys: ['OLLAMA_URL', 'QUICKBENCH_OLLAMA_URL'],
  },
  {
    name: 'vllm',
    label: 'vLLM',
    type: 'local',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    description: 'Self-hosted serving of any open-weights model, OpenAI-compatible.',
    envKeys: ['VLLM_URL'],
  },
  {
    name: 'llamacpp',
    label: 'llama.cpp',
    type: 'local',
    defaultModel: 'gguf',
    description: 'Self-hosted GGUF inference, OpenAI-compatible server.',
    envKeys: ['LLAMACPP_URL'],
  },

  // ---- Asia
  {
    name: 'deepseek',
    label: 'DeepSeek',
    type: 'hosted',
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek models. Open weights, and an OpenAI-compatible API.',
    envKeys: ['DEEPSEEK_API_KEY'],
  },
  {
    name: 'qwen',
    label: 'Qwen (Alibaba)',
    type: 'hosted',
    defaultModel: 'qwen-max',
    description: 'Qwen models via Alibaba Cloud DashScope.',
    envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
  },
  {
    name: 'moonshot',
    label: 'Kimi (Moonshot AI)',
    type: 'hosted',
    defaultModel: 'kimi-k3',
    description: 'Kimi models via the Moonshot API.',
    envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  },
  {
    name: 'zhipu',
    label: 'GLM (Zhipu AI)',
    type: 'hosted',
    defaultModel: 'glm-5.3',
    description: 'GLM models via Zhipu AI.',
    envKeys: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
  },
  {
    name: 'minimax',
    label: 'MiniMax',
    type: 'hosted',
    defaultModel: 'minimax-m3',
    description: 'MiniMax models.',
    envKeys: ['MINIMAX_API_KEY'],
  },

  // ---- Europe
  {
    name: 'mistral',
    label: 'Mistral',
    type: 'hosted',
    defaultModel: 'mistral-large-latest',
    description: 'Mistral models, hosted in the EU. Several are open weights.',
    envKeys: ['MISTRAL_API_KEY'],
  },
  {
    name: 'aleph-alpha',
    label: 'Aleph Alpha',
    type: 'hosted',
    defaultModel: 'luminous-supreme',
    description: 'Aleph Alpha models, hosted in Germany.',
    envKeys: ['ALEPH_ALPHA_API_KEY'],
  },

  // ---- North America
  {
    name: 'anthropic',
    label: 'Anthropic',
    type: 'hosted',
    defaultModel: 'claude-opus-5',
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
    name: 'google',
    label: 'Google',
    type: 'hosted',
    defaultModel: 'gemini-3.8-flash',
    description: 'Gemini models via the Google AI API.',
    envKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  },
  {
    name: 'cohere',
    label: 'Cohere',
    type: 'hosted',
    defaultModel: 'command-r-plus',
    description: 'Command models via Cohere, based in Canada.',
    envKeys: ['COHERE_API_KEY'],
  },

  // ---- Aggregators and clouds. A model reached through a broker is still a
  // model this deployment is accountable for.
  {
    name: 'openrouter',
    label: 'OpenRouter',
    type: 'hosted',
    defaultModel: 'openrouter/auto',
    description: 'One API over many providers, including most models listed here.',
    envKeys: ['OPENROUTER_API_KEY'],
  },
  {
    name: 'together',
    label: 'Together AI',
    type: 'hosted',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    description: 'Hosted open-weights models.',
    envKeys: ['TOGETHER_API_KEY'],
  },
  {
    name: 'groq',
    label: 'Groq',
    type: 'hosted',
    defaultModel: 'llama-3.3-70b-versatile',
    description: 'Low-latency serving of open-weights models.',
    envKeys: ['GROQ_API_KEY'],
  },
  {
    name: 'azure-openai',
    label: 'Azure OpenAI',
    type: 'hosted',
    defaultModel: 'gpt-4o',
    description: 'OpenAI models through an Azure tenancy, with its own residency terms.',
    envKeys: ['AZURE_OPENAI_API_KEY'],
  },
  {
    name: 'bedrock',
    label: 'AWS Bedrock',
    type: 'hosted',
    defaultModel: 'anthropic.claude-opus-5',
    description: 'Several vendors through one AWS region.',
    envKeys: ['AWS_BEDROCK_REGION'],
  },
  {
    name: 'vertex',
    label: 'Google Vertex AI',
    type: 'hosted',
    defaultModel: 'gemini-3.8-flash',
    description: 'Several vendors through one Google Cloud project.',
    envKeys: ['GOOGLE_VERTEX_PROJECT'],
  },

  // ---- Anything else. The list above will always be behind the world; this is
  // how a deployment names a provider nobody here has heard of yet.
  {
    name: 'custom',
    label: 'Custom (OpenAI-compatible)',
    type: 'hosted',
    defaultModel: 'unspecified',
    description: 'Any OpenAI-compatible endpoint. Set the base URL and a key.',
    envKeys: ['CUSTOM_LLM_URL', 'CUSTOM_LLM_API_KEY'],
  },
];

export function describeProviders(env: NodeJS.ProcessEnv = process.env): {
  providers: ProviderOption[];
  recommended: string;
} {
  const providers = DEFINITIONS.map<ProviderOption>(definition => {
    const configured = definition.envKeys.some(key => Boolean((env[key] || '').trim()));
    return {
      // Empty once configured: there is nothing outstanding to report, and a
      // list of variables beside a working provider reads as a warning.
      missing: configured ? [] : definition.envKeys,
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
