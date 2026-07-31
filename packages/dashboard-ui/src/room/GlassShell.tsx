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
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

interface GlassShellProps {
  /** The layer's colour. The glass takes its tint from what you are looking at. */
  color: THREE.Color;
  /** False on machines that cannot render refraction smoothly. */
  supported: boolean;
  /** Idle drops the cost as well as the brightness. */
  isIdle?: boolean;
  /** Edge length. The outer shell is 2.5; the inner block is 1.8. */
  size?: number;
  /**
   * How frosted. The outer shell stays clear enough to see the whole interior
   * through; the inner block is frostier, because it is the piece you are meant
   * to read as a held object rather than as a window.
   */
  roughness?: number;
  /** How much light the volume gives off on its own. */
  emissive?: number;
  /** Rendered without a fallback where the fallback would be a duplicate. */
  fallback?: boolean;
}

export function GlassShell({
  color,
  supported,
  isIdle,
  size = 2.5,
  roughness = 0.09,
  emissive = 0.035,
  fallback = true,
}: GlassShellProps) {
  if (!supported && !fallback) return null;

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
        <boxGeometry args={[size, size, size]} />
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
    /*
     * Rounded, not sharp.
     *
     * Ice has no razor edges — it is formed, not machined, and a 90-degree
     * corner is the single clearest tell that a shape came out of a modelling
     * package. A 2% fillet also gives the edges somewhere to catch a highlight,
     * which is most of what makes a solid read as solid.
     */
    <RoundedBox renderOrder={-1} args={[size, size, size]} radius={size * 0.022} smoothness={6}>
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
        /*
         * Frostier by default.
         *
         * 0.09 is polished glass. Ice scatters — it is translucent solid, not a
         * window, and the surface has to break the light for the eye to read it
         * as frozen rather than as manufactured.
         */
        roughness={Math.max(roughness, 0.28)}
        metalness={0}
        // The colour lives in the volume, not on the face — but faintly, so it
        // reads as a tint through ice rather than as stained glass.
        /*
         * The ice is ice-coloured; the light inside carries the layer.
         *
         * Tinting the volume with the layer colour was wrong and it is why this
         * read as stained glass. Real ice is a pale blue-white regardless of
         * what is lit behind it — the colour you see through a block comes from
         * the source, not the block.
         */
        attenuationColor={'#E6F7FF'}
        attenuationDistance={6}
        /*
         * No clearcoat. This is the mirror parameter.
         *
         * Clearcoat is a polished lacquer layer — it is literally what makes
         * car paint and showroom glass look mirrored, and it is the single
         * biggest reason this reads as glass rather than as ice. Ice has no
         * lacquer on it. I identified this once and then lost it restoring
         * these files after an unrelated revert, which is why the mirror came
         * back after being diagnosed.
         */
        clearcoat={0}
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
        emissiveIntensity={isIdle ? emissive * 0.35 : emissive}
        specularIntensity={1}
        envMapIntensity={isIdle ? 0.35 : 0.9}
        transparent
        opacity={1}
        side={THREE.DoubleSide}
      />
    </RoundedBox>
  );
}
