import { useState, useEffect, useRef } from 'react';
import React, { type ReactNode } from 'react';
import { Scene } from './Scene';
import { OrbitalNodes, type LayerReading } from './OrbitalNodes';
import { CommandPalette } from './CommandPalette';
import { TopBar, type Vital } from './TopBar';
import { BottomBar } from './BottomBar';
import type { TrustLayer } from './SceneCube';

/**
 * The layer surface.
 *
 * The supplied version reported STATUS ACTIVE, UPTIME 99.999% and LATENCY 12ms
 * — three figures nothing had measured, in a product whose first constitutional
 * line is that nothing may look more certain than it is. They are gone. What
 * opens here is the layer's real surface: the same panels that read from
 * CapKit, Trust and Edge-Run.
 */
function LayerSurface({ layer, onClose, children }: {
  layer: TrustLayer;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  if (layer === 'overview') return null;

  return (
    <div className="absolute inset-0 z-40 flex items-stretch justify-end pointer-events-none">
      <div className="w-full lg:w-[62%] xl:w-[56%] h-full ab-panel border-l border-ab-green/20 pointer-events-auto flex flex-col bg-[#020805]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between shrink-0">
          <div className="ab-panel-header mb-0 text-ab-green flex items-center gap-2">
            <div className="w-2 h-2 bg-ab-green rounded-full shadow-[0_0_10px_rgba(0,245,140,0.8)]" />
            [ LAYER.{layer.toUpperCase()} ]
          </div>
          <button
            onClick={onClose}
            className="text-[9px] font-mono text-ab-white/40 hover:text-ab-white uppercase tracking-widest transition-colors flex items-center gap-1"
          >
            <span className="w-4 h-4 border border-ab-white/20 rounded flex items-center justify-center text-[8px] mr-1">ESC</span>
            TO CLOSE
          </button>
        </div>

        {/* ab-surface converts everything rendered inside into the supplied
            design system — see the surface layer in globals.css. */}
        <div className="ab-surface flex-1 overflow-y-auto hidden-scrollbar pr-1">{children}</div>
      </div>
    </div>
  );
}

/** The ring, in the order the stations sit on it. Dragging walks this. */
const ORBIT: TrustLayer[] = ['observe', 'verify', 'explain', 'govern', 'arbitrate', 'act', 'learn'];

export function TrustOperationsCenter({ readings, vitals, connected, version, surface, onLayerChange, onOpenRecord, views }: {
  /** Live readings per layer. Absent when the layer has nothing to report. */
  readings: Record<string, LayerReading | undefined>;
  /** The masthead's metric columns, each bound to what the instance holds. */
  vitals: Vital[];
  connected: boolean;
  /** Shown in the footer. Read from the package, not typed in. */
  version: string;
  /** The entered layer's real surface. */
  surface: (layer: TrustLayer) => ReactNode;
  onLayerChange: (layer: TrustLayer) => void;
  onOpenRecord?: (id: string) => void;
  /** Every reachable view, for the command palette. */
  views: { id: string; label: string; question: string }[];
}) {
  const [activeLayer, setActiveLayerState] = useState<TrustLayer>('overview');
  /** Entering a layer. Every route into a layer goes through this. */
  const commit = (layer: TrustLayer) => { setActiveLayerState(layer); onLayerChange(layer); };
  const setActiveLayer = commit;
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isIdle, setIsIdle] = useState(false);

  /*
   * Steering the core.
   *
   * The cube was mounted but inert: the only ways into a layer were a
   * keyboard digit and a click on a hexagon, which makes the cube a picture
   * with a menu around it. Dragging now walks the focus around the ring and
   * releasing enters the station it landed on, the wheel moves in and out of
   * depth, and a double-click dives into the core — Verify, the layer whose
   * whole subject is what is inside the record.
   */
  // Null until someone steers. A focus ring drawn before anyone has touched
  // the cube would be pointing at a station nobody chose.
  const [focused, setFocused] = useState<number | null>(null);
  const drag = useRef<{ x: number; base: number; moved: boolean } | null>(null);

  const beginDrag = (e: React.PointerEvent) => {
    if (activeLayer !== 'overview') return;
    drag.current = { x: e.clientX, base: focused ?? 0, moved: false };
  };

  const trackDrag = (e: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const dx = e.clientX - state.x;
    if (Math.abs(dx) > 6) state.moved = true;
    // One station per 90px of travel — far enough that a stray movement does
    // not reassign attention, close enough to cross the ring in one gesture.
    const next = (((state.base + Math.round(dx / 90)) % ORBIT.length) + ORBIT.length) % ORBIT.length;
    setFocused(next);
  };

  const endDrag = () => {
    const state = drag.current;
    drag.current = null;
    if (state?.moved && focused !== null) commit(ORBIT[focused]);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (isCommandPaletteOpen) return;
    // In enters what attention is on; out returns to the room. With nothing
    // focused there is nothing to enter, so scrolling in does nothing.
    if (e.deltaY < 0) { if (focused !== null) commit(ORBIT[focused]); }
    else commit('overview');
  };

  // Into the core. Verify is what is inside a record.
  const onDoubleClick = () => commit('verify');

  useEffect(() => {
    let timeoutId: number;
    const resetIdle = () => {
      setIsIdle(false);
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setIsIdle(true), 30000);
    };

    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    window.addEventListener('click', resetIdle);
    resetIdle();

    return () => {
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keydown', resetIdle);
      window.removeEventListener('click', resetIdle);
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
        } else {
          setActiveLayer('overview');
        }
      }
      
      if (e.key === '/' && !isCommandPaletteOpen) {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      }
      
      // Number shortcuts
      if (!isCommandPaletteOpen) {
        const key = e.key;
        if (key === '1') setActiveLayer('observe');
        if (key === '2') setActiveLayer('verify');
        if (key === '3') setActiveLayer('explain');
        if (key === '4') setActiveLayer('govern');
        if (key === '5') setActiveLayer('arbitrate');
        if (key === '6') setActiveLayer('act');
        if (key === '7') setActiveLayer('learn');
        if (key === '`') setActiveLayer('overview');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCommandPaletteOpen]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-ab-bg text-ab-white font-sans selection:bg-ab-green-dim selection:text-ab-green">
      
      {/* 3D Scene Layer */}
      <Scene activeLayer={activeLayer} isIdle={isIdle} connected={connected} />

      {/*
        * The gesture surface.
        *
        * Sits over the canvas and under everything else, so a drag anywhere in
        * open space steers the core while the stations and the layer surface
        * keep their own clicks.
        */}
      {activeLayer === 'overview' && (
        <div
          className="absolute inset-0 z-[5] touch-none"
          style={{ cursor: drag.current ? 'grabbing' : 'grab' }}
          onPointerDown={beginDrag}
          onPointerMove={trackDrag}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        />
      )}

      {/* UI Overlay Layer */}
      <div className={`absolute inset-0 z-10 flex flex-col pointer-events-none transition-opacity duration-1000 ${isIdle ? 'opacity-30' : 'opacity-100'}`}>
        
        <TopBar connected={connected} vitals={vitals} />
        
        <main className="flex-1 flex justify-center items-center p-6 pt-24 pb-20 overflow-hidden relative pointer-events-none">
          
          {/* HTML Overlay for Orbital Nodes on top of the 3D scene */}
          {activeLayer === 'overview' && (
             <OrbitalNodes
               activeLayer={activeLayer}
               focusedLayer={focused === null ? undefined : ORBIT[focused]}
               onSelectLayer={setActiveLayer}
               readings={readings}
             />
          )}

          <LayerSurface layer={activeLayer} onClose={() => setActiveLayer('overview')}>
            {surface(activeLayer)}
          </LayerSurface>

        </main>
        
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectLayer={setActiveLayer}
        onOpenRecord={onOpenRecord}
        views={views}
      />

      {/* The supplied footer, carrying the constitutional line. */}
      <BottomBar connected={connected} version={version} />
    </div>
  );
}
