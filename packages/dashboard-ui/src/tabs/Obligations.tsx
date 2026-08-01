/**
 * What each side owes the other.
 *
 * Trust ships ten standard obligations, five owed by the agent and five owed by
 * the operator, each with the specific signal that would detect a breach. It is
 * the most unusual idea in this codebase — every comparable product measures
 * only whether the agent behaved — and it had no interface at all.
 *
 * The symmetry is the argument, so the layout is the argument: two columns, the
 * same length, side by side. An agent with a poor success rate and a clean
 * breach record is being set up to fail by its environment, and no screen that
 * only lists the agent's duties can ever show you that.
 *
 * Nothing here is scored. Each obligation states what is owed and what would
 * reveal it broken; whether a given deployment has broken one is a matter for
 * the breach record, not for a percentage.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../utils';
import { Problem } from '../surface/Surface';

interface Obligation {
  id: string;
  owedBy: 'agent' | 'operator';
  statement: string;
  detection: string;
  severity: 'minor' | 'major';
}

interface Contract {
  id: string;
  agentId: string;
  operatorId: string;
  responseWindowHours: number;
  createdAt: string;
  status: 'active' | 'suspended' | 'terminated';
  statusReason?: string;
}

const adminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

const Column = ({ title, subtitle, obligations, accent }: {
  title: string; subtitle: string; obligations: Obligation[]; accent: string;
}) => (
  <div className="rounded-xl border border-border bg-bg-secondary p-4">
    <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
    <p className="text-xs text-text-muted mt-0.5 mb-3">{subtitle}</p>

    {obligations.length === 0 ? (
      <p className="text-sm text-text-muted">Trust did not answer, so nothing can be listed.</p>
    ) : (
      <div className="space-y-2">
        {obligations.map((obligation, index) => (
          <motion.div
            key={obligation.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index * 0.05, 0.3), duration: 0.3 }}
            className="rounded-lg border border-border bg-bg-primary/40 p-3"
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[11px] font-mono" style={{ color: accent }}>{obligation.id}</span>
              <span className={cn('text-[10px] font-mono uppercase tracking-wider ml-auto',
                obligation.severity === 'major' ? 'text-amber-400' : 'text-text-muted/60')}>
                {obligation.severity}
              </span>
            </div>
            <p className="text-xs text-text-primary mt-1 leading-snug">{obligation.statement}</p>
            <p className="text-[10px] text-text-muted/70 mt-1.5 leading-snug">
              <span className="font-mono uppercase tracking-wider text-text-muted/50">detected by </span>
              {obligation.detection}
            </p>
          </motion.div>
        ))}
      </div>
    )}
  </div>
);

export const Obligations = () => {
  const [obligations, setObligations] = useState<Obligation[] | null>(null);
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, c] = await Promise.all([
        fetch('/trust/obligations', { headers: adminHeaders() }),
        fetch('/trust/contracts', { headers: adminHeaders() }),
      ]);
      if (o.ok) setObligations(((await o.json()) as { obligations: Obligation[] }).obligations ?? []);
      else setError('Trust did not answer, so the obligations cannot be listed.');
      if (c.ok) setContracts(((await c.json()) as { contracts: Contract[] }).contracts ?? []);
    } catch {
      setError('Trust is unreachable, so nothing about obligations can be stated.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const byAgent = obligations?.filter(o => o.owedBy === 'agent') ?? [];
  const byOperator = obligations?.filter(o => o.owedBy === 'operator') ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary">
          The operator owes the agent as much as the agent owes the operator
        </h3>
        <p className="text-xs text-text-muted mt-1 max-w-3xl leading-relaxed">
          Every comparable product measures one direction: did the agent behave. That framing quietly
          charges an agent for expired credentials it was handed, tools that changed shape underneath
          it, and escalations nobody answered. Here both columns are the same length on purpose — an
          agent with a poor success rate and a clean breach record is being set up to fail by its
          environment, and that is the most actionable thing this system can tell you.
        </p>
      </div>

      {error && (
        <Problem what={error} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Column
          title="What the agent owes"
          subtitle="Five duties, and the signal that would show each one broken."
          obligations={byAgent}
          accent="#00FF88"
        />
        <Column
          title="What the operator owes"
          subtitle="Five duties, held to the same standard and detected the same way."
          obligations={byOperator}
          accent="#00D9FF"
        />
      </div>

      <div className="rounded-xl border border-border bg-bg-secondary p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Contracts on this instance</h3>
        <p className="text-xs text-text-muted mb-3 leading-relaxed">
          An obligation binds nobody until a contract names the two parties. A breach recorded against
          an operator is never charged to the agent — attributing a failure to the component that
          cannot fix it is the defect this framework exists to remove.
        </p>

        {contracts === null ? (
          <p className="text-sm text-text-muted">Trust did not answer, so nothing can be stated.</p>
        ) : contracts.length === 0 ? (
          <p className="text-sm text-text-muted">
            No contracts established. The ten obligations above are the standard set this build
            ships; none of them is currently binding anyone on this instance. That is an accurate
            description of an unconfigured deployment, not a missing feature.
          </p>
        ) : (
          <div className="space-y-1.5">
            {contracts.map(contract => (
              <div key={contract.id}
                className="flex items-baseline gap-3 px-3 py-2 rounded-lg border border-border bg-bg-primary/40 flex-wrap">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 self-center',
                  contract.status === 'active' ? 'bg-[#00FF88]'
                    : contract.status === 'suspended' ? 'bg-amber-400' : 'bg-red-500')} />
                <span className="text-xs font-mono text-[#00FF88]">{contract.agentId}</span>
                <span className="text-[10px] text-text-muted">⇄</span>
                <span className="text-xs font-mono text-[#00D9FF]">{contract.operatorId}</span>
                <span className="text-[10px] font-mono text-text-muted uppercase">{contract.status}</span>
                {contract.statusReason && (
                  <span className="text-[10px] text-amber-400/80">{contract.statusReason}</span>
                )}
                <span className="text-[10px] font-mono text-text-muted/50 ml-auto">
                  answers within {contract.responseWindowHours}h
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Obligations;
