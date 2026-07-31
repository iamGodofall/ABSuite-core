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
