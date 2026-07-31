/**
 * The core, as an actual object in space.
 *
 * This replaces a CSS 3D cube with a real one. The behaviours come from the
 * supplied React Three Fiber package, which had the right idea and the wrong
 * discipline: its cube span continuously, and its overlays reported 482 records,
 * 99.999% uptime and 12ms latency that nothing had measured. The behaviours are
 * kept. The perpetual motion and the invented figures are not.
 *
 * Every layer performs its own verb, which is what makes the interface
 * legible without a legend:
 *
 *   Observe    receives      — the shell draws inward, the core takes it in
 *   Verify     becomes still — rotation damps to zero so the thing can be
 *                              inspected; verification requires stillness
 *   Explain    connects      — inner structure surfaces
 *   Govern     bounds        — a constraint cage appears around the core
 *   Arbitrate  splits in two — a dispute is two positions in tension, drawn
 *                              as two halves, green against amber
 *   Act        discharges    — the core expels, briefly
 *   Learn      grows         — the inner geometry expands
 *
 * Rule zero still governs. At rest the core drifts at 0.05°/sec — one turn
 * every two hours, below the threshold at which the eye reads motion. It never
 * spins. It orients: it turns toward what happened and stops there. Nothing
 * here loops because looping looks alive.
 */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

export type Integrity = 'DEMONSTRATED' | 'FAILED' | 'UNKNOWN' | 'ABSENT';

/** 0.05 degrees per second, in radians. The resting drift, and nothing more. */
const REST_DRIFT = (0.05 * Math.PI) / 180;

const TONE: Record<Integrity, string> = {
  DEMONSTRATED: '#00F58C',
  FAILED: '#EF4444',
  UNKNOWN: '#F6B100',
  ABSENT: '#6B7A75',
};

/** Where the core turns to face each station. */
const FACING: Record<string, [number, number]> = {
  observe:   [-0.26, 0],
  verify:    [0, 0],
  explain:   [0.26, 0],
  govern:    [0, -0.62],
  arbitrate: [0.16, 0.62],
  act:       [-0.16, -0.62],
  learn:     [-0.30, 0.50],
};

function Core({ integrity, attending, connected, arrivalKey }: {
  integrity: Integrity;
  attending: string | null;
  connected: boolean;
  /** Changes when a record genuinely arrives. Drives the one-shot response. */
  arrivalKey: string | null;
}) {
  const shell = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const cage = useRef<THREE.Mesh>(null);
  const leftHalf = useRef<THREE.Mesh>(null);
  const rightHalf = useRef<THREE.Mesh>(null);

  const lastArrival = useRef<string | null>(null);
  const impulse = useRef(0);

  const colour = useMemo(() => new THREE.Color(TONE[integrity]), [integrity]);
  const splitting = attending === 'arbitrate';

  useFrame((_, delta) => {
    if (!shell.current) return;

    // A record arriving is the only thing that produces a burst. It decays to
    // nothing and does not repeat.
    if (arrivalKey && arrivalKey !== lastArrival.current) {
      lastArrival.current = arrivalKey;
      impulse.current = 1;
    }
    impulse.current = Math.max(0, impulse.current - delta * 1.6);

    // Rest. Not a spin — a drift so slow it reads as holding station, and it
    // stops completely when the socket is down, because a disconnected system
    // is not observing.
    if (connected && attending !== 'verify') {
      shell.current.rotation.y += REST_DRIFT * delta;
    }

    // Orientation. The core turns toward what is being attended and stops
    // there; it does not return to centre, because returning is motion caused
    // by nothing.
    const target = attending ? FACING[attending] : null;
    if (target) {
      shell.current.rotation.x = THREE.MathUtils.lerp(shell.current.rotation.x, target[0], delta * 2.4);
      // Verify damps to a standstill so the object can be inspected.
      const damp = attending === 'verify' ? delta * 3.2 : delta * 2.4;
      shell.current.rotation.y = THREE.MathUtils.lerp(shell.current.rotation.y, target[1], damp);
    }

    // Act discharges; the impulse from an arrival does the same, briefly.
    const discharge = attending === 'act' ? 0.14 : impulse.current * 0.1;
    const scale = 1 + discharge;
    shell.current.scale.lerp(new THREE.Vector3(scale, scale, scale), delta * 4);

    // Learn grows. Explain surfaces its structure.
    if (inner.current) {
      const target = attending === 'learn' ? 1.5 : attending === 'explain' ? 1.2 : 1;
      inner.current.scale.lerp(new THREE.Vector3(target, target, target), delta * 3);
    }

    // Govern draws a boundary.
    if (cage.current) {
      const want = attending === 'govern' ? 1.55 : 1.0;
      cage.current.scale.lerp(new THREE.Vector3(want, want, want), delta * 3);
      const material = cage.current.material as THREE.MeshBasicMaterial;
      material.opacity = THREE.MathUtils.lerp(material.opacity, attending === 'govern' ? 0.5 : 0, delta * 4);
    }

    // Arbitrate splits in two. A dispute is two positions in tension.
    if (leftHalf.current && rightHalf.current) {
      const apart = splitting ? 0.75 : 0;
      leftHalf.current.position.x = THREE.MathUtils.lerp(leftHalf.current.position.x, -apart, delta * 3);
      rightHalf.current.position.x = THREE.MathUtils.lerp(rightHalf.current.position.x, apart, delta * 3);
      const leftMaterial = leftHalf.current.material as THREE.MeshBasicMaterial;
      const rightMaterial = rightHalf.current.material as THREE.MeshBasicMaterial;
      const show = splitting ? 0.5 : 0;
      leftMaterial.opacity = THREE.MathUtils.lerp(leftMaterial.opacity, show, delta * 4);
      rightMaterial.opacity = THREE.MathUtils.lerp(rightMaterial.opacity, show, delta * 4);
    }
  });

  return (
    <group>
      <group ref={shell} rotation={[-0.32, 0, 0]}>
        {/* The shell. Hidden while the core is split, because a cube cannot be
            whole and in two pieces at once. */}
        {!splitting && (
          <>
            <mesh>
              <boxGeometry args={[2.6, 2.6, 2.6]} />
              <meshBasicMaterial
                color={colour} transparent opacity={0.05}
                blending={THREE.AdditiveBlending} depthWrite={false}
              />
            </mesh>
            {[0.995, 1, 1.005].map(edge => (
              <mesh key={edge} scale={edge}>
                <boxGeometry args={[2.6, 2.6, 2.6]} />
                <meshBasicMaterial
                  color={colour} wireframe transparent
                  opacity={edge === 1 ? 0.55 : 0.14}
                  blending={THREE.AdditiveBlending} depthWrite={false}
                />
              </mesh>
            ))}

            {/* Inner structure. Learn expands it; Explain surfaces it. */}
            <group ref={inner}>
              <mesh scale={0.56}>
                <boxGeometry args={[2.6, 2.6, 2.6]} />
                <meshBasicMaterial
                  color={colour} wireframe transparent opacity={0.3}
                  blending={THREE.AdditiveBlending}
                />
              </mesh>
              <mesh scale={0.3}>
                <octahedronGeometry args={[1.4, 0]} />
                <meshBasicMaterial
                  color="#F4F7FA" wireframe transparent opacity={0.32}
                  blending={THREE.AdditiveBlending}
                />
              </mesh>
            </group>
          </>
        )}

        {/* Govern's boundary. Invisible until a rule is being applied. */}
        <mesh ref={cage}>
          <boxGeometry args={[2.6, 2.6, 2.6]} />
          <meshBasicMaterial
            color="#F6B100" wireframe transparent opacity={0}
            blending={THREE.AdditiveBlending} depthWrite={false}
          />
        </mesh>

        {/* Arbitrate. Two halves, two colours, held apart. */}
        <mesh ref={leftHalf}>
          <boxGeometry args={[1.24, 2.6, 2.6]} />
          <meshBasicMaterial
            color="#00F58C" wireframe transparent opacity={0}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh ref={rightHalf}>
          <boxGeometry args={[1.24, 2.6, 2.6]} />
          <meshBasicMaterial
            color="#F6B100" wireframe transparent opacity={0}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      <pointLight color={colour} intensity={1.1} distance={9} />
    </group>
  );
}

export const CoreCube = ({ integrity, attending, connected, arrivalKey }: {
  integrity: Integrity;
  attending: string | null;
  connected: boolean;
  arrivalKey: string | null;
}) => (
  <Canvas
    camera={{ position: [0, 0, 8.2], fov: 45 }}
    gl={{ antialias: true, alpha: true }}
    style={{ pointerEvents: 'none' }}
  >
    <ambientLight intensity={0.25} />
    <Core
      integrity={integrity}
      attending={attending}
      connected={connected}
      arrivalKey={arrivalKey}
    />
    <EffectComposer>
      <Bloom luminanceThreshold={0.22} mipmapBlur intensity={0.75} radius={0.55} />
    </EffectComposer>
  </Canvas>
);

export default CoreCube;
