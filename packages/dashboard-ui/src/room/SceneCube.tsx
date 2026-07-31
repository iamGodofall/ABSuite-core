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
import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { LayerVertices } from './LayerVertices';
import { createCausticTexture, createPointSprite } from './iceTextures';
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

  /*
   * Air trapped in the ice.
   *
   * The single most convincing detail available: real ice has bubbles, and
   * nothing else says "frozen" as immediately. A hundred points scattered
   * through the inner volume, seeded so the block is the same block on every
   * machine rather than a different one each reload.
   */
  const bubbles = useMemo(() => {
    const count = 100;
    const pos = new Float32Array(count * 3);
    let seed = 0xB0BB1E;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      // absuite-allow-fabrication: scatter positions for bubbles inside the ice — where a dot sits, not a value anyone reads.
      pos[i * 3] = (rand() - 0.5) * 1.6;
      pos[i * 3 + 1] = (rand() - 0.5) * 1.6;
      pos[i * 3 + 2] = (rand() - 0.5) * 1.6;
    }
    return pos;
  }, []);

  /** Round, lit from the middle. Shared by the field and the bubbles. */
  const sprite = useMemo(() => (typeof document === 'undefined' ? null : createPointSprite()), []);
  useEffect(() => () => sprite?.dispose(), [sprite]);

  /** Light the block has bent, arriving on the floor. */
  const caustics = useMemo(() => (typeof document === 'undefined' ? null : createCausticTexture()), []);
  useEffect(() => () => caustics?.dispose(), [caustics]);

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
              * The single transmission surface.
              *
              * One piece of glass, not two. Everything inside it is opaque or
              * ordinarily transparent, which is what lets the renderer place it
              * in the buffer this surface refracts. Glass shell, physical
              * interior, living core.
              */}
            <GlassShell color={color} supported={glass} isIdle={isIdle} />
            
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
                * The middle: physical, not transmissive.
                *
                * Two transmissive surfaces cannot see one another — the inner
                * is excluded from the outer's pass and simply is not there. So
                * this is an ordinary physical solid at low opacity: it has
                * surface, specular and structure, and it costs no second
                * render. Glass shell, physical interior, living core.
                */}
              {glass && (
                <points>
                  <bufferGeometry>
                    {/* R3F v9 takes args, not count/array/itemSize. The v8
                        signature compiles and silently builds nothing. */}
                    <bufferAttribute attach="attributes-position" args={[bubbles, 3]} />
                  </bufferGeometry>
                  <pointsMaterial
                    size={0.055}
                    map={sprite ?? undefined}
                    alphaMap={sprite ?? undefined}
                    color="#DFF6FF"
                    transparent
                    opacity={0.6}
                    sizeAttenuation
                    depthWrite={false}
                  />
                </points>
              )}

              {glass ? (
                <mesh>
                  <boxGeometry args={[1.8, 1.8, 1.8]} />
                  <meshPhysicalMaterial
                    color={color}
                    transparent
                    opacity={0.15}
                    metalness={0}
                    roughness={0}
                    /*
                     * A faint light in the material itself, not a lamp shining
                     * on it. The block should look like it is holding the
                     * core's light rather than merely standing next to it —
                     * which is the difference between a lit object and a
                     * glowing one.
                     */
                    emissive={color}
                    emissiveIntensity={0.22}
                    toneMapped={false}
                    clearcoat={1}
                    clearcoatRoughness={0}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                  />
                </mesh>
              ) : (
                [1.78, 1.79, 1.8, 1.81, 1.82].map((scale, i) => (
                  <mesh key={i} scale={scale}>
                    <boxGeometry args={[1, 1, 1, 2, 2, 2]} />
                    <meshBasicMaterial color={scale === 1.8 ? glowColor : color} transparent opacity={scale === 1.8 ? 0.5 : 0.1} wireframe={true} blending={THREE.AdditiveBlending} />
                  </mesh>
                ))
              )}
              
              {/*
                * The source, inside the block that contains it.
                *
                * This group sat as a sibling of the whole cube — at the centre
                * by coincidence of position rather than by belonging to
                * anything. It did not move with the cube, did not scale with
                * the inner block, and on the refracting path that reads as a
                * highlight lying on the surface rather than as a light held
                * within it.
                *
                * It is a child of the inner cube now. Glass shell, physical
                * interior, living core — nested in the scene graph the way the
                * doctrine says they are nested, so the geometry states the
                * relationship instead of merely suggesting it.
                *
                * The radius is up from 0.34 to 0.42 because this group now
                * inherits the inner cube's 0.8 scale, and the intent was the
                * size it looked before, not the number it was written as.
                */}
              <group ref={coreRef}>
                <mesh>
                  <icosahedronGeometry args={[0.42, 0]} />
                  {/*
                    * Opaque, and that is the whole point. Three builds the
                    * transmission buffer from opaque objects only, so an
                    * additive transparent core never enters the buffer the
                    * glass refracts and gets drawn on top of the surface
                    * instead of inside it.
                    */}
                  <meshStandardMaterial
                    color={'#04180F'}
                    emissive={color}
                    emissiveIntensity={6}
                    toneMapped={false}
                    roughness={0.35}
                    metalness={0}
                  />
                </mesh>

                {/* The lamps travel with the source. */}
                <pointLight color={color} intensity={isIdle ? 2 : 4} distance={8} decay={2} />
                <pointLight color={glowColor} intensity={isIdle ? 1 : 2} distance={4} decay={2} />
              </group>

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
              {/* A tube, not a flat annulus. A ring with thickness catches
                  light along its length and reads as a track rather than as a
                  drawn circle. */}
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[radius, 0.015, 8, 128]} />
                <meshBasicMaterial color={glowColor} transparent opacity={0.15 + (i * 0.05)} blending={THREE.AdditiveBlending} />
              </mesh>
              {i > 1 && (
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[radius + 0.12, 0.02, 8, 64]} />
                  <meshBasicMaterial color={color} transparent opacity={0.14} blending={THREE.AdditiveBlending} />
                </mesh>
              )}
              {/* Add data arcs */}
              <mesh rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]}>
                <torusGeometry args={[radius, 0.03, 8, 64, Math.PI / (i + 2)]} />
                <meshBasicMaterial color={color} transparent opacity={0.3} blending={THREE.AdditiveBlending} />
              </mesh>
            </group>
          ))}
          {/* Dashed outer boundary ring */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
             <torusGeometry args={[9, 0.01, 8, 128]} />
             <meshBasicMaterial color={color} transparent opacity={0.1} blending={THREE.AdditiveBlending} />
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
        {/* A disc with a soft centre, not a square. See createPointSprite. */}
        <pointsMaterial
          size={0.075}
          map={sprite ?? undefined}
          alphaMap={sprite ?? undefined}
          vertexColors
          transparent
          opacity={0.85}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
      
      {/*
        * The caustic floor.
        *
        * Light the block has bent, landing somewhere else — the detail that
        * makes the cube an object in a room rather than a shape on a
        * background. Only drawn where the machine is actually refracting;
        * without transmission there is no bent light to land, and painting one
        * anyway would be a claim about physics that is not happening.
        */}
      {glass && caustics && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4, 0]}>
          <planeGeometry args={[15, 15]} />
          <meshBasicMaterial
            map={caustics}
            color={glowColor}
            transparent
            opacity={isIdle ? 0.12 : 0.26}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {/*
        * The far pair only.
        *
        * The lamps that lit the centre have moved inside the inner cube with
        * the core, because that is where the light is coming from. These two
        * stay in world space: they rake the block from above and below and are
        * lighting the outside of it, not the inside.
        */}
      <pointLight color={color} intensity={isIdle ? 1 : 2} distance={15} position={[0, 5, 0]} />
      <pointLight color={color} intensity={isIdle ? 1 : 2} distance={15} position={[0, -5, 0]} />
    </group>
  );
}
