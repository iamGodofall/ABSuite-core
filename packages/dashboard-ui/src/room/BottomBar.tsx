/**
 * The footer, as supplied.
 *
 * Deleted on the first port along with the masthead. The layout is restored:
 * the shortcut strip on the left, the meta line on the right, the same
 * gradient and hairline.
 *
 * Two corrections, both of the same kind as the masthead's.
 *
 * The supplied shortcuts advertised TAB, ENTER, SPACE and ? — four keys this
 * interface does not bind. A keyboard legend is a promise about what the
 * keyboard does, and every key listed here is one you can press right now.
 *
 * The supplied status read CONNECTED with a pulse, unconditionally. It now
 * reports the socket, and the constitutional line takes the centre — it is the
 * sentence the whole product is built around, and the footer is where a
 * reader's eye lands last.
 */
import { Check } from 'lucide-react';

const SHORTCUTS = [
  { key: '1–7', does: 'Enter layer' },
  { key: 'DRAG', does: 'Steer core' },
  { key: 'ESC', does: 'Return' },
  { key: '`', does: 'Overview' },
  { key: '/', does: 'Command palette' },
];

export function BottomBar({ connected, version }: { connected: boolean; version: string }) {
  return (
    /*
     * A three-column grid, not a justify-between row with an absolutely
     * centred line through it. The centred line and the shortcut strip were
     * laid out independently and printed straight over each other; a reserved
     * centre track cannot overlap its neighbours by construction.
     */
    <footer className="absolute bottom-0 inset-x-0 h-14 grid grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 z-20 pointer-events-none bg-gradient-to-t from-[#000000] to-transparent border-t border-ab-green/5 shadow-[0_-4px_30px_rgba(0,245,140,0.03)]">

      <div className="flex items-center gap-4 text-[9px] font-mono text-ab-white/40 tracking-widest min-w-0">
        <div className="hidden 2xl:flex items-center gap-4 overflow-hidden">
          {SHORTCUTS.map(shortcut => (
            <span key={shortcut.key} className="whitespace-nowrap">
              <span className="text-ab-white/70 mr-1.5 bg-ab-white/5 px-1.5 py-0.5 rounded-sm">{shortcut.key}</span>
              {shortcut.does}
            </span>
          ))}
        </div>
      </div>

      {/* The line the whole product is built around. */}
      <p className="hidden lg:block text-[9px] font-mono uppercase tracking-[0.18em] text-ab-green/40 whitespace-nowrap text-center">
        Nothing may look more complete, more certain, or more authoritative than it actually is.
      </p>

      <div className="flex items-center justify-end gap-8 text-[9px] font-mono text-ab-white/40">
        <span className="hidden lg:flex items-center gap-1.5 text-ab-white/30">
          <Check size={10} className="text-ab-white/30" /> ABSuite Core v{version}
        </span>
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? 'bg-ab-green shadow-[0_0_5px_#00F58C] live-pulse' : 'bg-ab-red'
            }`}
          />
          <span className={`uppercase tracking-widest ${connected ? 'text-ab-green' : 'text-ab-red'}`}>
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
      </div>
    </footer>
  );
}
