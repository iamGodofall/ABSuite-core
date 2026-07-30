/**
 * Layer 4 — Govern. The rules the system will not break, and the tests that
 * hold it to them.
 *
 * A principle in a document is a promise. A principle with a test beside it is
 * a behaviour: the build fails if the system stops honouring it. Every entry
 * below names the test that enforces it, and `pnpm check:constraints` fails if
 * any of those tests stops existing — so this panel cannot quietly become a
 * list of things ABSuite used to do.
 */
import React from 'react';

interface Constraint {
  refusal: string;
  because: string;
  /** The test that fails if this stops being true. Verified by check:constraints. */
  test: { file: string; name: string };
}

export const CONSTRAINTS: Constraint[] = [
  {
    refusal: 'It will not score a person.',
    because:
      'Trust scoring aimed at humans is surveillance with a dashboard. ABSuite scores agents, vendors and models — and the refusal points at the endpoint that answers honestly instead.',
    test: { file: 'packages/trust/src/scoring.test.ts', name: 'refuses to score humans by default' },
  },
  {
    refusal: 'It will not issue authority the caller does not already hold.',
    because:
      'A capability service that widens scope on request is a privilege-escalation endpoint with good manners.',
    test: { file: 'packages/capkit/src/server.smoke.test.ts', name: 'refuses a token for a scope it does not hold' },
  },
  {
    refusal: 'It will not let an unverified record read as a verified one.',
    because:
      'Silence about verification is the most dangerous possible default: it makes "nobody checked" look exactly like "it passed".',
    test: { file: 'packages/capkit/src/explain.test.ts', name: 'a verified record and an unchecked one never read the same' },
  },
  {
    refusal: 'It will not tell you what to do about what it saw.',
    because:
      'ABSuite is the witness. It says what a person should look at, never what should be done to whoever is in the record.',
    test: { file: 'packages/capkit/src/explain.test.ts', name: 'the conclusion never tells anyone what to do' },
  },
  {
    refusal: 'It will not reduce trust to a number.',
    because:
      'Trust := f(Identity, Capability, Evidence, Governance, Time), and f is left undefined on purpose. ABSuite supplies the inputs; a person performs the judgement. "Trust: 96.4%" replaces evidence with something nobody audits — they just act on it.',
    test: { file: 'packages/capkit/src/conditions.test.ts', name: 'never produces a score, a percentage or a grade' },
  },
  {
    refusal: 'It will not reveal the payload it is describing.',
    because:
      'Inputs and outputs are hashed and dropped. A record that proves what happened without being a copy of it is the only kind safe to keep.',
    test: { file: 'packages/capkit/src/explain.test.ts', name: 'never reveals the payload it is explaining' },
  },
  {
    refusal: 'It will not record an execution it cannot hash.',
    because:
      'A trace with no input is a claim, not evidence. There is nothing to replay it against.',
    test: { file: 'packages/capkit/src/trace.test.ts', name: 'refuses to record an execution with no input at all' },
  },
  {
    refusal: 'It will not run a tool the token does not permit — and will not name the tools it refused.',
    because:
      'An error that lists what you could not reach is a map of the system for anyone probing it.',
    test: { file: 'packages/mcp/src/mcp.test.ts', name: 'refuses a tool the token does not permit, without calling out' },
  },
];

export const ConstraintsPanel = () => (
  <div className="rounded-xl border border-border bg-bg-secondary p-4">
    <h3 className="text-sm font-semibold text-text-primary mb-1">What this system refuses to do</h3>
    <p className="text-xs text-text-muted mb-4 leading-relaxed">
      These are not policies an operator configures. They are constitutional: enforced in code, each
      one held in place by a test that fails the build if the behaviour changes. The test name is
      printed so you can read it rather than take this panel's word for it.
    </p>

    <ul className="space-y-2.5">
      {CONSTRAINTS.map(constraint => (
        <li key={constraint.refusal} className="rounded-lg border border-border bg-bg-primary/40 p-3">
          <div className="text-xs font-semibold text-text-primary">{constraint.refusal}</div>
          <p className="text-[11px] text-text-muted mt-1 leading-snug">{constraint.because}</p>
          <div className="text-[10px] font-mono text-text-muted mt-1.5 opacity-70 break-all">
            {constraint.test.file} — “{constraint.test.name}”
          </div>
        </li>
      ))}
    </ul>
  </div>
);

export default ConstraintsPanel;
