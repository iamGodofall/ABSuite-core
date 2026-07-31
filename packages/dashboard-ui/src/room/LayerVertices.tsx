/**
 * The eight architectural layers, as the cube's eight corners.
 *
 * The room has navigated the seven operations — Observe through Learn — since
 * it was built. The eight layers of the constitution had no presence in it at
 * all: Identity, Capability, Evidence, Trust, Governance, Autonomy, Collective
 * Intelligence and Civilization existed only as a table in a document, which
 * meant the roadmap and the product were two artefacts that could drift apart
 * without anyone noticing.
 *
 * A cube has eight corners. The seven stations orbit it because they are what
 * *happens*; the eight layers sit on its structure because they are what the
 * thing *is*. That is not a metaphor reached for after the fact — the
 * constitution already says these are different kinds of noun, a property
 * versus an operation, and that forcing a one-to-one mapping would be a tidy
 * diagram that lies. Two different shapes for two different kinds of thing.
 *
 * Status comes from architecture-layers.json, generated from CONSTITUTION.md.
 * Nothing here decides what is built. A corner is bright because the
 * constitution says that layer is built, and it goes dark the moment the
 * constitution says otherwise.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import data from '../generated/architecture-layers.json';

type LayerStatus = 'BUILT' | 'PARTLY' | 'NOT_BUILT';

interface ArchitectureLayer {
  index: number;
  name: string;
  property: string;
  status: LayerStatus;
  evidence: string | null;
}

const LAYERS = data.layers as ArchitectureLayer[];

/**
 * The eight corners of a 2.5-unit cube, in constitutional order.
 *
 * Identity is the bottom of the stack and sits at a bottom corner; Civilization
 * is the top of the stack and sits at the top corner diagonally opposite it.
 * Everything between climbs. The order is load-bearing — the constitution says
 * each layer rests on the one below.
 */
const HALF = 1.25;
const CORNERS: [number, number, number][] = [
  [-HALF, -HALF, -HALF], // 1 Identity — the foundation, furthest back and down
  [ HALF, -HALF, -HALF], // 2 Capability
  [ HALF, -HALF,  HALF], // 3 Evidence
  [-HALF, -HALF,  HALF], // 4 Trust
  [-HALF,  HALF, -HALF], // 5 Governance
  [ HALF,  HALF, -HALF], // 6 Autonomy
  [ HALF,  HALF,  HALF], // 7 Collective Intelligence
  [-HALF,  HALF,  HALF], // 8 Civilization — the top, opposite the foundation
];

/**
 * The same four-state language the rest of the product uses, mapped onto the
 * three states the constitution's roadmap actually distinguishes.
 */
const STATUS_COLOUR: Record<LayerStatus, string> = {
  BUILT: '#00F58C',
  PARTLY: '#F59E0B',
  NOT_BUILT: '#6B7280',
};

/** How solid a corner reads. A layer nobody has built is nearly not there. */
const STATUS_OPACITY: Record<LayerStatus, number> = {
  BUILT: 0.95,
  PARTLY: 0.55,
  NOT_BUILT: 0.14,
};

/** How large. Built layers carry weight; unbuilt ones are a marked position. */
const STATUS_SIZE: Record<LayerStatus, number> = {
  BUILT: 0.075,
  PARTLY: 0.06,
  NOT_BUILT: 0.042,
};

function Vertex({ layer, position }: { layer: ArchitectureLayer; position: [number, number, number] }) {
  const haloRef = useRef<THREE.Mesh>(null);
  const colour = STATUS_COLOUR[layer.status];

  /*
   * Only a built layer breathes.
   *
   * Rule zero: motion is a claim that something is happening. A corner for a
   * layer that does not exist yet must not pulse as though it did — so
   * Collective Intelligence and Civilization are marked, dim and completely
   * still, and they will start moving on the day the constitution says they
   * are built and not one commit sooner.
   */
  useFrame((state) => {
    if (!haloRef.current || layer.status === 'NOT_BUILT') return;
    const t = state.clock.elapsedTime;
    // Each corner offset by its own index so the eight do not pulse in unison,
    // which would read as one animation rather than eight instruments.
    const phase = t * 0.6 + layer.index * 0.8;
    const swell = layer.status === 'BUILT' ? 0.14 : 0.08;
    haloRef.current.scale.setScalar(1 + Math.sin(phase) * swell);
  });

  return (
    <group position={position}>
      {/* The corner itself. */}
      <mesh>
        <icosahedronGeometry args={[STATUS_SIZE[layer.status], 0]} />
        <meshBasicMaterial
          color={colour}
          transparent
          opacity={STATUS_OPACITY[layer.status]}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Its halo — the thing that carries the pulse, so the corner stays crisp. */}
      <mesh ref={haloRef}>
        <icosahedronGeometry args={[STATUS_SIZE[layer.status] * 2.1, 0]} />
        <meshBasicMaterial
          color={colour}
          wireframe
          transparent
          opacity={STATUS_OPACITY[layer.status] * 0.42}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Mounted inside the cube's own group, so the corners turn with the cube and
 * stay corners rather than drifting into being decoration near it.
 */
export function LayerVertices() {
  return (
    <group>
      {LAYERS.map((layer, i) => (
        <Vertex key={layer.name} layer={layer} position={CORNERS[i]} />
      ))}
    </group>
  );
}

/** Exported so the surface can list them without re-reading the JSON. */
export { LAYERS as ARCHITECTURE_LAYERS };
export type { ArchitectureLayer, LayerStatus };
