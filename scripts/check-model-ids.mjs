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

/*
 * `--survey` — what is current, without any credentials at all.
 *
 * The check above can only speak about providers you hold a key for, which on
 * a fresh machine is none of them, and "0 verified" is a true answer to a
 * useless question. OpenRouter publishes its catalogue unauthenticated, and it
 * carries most of these vendors with a release date and a price, so a survey
 * needs no key from anybody.
 *
 * ## IT READS AN ALIAS AS BEHIND, AND THAT IS A FALSE NEGATIVE
 *
 * The catalogue lists concrete models, not the alias names a vendor keeps
 * pointed at them — so `qwen-max` and `mistral-large-latest` report BEHIND
 * here while resolving perfectly well at the vendor. Do not "fix" one of those
 * into a pinned version on the strength of this output: that trades a name
 * that cannot go stale for one that certainly will, which is backwards, and it
 * is the one way this instrument can make things worse.
 *
 * The authenticated check has no such blind spot — a vendor's own list
 * contains its aliases — which is the division of labour between the two.
 *
 * IT IS EVIDENCE ABOUT GENERATIONS, NOT ABOUT NATIVE IDS. OpenRouter names a
 * model `z-ai/glm-5.3`; the string a provider's own API wants is usually the
 * half after the slash, and usually is not always. So this is the instrument
 * that tells you a default is a generation behind — the provider's own list,
 * through the check above, is what confirms the replacement string.
 */
if (process.argv.includes('--survey')) {
  const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) { console.error(`Could not read the public catalogue: HTTP ${response.status}`); process.exit(2); }
  const rows = (await response.json()).data ?? [];

  // OpenRouter's vendor namespace for each provider named in llm-provider.ts.
  const NAMESPACE = {
    anthropic: 'anthropic', openai: 'openai', 'azure-openai': 'openai', vertex: 'google',
    deepseek: 'deepseek', qwen: 'qwen', moonshot: 'moonshotai', zhipu: 'z-ai',
    minimax: 'minimax', mistral: 'mistralai', bedrock: 'anthropic',
  };

  const { providers: all } = describeProviders(process.env);
  for (const p of all) {
    const ns = NAMESPACE[p.name];
    if (!ns) continue;

    const family = rows
      .filter((m) => m.id.startsWith(`${ns}/`) && !m.id.includes(':'))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    if (!family.length) continue;

    /*
     * THREE STATES, BECAUSE "STILL SERVED" IS NOT "LATEST".
     *
     * The first version of this printed CURRENT for anything the catalogue
     * still listed, and duly called `gpt-4o` current — true, and useless to
     * somebody asking whether they are on the newest generation. A vendor
     * keeps old models listed for years; that a string still resolves says
     * nothing about whether anyone should be sending it.
     *
     *   LATEST  among the newest handful this vendor has released
     *   LISTED  still served, but a newer generation exists
     *   BEHIND  the catalogue no longer lists it at all
     */
    const bare = p.defaultModel.replace(/^anthropic\./, '');
    const newestIds = family.slice(0, 6).map((m) => m.id.split('/')[1]);
    const listed = family.some((m) => m.id.split('/')[1] === bare);

    const verdict = newestIds.includes(bare) ? 'LATEST' : listed ? 'LISTED' : 'BEHIND';
    console.log(`  ${verdict.padEnd(7)} ${p.name.padEnd(13)} ${p.defaultModel.padEnd(24)} newest: ${newestIds.slice(0, 4).join(', ')}`);
  }
  console.log('\n  LISTED and BEHIND both mean a newer generation exists. Neither is an error;');
  console.log('  an alias that a provider keeps pointed at its current model reads LATEST on');
  console.log('  its own, which is why aliases are preferred in llm-provider.ts.');
  console.log('  This names the generation to move to. Confirm the exact string against the');
  console.log('  provider\'s own API — run without --survey once you hold a key.');
  process.exit(0);
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
