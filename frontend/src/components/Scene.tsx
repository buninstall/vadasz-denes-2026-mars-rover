import React, { useRef, useEffect, Suspense, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars, useGLTF, Clone, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { MapData, SimulationResult } from '../types';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

// Preload models
useGLTF.preload('/models/Rover.glb');
useGLTF.preload('/models/Rocks.glb');
useGLTF.preload('/models/Gold ore.glb');
useGLTF.preload('/models/Crystal.glb');

type CameraMode = 'follow' | 'overview';

interface SceneProps {
  map: MapData;
  simulationResult: SimulationResult | null;
  isPlaying: boolean;
  stepDurationSec?: number; // base seconds per sim-step (default 0.06)
  onStep?: (step: number) => void;
  onComplete?: () => void;
}

// ==== SETTINGS ====
const ROVER_GROUND_CLEARANCE = 0.04;
const ROVER_SCALE = 0.7;
const OBSTACLE_HEIGHT_OFFSET = -1.2;  // deeply embed model origin into terrain
const OBSTACLE_SCALE = 4.5;
const OBSTACLE_RANDOM_OFFSET = 0.5;
const MINERAL_EMBED_DEPTH = 0.03;
const MINERAL_SCALE = 0.15;
const GOLD_SCALE = 5;
const RENDER_DISTANCE = 1500;
// ==================

const GRID_SIZE = 50;
const CELL_SIZE = 2;
const OFFSET = (GRID_SIZE * CELL_SIZE) / 2;

const seededRandom = (x: number, y: number): number => {
  const seed = x * 73856093 ^ y * 19349663;
  const t = Math.sin(seed) * 10000;
  return t - Math.floor(t);
};

const getPosition = (x: number, y: number): [number, number, number] => {
  return [x * CELL_SIZE - OFFSET, 0, y * CELL_SIZE - OFFSET];
};

const getRandomizedPosition = (x: number, y: number, randomOffset: number): [number, number, number] => {
  const basePos = getPosition(x, y);
  const rand1 = seededRandom(x, y);
  const rand2 = seededRandom(y, x);
  const offsetX = (rand1 - 0.5) * CELL_SIZE * randomOffset;
  const offsetZ = (rand2 - 0.5) * CELL_SIZE * randomOffset;
  return [basePos[0] + offsetX, basePos[1], basePos[2] + offsetZ];
};

const getRandomRotation = (x: number, y: number): number => {
  const rand = seededRandom(x * 2 + 1, y * 3 + 2);
  return rand * Math.PI * 2;
};

/**
 * Analytical terrain height at world (wx, wz).
 * Matches MarsSurface geometry generation — no raycasting needed.
 */
const estimateTerrainHeight = (wx: number, wz: number): number => {
  const x = wx, y = wz;
  const noise =
    Math.sin(x * 0.05) * Math.cos(y * 0.05) * 2 +
    Math.sin(x * 0.1)  * Math.cos(y * 0.1)  * 1 +
    Math.sin(x * 0.2)  * Math.cos(y * 0.2)  * 0.5 + 0.15; // +0.15 ≈ E[random()*0.3]
  const dist = Math.sqrt(x * x + y * y);
  const macroHills = dist > 100 ? Math.sin(x * 0.01) * Math.cos(y * 0.01) * (dist / 10) : 0;
  const dE = Math.max(Math.max(0, Math.abs(x) - 50), Math.max(0, Math.abs(y) - 50));
  const boundary = dE > 0 ? (() => { const t = Math.min(dE / 5, 1); return (t < 0.5 ? 2*t*t : -1+(4-2*t)*t) * 3; })() : 0;
  return noise + macroHills + boundary - 0.1;
};

/** Extract first mesh geometry+material from a GLTF scene. */
function extractFirstMesh(gltfScene: THREE.Group): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  let result: { geo: THREE.BufferGeometry; mat: THREE.Material } | null = null;
  gltfScene.traverse(child => {
    if (!result && (child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      result = { geo: m.geometry, mat: Array.isArray(m.material) ? m.material[0] : m.material };
    }
  });
  return result;
}

const MODEL_GROUND_OFFSET_CACHE = new Map<string, number>();

function getModelGroundOffset(scene: THREE.Group, cacheKey: string, scale: number): number {
  const key = `${cacheKey}_${scale}`;
  const cached = MODEL_GROUND_OFFSET_CACHE.get(key);
  if (cached !== undefined) return cached;

  const box = new THREE.Box3().setFromObject(scene);
  const offset = Number.isFinite(box.min.y) ? -box.min.y * scale : 0;
  MODEL_GROUND_OFFSET_CACHE.set(key, offset);
  return offset;
}

// ── Path line drawn in world space showing the full planned route
const PathLine = React.memo(({ pathPoints }: { pathPoints: THREE.Vector3[] }) => {
  const geometry = useMemo(() => {
    if (pathPoints.length < 2) return null;
    const geo = new THREE.BufferGeometry().setFromPoints(
      pathPoints.map(p => new THREE.Vector3(p.x, p.y + 0.4, p.z))
    );
    return geo;
  }, [pathPoints]);

  if (!geometry) return null;

  return (
    // @ts-ignore
    <line geometry={geometry}>
      <lineBasicMaterial color="#d1d5db" opacity={0.25} transparent linewidth={1} />
    </line>
  );
});

// ── Mining indicator: pulsing ring at position when robot is mining
const MiningEffect = React.memo(({ position }: { position: [number, number, number] }) => {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      const t = (Math.sin(clock.getElapsedTime() * 8) + 1) / 2;
      ringRef.current.scale.setScalar(0.5 + t * 1.5);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.6 - t * 0.5;
    }
  });
  return (
    <mesh ref={ringRef} position={[position[0], position[1] + 0.4, position[2]]}>
      <torusGeometry args={[0.6, 0.08, 6, 24]} />
      <meshBasicMaterial color="#e5e7eb" transparent opacity={0.6} />
    </mesh>
  );
});

// ── Scenery: 300 rocks as ONE InstancedMesh — 1 draw call total
const SceneryInstanced = React.memo(() => {
  const { scene: rockScene } = useGLTF('/models/Rocks.glb');
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const meshData = useMemo(() => extractFirstMesh(rockScene), [rockScene]);
  const COUNT = 300;

  const matrices = useMemo(() => {
    const mats: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    let idx = 0;
    while (mats.length < COUNT && idx < COUNT * 8) {
      const i = idx++;
      const x = (seededRandom(i * 3, 7) - 0.5) * 1200;
      const z = (seededRandom(i * 3 + 1, 13) - 0.5) * 1200;
      if (Math.abs(x) < 65 && Math.abs(z) < 65) continue;
      const dist = Math.sqrt(x * x + z * z);
      const sc = (seededRandom(i * 3 + 2, 19) * 30 + 10) * (dist > 200 ? dist / 100 : 1);
      // Embed proportionally: larger rocks are buried deeper so they look rooted
      const embedDepth = Math.max(1, sc * 0.08);
      dummy.position.set(x, estimateTerrainHeight(x, z) - embedDepth, z);
      dummy.rotation.set(0, seededRandom(i, 5) * Math.PI * 2, 0);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());
    }
    return mats;
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !matrices.length) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices]);

  if (!meshData) return null;
  return (
    <instancedMesh ref={meshRef} args={[meshData.geo, meshData.mat, COUNT]} castShadow receiveShadow />
  );
});

// ── Rover: no raycasting — uses precomputed terrain heights per path step
const Rover = React.memo(({ pathPoints, stepRef, isMiningRef }: {
  pathPoints: THREE.Vector3[];
  stepRef: React.MutableRefObject<number>;
  isMiningRef: React.MutableRefObject<boolean>;
}) => {
  const { scene } = useGLTF('/models/Rover.glb');
  const roverRef = useRef<THREE.Group>(null);
  const velocityRef = useRef(new THREE.Vector3());
  const headingRef = useRef(new THREE.Vector2(0, 1));
  const yawRef = useRef(0);
  const groundOffset = useMemo(
    () => getModelGroundOffset(scene, '/models/Rover.glb', ROVER_SCALE),
    [scene],
  );

  useEffect(() => {
    if (!roverRef.current || pathPoints.length === 0) return;
    const start = pathPoints[0];
    const y = estimateTerrainHeight(start.x, start.z) + groundOffset + ROVER_GROUND_CLEARANCE;
    roverRef.current.position.set(start.x, y, start.z);
    velocityRef.current.set(0, 0, 0);
  }, [pathPoints, groundOffset]);

  useFrame((_, delta) => {
    if (!roverRef.current || pathPoints.length === 0) return;

    const idx = Math.min(stepRef.current, pathPoints.length - 1);
    const target = pathPoints[idx];
    const position = roverRef.current.position;
    const velocity = velocityRef.current;

    const accelScale = isMiningRef.current ? 6 : 18;
    velocity.x += THREE.MathUtils.clamp((target.x - position.x) * accelScale, -20, 20) * delta;
    velocity.z += THREE.MathUtils.clamp((target.z - position.z) * accelScale, -20, 20) * delta;

    const horizontalDamping = Math.exp(-6 * delta);
    velocity.x *= horizontalDamping;
    velocity.z *= horizontalDamping;

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    if (horizontalSpeed > 16) {
      const scale = 16 / horizontalSpeed;
      velocity.x *= scale;
      velocity.z *= scale;
    }

    position.x += velocity.x * delta;
    position.z += velocity.z * delta;

    const desiredY = estimateTerrainHeight(position.x, position.z) + groundOffset + ROVER_GROUND_CLEARANCE;
    velocity.y += (desiredY - position.y) * 45 * delta;
    velocity.y -= 7.5 * delta;
    velocity.y *= Math.exp(-7 * delta);
    position.y += velocity.y * delta;

    if (position.y < desiredY) {
      position.y = desiredY;
      if (velocity.y < 0) velocity.y = 0;
    }

    if (horizontalSpeed > 0.05) {
      headingRef.current.set(velocity.x, velocity.z).normalize();
    }

    const targetYaw = Math.atan2(headingRef.current.x, headingRef.current.y);
    const yawDiff = ((targetYaw - yawRef.current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    yawRef.current += yawDiff * Math.min(1, 10 * delta);
    roverRef.current.rotation.y = yawRef.current;

    const dirX = headingRef.current.x;
    const dirZ = headingRef.current.y;
    const rightX = dirZ;
    const rightZ = -dirX;
    const sample = 0.9;

    const hFront = estimateTerrainHeight(position.x + dirX * sample, position.z + dirZ * sample);
    const hBack = estimateTerrainHeight(position.x - dirX * sample, position.z - dirZ * sample);
    const hLeft = estimateTerrainHeight(position.x - rightX * sample, position.z - rightZ * sample);
    const hRight = estimateTerrainHeight(position.x + rightX * sample, position.z + rightZ * sample);

    const targetPitch = THREE.MathUtils.clamp(Math.atan2(hBack - hFront, sample * 2), -0.35, 0.35);
    const targetRoll = THREE.MathUtils.clamp(Math.atan2(hLeft - hRight, sample * 2), -0.35, 0.35);

    roverRef.current.rotation.x = THREE.MathUtils.lerp(
      roverRef.current.rotation.x,
      targetPitch,
      Math.min(1, 8 * delta),
    );
    roverRef.current.rotation.z = THREE.MathUtils.lerp(
      roverRef.current.rotation.z,
      targetRoll,
      Math.min(1, 8 * delta),
    );

    if (isMiningRef.current) {
      const vibration = Math.sin(Date.now() * 0.025) * 0.004;
      roverRef.current.position.y += vibration;
    }
  });

  return (
    <group ref={roverRef}>
      <Clone object={scene} scale={ROVER_SCALE} castShadow receiveShadow />
    </group>
  );
});

// ── All obstacles as ONE InstancedMesh — 1 draw call total
const ObstaclesInstanced = React.memo(({ map }: { map: MapData }) => {
  const { scene: rockScene } = useGLTF('/models/Rocks.glb');
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const meshData = useMemo(() => extractFirstMesh(rockScene), [rockScene]);

  const transforms = useMemo(() => {
    const result: { x: number; y: number; z: number; rot: number }[] = [];
    map.grid.forEach((row, gridY) =>
      row.forEach((cell, gridX) => {
        if (cell !== '#') return;
        const [wx, , wz] = getRandomizedPosition(gridX, gridY, OBSTACLE_RANDOM_OFFSET);
        result.push({ x: wx, y: estimateTerrainHeight(wx, wz) + OBSTACLE_HEIGHT_OFFSET, z: wz, rot: getRandomRotation(gridX, gridY) });
      })
    );
    return result;
  }, [map]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !transforms.length || !meshData) return;
    const dummy = new THREE.Object3D();
    transforms.forEach(({ x, y, z, rot }, i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(OBSTACLE_SCALE);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms, meshData]);

  if (!meshData || !transforms.length) return null;
  return (
    <instancedMesh ref={meshRef} args={[meshData.geo, meshData.mat, transforms.length]} castShadow receiveShadow />
  );
});

// ── Individual mineral with React.memo: only re-renders when collected changes
const Mineral = React.memo(({ position, type, rotation, collected }: {
  position: [number, number, number];
  type: 'Y' | 'B' | 'G';
  rotation: number;
  collected: boolean;
}) => {
  const modelPath = type === 'Y' ? '/models/Gold ore.glb' : '/models/Crystal.glb';
  const { scene } = useGLTF(modelPath);
  const mineralRef = useRef<THREE.Group>(null);
  const scale = type === 'Y' ? GOLD_SCALE : MINERAL_SCALE;
  const groundOffset = useMemo(
    () => getModelGroundOffset(scene, modelPath, scale),
    [scene, modelPath, scale],
  );
  const yPos = useMemo(
    () => estimateTerrainHeight(position[0], position[2]) + groundOffset - MINERAL_EMBED_DEPTH,
    [position, groundOffset],
  );
  // Use separate ref to track collected to avoid stale closure in useFrame
  const collectedRef = useRef(collected);
  useEffect(() => { collectedRef.current = collected; }, [collected]);
  const scaleRef = useRef(1);

  // Emissive materials so crystals glow and are visible at night
  const inject = useMemo(() => {
    if (type === 'B') return (
      <meshStandardMaterial
        color="#2266ff"
        emissive="#0033aa"
        emissiveIntensity={0.6}
        roughness={0.2}
        metalness={0.1}
      />
    );
    if (type === 'G') return (
      <meshStandardMaterial
        color="#22ee55"
        emissive="#005522"
        emissiveIntensity={0.6}
        roughness={0.2}
        metalness={0.1}
      />
    );
    // Gold ore uses its own GLTF material — add emissive via traversal effect below
    return undefined;
  }, [type]);

  // Make gold ore emissive so it's visible at night
  const cloneRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (type !== 'Y' || !cloneRef.current) return;
    cloneRef.current.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat && mat.isMeshStandardMaterial) {
          mat.emissive = new THREE.Color('#332200');
          mat.emissiveIntensity = 0.4;
          mat.needsUpdate = true;
        }
      }
    });
  }, [type, scene]);

  useFrame((_, delta) => {
    if (!mineralRef.current) return;
    scaleRef.current = collectedRef.current
      ? Math.max(0, scaleRef.current - delta * 6)   // shrink to 0 in ~0.17s
      : Math.min(1, scaleRef.current + delta * 4);
    mineralRef.current.scale.setScalar(scale * scaleRef.current);
    // Hide completely once fully shrunk (avoids z-fighting at scale≈0)
    mineralRef.current.visible = scaleRef.current > 0.01;
  });

  return (
    <group ref={mineralRef} position={[position[0], yPos, position[2]]} rotation={[0, rotation, 0]} scale={scale}>
      <Clone ref={cloneRef} object={scene} scale={1} castShadow receiveShadow inject={inject} />
    </group>
  );
}, (prev, next) => prev.collected === next.collected);

// ── Minerals isolated in their own component: only re-renders when collectedStep changes
const MapMinerals = React.memo(({ map, mineralCollectionMap, collectedStep }: {
  map: MapData;
  mineralCollectionMap: Map<string, number>;
  collectedStep: number;
}) => (
  <>
    {map.grid.map((row, y) =>
      row.map((cell, x) => {
        if (cell !== 'Y' && cell !== 'B' && cell !== 'G') return null;
        const collectedAt = mineralCollectionMap.get(`${y}_${x}`);
        return (
          <Mineral
            key={`min-${x}-${y}`}
            position={getPosition(x, y)}
            type={cell as 'Y' | 'B' | 'G'}
            rotation={getRandomRotation(x, y)}
            collected={collectedAt !== undefined && collectedAt <= collectedStep}
          />
        );
      })
    )}
  </>
));

// Terrain: 64×64 segments = 16× fewer triangles vs 256×256 → much faster raycasts and init
const MarsSurface = React.memo(() => {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!meshRef.current) return;
    const geometry = meshRef.current.geometry as THREE.PlaneGeometry;
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, estimateTerrainHeight(pos.getX(i), pos.getY(i)));
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }, []);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow castShadow>
      <planeGeometry args={[3000, 3000, 64, 64]} />
      <meshStandardMaterial color="#C1440E" roughness={0.95} metalness={0.05} />
    </mesh>
  );
});

const CameraController = ({
  targetRef,
  cameraModeRef,
}: {
  targetRef: React.MutableRefObject<THREE.Vector3>;
  cameraModeRef: React.MutableRefObject<CameraMode>;
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const prevModeRef = useRef<CameraMode>('follow');
  const smoothTarget = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;

    const mode = cameraModeRef.current;

    // On mode switch: reposition camera smoothly
    if (prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      if (mode === 'overview') {
        camera.position.set(0, 120, 0.1);
        ctrl.target.set(0, 0, 0);
        smoothTarget.current.set(0, 0, 0);
        ctrl.update();
      }
    }

    if (mode === 'follow') {
      // Very fast lerp so camera never falls behind the rover
      const lerpFactor = Math.min(1, 14 * delta);
      smoothTarget.current.lerp(targetRef.current, lerpFactor);
      ctrl.target.copy(smoothTarget.current);
      ctrl.update();
    } else {
      // overview: free orbit, no forced tracking
      ctrl.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={true}
      enableZoom={true}
      minDistance={5}
      maxDistance={300}
      enableRotate={true}
      maxPolarAngle={Math.PI / 2.2}
      minPolarAngle={0}
    />
  );
};

// ── Core animation controller
const SimulationController = ({
  simulationResult, isPlayingRef, stepRef, isMiningRef,
  cameraTargetRef, pathPoints, pathHeights, stepDuration, speedRef, onStepBatch, onComplete,
}: {
  simulationResult: SimulationResult;
  isPlayingRef: React.MutableRefObject<boolean>;
  stepRef: React.MutableRefObject<number>;
  isMiningRef: React.MutableRefObject<boolean>;
  cameraTargetRef: React.MutableRefObject<THREE.Vector3>;
  pathPoints: THREE.Vector3[];
  pathHeights: number[];
  stepDuration: number;
  speedRef: React.MutableRefObject<number>;
  onStepBatch: (step: number) => void;
  onComplete: () => void;
}) => {
  const timerRef = useRef(0);
  const completedRef = useRef(false);

  useFrame((_, delta) => {
    if (!isPlayingRef.current || completedRef.current) return;
    const effectiveDuration = stepDuration / Math.max(0.1, speedRef.current);
    timerRef.current += delta;

    let processed = 0;
    while (timerRef.current >= effectiveDuration && processed < 200 && !completedRef.current) {
      timerRef.current -= effectiveDuration;
      processed++;

      const maxStep = simulationResult.path.length - 1;
      if (stepRef.current >= maxStep) {
        completedRef.current = true;
        onComplete();
        break;
      }
      stepRef.current++;
      const step = stepRef.current;

      const log = simulationResult.logs[step] ?? null;
      isMiningRef.current = log ? log.action === 'mine' : false;

      // Update camera target with correct terrain height
      if (pathPoints[step]) {
        cameraTargetRef.current.set(pathPoints[step].x, (pathHeights[step] ?? 0) + 2, pathPoints[step].z);
      }

      onStepBatch(step);
    }
  });

  return null;
};

// ── Main scene component
const Scene: React.FC<SceneProps> = ({
  map,
  simulationResult,
  isPlaying,
  stepDurationSec = 0.06,
  onStep,
  onComplete,
}) => {
  const stepRef = useRef(0);
  const isMiningRef = useRef(false);
  const isPlayingRef = useRef(false);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 2, 0));

  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const [localPaused, setLocalPaused] = useState(false);

  const [cameraMode, setCameraMode] = useState<CameraMode>('follow');
  const cameraModeRef = useRef<CameraMode>('follow');
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);

  useEffect(() => {
    isPlayingRef.current = isPlaying && !localPaused;
  }, [isPlaying, localPaused]);

  // Reset on new simulation
  useEffect(() => {
    if (isPlaying) {
      stepRef.current = 0;
      isMiningRef.current = false;
      setLocalPaused(false);
      setCollectedStep(0);
      if (simulationResult) {
        const [row, col] = simulationResult.start;
        cameraTargetRef.current.set(col * CELL_SIZE - OFFSET, 2, row * CELL_SIZE - OFFSET);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  const pathPoints = useMemo<THREE.Vector3[]>(() => {
    if (!simulationResult) return [];
    return simulationResult.path.map(([row, col]) =>
      new THREE.Vector3(col * CELL_SIZE - OFFSET, 0, row * CELL_SIZE - OFFSET)
    );
  }, [simulationResult]);

  // Precomputed terrain heights — eliminates per-frame raycasting entirely
  const pathHeights = useMemo<number[]>(() =>
    pathPoints.map(p => estimateTerrainHeight(p.x, p.z))
  , [pathPoints]);

  const mineralCollectionMap = useMemo(() => {
    const m = new Map<string, number>();
    simulationResult?.minerals.forEach(min => m.set(`${min.pos[0]}_${min.pos[1]}`, min.step));
    return m;
  }, [simulationResult]);

  const [collectedStep, setCollectedStep] = useState(0);

  const handleStepBatch = useCallback((step: number) => {
    setCollectedStep(step);
    onStep?.(step);
  }, [onStep]);

  const handleComplete = useCallback(() => {
    isPlayingRef.current = false;
    onComplete?.();
  }, [onComplete]);

  // isDay — only triggers re-render when it actually changes (day/night flip)
  const [isDay, setIsDay] = useState(true);
  const prevIsDayRef = useRef(true);
  useEffect(() => {
    if (!simulationResult?.logs?.length) return;
    const log = simulationResult.logs[Math.min(collectedStep, simulationResult.logs.length - 1)];
    const nowDay = log?.is_day ?? true;
    if (nowDay !== prevIsDayRef.current) { prevIsDayRef.current = nowDay; setIsDay(nowDay); }
  }, [simulationResult, collectedStep]);

  const startPos: [number, number, number] = useMemo(() => {
    if (simulationResult) {
      const [row, col] = simulationResult.start;
      return [col * CELL_SIZE - OFFSET, 14, row * CELL_SIZE - OFFSET + 18];
    }
    return [0, 14, 18];
  }, [simulationResult]);

  const roverInitPoint = useMemo(() => {
    if (pathPoints.length > 0) return pathPoints[0];
    if (simulationResult) {
      const [row, col] = simulationResult.start;
      return new THREE.Vector3(col * CELL_SIZE - OFFSET, 0, row * CELL_SIZE - OFFSET);
    }
    return new THREE.Vector3(0, 0, 0);
  }, [pathPoints, simulationResult]);

  const currentRoverPos: [number, number, number] = useMemo(() => {
    if (!pathPoints.length) return [0, 0, 0];
    const idx = Math.min(collectedStep, pathPoints.length - 1);
    return [pathPoints[idx].x, pathHeights[idx] ?? 0, pathPoints[idx].z];
  }, [pathPoints, pathHeights, collectedStep]);

  const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20];
  const canPlay = !!simulationResult;
  const isActivelyPlaying = isPlaying && !localPaused;

  return (
    <div className="w-full h-screen absolute inset-0 z-0">
      <Canvas
        shadows
        camera={{ position: startPos, fov: 60, far: RENDER_DISTANCE * 2, near: 0.1 }}
        gl={{ logarithmicDepthBuffer: true }}
        frameloop="always"
      >
        <Suspense fallback={null}>
          {isDay ? (
            <>
              <Sky sunPosition={[100, 20, 100]} turbidity={0.1} rayleigh={0.5} />
              <ambientLight intensity={0.55} />
              <directionalLight
                position={[50, 50, 20]}
                intensity={1.35}
                castShadow
                shadow-mapSize={[1024, 1024]}
                shadow-camera-far={150}
                shadow-camera-left={-80}
                shadow-camera-right={80}
                shadow-camera-top={80}
                shadow-camera-bottom={-80}
              />
            </>
          ) : (
            <>
              <Stars radius={100} depth={50} count={4000} factor={4} saturation={0} fade speed={1} />
              <ambientLight intensity={0.62} color="#b8c0d0" />
              <hemisphereLight intensity={0.38} color="#d5deef" groundColor="#1c2230" />
              <directionalLight position={[-60, 80, -30]} intensity={0.55} color="#dbe4f2" />
              <pointLight position={currentRoverPos} intensity={5} distance={46} color="#f8fafc" castShadow />
            </>
          )}

          <MarsSurface />
          <SceneryInstanced />

          {pathPoints.length > 0 && <PathLine pathPoints={pathPoints} />}

          {/* Single draw call for all obstacles */}
          <ObstaclesInstanced map={map} />

          {/* Isolated mineral component — only re-renders when collectedStep changes */}
          <MapMinerals map={map} mineralCollectionMap={mineralCollectionMap} collectedStep={collectedStep} />

          {isMiningRef.current && <MiningEffect position={currentRoverPos} />}

          <Rover
            pathPoints={pathPoints.length > 0 ? pathPoints : [roverInitPoint]}
            stepRef={stepRef}
            isMiningRef={isMiningRef}
          />

          {simulationResult && isPlaying && (
            <SimulationController
              key={`sim-${simulationResult.steps_used}`}
              simulationResult={simulationResult}
              isPlayingRef={isPlayingRef}
              stepRef={stepRef}
              isMiningRef={isMiningRef}
              cameraTargetRef={cameraTargetRef}
              pathPoints={pathPoints}
              pathHeights={pathHeights}
              stepDuration={stepDurationSec}
              speedRef={speedRef}
              onStepBatch={handleStepBatch}
              onComplete={handleComplete}
            />
          )}

          <fog attach="fog" args={[isDay ? '#d28c63' : '#111827', 90, RENDER_DISTANCE]} />
          <CameraController targetRef={cameraTargetRef} cameraModeRef={cameraModeRef} />
        </Suspense>
      </Canvas>

      {/* ── Simulation controls overlay ── */}
      {canPlay && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'auto',
            userSelect: 'none',
          }}
        >
          {/* Speed buttons */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              background: 'rgba(3,7,18,0.75)',
              border: '1px solid #374151',
              borderRadius: 8,
              padding: '4px 8px',
              backdropFilter: 'blur(8px)',
            }}
          >
            <span style={{ color: '#9ca3af', fontSize: 11, alignSelf: 'center', marginRight: 4 }}>Sebesség</span>
            {SPEEDS.map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                style={{
                  background: speed === s ? '#f3f4f6' : 'transparent',
                  border: '1px solid ' + (speed === s ? '#f3f4f6' : '#4b5563'),
                  borderRadius: 5,
                  color: speed === s ? '#030712' : '#d1d5db',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  minWidth: 36,
                  transition: 'all 0.1s',
                }}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Play / Pause + Camera mode */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              background: 'rgba(3,7,18,0.75)',
              border: '1px solid #374151',
              borderRadius: 8,
              padding: '6px 12px',
              alignItems: 'center',
              backdropFilter: 'blur(8px)',
            }}
          >
            {/* Pause / Resume */}
            <button
              onClick={() => setLocalPaused(p => !p)}
              disabled={!isPlaying}
              style={{
                background: isActivelyPlaying ? 'transparent' : '#f3f4f6',
                border: '1px solid ' + (isActivelyPlaying ? '#4b5563' : '#f3f4f6'),
                borderRadius: 6,
                color: isActivelyPlaying ? '#d1d5db' : '#030712',
                fontSize: 18,
                padding: '4px 14px',
                cursor: isPlaying ? 'pointer' : 'not-allowed',
                opacity: isPlaying ? 1 : 0.4,
                transition: 'all 0.15s',
                lineHeight: 1,
              }}
              title={localPaused ? 'Folytatás' : 'Megállítás'}
            >
              {localPaused || !isPlaying ? '▶' : '⏸'}
            </button>

            <div style={{ width: 1, height: 24, background: '#374151' }} />

            {/* Camera mode toggle */}
            <button
              onClick={() => setCameraMode(m => m === 'follow' ? 'overview' : 'follow')}
              style={{
                background: cameraMode === 'follow' ? '#f3f4f6' : 'transparent',
                border: '1px solid ' + (cameraMode === 'follow' ? '#f3f4f6' : '#4b5563'),
                borderRadius: 6,
                color: cameraMode === 'follow' ? '#030712' : '#d1d5db',
                fontSize: 11,
                fontFamily: 'monospace',
                fontWeight: 700,
                padding: '5px 12px',
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              title="Kamera váltás: rover követés / térkép nézet"
            >
              {cameraMode === 'follow' ? 'Követés' : 'Áttekintés'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scene;