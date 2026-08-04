import { useState } from 'react';
import { Loader2, Check, ArrowRight, KeyRound } from 'lucide-react';

/**
 * The sentence the room never said.
 *
 * An instance holding nothing renders correctly and reads as broken. The rings
 * stop at exactly zero, the particle field is not drawn at all, the seven
 * stations go grey, and every one of those is the honest report of an empty
 * evidence chain. `SceneCube` says so in one line — `orbit = determination ===
 * 'ABSENT' ? 0` — deliberately, because motion is evidence and nothing had
 * happened.
 *
 * The person looking at it cannot tell that from a dead product. It fooled the
 * author of this repository, who spent four rounds hunting a rendering bug in a
 * scene that was reporting the truth perfectly.
 *
 * Stillness with an explanation is evidence. Stillness without one is a bug
 * report. That is the same rule this system applies everywhere else and had
 * never applied to itself: a determination carries the step that would settle
 * it, and UNKNOWN without a next step is a dead end wearing the costume of a
 * finding. The largest object on the screen was the one surface exempt from it.
 *
 * So this is the step, on the cube's own face, and it does the thing rather
 * than describing it.
 *
 * Two conditions produce an unreadable room, and they are not the same
 * condition — which is why this takes a mode rather than guessing:
 *
 *   `unauthorised`  This tab holds no admin key, so the evidence routes answer
 *                   403 and every station reads UNKNOWN. Nothing is wrong with
 *                   the instance. Nobody has introduced themselves to it.
 *   `empty`         The instance answered, and it holds nothing. `POST
 *                   /executions` was reachable by curl and by nothing else — a
 *                   product whose central act could only be performed by
 *                   somebody who had already read the documentation for the
 *                   thing they were evaluating.
 *
 * It removes itself the moment either condition ends, which is the whole
 * design: the only way to see this panel is to be stuck, and the only thing it
 * does is unstick you.
 */

/**
 * What gets recorded.
 *
 * Not a fictional invoice. `seed-scenario.mjs` exists for that and is candid
 * about it — invented batches, invented customers, real signatures. It is the
 * right tool for filling a room and the wrong one for the first press of a
 * button, because a stranger's first record should not be something they have
 * to later explain away.
 *
 * This describes the only event anyone can be certain occurred: an operator
 * opened this room and asked it to record. The subject really is the operator,
 * the module really is onboarding, the steps really are the three things that
 * happen — and the record is signed by the instance's own key and linked to the
 * genesis hash, because it is the first. Every claim in it is true.
 */
const FIRST_EXECUTION = {
  subject: 'operator:dashboard',
  scope: ['execution:record'],
  module: 'onboarding',
  action: 'record_first_execution',
  outcome: 'success',
  input: { source: 'trust operations center' },
  output: { recorded: true },
  steps: ['open_room', 'request_record', 'sign_and_chain'],
};

/** §5.1 of the protocol: the first record links to sixty-four zeros. */
const GENESIS = '0'.repeat(64);

/** Where Settings keeps the credential. One name, read in both places. */
const ADMIN_KEY_STORE = 'absuiteAdminApiKey';

type Phase =
  | { at: 'ready' }
  | { at: 'recording' }
  | { at: 'recorded'; id: string; genesis: boolean }
  | { at: 'refused'; title: string; detail: string };

/**
 * Why a refusal happened, said in the words of the thing that refused.
 *
 * `doing` is what the caller was attempting, because the same status code means
 * two different things here: 403 on a key someone just typed is *that key is
 * wrong*, and 403 on a record is *this tab is not carrying one*. Telling a
 * person their key was rejected when they never entered one is the interface
 * inventing a cause, which is the failure this product is named for.
 */
function refusal(
  doing: 'testing a key' | 'recording',
  status: number,
  body: { error?: string; message?: string },
): { title: string; detail: string } {
  if (status === 403 || status === 401) {
    return doing === 'testing a key'
      ? {
          title: 'That key was not accepted',
          detail:
            'The instance answered, and it does not recognise this value. It wants ABSUITE_ADMIN_API_KEY exactly as it ' +
            'appears in the .env the server was started with — no quotes, no trailing space. Nothing has been saved.',
        }
      : {
          title: 'This tab is not authorised to write',
          detail:
            'Recording appends to a chain that cannot be edited afterwards, so the instance will not take it from an ' +
            'unauthenticated caller. Open Settings — press / then type settings — and enter the admin key.',
        };
  }
  if (status === 503) {
    return {
      title: 'Writes are disabled on this instance',
      detail: body.message ?? 'ABSUITE_ADMIN_API_KEY is not configured on the server, so it will not accept a write from anyone.',
    };
  }
  if (status === 502) {
    return {
      title: 'CapKit is not answering',
      detail: 'The dashboard reached for the service that holds the evidence chain and got nothing back. Nothing was recorded, and nothing was assumed.',
    };
  }
  return {
    title: `The instance refused, ${status}`,
    detail: body.message ?? body.error ?? 'No reason was given. Nothing was recorded.',
  };
}

export function FirstRecord({ mode, headers, onChanged, onHoldOpen }: {
  /** Which of the two unreadable rooms this is. They have different exits. */
  mode: 'unauthorised' | 'empty';
  /** The admin credential this tab holds, if it holds one. */
  headers: HeadersInit;
  /** Something changed that the instruments would read differently. Re-read now. */
  onChanged: () => void;
  /**
   * Keep this panel mounted past the condition that summoned it, or stop.
   *
   * The confirmation cannot survive on its own: `onChanged` flips the room out
   * of ABSENT, which is the very condition the parent mounts this on, so the
   * success message would be written and unmounted in the same frame. The panel
   * is the only thing that knows it still has something to say.
   */
  onHoldOpen: (hold: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ at: 'ready' });
  const [key, setKey] = useState('');

  /*
   * Introducing yourself to the instance, from the room.
   *
   * Tried before it is stored, against the route the room actually reads. A
   * key that is saved and then silently rejected leaves someone pressing a
   * button that appears to do nothing — the interface would be waiting for a
   * poll to disagree with it, and the poll has no way to say *that key was
   * wrong* rather than *still nothing*.
   *
   * It writes the same localStorage entry Settings writes, under the same name.
   * Two stores of one secret can only ever disagree.
   */
  const saveKey = async () => {
    const candidate = key.trim();
    if (typeof window === 'undefined' || !candidate) return;
    setPhase({ at: 'recording' });
    try {
      const res = await fetch('/executions/stats?windowHours=24', { headers: { 'x-absuite-admin-key': candidate } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPhase({ at: 'refused', ...refusal('testing a key', res.status, body) });
        return;
      }
      window.localStorage.setItem(ADMIN_KEY_STORE, candidate);
      setKey('');
      setPhase({ at: 'ready' });
      onChanged();
    } catch {
      setPhase({
        at: 'refused',
        title: 'The request did not arrive',
        detail: 'The dashboard could not be reached from this tab, so the key was not tried and has not been saved.',
      });
    }
  };

  const record = async () => {
    setPhase({ at: 'recording' });
    try {
      const res = await fetch('/executions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...FIRST_EXECUTION, startedAt: new Date().toISOString() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setPhase({ at: 'refused', ...refusal('recording', res.status, body) }); return; }
      /*
       * Read from the record that came back, not asserted.
       *
       * The first draft displayed a sequence number the API does not return. It
       * would have rendered nothing forever and nobody would have noticed,
       * which is the quiet form of the failure this product exists to catch.
       * `prevHash` is genuinely in the response, and comparing it to the genesis
       * hash is how the record itself says it is the first link.
       */
      setPhase({ at: 'recorded', id: String(body.id ?? ''), genesis: body.prevHash === GENESIS });
      /*
       * The room lights up immediately and this panel stays for a moment.
       *
       * Without the hold the confirmation was unreachable code: `onChanged`
       * flips the determination away from ABSENT, the mount condition goes
       * false, and the panel is gone in the same frame it was written into —
       * a sentence that renders for nobody, ever. Caught by taking a screenshot
       * of the thing rather than by reasoning about it.
       */
      onHoldOpen(true);
      onChanged();
      window.setTimeout(() => onHoldOpen(false), 7000);
    } catch {
      setPhase({
        at: 'refused',
        title: 'The request did not arrive',
        detail: 'The dashboard could not be reached from this tab. Nothing was recorded — a write that cannot be sent is not a write that failed silently.',
      });
    }
  };

  /*
   * The manual route, built from the address this tab is actually on.
   *
   * Not a hardcoded localhost: the browser cannot know where the server is, and
   * a compiled-in hostname is a guess rendered as a fact — the same class of
   * error that once had Settings dialling itself once per service and reporting
   * five healthy services as connection-refused.
   */
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className="absolute inset-0 z-[8] flex items-center justify-center px-6 pointer-events-none">
      <div className="ab-panel ab-glass w-full max-w-[30rem] pointer-events-auto !p-6">

        {/*
          * State before explanation, on this surface as on every other, and
          * the reading has to move when the state does.
          *
          * Three readings, not one. Zero records held is a measurement; a dash
          * is the absence of one; and after a write, `0` is simply stale — the
          * masthead behind this panel already read 1 while the panel still
          * said 0, which is the interface disagreeing with itself on screen.
          *
          * `1` is claimed only where the record proves it: a `prevHash` of
          * sixty-four zeros is the chain saying this is its first link. Without
          * that, all this panel witnessed is one record added, so that is all
          * it says.
          */}
        <div className="flex items-baseline gap-4 border-b border-ab-green/10 pb-3 mb-4">
          <span
            className={`font-mono text-[34px] leading-none tabular-nums ${
              phase.at === 'recorded' ? 'text-ab-green' : 'text-ab-white/25'
            }`}
          >
            {phase.at === 'recorded' ? (phase.genesis ? '1' : '+1') : mode === 'empty' ? '0' : '—'}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-ab-white/40">
            {phase.at === 'recorded'
              ? (phase.genesis ? 'Records held' : 'Record added')
              : mode === 'empty' ? 'Records held' : 'Evidence not readable from this tab'}
          </span>
        </div>

        {phase.at === 'refused' ? (
          <>
            <p className="text-[13px] leading-relaxed text-ab-white/85">{phase.title}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ab-white/55">{phase.detail}</p>
            <button
              type="button"
              onClick={() => (mode === 'unauthorised' ? setPhase({ at: 'ready' }) : record())}
              className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-ab-green/70 hover:text-ab-green transition-colors"
            >
              Try again
            </button>
          </>
        ) : phase.at === 'recorded' ? (
          <>
            <p className="text-[13px] leading-relaxed text-ab-white/80">
              <span className="text-ab-green">Recorded.</span> Signed with this instance&rsquo;s own key
              {phase.genesis && <> and linked to the genesis hash, which makes it link one</>}. The core is lit,
              the stations have something to report, and the rings are turning — because now something has
              happened.
            </p>
            {phase.id && (
              <p className="mt-3 font-mono text-[10px] text-ab-white/40 break-all">{phase.id}</p>
            )}
          </>
        ) : mode === 'unauthorised' ? (
          <>
            <p className="text-[13px] leading-relaxed text-ab-white/85">
              The services are answering. The evidence chain is not, because this browser is not carrying a
              credential for it — so every station reads UNKNOWN, which means <span className="text-ab-white/90">nothing
              has been asked</span>, not that anything failed.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ab-white/55">
              Paste the value of <span className="font-mono text-ab-white/70">ABSUITE_ADMIN_API_KEY</span> from the
              <span className="font-mono text-ab-white/70"> .env</span> this instance was started with. It is kept in
              this browser only and never sent anywhere but this instance.
            </p>

            <div className="mt-4 flex gap-2">
              <input
                type="password"
                value={key}
                onChange={event => setKey(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') saveKey(); }}
                placeholder="ABSUITE_ADMIN_API_KEY"
                aria-label="Admin API key"
                className="flex-1 min-w-0 rounded-[var(--ab-radius-pill)] border border-ab-white/10 bg-black/40 px-4 py-2.5 font-mono text-[11px] text-ab-white placeholder:text-ab-white/25 focus:border-ab-green/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={saveKey}
                disabled={!key.trim() || phase.at === 'recording'}
                className="shrink-0 flex items-center gap-2 rounded-[var(--ab-radius-pill)] border border-ab-green/30 bg-ab-green/[0.07] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ab-green transition-colors hover:bg-ab-green/[0.13] disabled:opacity-40"
              >
                {phase.at === 'recording'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <KeyRound className="w-3.5 h-3.5" />} Use
              </button>
            </div>

            <p className="mt-4 pt-4 border-t border-ab-white/[0.06] text-[11px] leading-relaxed text-ab-white/45">
              No key to hand? The room is still honest without one — it will keep reporting UNKNOWN rather than
              filling the gap with a figure. Settings holds the same field, under <span className="font-mono text-ab-white/70">/</span> then
              <span className="font-mono text-ab-white/70"> settings</span>.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-ab-white/85">
              The room is still because nothing has happened in it. That is the reading, not a fault — this
              instance will not animate activity it does not have.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-ab-white/55">
              Record one execution and the core lights, the seven stations take a colour, and the rings turn at
              the rate the evidence earns.
            </p>

            <button
              type="button"
              onClick={record}
              disabled={phase.at === 'recording'}
              className="mt-5 w-full flex items-center justify-between gap-3 rounded-[var(--ab-radius-pill)] border border-ab-green/30 bg-ab-green/[0.07] px-5 py-3 text-left transition-colors hover:bg-ab-green/[0.13] disabled:opacity-50"
            >
              <span>
                <span className="block font-mono text-[11px] uppercase tracking-[0.18em] text-ab-green">
                  Record the first execution
                </span>
                <span className="block mt-1 text-[11px] text-ab-white/45">
                  One real record: this room, opened by you, now.
                </span>
              </span>
              {phase.at === 'recording'
                ? <Loader2 className="w-4 h-4 shrink-0 text-ab-green animate-spin" />
                : <ArrowRight className="w-4 h-4 shrink-0 text-ab-green/60" />}
            </button>

            {/*
              * The two routes that are not this button.
              *
              * A product that can only be started by its own button is a demo.
              * Both of these are what an actual deployment does, and naming them
              * here is how someone learns the shape of the API without leaving
              * the screen they are on.
              */}
            <div className="mt-5 pt-4 border-t border-ab-white/[0.06] space-y-3">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-ab-white/35">From an agent</p>
                <pre className="mt-1.5 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-ab-green/70">
{`curl -X POST ${origin}/executions \\
  -H "x-absuite-admin-key: $ABSUITE_ADMIN_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"subject":"agent:invoicing","module":"payments",
       "action":"approve_batch","outcome":"success"}'`}
                </pre>
              </div>
              <div className="flex items-start gap-2">
                <Check className="w-3 h-3 mt-1 shrink-0 text-ab-white/30" />
                <p className="text-[11px] leading-relaxed text-ab-white/45">
                  For a full worked day — nine actions, four agents, one failure and one unscoped call —
                  run <span className="font-mono text-ab-white/70">pnpm seed</span>. The signatures are real;
                  the business events are invented, and it says so.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
