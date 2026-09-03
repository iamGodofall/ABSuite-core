/*
 * ARE THE DEFAULT MODEL IDS STILL MODELS?
 *
 *   node scripts/check-model-ids.mjs
 *
 * `llm-provider.ts` names a `defaultModel` per provider. Every one of those is
 * a string typed by a person, and model ids are retired on somebody else's
 * schedule — so a table maintained by hand goes stale silently, and the way you
 * find out is a customer's call returning 404 for a model that was fine when it
 * was written down. This repository already refuses that shape of thing where
 * it declines to map a payment processor's plan catalogue by hand; the same
 * argument applies here and had no check behind it.
 *
 * So: ask each provider what it actually serves, and compare.
 *
 * ## IT ONLY CHECKS WHAT YOU ARE CONFIGURED FOR, WHICH IS THE POINT
 *
 * `describeProviders` already decides which providers a deployment can reach,
 * from credentials alone. This walks that same list. A provider with no key is
 * SKIPPED rather than guessed at — the same rule the dashboard follows, because
 * an optimistic answer about a provider you cannot reach is a lie either way.
 *
 * ## IT NEVER REPORTS OK FOR SOMETHING IT DID NOT CHECK
 *
 * An endpoint that refuses, times out, or is not known for a provider is
 * UNKNOWN, never a pass. The whole value here is the difference between
 * "verified against the provider" and "nobody has looked", and a check that
 * blurs those two is worse than no check — it converts an open question into a
 * green tick.
 *
 * Exit code is 1 only when a provider you ARE configured for no longer serves
 * the id configured for it. UNKNOWN and SKIPPED do not fail the run, because
 * neither is evidence of a problem.
 */
import { describeProviders } from '../packages/capkit/dist/llm-provider.js';

/*
 * Where to ask. Most of these speak the OpenAI wire format, so the models list
 * is `GET {base}/models` with a bearer token.
 *
 * These base URLs are written down here rather than in llm-provider.ts on
 * purpose: that file's job is to report what is CONFIGURED, from environment
 * variables only, and it reaches nothing over the network. Giving it a table of
 * hostnames would be giving it a second job.
 *
 * A wrong or moved URL here degrades to UNKNOWN, never to a false OK.
 */
const ENDPOINTS = {
  anthropic: { url: 'https://api.anthropic.com/v1/models', style: 'anthropic', env: 'ANTHROPIC_API_KEY' },
  openai:    { url: 'https://api.openai.com/v1/models', style: 'bearer', env: 'OPENAI_API_KEY' },
  deepseek:  { url: 'https://api.deepseek.com/v1/models', style: 'bearer', env: 'DEEPSEEK_API_KEY' },
  zhipu:     { url: 'https://api.z.ai/api/paas/v4/models', style: 'bearer', env: 'ZHIPU_API_KEY,GLM_API_KEY' },
  moonshot:  { url: 'https://api.moonshot.ai/v1/models', style: 'bearer', env: 'MOONSHOT_API_KEY,KIMI_API_KEY' },
  groq:      { url: 'https://api.groq.com/openai/v1/models', style: 'bearer', env: 'GROQ_API_KEY' },
  openrouter:{ url: 'https://openrouter.ai/api/v1/models', style: 'bearer', env: 'OPENROUTER_API_KEY' },
  mistral:   { url: 'https://api.mistral.ai/v1/models', style: 'bearer', env: 'MISTRAL_API_KEY' },
  qwen:      { url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models', style: 'bearer', env: 'QWEN_API_KEY,DASHSCOPE_API_KEY' },
};

const firstKey = (names) => names.split(',').map((n) => process.env[n.trim()]).find(Boolean);

async function servedModels(spec) {
  const key = firstKey(spec.env);
  if (!key) return null;

  const headers = spec.style === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${key}` };

  const response = await fetch(spec.url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const body = await response.json();
  // Both shapes in the wild: { data: [{ id }] } and { models: [{ id|name }] }.
  const rows = body?.data ?? body?.models ?? [];
  return rows.map((m) => m?.id ?? m?.name).filter(Boolean).map(String);
}

const { providers } = describeProviders(process.env);

const results = [];
for (const p of providers) {
  const spec = ENDPOINTS[p.name];

  if (!p.configured) { results.push({ ...p, verdict: 'SKIPPED', note: 'no credentials' }); continue; }
  if (!spec)         { results.push({ ...p, verdict: 'UNKNOWN', note: 'no models endpoint known' }); continue; }

  try {
    const served = await servedModels(spec);
    if (served === null) { results.push({ ...p, verdict: 'SKIPPED', note: 'no credentials' }); continue; }

    /*
     * Substring rather than equality, deliberately. Several providers list a
     * dated snapshot alongside the alias that points at it, and an alias that
     * resolves is not stale merely because the list shows its snapshot too.
     */
    const exact = served.includes(p.defaultModel);
    const prefixed = served.some((id) => id.startsWith(p.defaultModel));

    results.push(exact || prefixed
      ? { ...p, verdict: 'OK', note: `${served.length} models served` }
      : { ...p, verdict: 'STALE', note: `not served; e.g. ${served.slice(0, 3).join(', ') || 'none listed'}` });
  } catch (error) {
    results.push({ ...p, verdict: 'UNKNOWN', note: `could not ask: ${error.message}` });
  }
}

const width = Math.max(...results.map((r) => r.name.length), 8);
for (const r of results.sort((a, b) => a.verdict.localeCompare(b.verdict))) {
  console.log(`  ${r.verdict.padEnd(8)} ${r.name.padEnd(width)}  ${r.defaultModel.padEnd(28)} ${r.note}`);
}

const stale = results.filter((r) => r.verdict === 'STALE');
const checked = results.filter((r) => r.verdict === 'OK').length;
const unknown = results.filter((r) => r.verdict === 'UNKNOWN').length;

console.log(`\n  ${checked} verified against the provider, ${stale.length} stale, ${unknown} could not be checked.`);

if (stale.length) {
  console.log('\n  STALE means a provider you are configured for no longer serves the id set for it.');
  console.log('  Fix llm-provider.ts against that provider\'s own list, not against this output.');
  process.exit(1);
}
if (!checked && !stale.length) {
  console.log('  Nothing was verified. That is not a pass — set a provider key and run it again.');
}
