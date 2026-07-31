/**
 * The core, as a solid.
 *
 * Until now the cube's outer face was an additive plane at 8% opacity — a
 * suggestion of a surface rather than a surface. It read as a hologram, which
 * is the right family but the wrong material: a hologram is a projection of
 * something absent, and this cube is meant to be the thing itself. Evidence
 * you can hold up to the light.
 *
 * So the shell is glass now. Not a texture of glass — actual refraction: the
 * inner geometry, the sacred solids and the particle field behind it are bent
 * through the surface, so what you see inside the cube is genuinely the cube's
 * own contents seen through its own thickness. Move it and the interior moves
 * differently from the shell, the way it does in a real object.
 *
 * Two things are deliberate and worth defending:
 *
 * The frosting. `roughness` at 0.14 rather than 0 — clear glass would give a
 * lens, and a lens shows you a distorted world rather than a held object. A
 * faint frost reads as ice, and ice is the correct association: something with
 * substance, formed rather than manufactured, that you can see into but not
 * quite through.
 *
 * The tint through thickness. `attenuationColor` means the layer's colour
 * accumulates with depth rather than being painted on the surface, so the cube
 * is pale at its edges and saturated through its middle. That is why glass
 * looks like a volume and a decal looks like a sticker — and it is also honest
 * here, because depth in this object stands for the amount of evidence you are
 * looking through.
 *
 * If the machine cannot do any of this, `supported` is false and the original
 * additive shell renders instead. See glass.ts for why that fallback exists
 * and is not optional.
 */
import * as THREE from 'three';

interface GlassShellProps {
  /** The layer's colour. The glass takes its tint from what you are looking at. */
  color: THREE.Color;
  /** False on machines that cannot render refraction smoothly. */
  supported: boolean;
  /** Idle drops the cost as well as the brightness. */
  isIdle?: boolean;
}

export function GlassShell({ color, supported, isIdle }: GlassShellProps) {
  if (!supported) {
    /*
     * The original shell, unchanged.
     *
     * This is what shipped before glass existed and what still ships wherever
     * glass cannot. It is not a degraded placeholder — it is the design that
     * the rest of the cube was built around, and it holds on its own.
     */
    return (
      <mesh>
        <boxGeometry args={[2.5, 2.5, 2.5]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.08}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    );
  }

  return (
    /*
     * Drawn before the additive stack, not after.
     *
     * The cube's luminance comes from five overlapping additive wireframes and
     * the glowing solids inside it. At a later render order the glass composited
     * over all of that and the object went dark — technically a correct pane of
     * glass in front of a lamp, and visually the lamp switched off. Drawing the
     * shell first lets the glow add on top of it, so the structure still burns
     * through the surface the way light does through ice.
     */
    <mesh renderOrder={-1}>
      <boxGeometry args={[2.5, 2.5, 2.5]} />
      <meshPhysicalMaterial
        /*
         * Transmission, not opacity.
         *
         * `transparent` + low opacity blends a flat colour over whatever is
         * behind. Transmission re-renders what is behind and refracts it, which
         * is the entire difference between a tinted pane and a solid you are
         * looking into.
         */
        transmission={1}
        /*
         * Thin, and barely attenuating.
         *
         * The first pass used thickness 1.9 against an attenuation distance of
         * 1.5, which is physically a dense block of coloured glass: it ate the
         * additive glow of the inner geometry and the cube came out a dark
         * solid. Depth here should tint, not absorb — the interior is the
         * evidence, and glass that hides its contents is the opposite of the
         * point.
         */
        thickness={0.7}
        ior={1.38}
        roughness={0.09}
        metalness={0}
        // The colour lives in the volume, not on the face — but faintly, so it
        // reads as a tint through ice rather than as stained glass.
        attenuationColor={color}
        attenuationDistance={8}
        // A cold sheen across grazing angles — the light that catches an edge
        // of ice and tells you it is solid.
        clearcoat={1}
        clearcoatRoughness={0.1}
        // Just enough to break white highlights into colour at the corners.
        iridescence={0.35}
        iridescenceIOR={1.32}
        iridescenceThicknessRange={[100, 420]}
        /*
         * A faint internal light.
         *
         * Real glass only ever shows you what is behind it, and what is behind
         * this cube is mostly empty space — so a physically perfect shell reads
         * as a dark box in a dark room. A small emissive term gives the volume
         * its own glow, which is the difference between a window and a piece of
         * lit ice.
         */
        emissive={color}
        emissiveIntensity={isIdle ? 0.012 : 0.035}
        specularIntensity={1}
        envMapIntensity={isIdle ? 0.35 : 0.9}
        transparent
        opacity={1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
