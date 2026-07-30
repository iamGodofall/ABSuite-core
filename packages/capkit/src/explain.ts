/**
 * Explaining a record in plain language, without a language model.
 *
 * "AI that explains AI" sounds like it needs an AI. It does not, and using one
 * here would be a mistake: a generated explanation is a new claim, produced by a
 * system whose reasoning nobody can inspect, about a record whose entire value
 * is that its reasoning *can* be inspected. The explanation would be the least
 * trustworthy thing on the page.
 *
 * Every sentence below is derived from a field that is already signed. Nothing
 * is inferred, nothing is softened, and running it twice on the same record
 * produces the same words — which means a reader can check the prose against
 * the trace themselves, and disagree with it if it is wrong.
 *
 * That is the constitutional requirement: every conclusion re-derivable from
 * stored records by someone who does not trust ABSuite.
 */
import type { ExecutionTrace, TraceVerdict } from './trace';

export interface TraceExplanation {
  /** One line: what happened, in the past tense. */
  headline: string;
  /** Ordered findings, each traceable to a field. */
  findings: Explanation[];
  /** What a reader should take from it. Never a recommendation to act. */
  conclusion: string;
  /** True when something here warrants a person looking. */
  warrantsReview: boolean;
}

export interface Explanation {
  /** Which question this answers. */
  question: string;
  /** The answer, in plain words. */
  answer: string;
  /** The field(s) it came from, so the reader can check rather than believe. */
  from: string;
  status: 'ok' | 'attention' | 'unknown';
}

/** ISO timestamp to something a person reads without converting. */
function readable(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function humanDuration(ms?: number): string | null {
  if (ms === undefined) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} seconds`;
  return `${Math.round(ms / 60_000)} minutes`;
}

/**
 * Explain a single execution.
 *
 * `verdict` is optional. Without it the explanation says the record was not
 * checked, rather than implying it passed — an unverified record and a verified
 * one must never read the same way.
 */
export function explainTrace(trace: ExecutionTrace, verdict?: TraceVerdict): TraceExplanation {
  const findings: Explanation[] = [];
  let warrantsReview = false;

  findings.push({
    question: 'What happened?',
    answer: `${trace.subject} ran "${trace.action}" in ${trace.module} at ${readable(trace.startedAt)}.`,
    from: 'subject, action, module, startedAt',
    status: 'ok',
  });

  const duration = humanDuration(trace.durationMs);
  if (duration) {
    findings.push({
      question: 'How long did it take?',
      answer: `${duration}${trace.completedAt ? `, finishing at ${readable(trace.completedAt)}` : ''}.`,
      from: 'durationMs, completedAt',
      status: 'ok',
    });
  }

  // Authority. The scope on the trace is what the capability actually carried.
  const scopes = trace.scope ?? [];
  findings.push({
    question: 'Under what authority?',
    answer: scopes.length > 0
      ? `The capability granted ${scopes.map(s => `"${s}"`).join(', ')}${trace.jti ? `, from token ${trace.jti}` : ''}. Nothing outside that was permitted.`
      : 'No scope was recorded on this action, so what it was permitted to do cannot be stated from the record.',
    from: 'scope, jti',
    status: scopes.length > 0 ? 'ok' : 'unknown',
  });
  if (scopes.length === 0) warrantsReview = true;

  if (trace.outcome === 'failure') {
    warrantsReview = true;
    findings.push({
      question: 'Did it succeed?',
      answer: trace.error
        ? `No. It failed with: ${trace.error}`
        : 'No. It failed, and no error was recorded against it.',
      from: 'outcome, error',
      status: 'attention',
    });
  } else {
    findings.push({
      question: 'Did it succeed?',
      answer: 'Yes, the action completed and was recorded as successful.',
      from: 'outcome',
      status: 'ok',
    });
  }

  if (trace.steps && trace.steps.length > 0) {
    findings.push({
      question: 'What did it do, step by step?',
      answer: `${trace.steps.length} step${trace.steps.length === 1 ? '' : 's'}: ${trace.steps.map(s => s.name).join(' → ')}.`,
      from: 'steps',
      status: 'ok',
    });
  }

  findings.push({
    question: 'What was processed?',
    answer: trace.outputHash
      ? 'The input and output were hashed and the hashes recorded. The payloads themselves were never stored, so this record proves what was processed without being a copy of it.'
      : 'The input was hashed and recorded. No output hash was captured, so a replay can confirm the input but not the result.',
    from: 'inputHash, outputHash',
    status: trace.outputHash ? 'ok' : 'unknown',
  });

  // Integrity last, because it qualifies everything above it.
  if (!verdict) {
    warrantsReview = true;
    findings.push({
      question: 'Has the record been altered?',
      answer: 'Not checked. Nothing above should be relied on until this record is verified against the signing key.',
      from: 'verifyTrace() was not run',
      status: 'unknown',
    });
  } else if (verdict.valid) {
    findings.push({
      question: 'Has the record been altered?',
      answer: verdict.signatureValid
        ? 'No. The content matches its hash, and the Ed25519 signature verifies against the public key — so this was written by the holder of the private key and has not changed since.'
        : 'The content matches its hash, but no signature was checked, so authorship is unproven.',
      from: 'verifyTrace(): contentIntact, signatureValid',
      status: verdict.signatureValid ? 'ok' : 'unknown',
    });
    if (!verdict.signatureValid) warrantsReview = true;
  } else {
    warrantsReview = true;
    findings.push({
      question: 'Has the record been altered?',
      answer: `Yes — verification failed: ${verdict.reason ?? 'no reason given'}. Treat everything above as unproven.`,
      from: 'verifyTrace(): reason',
      status: 'attention',
    });
  }

  const headline = trace.outcome === 'failure'
    ? `${trace.subject} attempted "${trace.action}" and it failed.`
    : `${trace.subject} performed "${trace.action}".`;

  const conclusion = warrantsReview
    ? 'Something here is unproven or went wrong, so a person should look. This is a statement about the record, not an accusation about the subject.'
    : 'Every question above is answered by a signed field, and the record verifies. Nothing here needs a person.';

  return { headline, findings, conclusion, warrantsReview };
}

/** The explanation as plain text, for a terminal, an email or a ticket. */
export function renderExplanation(explanation: TraceExplanation): string {
  const mark = (s: Explanation['status']) => (s === 'ok' ? '  ' : s === 'attention' ? '! ' : '? ');
  return [
    explanation.headline,
    '',
    ...explanation.findings.flatMap(f => [
      `${mark(f.status)}${f.question}`,
      `    ${f.answer}`,
      `    from: ${f.from}`,
      '',
    ]),
    explanation.conclusion,
  ].join('\n');
}
