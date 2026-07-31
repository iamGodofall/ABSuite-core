# The Trust Operations Center — scene graph

This is the target architecture for the room, and the record of what has
already been tried against a running renderer. It exists so that the next
person to work on this — human or model — starts from what is known rather
than from what is plausible.

Three of the notes below contradict the obvious approach. Each one cost a build
and a screenshot to find, and none of them is visible by reading code.

---

## The five components

Everything else is HUD.

```
Scene
│
├── TrustUniverse
│   ├── ParticleField
│   ├── Starfield
│   └── Fog
│
├── TrustCube
│   ├── OuterGlassCube
│   ├── InnerGlassCube
│   ├── CoreLight
│   ├── CoreGeometry
│   └── VertexIndicators      ← the eight architectural layers
│
├── OrbitalSystem
│   ├── Orbit01
│   ├── Orbit02
│   ├── Orbit03
│   └── OrbitGlow
│
├── OperationNodes            ← the seven operations
│   ├── Observe   pulse()
│   ├── Verify    lock()
│   ├── Explain   expand()
│   ├── Govern    showConstraints()
│   ├── Arbitrate splitCube()
│   ├── Act       emitParticles()
│   └── Learn     growOrbit()
│
└── CameraController
```

The orbital rings stay. They are not decoration and not connective tissue —
they are the sentence *everything in ABSuite revolves around trust*, said
without words.

Two shapes for two kinds of noun, which the Constitution already argues for:
the **seven operations orbit** because they are what happens; the **eight
layers sit on the cube's corners** because they are what the thing is.

---

## What has been proven against a running renderer

### 1. Glass inside glass renders as nothing

`OuterGlassCube` and `InnerGlassCube` cannot both be `meshPhysicalMaterial`
with `transmission`. A transmissive surface is **excluded from another
transmissive surface's transmission pass**, so an ice block placed inside a
refracting shell is simply not there when you look through the shell. Building
both gets you one piece of glass and a missing one.

Verified: outer glass + inner glass → inner invisible. Outer hologram + inner
glass → inner reads correctly. The current build ships the second.

**Untested and worth testing first:** drei's `MeshTransmissionMaterial`
maintains its *own* FBO per material rather than sharing three's single
transmission pass, so it may nest where `meshPhysicalMaterial` cannot. If it
does, both cubes become possible and this note can be deleted. If it does not,
the outer surface should be a thin refractive **rim** rather than a full
transmissive volume.

### 2. The same fact explains the core sitting "on top" instead of inside

Three builds the transmission buffer from **opaque objects only**. The core is
currently additive and `transparent`, so it never enters the buffer the glass
refracts — it is drawn afterwards, on top of the surface, which is exactly what
it looks like.

The fix is the blueprint's own: an **opaque** `<Sphere />` (or icosahedron /
octahedron / torus knot) plus a real `<pointLight>`. An opaque core enters the
transmission pass and genuinely appears refracted inside the ice. The trade is
the additive glow stacking, which the light and bloom should replace.

**One rule follows from both notes: only opaque things exist to a refracting
surface.**

### 3. The post-processing stack is not free, and has already broken this scene

`EffectComposer` + `Bloom` was in this scene and was removed. It intermittently
wrote an empty buffer over the whole render — cube, orbital rings, particle
field and grid all gone, leaving only the starfield and the one mesh whose
colour is a literal white. Setting `multisampling={0}` fixed it at one viewport
and it returned at another, on the same commit, because whether the render
target allocates depends on the machine.

This is not an argument against the composer. It is an argument against
mounting it unconditionally. Bloom, DepthOfField and ChromaticAberration are
each another render target, and they must sit behind the **same capability
probe as the glass** — `src/room/glass.ts`, which refuses software rasterisers
and then allocates a half-float target and reads the framebuffer's own verdict
rather than inferring from extension strings.

A glow that sometimes deletes the instrument is worth less than a plain cube
that is always there.

---

## Two things the stack list will hit

**`<Environment preset="…">` fetches HDRIs from a CDN.** It will fail outright
under the artifact CSP, and more importantly it makes a third-party request on
every page load of a product whose subject is trust. The Google Fonts link was
removed from this repo for exactly that reason. Use `<Environment>` with
`<Lightformer>` children, or bake an environment from the scene itself with a
`CubeCamera`. Self-contained, no network.

**`leva` must be a dev dependency and must not mount in production.** A panel
of tuning controls shipping to operators is a debug surface in a product whose
first constitutional line is that nothing may look more authoritative than it
is.

---

## The rule that governs all of it

Every movement is state-driven. This is not a style preference here — it is
enforced by `pnpm check:motion`, which fails the build on any perpetual
animation nobody can name a state for, and on any animation name with no
keyframes behind it.

```ts
// Refused by doctrine.
rotation.y += 0.01;

// Required.
switch (activeOperation) {
  case 'VERIFY': targetRotation = 0; break;          // stabilises
  case 'ACT':    targetRotation = 4; break;          // accelerates
  case 'LEARN':  orbitExpansion += delta; break;     // grows
}
```

At rest the cube drifts at 0.05°/sec — one revolution every two hours, below
the threshold at which the eye reads motion — and stops completely when the
socket drops. A system that is not observing holds still.

Particle counts follow the same logic. The field is 1,200 today; 50,000 is
reasonable on hardware and impossible on the fallback path, so the count must
come from the same probe that decides the glass. Idle already slows the clock,
which is the honest way to show a system standing down — it must not drop the
draw range, because two thirds of a starfield blinking out reads as a fault.

---

## Camera

States: `LOBBY`, and one per operation. GSAP for the transitions rather than
CSS or framer-motion — the camera is a scene object, and tweening it through
the same system as the rest of the scene keeps the timing coherent.

The camera behaves as a visitor inhabiting a room, not as a page router.
`Verify` dives into the core; `Act` and `Learn` swing left so the cube sits
right; `Explain` and `Arbitrate` swing right.

---

## Where the nodes live

The seven operation nodes are currently **HTML overlays** at fixed percentage
positions, not scene objects. Moving them onto real circular splines is the
right call and is what makes them orbit rather than merely sit — but it costs
crisp DOM text. Either `<Html>` from drei, which keeps DOM text attached to a
3D position, or SDF text, which stays inside the canvas and behaves properly
under depth and refraction. The trade is legibility against belonging to the
scene; `<Html>` is the lower-risk first move.

---

## Order of work

1. `MeshTransmissionMaterial` nesting test — one build, decides note 1.
2. Opaque core + `pointLight` — fixes the light reading as on top.
3. Post-processing behind the capability probe.
4. Nodes onto splines.
5. Particle field scaled by the same probe.
6. GSAP camera states.

Nothing in this list is speculative. Each step has a way to be wrong that a
screenshot will show.
