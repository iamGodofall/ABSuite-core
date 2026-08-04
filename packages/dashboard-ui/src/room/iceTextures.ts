/**
 * Ice, generated rather than downloaded.
 *
 * The cube reads as mirrored glass rather than ice, and the reason is that its
 * surface is perfectly uniform. Real ice is unevenly frosted — the micro-facets
 * catch light differently across a face, and that irregularity is the entire
 * signal the eye uses to tell "frozen" from "manufactured". A single roughness
 * number can only ever produce polished glass.
 *
 * The usual fix is an HDRI or a texture set from a CDN, and this product cannot
 * do that. `<Environment preset="…">` fetches from polyhaven; a trust product
 * making third-party requests on every page load is not defensible, and the
 * Google Fonts link was already removed from this repo for exactly that reason.
 *
 * So the maps are drawn at runtime onto a 2D canvas and handed to the GPU as
 * `CanvasTexture`. No network, no assets, no CSP exemption, and deterministic
 * from a fixed seed — the same surface every time, on every machine, which is
 * the only kind of "generated" this codebase is allowed to ship.
 *
 * The technique is adapted from MilindBadsar/threejs-3d-cube, which builds its
 * cube's gradient and brushed-metal faces the same way. That project draws
 * decorative textures; the same mechanism here carries physical data.
 */
import * as THREE from 'three';

/**
 * A small deterministic PRNG.
 *
 * `Math.random()` would give a different surface on every reload, which is both
 * a fabrication in the sense this codebase means it — a value nobody chose,
 * varying with no cause — and impossible to review, because no two screenshots
 * would match. Mulberry32 from a fixed seed is reproducible everywhere.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothed value noise on a grid, sampled bilinearly. */
function valueNoise(size: number, cells: number, rand: () => number): Float32Array {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  const out = new Float32Array(size * size);
  const step = cells / size;
  const smooth = (t: number) => t * t * (3 - 2 * t);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x * step;
      const gy = y * step;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const i00 = grid[y0 * (cells + 1) + x0];
      const i10 = grid[y0 * (cells + 1) + x0 + 1];
      const i01 = grid[(y0 + 1) * (cells + 1) + x0];
      const i11 = grid[(y0 + 1) * (cells + 1) + x0 + 1];
      const top = i00 + (i10 - i00) * fx;
      const bot = i01 + (i11 - i01) * fx;
      out[y * size + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

/** Several octaves, so the frost has both broad patches and fine grain. */
function fractalNoise(size: number, seed: number): Float32Array {
  const rand = seeded(seed);
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (const cells of [4, 9, 18, 36]) {
    const layer = valueNoise(size, cells, rand);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amplitude;
    total += amplitude;
    amplitude *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

const SIZE = 256;

function toTexture(draw: (data: Uint8ClampedArray) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(SIZE, SIZE);
  draw(image.data);
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export interface IceMaps {
  /** Where the surface is frosted and where it is clear. */
  roughnessMap: THREE.Texture;
  /** The micro-facets. This is what stops it reading as a mirror. */
  normalMap: THREE.Texture;
  /** Uneven depth, so the tint through the volume is not uniform. */
  thicknessMap: THREE.Texture;
  /** Every texture created here, for disposal. */
  dispose: () => void;
}

/**
 * Build the three maps once.
 *
 * Costs roughly a millisecond and happens at mount. The caller owns them and
 * must call `dispose()` — a `CanvasTexture` is GPU memory that React's
 * reconciler does not know about and will not free.
 */
/**
 * Light that has passed through the ice, landing on the floor.
 *
 * A caustic is the give-away that an object is genuinely transmissive rather
 * than merely translucent — it is the light the block has bent, arriving
 * somewhere else. Without one the cube floats on a background; with one it is
 * an object in a room.
 *
 * Drawn as overlapping radial gradients with thin bright rings, which is the
 * cheap approximation every real-time renderer uses, seeded so the pattern is
 * the same on every machine.
 */
export function createCausticTexture(): THREE.CanvasTexture {
  const size = 512;
  const rand = seeded(0xCA05);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 60; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = rand() * 50 + 10;

    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // The thin bright ring is what makes it read as focused light rather than
    // as a smudge.
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // A soft centre, so the pattern is brightest directly beneath the cube and
  // falls off — the light has a source and the floor should say where.
  const c = size / 2;
  const falloff = ctx.createRadialGradient(c, c, 0, c, c, size / 2.2);
  falloff.addColorStop(0, 'rgba(255,255,255,1)');
  falloff.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(c, c, size / 2.2, 0, Math.PI * 2);
  ctx.fillStyle = falloff;
  ctx.fill();

  return new THREE.CanvasTexture(canvas);
}

/**
 * A round particle with its light on the inside.
 *
 * `pointsMaterial` draws squares. Every point in this scene was a little
 * rectangle, which at small sizes reads as pixel noise rather than as anything
 * physical — and a square is the one shape that cannot be a mote of light.
 *
 * This is a radial falloff: a bright centre, a soft shoulder, transparent at
 * the rim. That does two jobs at once — the alpha makes the point circular, and
 * the gradient gives it the inner glow, so each particle looks lit from within
 * rather than filled in flat. One texture, no shader, no asset.
 */
export function createPointSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  // A small, near-solid core so the point still has a definite centre...
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  // ...then a long soft shoulder, which is what reads as glow rather than blur.
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createIceMaps(): IceMaps {
  const height = fractalNoise(SIZE, 0x1CE);

  const roughnessMap = toTexture(data => {
    for (let i = 0; i < SIZE * SIZE; i++) {
      // Frost varies between roughly 0.18 and 0.62 — never mirror-smooth, never
      // fully matte. Uniform roughness is the thing that reads as manufactured.
      const value = 30 + height[i] * 70;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
  });

  const normalMap = toTexture(data => {
    // Sobel over the same height field, so the facets agree with the frost
    // rather than being a second, unrelated pattern.
    const at = (x: number, y: number) =>
      height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
    const strength = 1.1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const length = Math.hypot(dx, dy, 1);
        const i = (y * SIZE + x) * 4;
        data[i] = ((-dx / length) * 0.5 + 0.5) * 255;
        data[i + 1] = ((-dy / length) * 0.5 + 0.5) * 255;
        data[i + 2] = (1 / length) * 255;
        data[i + 3] = 255;
      }
    }
  });

  const thicknessMap = toTexture(data => {
    for (let i = 0; i < SIZE * SIZE; i++) {
      // Inverted, so the frosted patches read as the thin places — which is how
      // ice actually forms, cloudiest where it is shallowest.
      const value = 255 - height[i] * 150;
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
  });

  return {
    roughnessMap,
    normalMap,
    thicknessMap,
    dispose: () => {
      roughnessMap.dispose();
      normalMap.dispose();
      thicknessMap.dispose();
    },
  };
}

/**
 * A radial falloff on black, for geometry that has to be opaque.
 *
 * three builds the transmission buffer from opaque objects only, so everything
 * transparent is invisible through a refracting surface. The core's three
 * additive shells are exactly that — they carry the whole gradient that makes it
 * read as a light rather than a painted disc, and on a machine where glass
 * actually renders, none of them exist. What arrives through the ice is the one
 * opaque sphere at the centre: a hard-edged white blob.
 *
 * This is the way round it. A radial gradient that reaches pure black at its
 * rim, drawn on an opaque billboard, is indistinguishable from a glow against a
 * dark ground — and being opaque, it enters the buffer and survives the glass.
 * The falloff is in the pixels rather than in the blending, which is the only
 * kind a transmission pass can see.
 */
/**
 * The same point sprite, with its falloff in pixels instead of in alpha.
 *
 * `createPointSprite` puts the glow in the alpha channel, which forces the
 * material to be `transparent` — and three builds the transmission buffer from
 * **opaque objects only**, the rule stated in docs/SCENE-GRAPH.md. So on a
 * machine that renders glass, the particle field did not exist. Not dimmed:
 * absent. Reported by the one person looking at it on real hardware, who said
 * the particles disappeared when the cube became realistic, and was exactly
 * right about both the symptom and the moment.
 *
 * This is the technique `createRadianceMap` already uses for the core, applied
 * to the field the core sits in: fill black everywhere first, then draw the
 * white gradient over it. The glow ends up in RGB, the rim reaches the scene's
 * own ground, and the sprite is fully opaque — so it enters the buffer the
 * glass reads and survives refraction.
 *
 * Against a dark ground the square edge is invisible, which is the same trade
 * the radiance billboard makes and the same risk: on a light ground it would
 * read as a panel. This room has no light ground.
 */
export function createOpaquePointSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  // Black first, and everywhere — the rim must reach the ground or the sprite's
  // square becomes a visible tile.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // The same stops as createPointSprite, so the field reads identically with
  // and without glass. Alpha here composites against the black beneath rather
  // than against the scene, which is what moves the falloff into RGB.
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createRadianceMap(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  // Black first, and everywhere: the rim must reach the scene's own ground or
  // the billboard's square edge becomes visible as a dark panel.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  /*
   * A halo around the body, not a disc over it.
   *
   * This used to peak at full white in the very centre, which was right when
   * the billboard *was* the core. It is wrong now that there is a body inside
   * it: the plane passes through the sphere's centre, the sphere's silhouette
   * covers exactly the inner third of it, and a white centre paints over the
   * one part of the core that has any shape — the terminator, the rim and the
   * key highlight, all of it, behind a flat wash. The unlit core reads as a
   * physical object and the lit one reads as a smear, and the difference was
   * never the geometry. They are the same mesh.
   *
   * So the centre is dark and the peak sits at 0.33 — the body's own edge —
   * with the long shoulder outward. That is what bloom does around a bright
   * object: it hugs the silhouette and falls away. The dark middle is never
   * seen, because the body is in front of it.
   */
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  /*
   * Dimmed out to 0.33 — the body's silhouette — then peaking just past it.
   *
   * A halo that peaks *on* the edge blurs the edge, and the object goes back to
   * being a smudge. The bloom has to be quietest where the body is, so the
   * silhouette is read against something darker than itself.
   *
   * Dimmed, not black. A hole in the middle of a glow is visible as a hole on
   * the machines that do not render glass, where the body is smaller on screen
   * and the additive shells sit over it: the core read as a target, with a dark
   * ring inside a bright one. 0.18 is low enough to leave the edge its contrast
   * and high enough that there is nothing to notice.
   */
  gradient.addColorStop(0.0, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(0.30, 'rgba(255,255,255,0.20)');
  gradient.addColorStop(0.36, 'rgba(255,255,255,0.60)');
  gradient.addColorStop(0.50, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(0.72, 'rgba(255,255,255,0.07)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
