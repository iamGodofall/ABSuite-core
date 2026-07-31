import { Canvas, useFrame } from '@react-three/fiber';
import { SceneCube, type TrustLayer } from './SceneCube';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

interface SceneProps {
  activeLayer: TrustLayer;
  isIdle?: boolean;
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

export function Scene({ activeLayer, isIdle, connected = true }: SceneProps) {
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
         * No tone mapping.
         *
         * R3F v9 defaults to ACES filmic, which is right for a lit PBR scene
         * and wrong for this one: every material here is additive and
         * low-opacity, and ACES crushed the whole cube and the starfield to
         * black while leaving the brighter orbital rings visible. The symptom
         * was a scene that rendered without error and showed almost nothing.
         */
        gl={{ alpha: false, antialias: true, toneMapping: THREE.NoToneMapping }}
        onCreated={({ gl }) => gl.setClearColor('#05070A', 1)}
      >
        <fog attach="fog" args={['#000000', 5, 25]} />
        <ambientLight intensity={0.2} />
        
        {/* Deep space environment */}
        <Stars radius={100} depth={50} count={isIdle ? 1000 : 5000} factor={4} saturation={0} fade speed={isIdle ? 0.2 : 1} />
        
        {/* Background Grid */}
        <gridHelper args={[100, 100, '#00F58C', '#00F58C']} material-opacity={0.03} material-transparent rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -15]} />
        
        <SceneCube activeLayer={activeLayer} isIdle={isIdle} connected={connected} />
        <CameraController activeLayer={activeLayer} />
        
        <EffectComposer>
          <Bloom luminanceThreshold={0.1} mipmapBlur intensity={isIdle ? 0.5 : 1.2} radius={0.8} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
