/**
 * Self-serve signup.
 *
 * Without this every customer has to be onboarded by hand, which caps growth
 * at whatever the founder can do personally. This is deliberately the smallest
 * thing that removes that cap: a form, a tenant, and the API key shown once.
 *
 * The page is a single self-contained string — no build step, no framework, no
 * assets to serve — so it cannot drift out of sync with the API it calls.
 */

export interface SignupLimits {
  /** Signups allowed per IP per window, to blunt casual abuse. */
  maxPerWindow: number;
  windowMs: number;
}

const DEFAULT_LIMITS: SignupLimits = { maxPerWindow: 3, windowMs: 3_600_000 };

export class SignupThrottle {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limits: SignupLimits = DEFAULT_LIMITS) {}

  /** Returns true when the caller may proceed. */
  allow(key: string, now = Date.now()): boolean {
    const current = this.hits.get(key);

    if (!current || current.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.limits.windowMs });
      return true;
    }
    if (current.count >= this.limits.maxPerWindow) return false;

    current.count += 1;
    return true;
  }

  /** Drop expired windows so the map cannot grow without bound. */
  prune(now = Date.now()): void {
    for (const [key, value] of this.hits) {
      if (value.resetAt <= now) this.hits.delete(key);
    }
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignup(body: { name?: unknown; email?: unknown }): { ok: true; name: string; email: string } | { ok: false; error: string } {
  const name = String(body?.name ?? '').trim();
  const email = String(body?.email ?? '').trim().toLowerCase();

  if (name.length < 2) return { ok: false, error: 'Please provide an organisation name.' };
  if (name.length > 80) return { ok: false, error: 'Organisation name is too long.' };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: 'Please provide a valid email address.' };
  if (email.length > 160) return { ok: false, error: 'Email address is too long.' };

  return { ok: true, name, email };
}

/**
 * The signup page.
 *
 * Styled inline and theme-aware. The key is shown once with an explicit warning
 * — an operator who misses that has no way to recover it, so the interface has
 * to make it unmissable rather than merely mentioning it.
 */
export const SIGNUP_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Get started — ABSuite</title>
<style>
  :root { color-scheme: light dark; --bg:#ffffff; --fg:#18181b; --muted:#71717a; --border:#e4e4e7; --accent:#7C3AED; --card:#fafafa; --ok:#059669; --warn:#b45309; --warnbg:#fffbeb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#09090b; --fg:#fafafa; --muted:#a1a1aa; --border:#27272a; --accent:#a78bfa; --card:#18181b; --ok:#34d399; --warn:#fbbf24; --warnbg:#1c1917; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1rem; background:var(--bg); color:var(--fg);
         font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width: 34rem; margin: 0 auto; }
  h1 { font-size:1.75rem; margin:0 0 .5rem; letter-spacing:-.02em; }
  p.lede { color:var(--muted); margin:0 0 2rem; }
  label { display:block; font-weight:600; font-size:.875rem; margin:1rem 0 .375rem; }
  input, select { width:100%; padding:.625rem .75rem; font:inherit; color:var(--fg);
          background:var(--bg); border:1px solid var(--border); border-radius:.5rem; }
  input:focus, select:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
  button { width:100%; margin-top:1.5rem; padding:.75rem; font:inherit; font-weight:600;
           color:#fff; background:var(--accent); border:0; border-radius:.5rem; cursor:pointer; }
  button:disabled { opacity:.6; cursor:not-allowed; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:.75rem; padding:1.25rem; margin-top:1.5rem; }
  .warn { background:var(--warnbg); border-color:var(--warn); }
  .warn strong { color:var(--warn); }
  code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.8125rem; }
  pre { background:var(--bg); border:1px solid var(--border); border-radius:.5rem;
        padding:.75rem; overflow-x:auto; margin:.5rem 0 0; }
  .key { display:flex; gap:.5rem; align-items:center; margin-top:.5rem; }
  .key input { font-family:ui-monospace,monospace; font-size:.8125rem; }
  .key button { width:auto; margin:0; padding:.625rem .875rem; white-space:nowrap; }
  .error { color:#dc2626; font-size:.875rem; margin-top:1rem; }
  .hidden { display:none; }
  .muted { color:var(--muted); font-size:.875rem; }
</style>
</head>
<body>
<main>
  <h1>Get started with ABSuite</h1>
  <p class="lede">Scoped, expiring, auditable credentials for your AI agents. Free plan, no card required.</p>

  <form id="form">
    <label for="name">Organisation</label>
    <input id="name" name="name" required autocomplete="organization" placeholder="Acme Corp">

    <label for="email">Email</label>
    <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@acme.com">

    <label for="plan">Plan</label>
    <select id="plan" name="plan"><option value="free">Free — 3 agents, 10k validations/mo</option></select>

    <button type="submit" id="submit">Create account</button>
    <p class="error hidden" id="error"></p>
  </form>

  <div id="result" class="hidden">
    <div class="card warn">
      <strong>Save this key now.</strong>
      <p class="muted" style="margin:.5rem 0 0">It is shown once and cannot be recovered. If you lose it you will need to rotate it.</p>
      <div class="key">
        <input id="apikey" readonly>
        <button type="button" id="copy">Copy</button>
      </div>
    </div>

    <div class="card">
      <strong>Your first request</strong>
      <pre id="snippet"></pre>
    </div>
  </div>
</main>

<script>
(function () {
  var form = document.getElementById('form');
  var errorEl = document.getElementById('error');
  var submit = document.getElementById('submit');

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorEl.classList.add('hidden');
    submit.disabled = true;
    submit.textContent = 'Creating…';

    // outbound-ok: browser code, same-origin relative path
  fetch('/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        plan: document.getElementById('plan').value
      })
    })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error((r.data && (r.data.error && r.data.error.message || r.data.error)) || 'Signup failed');

        document.getElementById('apikey').value = r.data.apiKey;
        document.getElementById('snippet').textContent =
          'curl ' + location.origin + '/usage \\\\\\n  -H "X-ABSuite-Tenant-Key: ' + r.data.apiKey + '"';
        form.classList.add('hidden');
        document.getElementById('result').classList.remove('hidden');
      })
      .catch(function (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        submit.disabled = false;
        submit.textContent = 'Create account';
      });
  });

  document.getElementById('copy').addEventListener('click', function () {
    var field = document.getElementById('apikey');
    field.select();
    navigator.clipboard.writeText(field.value).then(function () {
      var button = document.getElementById('copy');
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy'; }, 1500);
    });
  });
})();
</script>
</body>
</html>`;
