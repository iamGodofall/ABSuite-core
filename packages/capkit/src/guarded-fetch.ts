/**
 * A fetch that checks where the request is going — every time it goes anywhere.
 *
 * ## The hole this closes
 *
 * Three packages were fixed for SSRF by classifying the URL before calling
 * `fetch`. Each check was correct. Each was also completely bypassed by a
 * one-line redirect, which was demonstrated rather than theorised:
 *
 *     server A (public address)  ->  302 Location: http://127.0.0.1:PORT/...
 *
 *     hop 1 classified: public   -> ALLOWED
 *     hop 2 classified: loopback -> REFUSED
 *     hops the guard actually inspected: 1
 *     body returned: {"iam":"STOLEN-CREDENTIALS"}
 *
 * `fetch` follows redirects by default, and it does not ask again. A guard that
 * inspects only the URL a caller supplied is checking the one hop an attacker
 * has no reason to make hostile. That is not partial protection — against a
 * redirect it is none, and documenting the classifier while leaving this open
 * would have been exactly the gloss this project exists to refuse.
 *
 * ## What it does
 *
 * Follows redirects itself, classifying every hop, and applies three rules that
 * `fetch` cannot be asked to apply:
 *
 *   1. **Every hop is classified**, not just the first.
 *   2. **Known metadata endpoints are refused whatever the caller's policy is.**
 *      `169.254.169.254` is link-local and `fd00:ec2::254` — AWS IMDS over IPv6
 *      — is unique-local, so a caller refusing only link-local was open on the
 *      IPv6 endpoint. Callers no longer carry that list.
 *   3. **Credentials are dropped when the origin changes.** A redirect to
 *      another host must not carry `Authorization` or `Cookie` with it, or a
 *      redirect becomes a way to harvest the caller's own tokens.
 *
 * ## What it does not do
 *
 * It does not close DNS rebinding. The address is resolved here and resolved
 * again by `fetch`, and a hostile resolver can answer differently in between.
 * Closing that needs an HTTP agent that connects to the address that was
 * checked. The window is now one hop wide rather than unbounded, which is a
 * smaller hole and not a closed one — see docs/SECURITY-MODEL.md.
 */
import { resolveRanges, inAnyRange, type AddressRange, type ResolvedTarget } from './outbound';

export interface GuardedFetchOptions {
  /** Ranges this caller will not fetch. Metadata endpoints are always refused. */
  refuse: AddressRange[];
  /**
   * Hostnames an operator named explicitly, which skip the range check.
   *
   * Somebody who writes a host into an allowlist has said what they mean, and a
   * control that cannot be overridden by the person running it gets patched out
   * rather than configured. Metadata endpoints are still refused: naming one is
   * far more likely to be an injected value than an intention.
   */
  allow?: string[];
  /**
   * If set, **every** hop's hostname must appear here. Anything else is refused.
   *
   * Distinct from `allow`, and the difference is the whole point. `allow` says
   * *these hosts skip the range check*; `only` says *nothing but these hosts,
   * ever*. Conflating them left a hole in the first version of this file:
   * edge-run enforced `EDGERUN_ALLOWED_HOSTS` before calling `fetch` and passed
   * the same list as `allow`, so hop zero was restricted to the named hosts and
   * every subsequent hop was not. An allowlisted host answering a `302` reached
   * anywhere — demonstrated, with the body returned in `output`.
   *
   * A restriction that applies to the first request and not the second is not a
   * restriction.
   */
  only?: string[];
  /**
   * Permit known instance metadata endpoints. Off unless explicitly set.
   *
   * This is separate from `allow` on purpose. edge-run's allowlist previously
   * meant "an operator who names `169.254.169.254` has said what they mean",
   * and that conflated two very different statements: *restrict which hosts may
   * be called* and *yes, read this machine's cloud credentials*. A knob whose
   * name is about scoping should not be the one that opens the credential
   * service.
   *
   * The override exists rather than being refused outright because a control an
   * operator cannot turn off gets patched out instead, and a patched-out control
   * protects nobody. It just has to be asked for by name.
   */
  allowMetadata?: boolean;
  /** How many redirects to follow. Beyond this, the request fails. */
  maxRedirects?: number;
  /** Protocols permitted at every hop. */
  protocols?: string[];
  /** Verb used in error messages: "Refusing to call", "Refusing to benchmark". */
  verb?: string;
}

/** Thrown when a hop is refused. Carries what matched, so callers can report it. */
export class BlockedTargetError extends Error {
  constructor(
    readonly url: string,
    readonly target: ResolvedTarget,
    readonly hop: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlockedTargetError';
  }
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Headers that authenticate the caller and must not cross an origin boundary. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

function headerEntries(init: RequestInit): [string, string][] {
  const headers = init.headers;
  if (!headers) return [];
  if (headers instanceof Headers) return [...headers.entries()];
  if (Array.isArray(headers)) return headers.map(([k, v]) => [k, v] as [string, string]);
  return Object.entries(headers as Record<string, string>);
}

/**
 * Check one hop, and say why if it is refused.
 *
 * An unresolvable host is not a refusal. It fails at `fetch` anyway, and
 * reporting a DNS outage as a security event teaches operators to ignore
 * security events.
 */
async function checkHop(
  url: URL,
  hop: number,
  options: GuardedFetchOptions,
): Promise<void> {
  const { refuse, allow = [], only, protocols = ['http:', 'https:'], verb = 'call' } = options;
  const where = hop === 0 ? '' : ` (redirected from hop ${hop})`;

  if (!protocols.includes(url.protocol)) {
    throw new Error(`Refusing to ${verb} ${url.protocol}//${url.hostname}: unsupported protocol${where}`);
  }

  /*
   * `only` is checked before anything is resolved, because it is a restriction
   * on names rather than on addresses. Checking it after the resolver would
   * have meant an unresolvable host skipped it — and `resolveRanges` returning
   * undefined is deliberately not a refusal, so a name that fails to resolve
   * would have slipped past the one rule that does not depend on resolution.
   */
  if (only && !only.includes(url.hostname)) {
    throw new Error(`Refusing to ${verb} ${url.hostname}: it is not on the allowed host list${where}.`);
  }

  const resolved = await resolveRanges(url.hostname);
  if (!resolved) return;

  // Metadata endpoints are refused before the allowlist is consulted: an entry
  // in a host allowlist says "restrict what may be called", which is not the
  // same statement as "read this machine's cloud credentials". Overriding that
  // takes `allowMetadata`, which says so in its name.
  const isMetadata = resolved.find(entry => entry.metadata);
  if (isMetadata && !options.allowMetadata) {
    throw new BlockedTargetError(url.href, isMetadata, hop,
      `Refusing to ${verb} ${url.hostname}: it is ${isMetadata.why}${where}.`);
  }

  if (allow.includes(url.hostname)) return;

  const blocked = inAnyRange(resolved, refuse);
  if (blocked) {
    throw new BlockedTargetError(url.href, blocked, hop,
      `Refusing to ${verb} ${url.hostname}: it is ${blocked.why}${where}.`);
  }
}

/**
 * How a redirect changes the request.
 *
 * Replicated from what `fetch` does internally, because following redirects by
 * hand means owning the parts of the spec that used to be handled for us. A 303
 * always becomes a GET; a 301 or 302 on a POST becomes a GET, which is what
 * every browser and every HTTP client has done since long before it was
 * written down. Getting this wrong would not fail loudly — it would re-POST a
 * body somewhere it was not sent before.
 */
function afterRedirect(status: number, init: RequestInit): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  const becomesGet = status === 303 || ((status === 301 || status === 302) && method === 'POST');
  if (!becomesGet) return init;

  const { body: _body, ...rest } = init;
  return { ...rest, method: 'GET' };
}

/** Drop credential headers when the origin changes. */
function forOrigin(init: RequestInit, from: URL, to: URL): RequestInit {
  if (from.origin === to.origin) return init;

  const kept = headerEntries(init).filter(([name]) => !CREDENTIAL_HEADERS.includes(name.toLowerCase()));
  return { ...init, headers: kept };
}

export async function guardedFetch(
  input: string,
  init: RequestInit = {},
  options: GuardedFetchOptions,
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Refusing to ${options.verb ?? 'call'} a URL that could not be parsed: ${input}`);
  }

  let request = init;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await checkHop(url, hop, options);

    // outbound-ok: this is the guard. `url` was classified by checkHop above,
    // and `redirect: 'manual'` is what stops fetch from going anywhere else.
    const response = await fetch(url.href, { ...request, redirect: 'manual' });

    const location = response.headers.get('location');
    if (!REDIRECT_STATUS.has(response.status) || !location) return response;

    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      // A Location header that is not a URL is the server's problem, not a
      // redirect. Hand back the 3xx rather than inventing a destination.
      return response;
    }

    request = forOrigin(afterRedirect(response.status, request), url, next);
    url = next;
  }

  throw new Error(
    `Refusing to ${options.verb ?? 'call'} ${url.hostname}: more than ${maxRedirects} redirects. ` +
    'A redirect loop is the shape of an attempt to exhaust a checker.'
  );
}
