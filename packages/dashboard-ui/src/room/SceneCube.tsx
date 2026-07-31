/**
 * The core. Ported from the supplied React Three Fiber scene, essentially
 * whole.
 *
 * An earlier attempt rewrote this from scratch and kept only the behaviours —
 * which meant throwing away the layered edge glow, the nested sacred geometry,
 * the twelve-hundred-point field and the orbital arcs, and shipping something
 * markedly worse while calling it an adaptation. That was a downgrade. This is
 * the original.
 *
 * Two changes only, both required by doctrine rather than taste:
 *
 *   1. At rest the cube does not spin. The original turned continuously in
 *      overview; rule zero is that motion is evidence, so at rest it drifts at
 *      0.05°/sec — a turn every two hours, below the threshold at which the eye
 *      reads motion — and stops entirely when the socket drops. Every other
 *      movement is unchanged: it still orients per layer, still splits for
 *      Arbitrate, still accelerates and discharges for Act.
 *
 *   2. `activeLayer` is driven by what the operator is attending to, not by a
 *      hardcoded state.
 *
 * Everything else — the geometry, the materials, the particle field, the rings,
 * the idle degradation — is as supplied.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { LayerVertices } from './LayerVertices';
import { GlassShell } from './GlassShell';
import * as THREE from 'three';

export type TrustLayer =
  | 'overview' | 'observe' | 'verify' | 'explain'
  | 'govern' | 'arbitrate' | 'act' | 'learn';

/** Fixed for the life of the scene. Resizing a WebGL attribute mid-flight is
 *  what produced the torn geometry this field used to show. */
const PARTICLE_COUNT = 1200;
/** The band the field occupies vertically, and the distance a point travels
 *  before it wraps. Wrapping by exactly this keeps the drift continuous. */
const FIELD_HEIGHT = 8;

/** 0.05 degrees per second, in radians. The resting drift. */
const REST_DRIFT = (0.05 * Math.PI) / 180;

interface TrustCubeProps {
  activeLayer: TrustLayer;
  isIdle?: boolean;
  /** False when the socket is down: a system that is not observing holds still. */
  connected?: boolean;
  /** True when this machine can refract. See glass.ts. */
  glass?: boolean;
}

export function SceneCube({ activeLayer, isIdle, connected = true, glass = false }: TrustCubeProps) {
  const cubeRef = useRef<THREE.Group>(null);
  const innerCubeRef = useRef<THREE.Mesh>(null);
  const leftHalfRef = useRef<THREE.Mesh>(null);
  const rightHalfRef = useRef<THREE.Mesh>(null);
  const ringsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const governEdgesRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Group>(null);
  
  // Keep track of time locally to allow for slowing down time
  const timeRef = useRef(0);

  const colors = {
    overview: '#00F58C',
    observe: '#00F58C',
    verify: '#3B82F6', // Blue
    explain: '#FFFFFF', // White
    govern: '#F59E0B', // Gold
    arbitrate: '#8B5CF6', // Purple
    act: '#00F58C', // Electric pulse
    learn: '#00F58C'
  };

  const baseColor = new THREE.Color(colors[activeLayer] || colors.overview);
  const color = baseColor.clone();
  /*
   * The glow now lives entirely in the materials.
   *
   * These values were tuned against a Bloom pass that has been removed for
   * being unreliable — see Scene.tsx. Without it the additive stack lost its
   * top end, so the multiplier is raised: the accumulation across the five
   * overlapping edge wireframes is what produces the bright edge now, rather
   * than a post-process finding it afterwards. Idle stays at 1.0, so standing
   * down still visibly dims the core.
   */
  const glowColor = baseColor.clone().multiplyScalar(isIdle ? 1.0 : 2.8);

  /** Built once and shared by the five edge passes. */
  const shellEdges = useMemo(() => new THREE.BoxGeometry(2.5, 2.5, 2.5), []);

  useFrame((state, delta) => {
    // Slow down time if idle
    const effectiveDelta = isIdle ? delta * 0.1 : delta;
    timeRef.current += effectiveDelta;
    const t = timeRef.current;
    
    if (cubeRef.current) {
      if (isIdle) {
         // IDLE: the same resting drift, and nothing else.
         if (connected) cubeRef.current.rotation.y += REST_DRIFT * delta;
      } else {
         if (activeLayer === 'overview') {
           // Rule zero: if nothing happened, nothing moves. At rest this is a
           // drift of 0.05°/sec — one revolution every two hours — which reads
           // as an instrument holding station rather than an ornament turning.
           // It stops completely when the socket is down.
           if (connected) cubeRef.current.rotation.y += REST_DRIFT * delta;
         } else if (activeLayer === 'act') {
           // Quick acceleration
           cubeRef.current.rotation.x += delta * 2.0;
           cubeRef.current.rotation.y += delta * 2.5;
           cubeRef.current.rotation.z += delta * 1.0;
         } else if (activeLayer === 'arbitrate') {
           // Cube pauses completely
         } else {
           // Orienting towards specific angles
           let targetX = 0, targetY = 0, targetZ = 0;
           switch (activeLayer) {
             case 'observe':
               targetX = Math.PI / 8; targetY = -Math.PI / 6; targetZ = 0;
               break;
             case 'verify':
               targetX = 0; targetY = 0; targetZ = 0; // stabilizes perfectly
               break;
             case 'explain':
               targetX = -Math.PI / 8; targetY = Math.PI / 6; targetZ = Math.PI / 12;
               break;
             case 'govern':
               targetX = Math.PI / 6; targetY = 0; targetZ = -Math.PI / 12;
               break;
             case 'learn':
               targetX = -Math.PI / 6; targetY = -Math.PI / 4; targetZ = Math.PI / 8;
               break;
           }
           cubeRef.current.rotation.x = THREE.MathUtils.lerp(cubeRef.current.rotation.x, targetX, delta * 3);
           cubeRef.current.rotation.y = THREE.MathUtils.lerp(cubeRef.current.rotation.y, targetY, delta * 3);
           cubeRef.current.rotation.z = THREE.MathUtils.lerp(cubeRef.current.rotation.z, targetZ, delta * 3);
         }
      }
      
      // Breathing effect
      const scale = 1 + Math.sin(t) * (isIdle ? 0.002 : 0.01);
      cubeRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), delta * 2);

      // Arbitrate split
      if (activeLayer === 'arbitrate' && leftHalfRef.current && rightHalfRef.current) {
        leftHalfRef.current.position.lerp(new THREE.Vector3(-0.5, 0, 0), delta * 2);
        rightHalfRef.current.position.lerp(new THREE.Vector3(0.5, 0, 0), delta * 2);
      } else if (leftHalfRef.current && rightHalfRef.current) {
        leftHalfRef.current.position.lerp(new THREE.Vector3(0, 0, 0), delta * 2);
        rightHalfRef.current.position.lerp(new THREE.Vector3(0, 0, 0), delta * 2);
      }
      
      // Govern bounds
      if (governEdgesRef.current) {
        const targetScale = activeLayer === 'govern' ? 1.5 : 1.0;
        governEdgesRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 2);
        governEdgesRef.current.rotation.x -= delta * 0.02;
        governEdgesRef.current.rotation.y += delta * 0.03;
      }
      
      if (coreRef.current) {
        coreRef.current.rotation.x += delta * 0.2;
        coreRef.current.rotation.y -= delta * 0.3;
        coreRef.current.rotation.z += delta * 0.1;
        
        // Dynamic scaling based on layer and time
        let coreScale = 1;
        if (activeLayer === 'act') {
          coreScale = 1.2 + Math.sin(t * 15) * 0.2; // Rapid pulsing
        } else if (activeLayer === 'govern') {
          coreScale = 0.8 + Math.sin(t * 5) * 0.1; // Slower pulsing
        } else if (activeLayer === 'arbitrate') {
          coreScale = 1 + Math.sin(t * 8) * 0.15; // Unstable pulsing
        } else {
          coreScale = 1 + Math.sin(t * 2) * 0.05; // Normal breathing
        }
        
        coreRef.current.scale.lerp(new THREE.Vector3(coreScale, coreScale, coreScale), delta * 4);
      }

      // Layer specific animations
      if (innerCubeRef.current) {
        if (activeLayer === 'act') {
          innerCubeRef.current.scale.setScalar(0.8 + Math.sin(t * 10) * 0.05);
        } else if (activeLayer === 'observe') {
          innerCubeRef.current.scale.setScalar(0.8 + Math.sin(t * 2) * 0.02);
        } else {
          innerCubeRef.current.scale.setScalar(0.8);
        }
      }
    }
    
    if (ringsRef.current) {
      ringsRef.current.rotation.y -= effectiveDelta * 0.05;
      
      if (activeLayer === 'learn') {
         ringsRef.current.scale.lerp(new THREE.Vector3(1.5, 1.5, 1.5), delta * 2);
      } else {
         ringsRef.current.scale.lerp(new THREE.Vector3(1, 1, 1), delta * 2);
      }
    }
    
    if (particlesRef.current) {
      particlesRef.current.rotation.y -= effectiveDelta * 0.05;
      const positions = particlesRef.current.geometry.attributes.position.array as Float32Array;

      /*
       * The whole field is always drawn.
       *
       * Going idle used to cut the draw range from 1200 to 400, so two thirds
       * of the points vanished between one frame and the next and reappeared
       * the moment the mouse moved. Nothing was fading — they were simply not
       * being drawn — and a third of a starfield blinking out reads as a fault,
       * not as a system resting. Idle already slows the clock, which is the
       * honest way to show a system standing down.
       */

      if (activeLayer === 'act' && !isIdle) {
         // Emit particles outward
         for (let i = 0; i < positions.length; i += 3) {
            positions[i] *= 1.01;
            positions[i + 1] *= 1.01;
            positions[i + 2] *= 1.01;
            if (Math.abs(positions[i]) > 10 || Math.abs(positions[i+1]) > 10 || Math.abs(positions[i+2]) > 10) {
               positions[i] = (Math.random() - 0.5) * 2;
               positions[i + 1] = (Math.random() - 0.5) * 2;
               positions[i + 2] = (Math.random() - 0.5) * 2;
            }
         }
      } else {
         /*
          * A continuous upward drift that wraps exactly.
          *
          * The wrap used to assign -4 whenever a point passed +4, which throws
          * away the fraction it had already travelled past the boundary. At
          * 60fps that error is invisible; on a frame that arrives late — a tab
          * regaining focus, a slow machine — it is a visible jump, and the eye
          * catches a bright point teleporting. Subtracting exactly one field
          * height preserves the overshoot, so the motion is unbroken however
          * long the frame took.
          */
         for (let i = 1; i < positions.length; i += 3) {
           positions[i] += effectiveDelta * 0.5;
           if (positions[i] > FIELD_HEIGHT / 2) positions[i] -= FIELD_HEIGHT;
         }
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  /*
   * The particle field, built once.
   *
   * This was memoised on [glowColor] — and glowColor is a fresh THREE.Color
   * constructed on every render, so the dependency never compared equal. Both
   * Float32Arrays were rebuilt every single render, React handed the geometry
   * a brand-new position buffer, and the frame loop's mutations — the upward
   * drift, the outward emission on Act — were discarded and restarted from
   * scratch at random moments. That is the glitch: not a stutter in the
   * animation, but the animation being thrown away and begun again several
   * times a second, with the buffer briefly inconsistent while it swapped.
   *
   * Geometry is built once and never rebuilt. Colour is a separate buffer
   * keyed on the colour itself as a string, so changing layer re-tints the
   * field without disturbing where any point is or where it was going.
   */
  const positions = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3.5 + Math.random() * 8; // Spread out, away from the core.
      pos[i * 3] = Math.cos(angle) * radius;
      // absuite-allow-fabrication: the vertical coordinate of a scatter point in the particle field — where a dot sits, not a value anyone reads.
      pos[i * 3 + 1] = (Math.random() - 0.5) * FIELD_HEIGHT;
      pos[i * 3 + 2] = Math.sin(angle) * radius;
    }
    return pos;
  }, []);

  const glowHex = glowColor.getHexString();
  const particleColors = useMemo(() => {
    const cols = new Float32Array(PARTICLE_COUNT * 3);
    const tint = new THREE.Color(`#${glowHex}`);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      cols[i * 3] = tint.r;
      cols[i * 3 + 1] = tint.g;
      cols[i * 3 + 2] = tint.b;
    }
    return cols;
  }, [glowHex]);

  const isArbitrate = activeLayer === 'arbitrate';

  return (
    <group>
      {/* The Core Reactor Cube */}
      <group ref={cubeRef}>
        {!isArbitrate && (
          /* The faint lattice. Subdivided, so its diagonals read as a mesh
             rather than as stray lines, and left as a wireframe for that
             reason. */
          <mesh>
            <boxGeometry args={[2.5, 2.5, 2.5, 8, 8, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.04} wireframe={true} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        )}
        
        {!isArbitrate && (
          <group>
            {/*
              * The outer shell stays a hologram, for now.
              *
              * Glass inside glass does not work: a transmissive surface is
              * excluded from another transmissive surface's render pass, so an
              * ice block placed inside a refracting shell simply is not there
              * when you look through the shell. Making both of them glass gets
              * you one piece of glass and a missing one.
              *
              * The inner block is the piece worth holding, so it takes the
              * refraction and the outer surface goes back to the additive
              * plane that lets you see straight into it. Turning the outer
              * shell to ice as well means solving the nesting — most likely by
              * giving the outer surface a thin refractive rim rather than a
              * full transmissive volume — and that is its own piece of work.
              */}
            <mesh>
              <boxGeometry args={[2.5, 2.5, 2.5]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={activeLayer === 'observe' ? 0.05 : 0.08}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
            
            {/*
              * Twelve edges, not eighteen.
              *
              * These were `wireframe` boxes, and a wireframe draws the
              * geometry's triangulation — every square face of a box is two
              * triangles, so each face came with a diagonal across it. Six
              * extra lines cutting corner to corner, belonging to nothing,
              * which is exactly what they looked like. `edgesGeometry` keeps
              * only the twelve real edges of the shape.
              *
              * The stack of five at slightly different scales is unchanged:
              * additive lines a hair apart is what makes an edge read as
              * thick and lit rather than as a one-pixel line.
              */}
            <group>
              {[0.98, 0.99, 1.0, 1.01, 1.02].map((scale, i) => (
                <lineSegments key={i} scale={scale}>
                  <edgesGeometry args={[shellEdges]} />
                  <lineBasicMaterial
                    color={scale === 1.0 ? glowColor : color}
                    transparent
                    opacity={scale === 1.0 ? 1 : 0.22}
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                  />
                </lineSegments>
              ))}
            </group>
            
            {/* The eight architectural layers, on the eight corners. Inside
                the cube group so they turn with it. */}
            <LayerVertices />

            <group ref={innerCubeRef}>
              {/*
                * The inner block, as ice.
                *
                * This was five stacked wireframes around empty space — an
                * outline of a cube rather than a cube. It is a solid now, and
                * frostier than the outer shell: the outer one is a window you
                * look through, this one is the object you look at. The core
                * sits inside it, so its light is refracted and scattered by
                * the block containing it rather than simply drawn in front.
                *
                * No fallback here. Where refraction is unavailable the
                * wireframes below already describe this cube, and a second
                * additive box would only wash them out.
                */}
              <GlassShell
                color={color}
                supported={glass}
                isIdle={isIdle}
                size={1.8}
                roughness={0.22}
                emissive={0.06}
                fallback={false}
              />

              {/* Inner structural wireframe - Cubist element */}
              {[1.78, 1.79, 1.8, 1.81, 1.82].map((scale, i) => (
                <mesh key={i} scale={scale}>
                  <boxGeometry args={[1, 1, 1, 2, 2, 2]} />
                  <meshBasicMaterial color={scale === 1.8 ? glowColor : color} transparent opacity={scale === 1.8 ? 0.5 : 0.1} wireframe={true} blending={THREE.AdditiveBlending} />
                </mesh>
              ))}
              
              {/*
                * The two diagonal cross-sections are gone.
                *
                * They were 2x2 planes turned 45 degrees, and their edges ran
                * corner to corner right across the outer shell — lines that
                * belonged to neither cube, cutting through the space between
                * them. With the shell now a refracting solid they read as
                * scratches on the glass rather than as structure inside it.
                */}
            </group>
          </group>
        )}
        
        {/* Split Cubes for Arbitrate */}
        {isArbitrate && (
          <group>
            <mesh ref={leftHalfRef} position={[-0.1, 0, 0]}>
               <boxGeometry args={[1.2, 2.5, 2.5]} />
               <meshBasicMaterial color={'#00F58C'} transparent opacity={0.1} blending={THREE.AdditiveBlending} />
               <Edges color={'#00F58C'} />
            </mesh>
            <mesh ref={rightHalfRef} position={[0.1, 0, 0]}>
               <boxGeometry args={[1.2, 2.5, 2.5]} />
               <meshBasicMaterial color={'#F59E0B'} transparent opacity={0.1} blending={THREE.AdditiveBlending} />
               <Edges color={'#F59E0B'} />
            </mesh>
          </group>
        )}
        
        {/* Govern Constraints */}
        {activeLayer === 'govern' && (
          <group ref={governEdgesRef}>
            <mesh>
              <boxGeometry args={[2.5, 2.5, 2.5]} />
              <meshBasicMaterial transparent opacity={0} />
              <Edges scale={1.0} color="#F59E0B" />
            </mesh>
          </group>
        )}
      </group>

      {/* Orbital Rings */}
      {activeLayer !== 'explain' && activeLayer !== 'govern' && (
        <group ref={ringsRef}>
          {[3.5, 4.5, 6, 7.5].map((radius, i) => (
            <group key={i}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[radius, radius + 0.01, 128]} />
                <meshBasicMaterial color={glowColor} transparent opacity={0.15 + (i * 0.05)} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
              </mesh>
              {i > 1 && (
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[radius + 0.1, radius + 0.15, 64, 1, 0, Math.PI * 2]} />
                  <meshBasicMaterial color={color} transparent opacity={0.1} side={THREE.DoubleSide} wireframe={true} blending={THREE.AdditiveBlending} />
                </mesh>
              )}
              {/* Add data arcs */}
              <mesh rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]}>
                <ringGeometry args={[radius - 0.05, radius + 0.05, 64, 1, 0, Math.PI / (i + 2)]} />
                <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
              </mesh>
            </group>
          ))}
          {/* Dashed outer boundary ring */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
             <ringGeometry args={[9, 9.02, 128]} />
             <meshBasicMaterial color={color} transparent opacity={0.1} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      )}

      {/* Orbiting Particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[particleColors, 3]}
          />
        </bufferGeometry>
        <pointsMaterial size={0.03} vertexColors transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      
      {/* Super-bright inner core - Cubist / Sacred Geometry style */}
      <group ref={coreRef}>
        <mesh>
          <icosahedronGeometry args={[0.2, 0]} />
          {/* The centre, at twice its former output. Everything in this group
              was doubled together so the falloff between the shells is
              unchanged — a brighter core, not a differently shaped one. */}
          <meshBasicMaterial color={'#FFFFFF'} transparent opacity={0.8} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh>
          <dodecahedronGeometry args={[0.4, 0]} />
          <meshBasicMaterial color={glowColor} wireframe transparent opacity={0.8} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.6, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.4} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.8, 0]} />
          <meshBasicMaterial color={glowColor} wireframe transparent opacity={0.2} blending={THREE.AdditiveBlending} />
          <Edges scale={1.0} color={glowColor} />
        </mesh>
      </group>
      
      {/* Center light */}
      <pointLight color={color} intensity={isIdle ? 2 : 4} distance={8} />
      <pointLight color={color} intensity={isIdle ? 1 : 2} distance={15} position={[0, 5, 0]} />
      <pointLight color={color} intensity={isIdle ? 1 : 2} distance={15} position={[0, -5, 0]} />
    </group>
  );
}
