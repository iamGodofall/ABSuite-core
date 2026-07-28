/**
 * Evidence validation — claims, the evidence for them, and a status.
 *
 * **What this is not.** It is not hallucination detection, because that is not
 * a thing that can exist: deciding whether an arbitrary statement is true is
 * open-domain fact-checking, and anyone selling you a box that does it is
 * selling you a classifier with a confident voice. Marketing a truth oracle
 * would be the single fastest way to get a customer sued after they trusted it.
 *
 * **What it is.** A set of deterministic, explainable checks for the specific
 * failure that actually dominates production incidents: a model asserting
 * something *its own sources do not support*. That is a closed-domain question
 * with a real answer. Given the text the model produced and the sources it was
 * given, we can say — reproducibly, and showing our work — which claims are
 * anchored in those sources and which are floating free.
 *
 * The output shape is the point:
 *
 *     Claim:     "The CEO approved this."
 *     Evidence:  none
 *     Status:    UNVERIFIED
 *
 * No score. No probability. No judgement about truth. `UNVERIFIED` means the
 * evidence is absent, not that the claim is false — and that distinction is
 * what keeps this defensible in a room where the answer matters.
 *
 * Three signals, in descending order of reliability:
 *
 * 1. **Verbatim anchors.** Numbers, dates, quoted spans and identifiers that
 *    appear in the output but nowhere in the sources. Fabricated figures and
 *    invented citations are the highest-cost, highest-frequency failure, and
 *    they are *exactly* detectable — no judgement required.
 * 2. **Lexical grounding.** How much of a claim's content vocabulary appears in
 *    the sources. Weak evidence on its own, so it is reported as coverage with
 *    the matched terms attached, never as a verdict.
 * 3. **Self-contradiction.** Two claims in the same output that assert opposite
 *    polarity about the same subject, or different numbers for the same
 *    quantity. Requires no external truth at all — the output disagrees with
 *    itself, which is checkable and always a defect.
 *
 * Every finding names the claim, the reason and the evidence, so a human can
 * overrule it in seconds. Nothing here decides anything on its own.
 */

/** How confident we are that a finding is real, not what the finding means. */
export type Severity = 'info' | 'warning' | 'critical';

export type FindingKind =
  | 'unsupported_number'
  | 'unsupported_quote'
  | 'unsupported_identifier'
  | 'low_grounding'
  | 'self_contradiction'
  | 'numeric_conflict';

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  /** The sentence this finding is about. */
  claim: string;
  /** Index of the claim in the segmented output, for stable referencing. */
  claimIndex: number;
  /** The specific token or span that triggered it. */
  evidence: string;
  /** Plain language, written for the person who has to act on it. */
  explanation: string;
}

/**
 * The status of a claim against its evidence.
 *
 * Three values, and deliberately no fourth. There is no `LIKELY_FALSE`, no
 * probability and no score, because this system does not know what is true — it
 * knows what is *supported*. The distinction is the entire product:
 *
 * - `SUPPORTED` — every checkable element traces to a supplied source.
 * - `UNVERIFIED` — something in this claim is not in the sources. **Not a
 *   claim of falsehood.** An unverified claim is very often correct and merely
 *   unsourced; what it is not is evidenced.
 * - `CONTRADICTED` — the output disagrees with itself. This one needs no
 *   external truth, which is why it is the only status that asserts a defect.
 * - `NOT_CHECKED` — no sources were supplied, so nothing could be assessed.
 *
 * Reporting a status rather than a probability keeps the system inside the
 * territory it can actually defend. "UNVERIFIED" survives a courtroom. "73%
 * likely to be a hallucination" does not.
 */
export type ClaimStatus = 'SUPPORTED' | 'UNVERIFIED' | 'CONTRADICTED' | 'NOT_CHECKED';

export interface ClaimAssessment {
  index: number;
  text: string;
  /** The headline. Read this; everything else is the working. */
  status: ClaimStatus;
  /** Which elements were checked and whether each was found in the sources. */
  evidence: EvidenceItem[];
  /** 0-1 share of the claim's content words found in the sources. */
  grounding: number;
  /** Content words that were found — the "show your work" half. */
  matchedTerms: string[];
  /** Content words that were not. */
  unmatchedTerms: string[];
  findings: Finding[];
}

/** One checkable element of a claim, and whether a source backs it. */
export interface EvidenceItem {
  kind: 'number' | 'quote' | 'identifier' | 'terms';
  value: string;
  found: boolean;
}

export interface VerificationReport {
  /**
   * The report's headline status — the worst status across all claims.
   *
   * `CONTRADICTED` if the output disagrees with itself, otherwise `UNVERIFIED`
   * if anything is unsourced, otherwise `SUPPORTED`.
   */
  status: ClaimStatus;
  /** How many claims landed in each status. The number people actually quote. */
  summary: Record<ClaimStatus, number>;
  /**
   * 0-100 triage aid for ordering a review queue — **not** a probability of
   * falsehood and not a judgement about the output. When a team has ten
   * thousand outputs and time for fifty, this says which fifty. Nothing else.
   */
  reviewPriority: number;
  /** True when nothing was flagged. Absence of findings is not proof of truth. */
  clean: boolean;
  claimCount: number;
  /** Set when no sources were supplied — grounding could not be assessed. */
  grounded: boolean;
  claims: ClaimAssessment[];
  findings: Finding[];
  /** What was and was not checked, so nobody over-reads the result. */
  disclaimer: string;
  checkedAt: string;
}

export interface VerifyOptions {
  /** Below this share of matched content words a claim is flagged. */
  groundingThreshold?: number;
  /** Skip claims shorter than this many content words — too little to assess. */
  minClaimTerms?: number;
  now?: Date;
}

const DEFAULT_GROUNDING_THRESHOLD = 0.4;
const DEFAULT_MIN_CLAIM_TERMS = 3;

const DISCLAIMER =
  'Evidence validation, not fact checking. SUPPORTED means a claim traces to the ' +
  'supplied sources — not that it is true. UNVERIFIED means the evidence is ' +
  'absent — not that the claim is false; it may well be correct and merely ' +
  'unsourced. Only CONTRADICTED asserts a defect, because there the output ' +
  'disagrees with itself and no external truth is needed to see it.';

/**
 * Words carrying no topical content.
 *
 * Kept deliberately small. An aggressive stop list inflates grounding scores by
 * removing the words most likely to be missing, which would make the check look
 * better while making it useless.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'may', 'me', 'might', 'must', 'my', 'of', 'on', 'or', 'our', 'she', 'should',
  'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'to', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'would',
  'you', 'your',
]);

/** Terms that flip a sentence's polarity, for the contradiction check. */
const NEGATIONS = new Set([
  'not', 'no', 'never', 'none', 'cannot', 'without', 'neither', 'nor',
  "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't",
  "won't", "can't", "couldn't", "shouldn't", "wouldn't", 'unsupported', 'unavailable',
]);

/**
 * Split text into claims.
 *
 * Sentence segmentation on abbreviations and decimals is where naive splitters
 * fall apart, producing fragments that then fail grounding for no reason. The
 * lookbehind requires a lowercase letter, digit, quote or closing bracket before
 * the terminator, which keeps "Inc." and "3.5" intact.
 *
 * It also accepts a capital *preceded by* a lowercase letter or digit, so a
 * sentence ending in a magnitude suffix — "Revenue was $4.2M." — still splits.
 * Without that, the following sentence is silently swallowed into the same
 * claim and inherits its evidence, which is how an unsupported statement ends
 * up reported as SUPPORTED. A lone initial ("J. Smith") has no such preceding
 * character, so it is still left alone.
 */
export function segmentClaims(text: string): string[] {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[a-z0-9"')\]]|[a-z0-9][A-Z])[.!?]+(?=\s+[A-Z"'(\[]|\s*$)/g)
    .map(s => s.trim().replace(/^[.!?\s]+/, ''))
    .filter(s => s.length > 0);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** Content words: lowercased, stop words and pure punctuation removed. */
export function contentTerms(text: string): string[] {
  return normalise(text)
    .split(/[^a-z0-9'%$.\-]+/)
    .map(t => t.replace(/^[-'.]+|[-'.]+$/g, ''))
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Numbers worth checking.
 *
 * Years and small integers are excluded deliberately: "3 steps" or "in 2024"
 * appearing in an answer but not verbatim in a source is normal phrasing, and
 * flagging it would bury the signal that matters — a fabricated statistic — in
 * noise. Percentages and currency are always checked regardless of size,
 * because those are the ones that get quoted in a board deck.
 */
export function significantNumbers(text: string): string[] {
  const found = new Set<string>();

  // The magnitude suffix is part of the number. Dropping it makes "$4.2M" and
  // "$4.2B" compare equal, so a thousand-fold error would pass as grounded —
  // which is precisely the mistake this check exists to catch.
  const magnitude = '(?:\\s?(?:k|m|bn|b|tn|t|thousand|million|billion|trillion)\\b)?';
  const pattern = new RegExp(
    `[$£€]\\s?\\d[\\d,]*(?:\\.\\d+)?${magnitude}` +
    `|\\d[\\d,]*(?:\\.\\d+)?\\s?%` +
    `|\\d[\\d,]*\\.\\d+${magnitude}` +
    `|\\d[\\d,]*${magnitude}`,
    'g'
  );

  for (const match of normalise(text).matchAll(pattern)) {
    const raw = match[0].trim();
    const digits = raw.replace(/[^\d.]/g, '');
    const value = Number(digits.replace(/,/g, ''));

    const isMoney = /[$£€]/.test(raw);
    const isPercent = raw.includes('%');
    const isDecimal = /\.\d/.test(raw);
    const isScaled = /(?:k|m|bn|b|tn|t|thousand|million|billion|trillion)$/.test(raw);

    // A scaled figure is a claim about quantity whatever its digits look like.
    if (!isMoney && !isPercent && !isDecimal && isScaled) {
      found.add(raw.replace(/\s+/g, ''));
      continue;
    }

    if (!isMoney && !isPercent && !isDecimal) {
      if (!Number.isFinite(value) || value < 10) continue;
      // Bare four-digit years are ordinary prose, not claims about quantity.
      if (value >= 1900 && value <= 2100 && Number.isInteger(value)) continue;
    }
    found.add(raw.replace(/\s+/g, ''));
  }

  return [...found];
}

/** Quoted spans long enough to be an attributed statement rather than scare quotes. */
export function quotedSpans(text: string): string[] {
  const spans: string[] = [];
  for (const match of String(text || '').matchAll(/["“]([^"”]{12,240})["”]/g)) {
    const span = match[1]?.trim();
    if (span) spans.push(span);
  }
  return spans;
}

/**
 * Identifier-shaped tokens: URLs, DOIs, emails, ticket refs, code symbols.
 *
 * A fabricated citation or a made-up endpoint is both very damaging and very
 * cheap to detect, because these must match exactly to be usable at all.
 */
export function identifiers(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s<>"')]+/g,
    /\b10\.\d{4,9}\/[^\s"']+/g,                    // DOI
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,               // email
    /\b[A-Z][A-Z0-9]+-\d+\b/g,                     // JIRA-style ref
    /\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(\)/g,   // method call
  ];

  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      found.add(match[0].replace(/[.,;:)\]]+$/, ''));
    }
  }
  return [...found];
}

const MAGNITUDES: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
  t: 1e12, tn: 1e12, trillion: 1e12,
};

/**
 * Normalise a number for comparison.
 *
 * Resolved to an actual value rather than compared as text, so "1,200" matches
 * "1200" and "$4.2M" matches "4,200,000" — a source and an output are allowed
 * to write the same figure differently. Percent is kept distinct from the bare
 * number, because 23% and 23 are not the same claim.
 */
function numericKey(raw: string): string {
  const text = raw.toLowerCase().replace(/[\s,]/g, '').replace(/^[$£€]/, '');
  // Percent falls through this pattern deliberately: "23%" stays "23%" and
  // never collapses onto the bare number 23, which is a different claim.
  const match = text.match(/^(\d+(?:\.\d+)?)([a-z]*)$/);
  if (!match) return text;

  const value = Number(match[1]);
  const suffix = match[2] ?? '';
  if (!Number.isFinite(value)) return text;

  const multiplier = MAGNITUDES[suffix];
  if (multiplier) return String(value * multiplier);

  return suffix ? `${value}${suffix}` : String(value);
}

/** Compare quoted text loosely enough to survive whitespace and case differences. */
function looseIncludes(haystack: string, needle: string): boolean {
  const flatten = (s: string) => normalise(s).replace(/[^a-z0-9]+/g, ' ').trim();
  return flatten(haystack).includes(flatten(needle));
}

/**
 * Verify an output against the sources it was supposed to be grounded in.
 *
 * Pure and deterministic: the same output and sources always produce the same
 * report. That is what lets a finding be re-checked by an auditor months later,
 * and it is why none of this calls a model.
 */
export function verifyOutput(
  output: string,
  sources: readonly string[] = [],
  options: VerifyOptions = {}
): VerificationReport {
  const threshold = options.groundingThreshold ?? DEFAULT_GROUNDING_THRESHOLD;
  const minTerms = options.minClaimTerms ?? DEFAULT_MIN_CLAIM_TERMS;
  const now = options.now ?? new Date();

  const claims = segmentClaims(output);
  const sourceText = sources.join('\n\n');
  const grounded = sourceText.trim().length > 0;

  const sourceTerms = new Set(contentTerms(sourceText));
  const sourceNumbers = new Set(significantNumbers(sourceText).map(numericKey));
  const sourceIdentifiers = new Set(identifiers(sourceText).map(v => v.toLowerCase()));

  const findings: Finding[] = [];
  const assessments: ClaimAssessment[] = claims.map((text, index) => {
    const terms = contentTerms(text);
    const matchedTerms = grounded ? terms.filter(t => sourceTerms.has(t)) : [];
    const unmatchedTerms = grounded ? terms.filter(t => !sourceTerms.has(t)) : terms;
    const coverage = terms.length === 0 ? 1 : matchedTerms.length / terms.length;

    const claimFindings: Finding[] = [];
    const evidence: EvidenceItem[] = [];

    if (grounded) {
      // Record every checkable element and whether a source backs it — found
      // and not-found alike. A report that lists only failures cannot show that
      // anything was actually checked.
      for (const number of significantNumbers(text)) {
        evidence.push({ kind: 'number', value: number, found: sourceNumbers.has(numericKey(number)) });
      }
      for (const span of quotedSpans(text)) {
        evidence.push({ kind: 'quote', value: truncate(span, 120), found: looseIncludes(sourceText, span) });
      }
      for (const identifier of identifiers(text)) {
        evidence.push({ kind: 'identifier', value: identifier, found: sourceIdentifiers.has(identifier.toLowerCase()) });
      }
      if (terms.length) {
        evidence.push({
          kind: 'terms',
          value: `${matchedTerms.length}/${terms.length} content words in sources`,
          found: coverage >= threshold,
        });
      }

      for (const number of significantNumbers(text)) {
        if (sourceNumbers.has(numericKey(number))) continue;
        claimFindings.push({
          kind: 'unsupported_number',
          severity: 'critical',
          claim: text,
          claimIndex: index,
          evidence: number,
          explanation: `The figure ${number} does not appear in any supplied source. Fabricated numbers are the most common and most costly model error — confirm it before this is quoted anywhere.`,
        });
      }

      for (const span of quotedSpans(text)) {
        if (looseIncludes(sourceText, span)) continue;
        claimFindings.push({
          kind: 'unsupported_quote',
          severity: 'critical',
          claim: text,
          claimIndex: index,
          evidence: span.length > 120 ? `${span.slice(0, 117)}...` : span,
          explanation: 'This quotation does not appear in the sources. A quote attributed to a source that does not contain it is a fabrication regardless of whether the sentiment is accurate.',
        });
      }

      for (const identifier of identifiers(text)) {
        if (sourceIdentifiers.has(identifier.toLowerCase())) continue;
        claimFindings.push({
          kind: 'unsupported_identifier',
          severity: 'warning',
          claim: text,
          claimIndex: index,
          evidence: identifier,
          explanation: `${identifier} is not present in the sources. Invented links, DOIs and references look authoritative and resolve to nothing.`,
        });
      }

      if (terms.length >= minTerms && coverage < threshold) {
        claimFindings.push({
          kind: 'low_grounding',
          severity: 'warning',
          claim: text,
          claimIndex: index,
          evidence: `${Math.round(coverage * 100)}% of terms found`,
          explanation: `Only ${matchedTerms.length} of ${terms.length} content words appear in the sources. This is weak evidence on its own — the claim may be a correct paraphrase — but it is where unsupported assertions cluster.`,
        });
      }
    }

    findings.push(...claimFindings);

    return {
      index,
      text,
      status: statusFor(claimFindings, evidence, grounded),
      evidence,
      grounding: Math.round(coverage * 100) / 100,
      matchedTerms: [...new Set(matchedTerms)].slice(0, 25),
      unmatchedTerms: [...new Set(unmatchedTerms)].slice(0, 25),
      findings: claimFindings,
    };
  });

  // Self-consistency needs no sources: an output that disagrees with itself is
  // defective whatever the truth of the matter is.
  const internal = findInternalContradictions(assessments);
  findings.push(...internal);
  for (const finding of internal) {
    const assessment = assessments[finding.claimIndex];
    if (!assessment) continue;
    assessment.findings.push(finding);
    // A contradiction outranks everything: it is the one status that asserts a
    // defect rather than merely an absence of evidence.
    assessment.status = 'CONTRADICTED';
  }

  const summary: Record<ClaimStatus, number> = {
    SUPPORTED: 0, UNVERIFIED: 0, CONTRADICTED: 0, NOT_CHECKED: 0,
  };
  for (const assessment of assessments) summary[assessment.status] += 1;

  const status: ClaimStatus =
    summary.CONTRADICTED > 0 ? 'CONTRADICTED'
      : summary.UNVERIFIED > 0 ? 'UNVERIFIED'
        : summary.SUPPORTED > 0 ? 'SUPPORTED'
          : 'NOT_CHECKED';

  return {
    status,
    summary,
    reviewPriority: reviewPriorityFor(findings, assessments.length),
    clean: findings.length === 0,
    claimCount: assessments.length,
    grounded,
    claims: assessments,
    findings,
    disclaimer: grounded
      ? DISCLAIMER
      : `${DISCLAIMER} No sources were supplied, so grounding was not assessed — only self-consistency was checked.`,
    checkedAt: now.toISOString(),
  };
}

/**
 * Decide a claim's status from its evidence.
 *
 * Derived from the evidence rather than from the findings, and the difference
 * matters: findings are tuned for a review queue and stay quiet on claims too
 * short to assess, so reading their silence as support would report "The CEO
 * approved this." — two words, nothing backing it — as SUPPORTED. Absence of a
 * complaint is not presence of evidence.
 *
 * `SUPPORTED` therefore requires something to have been checked *and* every
 * checked element to have been found. Everything else is `UNVERIFIED`, which
 * deliberately does not distinguish "probably wrong" from "fine but unsourced",
 * because this system cannot tell those apart and pretending otherwise is the
 * whole failure mode being avoided.
 */
function statusFor(
  findings: readonly Finding[],
  evidence: readonly EvidenceItem[],
  grounded: boolean
): ClaimStatus {
  if (!grounded) return 'NOT_CHECKED';
  if (findings.some(f => f.kind === 'self_contradiction' || f.kind === 'numeric_conflict')) return 'CONTRADICTED';
  if (evidence.length === 0) return 'UNVERIFIED';
  return evidence.every(e => e.found) ? 'SUPPORTED' : 'UNVERIFIED';
}

/**
 * Find claims in the same output that contradict each other.
 *
 * Two heuristics, both requiring substantial subject overlap before they fire:
 * opposite negation polarity, and different numbers attached to the same
 * quantity. Requiring overlap is what keeps this from flagging every pair of
 * sentences where one happens to contain "not".
 */
export function findInternalContradictions(claims: readonly ClaimAssessment[]): Finding[] {
  const findings: Finding[] = [];

  const prepared = claims.map(claim => {
    const terms = contentTerms(claim.text);
    const tokens = new Set(normalise(claim.text).split(/[^a-z']+/).filter(Boolean));
    return {
      claim,
      terms: new Set(terms),
      negated: [...tokens].some(t => NEGATIONS.has(t)),
      numbers: significantNumbers(claim.text),
    };
  });

  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i]!;
      const b = prepared[j]!;

      const shared = [...a.terms].filter(t => b.terms.has(t));
      const smaller = Math.min(a.terms.size, b.terms.size);
      if (smaller < 3 || shared.length / smaller < 0.6) continue;

      if (a.negated !== b.negated) {
        findings.push({
          kind: 'self_contradiction',
          severity: 'critical',
          claim: b.claim.text,
          claimIndex: b.claim.index,
          evidence: `Claim ${a.claim.index + 1}: "${truncate(a.claim.text)}"`,
          explanation: 'These two claims describe the same subject with opposite polarity — one asserts what the other denies. The output disagrees with itself, so at least one statement is wrong.',
        });
        continue;
      }

      // Same subject, different figure: one of them is wrong.
      const aKeys = new Set(a.numbers.map(numericKey));
      const bKeys = new Set(b.numbers.map(numericKey));
      if (aKeys.size && bKeys.size) {
        const conflicting = [...bKeys].filter(k => !aKeys.has(k));
        if (conflicting.length && [...aKeys].some(k => !bKeys.has(k))) {
          findings.push({
            kind: 'numeric_conflict',
            severity: 'critical',
            claim: b.claim.text,
            claimIndex: b.claim.index,
            evidence: `${[...aKeys].join(', ')} vs ${[...bKeys].join(', ')}`,
            explanation: 'The same quantity is given two different values in one output. Whichever is right, the output cannot be relied on as written.',
          });
        }
      }
    }
  }

  return findings;
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/**
 * Render a report the way a person should read it: claim, evidence, status.
 *
 * Deliberately plain text. This is the form that goes in a ticket, an email or
 * an audit bundle, and it should be legible to someone who has never heard of
 * this package and is not going to read a JSON schema to find out whether their
 * agent made something up.
 */
export function renderReport(report: VerificationReport): string {
  const lines: string[] = [];

  for (const claim of report.claims) {
    const backing = claim.evidence.filter(e => e.found);
    const missing = claim.evidence.filter(e => !e.found);

    lines.push(`Claim:    ${claim.text}`);

    if (claim.evidence.length === 0) {
      lines.push('Evidence: none supplied');
    } else {
      lines.push(`Evidence: ${backing.length ? backing.map(e => `${e.value} (found)`).join(', ') : 'none'}`);
      if (missing.length) {
        lines.push(`          missing: ${missing.map(e => e.value).join(', ')}`);
      }
    }

    lines.push(`Status:   ${claim.status}`);
    lines.push('');
  }

  lines.push(
    `${report.summary.SUPPORTED} supported, ${report.summary.UNVERIFIED} unverified, ` +
    `${report.summary.CONTRADICTED} contradicted, ${report.summary.NOT_CHECKED} not checked.`,
    '',
    report.disclaimer
  );

  return lines.join('\n');
}

/**
 * Turn findings into a review-priority number for ordering a queue.
 *
 * Density rather than count: three unsupported figures in a three-sentence
 * answer is a much worse signal than three in forty sentences, and a raw count
 * would rank them identically. This orders work; it does not judge output.
 */
function reviewPriorityFor(findings: readonly Finding[], claimCount: number): number {
  if (findings.length === 0) return 0;

  const weights: Record<Severity, number> = { info: 1, warning: 4, critical: 12 };
  const total = findings.reduce((sum, f) => sum + weights[f.severity], 0);
  const density = total / Math.max(1, claimCount);

  return Math.min(100, Math.round(100 * (1 - Math.exp(-density / 6))));
}

/**
 * Map a report onto trust events.
 *
 * Only findings we are confident in become evidence. Low grounding is a prompt
 * for a human to look, not proof of misbehaviour, so it never lands on a
 * subject's permanent record — the alternative is a score that decays every
 * time a model paraphrases well.
 */
export function findingsToEventKinds(report: VerificationReport): Array<'unsupported_claim' | 'contradiction' | 'verification_passed'> {
  const kinds: Array<'unsupported_claim' | 'contradiction' | 'verification_passed'> = [];

  const unsupported = report.findings.filter(
    f => f.kind === 'unsupported_number' || f.kind === 'unsupported_quote' || f.kind === 'unsupported_identifier'
  );
  const contradictions = report.findings.filter(
    f => f.kind === 'self_contradiction' || f.kind === 'numeric_conflict'
  );

  if (unsupported.length) kinds.push('unsupported_claim');
  if (contradictions.length) kinds.push('contradiction');
  // Only claim a pass when there were sources to check against.
  if (!kinds.length && report.grounded && report.claimCount > 0) kinds.push('verification_passed');

  return kinds;
}
