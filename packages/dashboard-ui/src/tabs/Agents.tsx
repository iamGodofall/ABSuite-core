/**
 * Agents — ranked by what is unproven about them, never by a score.
 *
 * The obvious design here is a leaderboard: "Top Agents by Trust Score —
 * Agent-3, 98.7%". It looks authoritative, it fills the slot, and it is exactly
 * what this product exists to argue against. A trust score is a judgement
 * wearing a decimal point: nobody audits a 98.7, they act on it, and the number
 * would have to be invented because trust is not a quantity this system
 * computes. `conditions.test.ts` fails the build if a percentage or the words
 * score, grade, rating or confidence appear in that output — the refusal is
 * enforced, not merely held.
 *
 * So this occupies the same slot and does the more useful job. Every subject
 * that has acted, ordered by how much about it cannot currently be shown:
 * records with no recorded authority, failures, and actions with no governing
 * rule. Those are counts of things that exist, they can be argued with line by
 * line, and they point at work rather than at a person.
 *
 * Ordering is not ranking. The counts are real; which of them matters is a
 * judgement, and that judgement is the reader's.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';
import { formatMoney } from '../money';
import { Panel, Empty, Problem, Loading, Badge, Note } from '../surface/Surface';

interface SubjectSpend {
  subject: string;
  priced: number;
  unpriced: number;
  currencies: { currency: string; amount: number; executions: number }[];
  sources: string[];
}

interface SubjectAuthority {
  subject: string;
  total: number;
  lastSeen: string;
  unscoped: number;
  scopes: { scope: string; count: number }[];
}

interface Record_ {
  id: string; subject: string; action: string;
  outcome: 'success' | 'failure'; startedAt: string;
  scope?: string[]; governance?: { policyRef: string };
}

interface Row {
  subject: string;
  total: number;
  lastSeen: string;
  unscoped: number;
  failures: number;
  ungoverned: number;
  scopes: { scope: string; count: number }[];
  unproven: number;
  spend?: SubjectSpend;
}

interface Coverage {
  records: number;
  priced: number;
  unpriced: number;
  meaning: string;
}

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

export const Agents = ({ onOpenRecord }: { onOpenRecord?: (id: string) => void }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [records, setRecords] = useState<Record_[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [authorityRes, recordsRes, costRes] = await Promise.all([
        fetch('/executions/authority', { headers: adminHeaders() }),
        fetch('/executions?limit=200', { headers: adminHeaders() }),
        fetch('/executions/cost', { headers: adminHeaders() }),
      ]);

      if (!authorityRes.ok) {
        throw new Error(authorityRes.status === 401 || authorityRes.status === 403
          ? 'Reading the execution log requires your admin key — Settings → Admin API key.'
          : `Could not read the log (${authorityRes.status}).`);
      }

      const authority = ((await authorityRes.json()) as { subjects: SubjectAuthority[] }).subjects ?? [];
      const all = recordsRes.ok ? ((await recordsRes.json()) as { executions: Record_[] }).executions ?? [] : [];
      setRecords(all);

      // Spend is loaded beside authority, not instead of it. If this call fails
      // the screen still answers its own question; it simply says nothing about
      // money rather than reporting zero, which would be a different claim.
      const spend = costRes.ok
        ? ((await costRes.json()) as { coverage: Coverage; subjects: SubjectSpend[] })
        : null;
      setCoverage(spend?.coverage ?? null);
      const spendBySubject = new Map((spend?.subjects ?? []).map(entry => [entry.subject, entry]));

      const built = authority.map(entry => {
        const mine = all.filter(record => record.subject === entry.subject);
        const failures = mine.filter(record => record.outcome === 'failure').length;
        const ungoverned = mine.filter(record => !record.governance).length;
        return {
          subject: entry.subject,
          total: entry.total,
          lastSeen: entry.lastSeen,
          unscoped: entry.unscoped,
          failures,
          ungoverned,
          scopes: entry.scopes,
          unproven: entry.unscoped + failures + ungoverned,
          ...(spendBySubject.has(entry.subject) ? { spend: spendBySubject.get(entry.subject)! } : {}),
        };
      });

      // Most unproven first. This orders work; it does not judge a subject.
      built.sort((a, b) => b.unproven - a.unproven || b.total - a.total || a.subject.localeCompare(b.subject));
      setRows(built);
    } catch (err) { setError((err as Error).message); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <Panel
        title="Agents, by what cannot be shown about them"
        subtitle="Not a trust score. Trust is not a quantity this system computes, and a leaderboard of percentages would be a judgement wearing a decimal point — nobody audits a 98.7, they act on it. These are counts of things that exist: actions with no recorded authority, failures, and actions with no governing rule. Argue with any line of it."
        footnote="Ordered by how much is unproven. Ordering is not ranking — which of these matters is your judgement, not ABSuite's."
      />

      {/*
        Spend, stated as coverage first.
        A figure on its own reads as the bill. This one is a sum over whichever
        records happened to carry a cost, and the share it covers is the part a
        reader needs before the amount means anything — so the sentence comes
        before the number, and the number never appears without it.
      */}
      {coverage && coverage.records > 0 && (
        <Panel
          title="What it cost, and who spent it"
          subtitle={coverage.meaning}
          actions={<Badge>{coverage.priced.toLocaleString('en-US')} of {coverage.records.toLocaleString('en-US')} priced</Badge>}
          footnote="ABSuite meters nothing. Every figure below is a claim the caller recorded, attributed to the source named on it and signed into the record — so it can be pointed at later, and cannot be revised afterwards without breaking the chain. Currencies are shown separately; no record carries an exchange rate, so there is no combined total to give."
        />
      )}

      {error && <Problem what={error} />}

      {!rows && !error && <Loading what="Reading the record…" />}

      {rows && rows.length === 0 && (
        <Empty
          because="No subject has acted yet. Nothing has been exercised, so there is nothing to review."
          resolvedBy="Record an execution and the subject appears here — this view is built from what happened, not from tokens that were issued."
        />
      )}

      {rows && rows.length > 0 && (
        <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
          {rows.map((row, index) => {
            const clean = row.unproven === 0;
            const open = expanded === row.subject;
            const mine = records.filter(record => record.subject === row.subject);

            return (
              <div key={row.subject} className="border-b border-border/50 last:border-b-0">
                <motion.button
                  type="button"
                  onClick={() => setExpanded(open ? null : row.subject)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.3 }}
                  className="w-full text-left px-4 py-3 hover:bg-bg-tertiary/30 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={cn('w-2 h-2 rounded-full shrink-0',
                      clean ? 'bg-[#00FF88] ops-state-demonstrated' : 'bg-amber-400 ops-state-unknown')} />
                    <span className="text-sm font-mono text-text-primary">{row.subject}</span>
                    <span className="text-[11px] text-text-muted">
                      {row.total.toLocaleString('en-US')} action(s) · last {new Date(row.lastSeen).toLocaleString()}
                    </span>

                    <span className="ml-auto flex items-center gap-2 flex-wrap">
                      {/*
                        One badge per currency, never a sum across them. The
                        unpriced count sits beside the money deliberately: an
                        agent showing $18.12 over two of its nine actions has not
                        been shown to have spent $18.12.
                      */}
                      {row.spend?.currencies.map(total => (
                        <span key={total.currency}
                          className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#00D9FF]/30 text-[#00D9FF] tabular-nums">
                          {formatMoney(total.amount, total.currency)}
                        </span>
                      ))}
                      {row.spend && row.spend.priced > 0 && row.spend.unpriced > 0 && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-text-muted">
                          {row.spend.unpriced} unpriced
                        </span>
                      )}
                      {row.unscoped > 0 && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/30 text-amber-400">
                          {row.unscoped} unscoped
                        </span>
                      )}
                      {row.failures > 0 && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-red-500/30 text-red-400">
                          {row.failures} failed
                        </span>
                      )}
                      {row.ungoverned > 0 && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-text-muted">
                          {row.ungoverned} with no rule
                        </span>
                      )}
                      {clean && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#00FF88]/30 text-[#00FF88]">
                          nothing unproven
                        </span>
                      )}
                    </span>
                  </div>

                  {row.spend && row.spend.sources.length > 0 && (
                    <div className="mt-2 pl-5 text-[10px] font-mono text-text-muted/70">
                      figures from {row.spend.sources.join(', ')}
                    </div>
                  )}

                  {row.scopes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 pl-5">
                      {row.scopes.map(scope => (
                        <span key={scope.scope}
                          className="text-[10px] font-mono text-[#00D9FF]/70 border border-[#00D9FF]/20 rounded px-1.5 py-0.5">
                          {scope.scope} ×{scope.count}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.button>

                {open && mine.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    className="bg-bg-primary/40 border-t border-border/50"
                  >
                    {mine.slice(0, 10).map(record => (
                      <button
                        key={record.id}
                        onClick={() => onOpenRecord?.(record.id)}
                        className="w-full text-left px-4 py-2 pl-9 hover:bg-bg-tertiary/40 flex items-center gap-2.5 flex-wrap border-b border-border/30 last:border-b-0"
                      >
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                          record.outcome === 'success' ? 'bg-[#00FF88]' : 'bg-red-500')} />
                        <span className="text-xs font-mono text-text-primary">{record.action}</span>
                        {(!record.scope || record.scope.length === 0) && (
                          <span className="text-[10px] text-amber-400">no scope</span>
                        )}
                        {!record.governance && (
                          <span className="text-[10px] text-text-muted/60">no rule</span>
                        )}
                        <span className="text-[10px] font-mono text-text-muted/50 ml-auto">
                          {new Date(record.startedAt).toLocaleTimeString()}
                        </span>
                      </button>
                    ))}
                    {mine.length > 10 && (
                      <p className="px-4 py-2 pl-9 text-[10px] text-text-muted/60">
                        Showing 10 of {mine.length} — this list is a window, not the archive.
                      </p>
                    )}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rows && rows.length > 0 && (
        <Note>
          Derived from executions that happened, not from tokens that were issued. A capability nobody
          used does not appear here, and a subject that has never acted does not exist to this screen.
        </Note>
      )}
    </div>
  );
};

export default Agents;
