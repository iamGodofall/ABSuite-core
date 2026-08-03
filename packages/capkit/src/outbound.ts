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

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * Text matching on IPv6 does not work, and the reason is worth stating because
 * the first version of this file did it and was wrong. `new URL()` re-serialises
 * an address into its shortest form, so `[::ffff:169.254.169.254]` — which a
 * person writes and a test asserts — arrives at the guard as `::ffff:a9fe:a9fe`.
 * A regex looking for a dotted quad sees no dotted quad and calls it public.
 *
 * Comparing numbers instead of characters makes every spelling of one address
 * the same address.
 */
function hextets(address: string): number[] | undefined {
  // Strip brackets and any zone index — `fe80::1%eth0` is still `fe80::1`.
  let text = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';

  // A trailing dotted quad occupies the last two groups: ::ffff:169.254.169.254
  let tail: number[] = [];
  const quad = text.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (quad?.[1]) {
    const octets = quad[1].split('.').map(Number);
    if (octets.some(n => !Number.isInteger(n) || n > 255)) return undefined;
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    text = text.slice(0, text.length - quad[1].length);
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }

  const [head = '', rest] = text.split('::');
  const left = head ? head.split(':').filter(Boolean).map(h => parseInt(h, 16)) : [];
  const right = rest ? rest.split(':').filter(Boolean).map(h => parseInt(h, 16)) : [];

  const groups = text.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length - tail.length)).fill(0), ...right, ...tail]
    : [...left, ...right, ...tail];

  return groups.length === 8 && groups.every(n => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? groups
    : undefined;
}

/**
 * The IPv4 address embedded in an IPv6 one, in any of the three forms that
 * reach an IPv4 host.
 *
 * All three are treated alike, deliberately. Whether a given kernel routes an
 * IPv4-compatible address is a property of that kernel, and a guard whose
 * correctness depends on the target machine's network stack is not a guard.
 */
function embeddedV4(groups: number[]): string | undefined {
  const zero = (from: number, to: number) => groups.slice(from, to).every(g => g === 0);
  const dotted = () => [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');

  if (zero(0, 5) && groups[5] === 0xffff) return dotted();                    // ::ffff:a.b.c.d — mapped
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zero(2, 6)) return dotted(); // 64:ff9b::/96 — NAT64
  if (zero(0, 6) && !(groups[6] === 0 && groups[7]! <= 1)) return dotted();   // ::a.b.c.d — compatible
  return undefined;
}

/** Classify a literal IP address. Returns `public` for anything unrecognised. */
export function classifyAddress(address: string): AddressRange {
  if (isIP(address) === 4) {
    for (const [pattern, range] of V4) if (pattern.test(address)) return range;
    return 'public';
  }

  const groups = hextets(address);
  if (!groups) return 'public';

  if (groups.every(g => g === 0)) return 'unspecified';
  if (groups.slice(0, 7).every(g => g === 0) && groups[7] === 1) return 'loopback';

  const v4 = embeddedV4(groups);
  if (v4) return classifyAddress(v4);

  if ((groups[0]! & 0xfe00) === 0xfc00) return 'unique-local';   // fc00::/7
  if ((groups[0]! & 0xffc0) === 0xfe80) return 'link-local';     // fe80::/10
  if ((groups[0]! & 0xffc0) === 0xfec0) return 'unique-local';   // fec0::/10, deprecated site-local
  return 'public';
}

/**
 * Addresses that are an instance metadata service, whatever range they sit in.
 *
 * This is separate from `classifyAddress` because it is not a fact about
 * network topology, and pretending otherwise hid a hole: **AWS serves IMDS over
 * IPv6 at `fd00:ec2::254`**, which is a unique-local address. edge-run and
 * quickbench refuse link-local and allow unique-local — correctly, since a
 * `fd00::/8` service is exactly the kind of internal thing they exist to call —
 * so the IPv6 endpoint was reachable in both while the IPv4 one was refused.
 *
 * `169.254.170.2` is the ECS task metadata endpoint, which serves task role
 * credentials. It is link-local, so it was already covered; it is named here so
 * that the list is a list of credential endpoints rather than a list of the ones
 * that happened to need it.
 */
const METADATA_ENDPOINTS = new Set([
  '169.254.169.254',   // AWS IMDSv1/v2, GCP, Azure, DigitalOcean, Oracle, Alibaba
  '169.254.170.2',     // AWS ECS task metadata — task role credentials
  '100.100.100.200',   // Alibaba Cloud
  'fd00:ec2::254',     // AWS IMDS over IPv6
]);

/** Whether an address is a known cloud instance metadata endpoint. */
export function isMetadataEndpoint(address: string): boolean {
  if (METADATA_ENDPOINTS.has(address.toLowerCase().replace(/^\[|\]$/g, ''))) return true;

  const groups = hextets(address);
  if (groups) {
    // Compare numerically so fd00:ec2:0:0:0:0:0:254 is the same address.
    const canonical = groups.map(g => g.toString(16)).join(':');
    for (const known of METADATA_ENDPOINTS) {
      const other = hextets(known);
      if (other && other.map(g => g.toString(16)).join(':') === canonical) return true;
    }
    const v4 = embeddedV4(groups);
    if (v4 && METADATA_ENDPOINTS.has(v4)) return true;
  }
  return false;
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
  // The trailing dot is the bypass. `metadata.google.internal.` is a valid
  // fully-qualified name, resolves exactly like the undotted form, and did not
  // match this pattern — found by probing spellings rather than by reading it.
  return /(^|\.)metadata\.(google\.internal|goog)$/i.test(hostname.trim().replace(/\.$/, ''));
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
  /**
   * A known instance metadata endpoint, regardless of range.
   *
   * Carried separately because it cuts across topology: `169.254.169.254` is
   * link-local and `fd00:ec2::254` is unique-local, and both are the same
   * credential service. `guardedFetch` refuses these whatever a caller's policy
   * says, so no caller has to remember the list.
   */
  metadata: boolean;
}

/**
 * Name the specific target, not just its category.
 *
 * `169.254.169.254` is where every major cloud puts instance metadata, and
 * saying so is far more useful than "a link-local address" — while `fe80::1`
 * is link-local and is *not* that address, so it must not claim to be.
 */
export function describeTarget(address: string): string {
  if (isMetadataEndpoint(address)) return `the cloud instance metadata service (${address})`;

  const range = classifyAddress(address);
  if (range !== 'link-local') return RANGE_REASON[range];
  return classifyAddress(address) === 'link-local' && isIP(address) === 4
    ? 'the cloud instance metadata range (169.254.0.0/16)'
    : 'an IPv6 link-local address';
}

const target = (address: string): ResolvedTarget => ({
  address,
  range: classifyAddress(address),
  why: describeTarget(address),
  metadata: isMetadataEndpoint(address),
});

export async function resolveRanges(hostname: string): Promise<ResolvedTarget[] | undefined> {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (isMetadataHostname(host)) {
    return [{ address: host, range: 'link-local', why: 'the GCP metadata service', metadata: true }];
  }
  if (isIP(host)) return [target(host)];

  try {
    const resolved = await lookup(host, { all: true });
    return resolved.map(entry => target(entry.address));
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
