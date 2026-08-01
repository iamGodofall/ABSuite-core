import { Canvas, useFrame } from '@react-three/fiber';
import { useState } from 'react';
import { probeGlassSupport, type GlassSupport } from './glass';
import { SceneCube, type TrustLayer, type CubeEvidenceState } from './SceneCube';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

interface SceneProps {
  /** The claim the core expresses. Passed straight through to the cube. */
  evidence?: CubeEvidenceState;
  activeLayer: TrustLayer;
  isIdle?: boolean;
  /** Replaying a record: the room stops rather than merely slowing. */
  witnessing?: boolean;
  connected?: boolean;
}

function CameraController({ activeLayer }: { activeLayer: TrustLayer }) {
  useFrame((state, delta) => {
    // Determine target position based on layer
    let targetZ = 8;
    let targetY = 3.5;
    let targetX = 0;
    
    if (activeLayer === 'overview') {
       targetZ = 8;
       targetY = 3.5;
       targetX = 0;
    } else if (activeLayer === 'verify') {
       // Dive inside the core
       targetZ = 1.2;
       targetY = 0;
       targetX = 0;
    } else if (activeLayer === 'observe') {
       targetZ = 5;
       targetY = -1.5;
       targetX = 0;
    } else if (activeLayer === 'govern') {
       targetZ = 6;
       targetY = 2;
       targetX = 0;
    } else if (activeLayer === 'act' || activeLayer === 'learn') {
       targetZ = 5;
       targetY = 1;
       targetX = -2; // Move camera left -> cube appears on the right
    } else if (activeLayer === 'explain' || activeLayer === 'arbitrate') {
       targetZ = 5;
       targetY = 1;
       targetX = 2; // Move camera right -> cube appears on the left
    }
    
    const targetPos = new THREE.Vector3(targetX, targetY, targetZ);
    
    // Smoothly interpolate camera position
    state.camera.position.lerp(targetPos, delta * 3);
    
    // Keep looking at the center
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

export function Scene({ activeLayer, isIdle, witnessing = false, connected = true, evidence }: SceneProps) {
  /*
   * Asked once, when the context exists, and never again.
   *
   * Probing per frame would be a per-frame allocation for an answer that
   * cannot change; probing before the canvas mounts is impossible, because the
   * question is about a renderer that does not exist yet.
   */
  const [glass, setGlass] = useState<GlassSupport | null>(null);

  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      {/*
        * An opaque clear colour, not a transparent canvas.
        *
        * Every material in this scene uses additive blending, which adds the
        * fragment to whatever is already in the buffer. Against a transparent
        * buffer there is nothing to add to, and the whole cube composites away
        * to almost nothing — which is exactly what happened the first time this
        * was mounted here: the orbital rings survived and the core did not.
        */}
      <Canvas
        camera={{ position: [0, 0, 7], fov: 45 }}
        /*
         * Device pixel ratio, clamped — adopted from
         * MilindBadsar/threejs-3d-cube, which clamps it the same way.
         *
         * Unclamped, a retina display at DPR 3 renders nine times the pixels of
         * a DPR 1 screen, and this scene is refraction plus a particle field —
         * exactly the workload that cannot afford it. Above 2 the difference is
         * not visible and the frame cost is.
         */
        dpr={[1, 2]}
        /*
         * No tone mapping.
         *
         * R3F v9 defaults to ACES filmic, which is right for a lit PBR scene
         * and wrong for this one: every material here is additive and
         * low-opacity, and ACES crushed the whole cube and the starfield to
         * black while leaving the brighter orbital rings visible. The symptom
         * was a scene that rendered without error and showed almost nothing.
         */
        gl={{ alpha: false, antialias: true, toneMapping: THREE.NoToneMapping }}
        onCreated={({ gl }) => {
          gl.setClearColor('#05070A', 1);
          setGlass(probeGlassSupport(gl));
        }}
      >
        <fog attach="fog" args={['#000000', 5, 25]} />
        <ambientLight intensity={0.2} />
        
        {/* Deep space environment */}
        <Stars radius={100} depth={50} count={isIdle ? 1000 : 5000} factor={4} saturation={0} fade speed={isIdle ? 0.2 : 1} />
        
        {/* Background Grid */}
        <gridHelper args={[100, 100, '#00F58C', '#00F58C']} material-opacity={0.03} material-transparent rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -15]} />
        
        {/* Lights the glass needs. The additive shell needed none, so these
            arrive with refraction: a key to catch the near faces and a cold
            rim to separate the far edge from the field behind it. */}
        {/* Witness takes the key light down further than idle does. The room is
            not asleep — it is being read by lamplight while something older is
            recounted, and the record on screen should be the brightest thing. */}
        <directionalLight position={[4, 6, 5]} intensity={witnessing ? 0.28 : isIdle ? 0.5 : 1.15} color="#DFFFF2" />
        <directionalLight position={[-6, -2, -4]} intensity={witnessing ? 0.12 : isIdle ? 0.2 : 0.5} color="#3FE8FF" />

        <SceneCube
          evidence={evidence}
          activeLayer={activeLayer}
          isIdle={isIdle}
          witnessing={witnessing}
          connected={connected}
          glass={glass?.supported ?? false}
        />
        <CameraController activeLayer={activeLayer} />
        
        {/*
          * No post-processing pass.
          *
          * The scene carried an EffectComposer with a Bloom effect, and it
          * intermittently wrote an empty buffer over the whole render: the
          * cube, the four orbital rings, the particle field and the grid all
          * disappeared, leaving the starfield (drawn before the pass) and the
          * single mesh whose colour is a literal white. Dropping the
          * composer's multisampling to 0 fixed it at one viewport and it came
          * back at another, which is the signature of a pass that depends on
          * a render target the machine may or may not give it.
          *
          * A glow that sometimes deletes the instrument is not a glow worth
          * having. The materials are additive against an opaque ground with
          * tone mapping off, which is where most of the luminance came from in
          * the first place — the composer was adding polish on top of a scene
          * that already reads. Removing it makes the render unconditional:
          * there is now no frame in which the core can fail to be drawn.
          */}
      </Canvas>
    </div>
  );
}
