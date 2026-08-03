/**
 * Where an outbound request is actually going.
 *
 * ## Why this is in capkit
 *
 * The same defect was found three times, in three packages, each of which takes
 * a URL from a caller and fetches it:
 *
 *   connector-starter  `webhook.send` reached the cloud metadata service and
 *                      returned the body — the worst of the three.
 *   edge-run           `http` tasks reached it too, over plain http, on a
 *                      schedule. AWS IMDSv1 is HTTP-only, so this was the one
 *                      path nothing incidentally blocked.
 *   quickbench         the `http` provider reaches it, though it returns no
 *                      body — an existence and latency oracle rather than
 *                      exfiltration.
 *
 * Three fixes were about to become three copies of one guard, which is the
 * defect this repository keeps finding in itself: a hand-copied fact that
 * drifts, where fixing one instance leaves the others quietly wrong. The
 * project's own stated pattern is that **enforcement lives in a library
 * distributed to every service**, and all three already depend on capkit.
 *
 * ## Why this classifies and does not decide
 *
 * The right policy genuinely differs per caller, and flattening that would be
 * worse than duplication:
 *
 *   - `webhook.send` posts to third parties. Private ranges are not legitimate
 *     targets, so it refuses them.
 *   - `edge-run` is a task runner **inside your own infrastructure**. Calling
 *     `http://10.0.0.5/reindex` on a schedule is its primary job, so refusing
 *     private ranges would break the product to prevent nothing.
 *   - `quickbench` benchmarks your own services, for the same reason.
 *
 * What they agree on is link-local: `169.254.0.0/16` is where every major cloud
 * puts instance metadata, and it is never a legitimate target for any of them.
 *
 * So this module answers *what kind of address is this?* and each caller
 * decides what to do about it. A shared classifier with per-caller policy is
 * honest about the difference; a shared `isAllowed()` would have had to pick a
 * side and be wrong somewhere.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type AddressRange =
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'carrier-grade-nat'
  | 'unspecified'
  | 'unique-local'
  | 'public';

/**
 * Human-readable reason, for an error a person has to act on.
 *
 * Deliberately generic per range. An earlier version described `link-local` as
 * *"the cloud instance metadata range (169.254.0.0/16)"* — accurate for IPv4
 * and plainly false when it was printed about `fe80::1` or about a hostname.
 * The tests caught it during the refactor that introduced it.
 *
 * A shared classifier must not bake one caller's phrasing into every caller's
 * message, so the range names the *category* and `describeTarget` below names
 * the specific thing that matched.
 */
export const RANGE_REASON: Record<AddressRange, string> = {
  'loopback': 'a loopback address',
  'private': 'a private address',
  'link-local': 'a link-local address',
  'carrier-grade-nat': 'a carrier-grade NAT address',
  'unspecified': 'the unspecified address',
  'unique-local': 'a unique-local address',
  'public': 'a public address',
};

const V4: [RegExp, AddressRange][] = [
  [/^127\./, 'loopback'],
  [/^10\./, 'private'],
  [/^192\.168\./, 'private'],
  [/^172\.(1[6-9]|2\d|3[01])\./, 'private'],
  [/^169\.254\./, 'link-local'],
  [/^0\./, 'unspecified'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'carrier-grade-nat'],
];

/** Classify a literal IP address. Returns `public` for anything unrecognised. */
export function classifyAddress(address: string): AddressRange {
  if (isIP(address) === 4) {
    for (const [pattern, range] of V4) if (pattern.test(address)) return range;
    return 'public';
  }

  const v6 = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::1') return 'loopback';
  if (v6 === '::') return 'unspecified';
  if (/^f[cd]/.test(v6)) return 'unique-local';
  if (/^fe[89ab]/.test(v6)) return 'link-local';

  // ::ffff:127.0.0.1 — an IPv4 address wearing an IPv6 coat.
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?.[1] ? classifyAddress(mapped[1]) : 'public';
}

/**
 * Hostnames that are the metadata service by name rather than by address.
 *
 * `metadata.google.internal` resolves to `169.254.169.254` **on GCP and
 * nowhere else** — it returns `ENOTFOUND` on any other machine, which was
 * verified rather than assumed. So a resolution-based check catches it only in
 * the one environment where it is hardest to test, and a guard that works only
 * where you cannot test it is not a guard anyone should rely on.
 */
export function isMetadataHostname(hostname: string): boolean {
  return /(^|\.)metadata\.(google\.internal|goog)$/i.test(hostname.trim());
}

/**
 * Every range a hostname resolves to, plus the name check.
 *
 * Returns `undefined` when the name cannot be resolved: a host that will not
 * resolve fails at `fetch` anyway, and reporting a DNS outage as a security
 * refusal would teach operators to ignore the refusals that matter.
 *
 * **This does not close DNS rebinding.** Between this lookup and the one
 * `fetch` performs, a hostile resolver can answer differently. Closing that
 * needs an agent that pins the resolved address, which is a larger change than
 * any single caller here should carry — so the cost is raised and the class is
 * not eliminated, and saying otherwise would be the sort of claim this project
 * refuses.
 */
export interface ResolvedTarget {
  address: string;
  range: AddressRange;
  /** The specific thing that matched, for a message a person can act on. */
  why: string;
}

/**
 * Name the specific target, not just its category.
 *
 * `169.254.169.254` is where every major cloud puts instance metadata, and
 * saying so is far more useful than "a link-local address" — while `fe80::1`
 * is link-local and is *not* that address, so it must not claim to be.
 */
export function describeTarget(address: string): string {
  const range = classifyAddress(address);
  if (range !== 'link-local') return RANGE_REASON[range];
  return address.startsWith('169.254.')
    ? 'the cloud instance metadata range (169.254.0.0/16)'
    : 'an IPv6 link-local address';
}

export async function resolveRanges(hostname: string): Promise<ResolvedTarget[] | undefined> {
  const host = hostname.replace(/^\[|\]$/g, '');

  if (isMetadataHostname(host)) return [{ address: host, range: 'link-local', why: 'the GCP metadata service' }];
  if (isIP(host)) return [{ address: host, range: classifyAddress(host), why: describeTarget(host) }];

  try {
    const resolved = await lookup(host, { all: true });
    return resolved.map(entry => ({
      address: entry.address,
      range: classifyAddress(entry.address),
      why: describeTarget(entry.address),
    }));
  } catch {
    return undefined;
  }
}

/** Whether any resolved address falls in one of `ranges`. */
export function inAnyRange(
  resolved: ResolvedTarget[] | undefined,
  ranges: AddressRange[]
): ResolvedTarget | undefined {
  return resolved?.find(entry => ranges.includes(entry.range));
}
