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
import * as THREE from 'three';

export type TrustLayer =
  | 'overview' | 'observe' | 'verify' | 'explain'
  | 'govern' | 'arbitrate' | 'act' | 'learn';

/** 0.05 degrees per second, in radians. The resting drift. */
const REST_DRIFT = (0.05 * Math.PI) / 180;

interface TrustCubeProps {
  activeLayer: TrustLayer;
  isIdle?: boolean;
  /** False when the socket is down: a system that is not observing holds still. */
  connected?: boolean;
}

export function SceneCube({ activeLayer, isIdle, connected = true }: TrustCubeProps) {
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
  const glowColor = baseColor.clone().multiplyScalar(isIdle ? 1.0 : 2.0); // Reduced HDR bloom color

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
      
      // Update draw range to simulate dropped particle count
      particlesRef.current.geometry.setDrawRange(0, isIdle ? 400 : 1200);
      
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
         for (let i = 0; i < positions.length; i += 3) {
           positions[i + 1] += effectiveDelta * 0.5; // Flow upwards
           if (positions[i + 1] > 4) {
             positions[i + 1] = -4;
           }
         }
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  const [positions, particleColors] = useMemo(() => {
    const pos = [];
    const cols = [];
    // Keep particle count constant to prevent WebGL attribute resize error
    const count = 1200;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3.5 + Math.random() * 8; // Spread out more, away from core
      const x = Math.cos(angle) * radius;
      const y = (Math.random() - 0.5) * 8;
      const z = Math.sin(angle) * radius;
      pos.push(x, y, z);
      
      cols.push(glowColor.r, glowColor.g, glowColor.b);
    }
    return [new Float32Array(pos), new Float32Array(cols)];
  }, [glowColor]);

  const isArbitrate = activeLayer === 'arbitrate';

  return (
    <group>
      {/* The Core Reactor Cube */}
      <group ref={cubeRef}>
        {!isArbitrate && (
          <mesh>
            <boxGeometry args={[2.5, 2.5, 2.5, 8, 8, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.04} wireframe={true} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
        )}
        
        {!isArbitrate && (
          <group>
            {/* Outer holographic shell */}
            <mesh>
              <boxGeometry args={[2.5, 2.5, 2.5]} />
              <meshBasicMaterial color={color} transparent opacity={activeLayer === 'observe' ? 0.05 : 0.08} wireframe={false} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>
            
            {/* Thickened glowing edges using multiple overlapping wireframes */}
            <group>
              {[0.98, 0.99, 1.0, 1.01, 1.02].map((scale, i) => (
                <mesh key={i} scale={scale}>
                  <boxGeometry args={[2.5, 2.5, 2.5]} />
                  <meshBasicMaterial color={scale === 1.0 ? glowColor : color} transparent opacity={scale === 1.0 ? 0.8 : 0.15} wireframe={true} depthWrite={false} blending={THREE.AdditiveBlending} />
                </mesh>
              ))}
            </group>
            
            <group ref={innerCubeRef}>
              {/* Inner structural wireframe - Cubist element */}
              {[1.78, 1.79, 1.8, 1.81, 1.82].map((scale, i) => (
                <mesh key={i} scale={scale}>
                  <boxGeometry args={[1, 1, 1, 2, 2, 2]} />
                  <meshBasicMaterial color={scale === 1.8 ? glowColor : color} transparent opacity={scale === 1.8 ? 0.5 : 0.1} wireframe={true} blending={THREE.AdditiveBlending} />
                </mesh>
              ))}
              
              {/* Inner diagonal cross sections */}
              <mesh rotation={[Math.PI / 4, Math.PI / 4, 0]}>
                <boxGeometry args={[2, 2, 0.01]} />
                <meshBasicMaterial color={glowColor} transparent opacity={0.05} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                <Edges scale={1.0} color={color} />
              </mesh>
              <mesh rotation={[-Math.PI / 4, -Math.PI / 4, 0]}>
                <boxGeometry args={[2, 2, 0.01]} />
                <meshBasicMaterial color={glowColor} transparent opacity={0.05} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
                <Edges scale={1.0} color={color} />
              </mesh>
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
          <meshBasicMaterial color={'#FFFFFF'} transparent opacity={0.4} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh>
          <dodecahedronGeometry args={[0.4, 0]} />
          <meshBasicMaterial color={glowColor} wireframe transparent opacity={0.4} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.6, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.2} blending={THREE.AdditiveBlending} />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.8, 0]} />
          <meshBasicMaterial color={glowColor} wireframe transparent opacity={0.1} blending={THREE.AdditiveBlending} />
          <Edges scale={1.0} color={glowColor} />
        </mesh>
      </group>
      
      {/* Center light */}
      <pointLight color={color} intensity={isIdle ? 1 : 2} distance={8} />
      <pointLight color={color} intensity={isIdle ? 0.5 : 1} distance={15} position={[0, 5, 0]} />
      <pointLight color={color} intensity={isIdle ? 0.5 : 1} distance={15} position={[0, -5, 0]} />
    </group>
  );
}
