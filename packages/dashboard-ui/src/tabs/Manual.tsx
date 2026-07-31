/**
 * How to move around, written down.
 *
 * A room has no menu bar, which is the point and is also the problem: the seven
 * operations answer to the number keys, the cube is steered by dragging, and
 * everything else lives behind a slash. None of that is discoverable by
 * looking, and the footer can only carry four hints before it becomes a menu
 * bar by another name.
 *
 * So this is the manual, reachable the same way everything else is. It is
 * deliberately about *navigation and what the words mean*, not a feature tour —
 * someone who knows what ABSENT means and how to reach Replay can find the rest
 * themselves, and a tour would go stale the first time a panel moved.
 */
const KEYS: { keys: string[]; does: string }[] = [
  { keys: ['1', '–', '7'], does: 'Enter an operation directly, from anywhere. Observe, Verify, Explain, Govern, Arbitrate, Act, Learn — in the order trust is built.' },
  { keys: ['/'], does: 'Open the command palette. Every view lives here, including the ones with no station on the ring.' },
  { keys: ['Esc'], does: 'Leave whatever you entered and return to the room.' },
  { keys: ['`'], does: 'Back to the overview — the whole room, nothing entered.' },
  { keys: ['↑', '↓'], does: 'Move the selection inside the palette.' },
  { keys: ['↵'], does: 'Enter the selected view.' },
];

const GESTURES: { gesture: string; does: string }[] = [
  { gesture: 'Drag the core', does: 'Walks the focus around the ring of stations. Release to enter the one it landed on.' },
  { gesture: 'Wheel', does: 'Moves in and out of depth.' },
  { gesture: 'Double-click the core', does: 'Dives into Verify — the layer whose whole subject is what is inside the record.' },
  { gesture: 'Click a station', does: 'Enters it directly.' },
];

const WORDS: { word: string; means: string }[] = [
  { word: 'DEMONSTRATED', means: 'Checked, and it held. The strongest thing this system says.' },
  { word: 'FAILED', means: 'Checked, and it did not hold. A real negative result, not an error.' },
  { word: 'UNKNOWN', means: 'Not resolved. Nobody has asked, or the answer could not be reached. Never rounded to either side.' },
  { word: 'ABSENT', means: 'Nothing recorded. Different from zero, which is a measurement.' },
];

export function Manual() {
  return (
    <div className="space-y-6 max-w-3xl">
      <section>
        <p className="text-sm text-text-muted leading-relaxed">
          ABSuite is not software you browse. There is one canvas, a core at the
          centre, and seven stations around it. You do not scroll between places
          — you enter one, look, and come back. Everything below is the whole of
          how to move.
        </p>
      </section>

      <section>
        <h3 className="text-[10px] font-mono uppercase tracking-[0.24em] text-text-muted mb-3">Keys</h3>
        <div className="space-y-2">
          {KEYS.map(row => (
            <div key={row.keys.join('')} className="flex items-baseline gap-4">
              <span className="flex gap-1 shrink-0 w-24">
                {row.keys.map(key => (
                  <kbd key={key} className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-ab-white/20 text-ab-white/70">{key}</kbd>
                ))}
              </span>
              <span className="text-xs text-text-muted">{row.does}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-mono uppercase tracking-[0.24em] text-text-muted mb-3">The cube</h3>
        <div className="space-y-2">
          {GESTURES.map(row => (
            <div key={row.gesture} className="flex items-baseline gap-4">
              <span className="font-mono text-[11px] text-ab-green shrink-0 w-44">{row.gesture}</span>
              <span className="text-xs text-text-muted">{row.does}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted leading-relaxed">
          The eight corners are not decoration. They are the eight architectural
          layers from the constitution, and each one is lit by what that document
          says is built — bright for built, amber for partly, grey for not yet.
          Promoting a layer on screen requires promoting it in the document,
          which is checked at build time.
        </p>
      </section>

      <section>
        <h3 className="text-[10px] font-mono uppercase tracking-[0.24em] text-text-muted mb-3">The four words</h3>
        <p className="text-xs text-text-muted mb-3 leading-relaxed">
          Every reading in this interface is one of four states, never two. True
          and false are claims about the world; this system only makes claims
          about evidence.
        </p>
        <div className="space-y-2">
          {WORDS.map(row => (
            <div key={row.word} className="flex items-baseline gap-4">
              <span className="font-mono text-[11px] text-ab-green shrink-0 w-36">{row.word}</span>
              <span className="text-xs text-text-muted">{row.means}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-[10px] font-mono uppercase tracking-[0.24em] text-text-muted mb-3">If everything says UNKNOWN</h3>
        <p className="text-xs text-text-muted leading-relaxed">
          Then this copy has nothing behind it, and it is saying so rather than
          inventing figures to look complete. A published single-file copy can
          never be live — there are no services on the other side of it. Run{' '}
          <code className="font-mono text-ab-green">pnpm room</code> for the
          whole stack, then{' '}
          <code className="font-mono text-ab-green">pnpm seed</code> to give it a
          day of signed records to read, and the same screen fills with evidence.
        </p>
      </section>
    </div>
  );
}
