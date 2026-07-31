import { useEffect, useRef } from 'react';
import { Hash } from 'lucide-react';

export function CommandPalette({ isOpen, onClose, onSelectLayer }: {
  isOpen: boolean;
  onClose: () => void;
  onSelectLayer: (layer: any) => void;
  /** Reserved for opening a record directly from the palette. */
  onOpenRecord?: (id: string) => void;
  /** Every reachable view. The standing views have no orbital node, so this
      palette is the only way to them — which is the right place for things you
      go to deliberately rather than watch continuously. */
  views?: { id: string; label: string; question: string }[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelect = (layer: string) => {
    onSelectLayer(layer);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto bg-ab-bg/40 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-[500px] ab-panel border-ab-green/30 shadow-[0_0_50px_rgba(0,245,140,0.1)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="ab-panel-header mb-0">
            <span className="text-ab-green mr-2 font-bold">/</span> COMMAND PALETTE
          </div>
          <div className="text-[9px] font-mono text-ab-white/30 uppercase tracking-widest">ESC TO CLOSE</div>
        </div>

        <div className="relative mb-4">
          <input 
            ref={inputRef}
            type="text" 
            placeholder="> enter command..." 
            className="w-full bg-ab-bg border border-ab-green/20 rounded-sm px-4 py-4 text-sm font-mono text-ab-white placeholder:text-ab-white/30 focus:outline-none focus:border-ab-green/60 shadow-inner transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
            <div className="w-5 h-5 border border-ab-white/10 rounded flex items-center justify-center text-[9px] text-ab-white/40">↵</div>
          </div>
        </div>

        <div className="text-[8px] font-mono text-ab-white/40 uppercase tracking-widest mb-3">SUGGESTED COMMANDS</div>
        <div className="flex flex-col gap-1 font-mono text-xs">
          {[
             { cmd: 'observe.stream', layer: 'observe', desc: 'Open live evidence stream' },
             { cmd: 'verify.chain', layer: 'verify', desc: 'Check cryptographic proofs' },
             { cmd: 'explain.agent', layer: 'explain', desc: 'Query agent reasoning' },
             { cmd: 'govern.violations', layer: 'govern', desc: 'Show active violations' },
             { cmd: 'arbitrate.disputes', layer: 'arbitrate', desc: 'Open resolution center' },
          ].map((item, i) => (
            <div 
              key={i} 
              className="flex justify-between items-center group cursor-pointer hover:bg-ab-green/10 -mx-2 px-3 py-2 rounded transition-colors"
              onClick={() => handleSelect(item.layer)}
            >
              <span className="text-ab-white/80 group-hover:text-ab-green flex items-center gap-3">
                <Hash size={14} className="opacity-50 text-ab-green" /> {item.cmd}
              </span>
              <span className="text-ab-white/30 text-[10px]">{item.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
