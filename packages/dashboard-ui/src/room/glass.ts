/**
 * Whether this machine can actually render glass.
 *
 * Refraction is not a material setting — it is a second render. Three renders
 * the scene behind the transmissive surface into an off-screen buffer and
 * samples that buffer to bend what is behind the glass. The whole look depends
 * on a render target the driver has to give us.
 *
 * That is the same class of thing that removed the bloom pass from this scene
 * earlier: an EffectComposer whose multisampled target could not be allocated,
 * which wrote an empty buffer over the entire render and made the cube, the
 * orbital rings and the particle field disappear. It failed at one viewport
 * and not another, on the same commit, because whether the allocation succeeds
 * depends on the machine.
 *
 * So this asks first, and asks by trying rather than by guessing. If the answer
 * is no, the cube renders the way it does today — the additive shell, intact
 * and never blank. A beautiful cube that sometimes is not there is worth less
 * than a plain one that always is.
 */
import * as THREE from 'three';

export type GlassSupport = {
  supported: boolean;
  /** Why, in a sentence, for the machine room panel. */
  reason: string;
  /** What the driver calls itself, when it will say. */
  renderer: string;
};

/**
 * The operator's override.
 *
 * `?glass=on` forces it, `?glass=off` refuses it. Not a debug flag left in by
 * accident — a real setting, because the probe is a heuristic and someone on
 * hardware it misjudges should be able to disagree with it in both directions.
 */
function override(): boolean | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('glass');
  if (value === 'on' || value === 'force') return true;
  if (value === 'off' || value === 'never') return false;
  return null;
}

export function probeGlassSupport(renderer: THREE.WebGLRenderer): GlassSupport {
  const forced = override();
  if (forced === true) return { supported: true, reason: 'forced on by ?glass=on', renderer: 'overridden' };
  if (forced === false) return { supported: false, reason: 'forced off by ?glass=off', renderer: 'overridden' };

  const gl = renderer.getContext();

  // What the driver calls itself. Software rasterisers can do transmission
  // correctly and at a handful of frames per second, which fails the only
  // requirement that matters here — that it be smooth.
  let name = 'unknown';
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (debug) name = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  } catch {
    /* Some browsers refuse to say. Treated as unknown, not as unsupported. */
  }

  if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(name)) {
    return { supported: false, reason: 'software rendering — refraction would run at a few frames per second', renderer: name };
  }

  // Then the actual question: can we allocate and bind the kind of target
  // transmission needs? Asked by allocating a tiny one and reading the
  // framebuffer's own verdict, rather than inferring it from extension strings.
  let target: THREE.WebGLRenderTarget | null = null;
  try {
    target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    renderer.setRenderTarget(previous);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      return { supported: false, reason: `the driver cannot complete a half-float render target (0x${status.toString(16)})`, renderer: name };
    }
  } catch (error) {
    return { supported: false, reason: `render target allocation threw: ${(error as Error).message}`, renderer: name };
  } finally {
    target?.dispose();
  }

  return { supported: true, reason: 'half-float render targets available on hardware', renderer: name };
}
