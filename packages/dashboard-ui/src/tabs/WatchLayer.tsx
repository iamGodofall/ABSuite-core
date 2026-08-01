/**
 * Layer 6 — what the watch has seen, and how much of the record that covers.
 *
 * The coverage line is not a footer and must not be moved into one. It is the
 * reason this surface exists at all.
 *
 * An empty list of notices means *the last sweep found none* or it means
 * *nothing has ever swept* — the interval was never started, the container
 * restarted, the sweep threw three weeks ago — and in a list those are the same
 * picture. The second is the more dangerous state a monitor can be in, because a
 * system that looks watched is one nobody checks by hand either. So the sentence
 * that tells them apart is rendered above the list, at the same weight as the
 * count, on every load.
 *
 * Nothing here is ranked. There is no severity, no red banner for the "worst"
 * finding, and no ordering that implies one. Which of these matters most is a
 * judgement about somebody's business, and the product does not have one.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Panel, Empty, Problem, Loading, Badge, Note } from '../surface/Surface';
import { cn } from '../utils';

interface Notice {
  id: string;
  kind: string;
  state: 'OPEN' | 'ACKNOWLEDGED';
  finding: string;
  from: string;
  executionId?: string;
  subject?: string;
  raisedAt: string;
  lastSeenAt: string;
  seen: number;
  acknowledgedBy?: string;
  basis?: string;
}

interface Coverage {
  everRun: boolean;
  sweeps: number;
  lastSweepAt?: string;
  lastSweepRead: number;
  highWaterSeq: number;
  behind: number;
  lastSweepFailed?: string;
  because: string;
}

const KIND_LABEL: Record<string, string> = {
  CHAIN_BROKEN: 'Chain',
  UNAPPROVED_EXECUTION: 'Unapproved',
  DENIED_BUT_SUCCEEDED: 'Denied, ran',
  NO_RECORDED_AUTHORITY: 'No authority',
  APPROVAL_LAPSED: 'Lapsed',
  EPHEMERAL_SIGNING_KEY: 'Signing key',
};

const getAdminHeaders = (): HeadersInit => {
  if (typeof window === 'undefined') return {};
  const key = window.localStorage.getItem('absuiteAdminApiKey')?.trim();
  return key ? { 'x-absuite-admin-key': key } : {};
};

/**
 * How much of the record the list below covers.
 *
 * Rendered before the notices, deliberately. A reader who sees the count first
 * has already formed a conclusion by the time they reach the caveat.
 */
const CoverageLine = ({ coverage, running }: { coverage: Coverage; running: boolean }) => {
  const tone = !coverage.everRun || coverage.lastSweepFailed
    ? 'UNKNOWN'
    : coverage.behind > 0 ? 'UNKNOWN' : 'DEMONSTRATED';

  return (
    <div className="rounded-xl border border-border bg-bg-primary/40 p-3.5">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Badge state={tone}>{coverage.everRun ? `${coverage.sweeps} sweep(s)` : 'never run'}</Badge>
        <Badge state={running ? 'DEMONSTRATED' : 'UNKNOWN'}>{running ? 'sweeping' : 'not sweeping'}</Badge>
        {coverage.behind > 0 && <Badge state="UNKNOWN">{coverage.behind} not yet read</Badge>}
        {coverage.lastSweepFailed && <Badge state="FAILED">last sweep failed</Badge>}
      </div>
      <p className={cn(
        'text-xs leading-relaxed',
        tone === 'DEMONSTRATED' ? 'text-text-muted' : 'text-amber-400'
      )}>
        {coverage.because}
      </p>
    </div>
  );
};

const NoticeRow = ({ notice, onAcknowledged }: { notice: Notice; onAcknowledged: () => void }) => {
  const [basis, setBasis] = useState('');
  const [who, setWho] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const acknowledge = async () => {
    setBusy(true);
    setProblem('');
    try {
      const res = await fetch(`/watch/notices/${notice.id}/acknowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...getAdminHeaders() },
        body: JSON.stringify({ by: who.trim(), basis: basis.trim() }),
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Not recorded (${res.status}).`);
      onAcknowledged();
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = who.trim().length > 0 && basis.trim().length > 0;

  return (
    <li className="rounded-xl border border-border bg-bg-primary/40 p-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-text-primary leading-snug min-w-0">{notice.finding}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge>{KIND_LABEL[notice.kind] ?? notice.kind}</Badge>
          {notice.state === 'ACKNOWLEDGED' && <Badge state="ABSENT">acknowledged</Badge>}
        </div>
      </div>

      <p className="text-[11px] text-text-muted/70 mt-2 font-mono">
        from {notice.from} · first seen {notice.raisedAt} · seen {notice.seen}×
        {notice.executionId ? ` · ${notice.executionId}` : ''}
      </p>

      {notice.state === 'ACKNOWLEDGED' ? (
        <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
          <span className="text-text-muted/70">Closed by {notice.acknowledgedBy} — </span>
          {notice.basis}
          {notice.seen > 1 && (
            <span className="text-amber-400/80">
              {' '}It has been seen {notice.seen} times, so the cause is still present. It is not re-opened —
              that was your decision to make.
            </span>
          )}
        </p>
      ) : !open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-2 px-3 py-1 rounded-full border border-border text-text-muted hover:text-text-primary text-[11px] font-medium transition-all"
        >
          Acknowledge
        </button>
      ) : (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <input
              value={who}
              onChange={event => setWho(event.target.value)}
              placeholder="Who"
              className="flex-1 min-w-[120px] rounded-lg bg-bg-secondary border border-border px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
            />
            <input
              value={basis}
              onChange={event => setBasis(event.target.value)}
              placeholder="Why this is understood"
              className="flex-[2] min-w-[200px] rounded-lg bg-bg-secondary border border-border px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              disabled={!ready || busy}
              onClick={() => void acknowledge()}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border',
                ready && !busy
                  ? 'border-[#00F58C]/40 text-[#00F58C] hover:bg-[#00F58C]/10'
                  : 'border-border text-text-muted/50 cursor-not-allowed'
              )}
            >
              Close it
            </button>
            <span className="text-[11px] text-text-muted/70">
              Kept, not deleted. The reason you give is usually the most useful sentence in this record a year from now.
            </span>
          </div>
          {problem && <Problem what={problem} />}
        </div>
      )}
    </li>
  );
};

export const WatchLayer = () => {
  const [data, setData] = useState<{ notices: Notice[]; coverage: Coverage; running: boolean } | null>(null);
  const [error, setError] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      // See the note in Approvals.tsx: a literal path, so check:routes can read it.
      const query = onlyOpen ? '?state=OPEN' : '';
      const res = await fetch('/watch' + query, { headers: getAdminHeaders() });
      const body = (await res.json()) as {
        notices?: Notice[]; coverage?: Coverage; running?: boolean;
        error?: { message?: string } | string;
      };
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Reading the watch requires your admin key. Add it under Settings → Admin API key.');
        }
        const detail = body.error;
        throw new Error((typeof detail === 'string' ? detail : detail?.message) ?? `Could not load (${res.status})`);
      }
      setData({
        notices: body.notices ?? [],
        coverage: body.coverage as Coverage,
        running: Boolean(body.running),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [onlyOpen]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <Panel
        title="What the watch has raised"
        subtitle={
          'ABSuite sweeps its own record on an interval and states what is there. It does not rank these, call any of ' +
          'them an incident, notify anybody, or say what should be done — every one of those is a judgement, and the ' +
          'judgement is yours.'
        }
        actions={
          <>
            <button
              onClick={() => setOnlyOpen(value => !value)}
              className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-all"
            >
              {onlyOpen ? 'Show closed' : 'Only open'}
            </button>
            <button
              onClick={() => void load()}
              className="px-3 py-1.5 rounded-full text-text-muted hover:text-text-primary text-xs font-medium transition-all"
            >
              Refresh
            </button>
          </>
        }
        footnote={
          'A standing problem is one notice seen many times, not a new notice each sweep — a queue that re-raises is a ' +
          'queue people turn off. Closing one keeps it: the record of what was raised, and why somebody decided it was ' +
          'understood, is part of the history of the thing it was raised about.'
        }
      >
        {error ? (
          <Problem
            title="The watch could not be read"
            what={error}
            resolvedBy="Check that CapKit is reachable and your admin key is set."
          />
        ) : data === null ? (
          <Loading what="Reading what the watch has seen…" />
        ) : (
          <div className="space-y-3">
            <CoverageLine coverage={data.coverage} running={data.running} />

            {data.notices.length === 0 ? (
              <Empty
                because={
                  data.coverage.everRun
                    ? 'The last sweep raised nothing that is still open.'
                    : 'Nothing has been raised because nothing has swept yet.'
                }
                resolvedBy={
                  data.coverage.everRun
                    ? 'A sweep finds what it knows how to look for. This is an absence of findings, not evidence that the system is well.'
                    : 'Start the service, or sweep once from POST /watch/sweep. Until then this list means nothing at all.'
                }
              />
            ) : (
              <ul className="space-y-2.5">
                {data.notices.map(notice => (
                  <NoticeRow key={notice.id} notice={notice} onAcknowledged={() => void load()} />
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <Note>
        Every notice names the field it was read from, so none of it has to be taken on this panel's
        word. The three things the watch can never tell you are which of these matters most, whether
        the list is complete, and what to do — and it is written that way on purpose.
      </Note>
    </div>
  );
};

export default WatchLayer;
