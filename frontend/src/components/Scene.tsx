import React, { useRef, useEffect, Suspense, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars, useGLTF, Clone, OrbitControls, ContactShadows, Environment, Float, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette, ToneMapping } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MapData, SimulationResult, CameraMode } from '../types';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

// Preload models
useGLTF.preload('/models/Rover.glb');
useGLTF.preload('/models/Rocks.glb');
useGLTF.preload('/models/Gold ore.glb');
useGLTF.preload('/models/Crystal.glb');
useGLTF.preload('/models/nagykavics.glb');
useGLTF.preload('/models/szikla.glb');

interface SceneProps {
  map: MapData;
  simulationResult: SimulationResult | null;
  isPlaying: boolean;
  stepDurationSec?: number;
  onStep?: (step: number) => void;
  onComplete?: () => void;
  stepOverride?: number | null;
  showEnergyHeatmap?: boolean;
  photoMode?: boolean;
  hideHudOverlay?: boolean;
  cameraMode?: CameraMode;
}

// ==== SETTINGS ====
const ROVER_GROUND_CLEARANCE = 0.04;
const ROVER_SCALE = 0.7;
const OBSTACLE_GROUND_CLEARANCE = 0.03;
const OBSTACLE_SCALE = 4.5;
const MINERAL_GROUND_CLEARANCE = 0.02;
const GOLD_GROUND_CLEARANCE = 0.04;
const MINERAL_SCALE = 0.15;
const GOLD_SCALE = 5;
const MINERAL_RANDOM_OFFSET = 0.6;
const RENDER_DISTANCE = 1400;
const TERRAIN_SIZE = 2200;
const TERRAIN_SEGMENTS = 250;
const ARRIVAL_THRESHOLD = 0.2;
const CAMERA_GROUND_CLEARANCE = 2.3;
const DETACHED_CAMERA_HALF_EXTENT = 60;
const DETACHED_CAMERA_MAX_HEIGHT = 240;
// ==================

const GRID_SIZE = 50;
const CELL_SIZE = 2;
const OFFSET = (GRID_SIZE * CELL_SIZE) / 2;

// The play area edge in world coords
const PLAY_EDGE = OFFSET + 12; // Pushed out further so minerals don't hit the rim
const RIM_WIDTH = 18;     // Wider, smoother transition
const RIM_HEIGHT = 4;     // Slightly lower rim for better visibility

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

const terrainJitter = (wx: number, wz: number): number => {
  const qx = Math.floor((wx + 4000) * 2);
  const qz = Math.floor((wz + 4000) * 2);
  return (seededRandom(qx, qz) - 0.5) * 0.24;
};

/**
 * Smooth ease-in-out: t in [0,1] -> [0,1]
 */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * Terrain height at world (wx, wz).
 *
 * Design:
 *  - Inside the 50×50 play area: essentially flat (height ≈ 0)
 *  - Crater rim ring: smooth rise up to RIM_HEIGHT
 *  - Outside rim: Mars terrain with rolling hills + macro hills
 */
const estimateTerrainHeight = (wx: number, wz: number): number => {
  // Distance from play-area edge (0 inside, positive outside)
  const dE = Math.max(Math.abs(wx) - PLAY_EDGE, Math.abs(wz) - PLAY_EDGE, 0);

  // Inside the play area — flat with very subtle micro-variation
  if (dE <= 0) {
    return terrainJitter(wx, wz) * 0.12;
  }

  // Crater rim profile: rises up then descends into outer terrain
  const rimT = Math.min(dE / RIM_WIDTH, 1);
  const rimProfile = Math.sin(rimT * Math.PI) * RIM_HEIGHT; // bell curve: 0 → peak → 0

  // Outer terrain: multi-octave sine hills (only active beyond rim)
  const outerT = Math.max(0, (dE - RIM_WIDTH * 0.3) / (RIM_WIDTH * 0.7)); // ramp from 0 at 30% into rim
  const outerBlend = Math.min(outerT, 1);

  const x = wx, y = wz;
  const hills =
    Math.sin(x * 0.012 + 0.3) * Math.cos(y * 0.015 + 0.7) * 5.0 +
    Math.sin(x * 0.022 - 1.2) * Math.cos(y * 0.018 + 2.1) * 3.0 +
    Math.sin(x * 0.04 + 0.8) * Math.cos(y * 0.03 - 0.5) * 1.5 +
    Math.sin(x * 0.08) * Math.cos(y * 0.07 + 1.0) * 0.5 +
    terrainJitter(wx, wz);

  // Macro hills grow with distance for epic far-away mountains
  const dist = Math.sqrt(wx * wx + wz * wz);
  const macroHills = dist > 120 ? Math.sin(x * 0.008) * Math.cos(y * 0.009) * (dist / 15) : 0;

  // Base elevation so outer terrain sits at rim-height level
  const outerBase = RIM_HEIGHT * 0.15;

  return rimProfile + outerBlend * (hills + macroHills + outerBase);
};

/** Extract first mesh geometry+material from a GLTF scene. */
function extractFirstMesh(gltfScene: THREE.Group): { geo: THREE.BufferGeometry; mat: THREE.Material } | null {
  gltfScene.updateWorldMatrix(true, true);
  let result: { geo: THREE.BufferGeometry; mat: THREE.Material } | null = null;
  gltfScene.traverse(child => {
    if (!result && (child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      const geo = m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      geo.computeBoundingBox();
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      result = { geo, mat };
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
  const rawOffset = Number.isFinite(box.min.y) ? -box.min.y * scale : 0;
  const offset = Math.max(0, rawOffset);
  MODEL_GROUND_OFFSET_CACHE.set(key, offset);
  return offset;
}

// ── Path lines: future guide + traversed route (thick, static, cinematic)
const PathLine = React.memo(({ pathPoints, currentStep }: { pathPoints: THREE.Vector3[]; currentStep: number }) => {
  const traversedPoints = useMemo(() => {
    if (pathPoints.length < 2) return [] as THREE.Vector3[];
    const end = Math.min(Math.max(currentStep, 1), pathPoints.length - 1);
    return pathPoints
      .slice(0, end + 1)
      .map((point) => new THREE.Vector3(point.x, point.y + 0.52, point.z));
  }, [pathPoints, currentStep]);

  const futurePoints = useMemo(() => {
    if (pathPoints.length < 2) return [] as THREE.Vector3[];
    const start = Math.min(Math.max(currentStep, 0), pathPoints.length - 1);
    return pathPoints
      .slice(start)
      .map((point) => new THREE.Vector3(point.x, point.y + 0.48, point.z));
  }, [pathPoints, currentStep]);

  const traversedCoreGeometry = useMemo(() => {
    if (traversedPoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(traversedPoints, false, 'catmullrom', 0.08);
    const tubularSegments = Math.max(28, traversedPoints.length * 7);
    return new THREE.TubeGeometry(curve, tubularSegments, 0.2, 14, false);
  }, [traversedPoints]);

  const traversedGlowGeometry = useMemo(() => {
    if (traversedPoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(traversedPoints, false, 'catmullrom', 0.08);
    const tubularSegments = Math.max(28, traversedPoints.length * 7);
    return new THREE.TubeGeometry(curve, tubularSegments, 0.34, 12, false);
  }, [traversedPoints]);

  const futureCoreGeometry = useMemo(() => {
    if (futurePoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(futurePoints, false, 'catmullrom', 0.08);
    const tubularSegments = Math.max(24, futurePoints.length * 6);
    return new THREE.TubeGeometry(curve, tubularSegments, 0.13, 10, false);
  }, [futurePoints]);

  const futureGlowGeometry = useMemo(() => {
    if (futurePoints.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(futurePoints, false, 'catmullrom', 0.08);
    const tubularSegments = Math.max(24, futurePoints.length * 6);
    return new THREE.TubeGeometry(curve, tubularSegments, 0.24, 10, false);
  }, [futurePoints]);

  useEffect(() => {
    return () => {
      traversedCoreGeometry?.dispose();
      traversedGlowGeometry?.dispose();
      futureCoreGeometry?.dispose();
      futureGlowGeometry?.dispose();
    };
  }, [traversedCoreGeometry, traversedGlowGeometry, futureCoreGeometry, futureGlowGeometry]);

  if (!traversedCoreGeometry && !futureCoreGeometry) return null;

  return (
    <>
      {futureGlowGeometry && (
        <mesh geometry={futureGlowGeometry} renderOrder={4}>
          <meshBasicMaterial
            color="#75d4ef"
            transparent
            opacity={0.16}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {futureCoreGeometry && (
        <mesh geometry={futureCoreGeometry} renderOrder={5}>
          <meshStandardMaterial
            color="#9ee9ff"
            emissive="#4aa9bd"
            emissiveIntensity={0.42}
            roughness={0.38}
            metalness={0.08}
            transparent
            opacity={0.66}
          />
        </mesh>
      )}

      {traversedGlowGeometry && (
        <mesh geometry={traversedGlowGeometry} renderOrder={6}>
          <meshBasicMaterial
            color="#f8bd70"
            transparent
            opacity={0.28}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {traversedCoreGeometry && (
        <mesh geometry={traversedCoreGeometry} renderOrder={7}>
          <meshStandardMaterial
            color="#ffd08a"
            emissive="#c98337"
            emissiveIntensity={0.72}
            roughness={0.26}
            metalness={0.15}
          />
        </mesh>
      )}
    </>
  );
});

// ── Mining indicator: pulsing ring at position when robot is mining
const MiningEffect = React.memo(({ position }: { position: [number, number, number] }) => {
  const ringRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ringRef.current) {
      ringRef.current.scale.setScalar(1.2);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.4;
    }
    if (coreRef.current) {
      coreRef.current.scale.setScalar(0.6);
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = 0.6;
    }
  });
  return (
    <group position={[position[0], position[1] + 0.4, position[2]]}>
      <mesh ref={ringRef}>
        <torusGeometry args={[0.6, 0.08, 6, 24]} />
        <meshBasicMaterial color="#e5e7eb" transparent opacity={0.6} />
      </mesh>
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.24, 12, 12]} />
        <meshBasicMaterial color="#fff7d8" transparent opacity={0.45} />
      </mesh>
    </group>
  );
});

const EnergyHeatmapOverlay = React.memo(({ map, start, visible }: { map: MapData; start: [number, number]; visible: boolean }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const data = useMemo(() => {
    const result: { x: number; y: number; z: number; color: THREE.Color }[] = [];
    const [startRow, startCol] = start;
    const maxDist = Math.sqrt(map.grid.length * map.grid.length + (map.grid[0]?.length ?? map.grid.length) ** 2) / 2;

    for (let row = 0; row < map.grid.length; row++) {
      for (let col = 0; col < map.grid[row].length; col++) {
        if (map.grid[row][col] === '#') continue;

        const wx = col * CELL_SIZE - OFFSET;
        const wz = row * CELL_SIZE - OFFSET;
        const distance = Math.sqrt((row - startRow) ** 2 + (col - startCol) ** 2);
        const distanceRisk = Math.min(distance / Math.max(maxDist, 1), 1);

        let obstaclePenalty = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (oy === 0 && ox === 0) continue;
            const ny = row + oy;
            const nx = col + ox;
            if (ny < 0 || nx < 0 || ny >= map.grid.length || nx >= map.grid[0].length) continue;
            if (map.grid[ny][nx] === '#') obstaclePenalty += 0.04;
          }
        }

        const risk = Math.min(distanceRisk + obstaclePenalty, 1);
        const color = new THREE.Color().setRGB(
          THREE.MathUtils.lerp(0.14, 0.95, risk),
          THREE.MathUtils.lerp(0.82, 0.24, risk),
          0.18,
        );

        result.push({
          x: wx,
          y: estimateTerrainHeight(wx, wz) + 0.07,
          z: wz,
          color,
        });
      }
    }
    return result;
  }, [map, start]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || !visible) return;
    const dummy = new THREE.Object3D();

    data.forEach((entry, index) => {
      dummy.position.set(entry.x, entry.y, entry.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(0.95, 0.95, 0.95);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, entry.color);
    });

    mesh.count = data.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [data, visible]);

  if (!visible || data.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, data.length]}>
      <planeGeometry args={[CELL_SIZE * 0.95, CELL_SIZE * 0.95]} />
      <meshBasicMaterial vertexColors transparent opacity={0.25} depthWrite={false} />
    </instancedMesh>
  );
});

const BaseBeacon = React.memo(({ position }: { position: [number, number, number] }) => {
  return (
    <group position={[position[0], estimateTerrainHeight(position[0], position[2]) + 0.2, position[2]]}>
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.2, 32]} />
        <meshBasicMaterial color="#9fe3ff" />
      </mesh>
      <pointLight position={[0, 0.6, 0]} intensity={1.1} distance={30} color="#8dd9ff" />
    </group>
  );
});

const RoverHeadlights = React.memo(({
  position,
  heading,
  active,
}: {
  position: [number, number, number];
  heading: THREE.Vector3;
  active: boolean;
}) => {
  const leftTarget = useMemo(() => new THREE.Object3D(), []);
  const rightTarget = useMemo(() => new THREE.Object3D(), []);
  const leftRef = useRef<THREE.SpotLight>(null);
  const rightRef = useRef<THREE.SpotLight>(null);

  useFrame(() => {
    if (!active || !leftRef.current || !rightRef.current) return;
    const normalized = heading.lengthSq() > 0.0001 ? heading.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3(normalized.z, 0, -normalized.x).normalize();

    const base = new THREE.Vector3(position[0], position[1] + 1.0, position[2]);
    const forward = normalized.clone().multiplyScalar(1.2);
    const leftPos = base.clone().add(forward).add(right.clone().multiplyScalar(-0.36));
    const rightPos = base.clone().add(forward).add(right.clone().multiplyScalar(0.36));
    const targetPos = base.clone().add(normalized.clone().multiplyScalar(7));

    leftRef.current.position.copy(leftPos);
    rightRef.current.position.copy(rightPos);
    leftTarget.position.copy(targetPos.clone().add(right.clone().multiplyScalar(-0.2)));
    rightTarget.position.copy(targetPos.clone().add(right.clone().multiplyScalar(0.2)));
    leftRef.current.target = leftTarget;
    rightRef.current.target = rightTarget;
  });

  if (!active) return null;

  return (
    <>
      <primitive object={leftTarget} />
      <primitive object={rightTarget} />
      <spotLight ref={leftRef} intensity={3.1} distance={26} angle={0.34} penumbra={0.6} color="#f8fcff" />
      <spotLight ref={rightRef} intensity={3.1} distance={26} angle={0.34} penumbra={0.6} color="#f8fcff" />
    </>
  );
});

const RoverDustTrail = React.memo(({
  position,
  heading,
  active,
}: {
  position: [number, number, number];
  heading: THREE.Vector3;
  active: boolean;
}) => {
  const trailRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!trailRef.current) return;
    if (!active) {
      (trailRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      return;
    }

    const normalized = heading.lengthSq() > 0.0001 ? heading.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const pos = new THREE.Vector3(position[0], position[1] + 0.05, position[2]).add(normalized.multiplyScalar(-1.3));
    trailRef.current.position.copy(pos);
    trailRef.current.rotation.y = Math.atan2(normalized.x, normalized.z);

    const flicker = (Math.sin(clock.getElapsedTime() * 12) + 1) / 2;
    trailRef.current.scale.setScalar(0.9 + flicker * 0.5);
    (trailRef.current.material as THREE.MeshBasicMaterial).opacity = 0.08 + flicker * 0.08;
  });

  return (
    <mesh ref={trailRef} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.8, 2.2, 24]} />
      <meshBasicMaterial color="#cca17e" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
});

// ── Scenery: dense deterministic Mars rock field (outside mission area)
const SceneryInstanced = React.memo(() => {
  const { scene: boulderScene } = useGLTF('/models/nagykavics.glb');
  const { scene: cliffRockScene } = useGLTF('/models/szikla.glb');

  const boulderMeshRef = useRef<THREE.InstancedMesh>(null);
  const cliffRockMeshRef = useRef<THREE.InstancedMesh>(null);

  const boulderMeshData = useMemo(() => extractFirstMesh(boulderScene), [boulderScene]);
  const cliffRockMeshData = useMemo(() => extractFirstMesh(cliffRockScene), [cliffRockScene]);

  type RockBoundsInfo = {
    baseSize: number;
    supportPoints: THREE.Vector3[];
    floatCheckPoints: THREE.Vector3[];
    footprintRadius: number;
  };

  const getRockBounds = useCallback((geometry: THREE.BufferGeometry): RockBoundsInfo => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5),
    );

    const size = new THREE.Vector3();
    box.getSize(size);
    const baseSize = Math.max(size.x, size.y, size.z, 0.001);

    const supportPoints: THREE.Vector3[] = [];
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const minY = box.min.y;
    const lowBand = Math.max(size.y * 0.22, 0.08);
    if (pos) {
      const stride = Math.max(1, Math.floor(pos.count / 900));
      for (let i = 0; i < pos.count; i += stride) {
        const y = pos.getY(i);
        if (y <= minY + lowBand) {
          supportPoints.push(new THREE.Vector3(pos.getX(i), y, pos.getZ(i)));
        }
      }
    }

    if (supportPoints.length < 36) {
      const steps = [0, 0.2, 0.4, 0.6, 0.8, 1];
      for (let xi = 0; xi < steps.length; xi++) {
        for (let zi = 0; zi < steps.length; zi++) {
          supportPoints.push(
            new THREE.Vector3(
              THREE.MathUtils.lerp(box.min.x, box.max.x, steps[xi]),
              minY,
              THREE.MathUtils.lerp(box.min.z, box.max.z, steps[zi]),
            ),
          );
        }
      }
    }

    const maxSupportPoints = 420;
    if (supportPoints.length > maxSupportPoints) {
      const trimmed: THREE.Vector3[] = [];
      const pickStride = Math.ceil(supportPoints.length / maxSupportPoints);
      for (let i = 0; i < supportPoints.length && trimmed.length < maxSupportPoints; i += pickStride) {
        trimmed.push(supportPoints[i]);
      }
      supportPoints.length = 0;
      supportPoints.push(...trimmed);
    }

    let footprintRadius = 0;
    for (let i = 0; i < supportPoints.length; i++) {
      const point = supportPoints[i];
      const radius = Math.hypot(point.x, point.z);
      if (radius > footprintRadius) footprintRadius = radius;
    }

    const floatCheckPoints: THREE.Vector3[] = [];
    const checkSteps = [0, 0.17, 0.34, 0.5, 0.66, 0.83, 1];
    for (let xi = 0; xi < checkSteps.length; xi++) {
      for (let zi = 0; zi < checkSteps.length; zi++) {
        floatCheckPoints.push(
          new THREE.Vector3(
            THREE.MathUtils.lerp(box.min.x, box.max.x, checkSteps[xi]),
            minY,
            THREE.MathUtils.lerp(box.min.z, box.max.z, checkSteps[zi]),
          ),
        );
      }
    }

    return {
      baseSize,
      supportPoints,
      floatCheckPoints,
      footprintRadius: Math.max(footprintRadius, 0.2),
    };
  }, []);

  const boulderBounds = useMemo(
    () => (boulderMeshData ? getRockBounds(boulderMeshData.geo) : null),
    [boulderMeshData, getRockBounds],
  );
  const cliffRockBounds = useMemo(
    () => (cliffRockMeshData ? getRockBounds(cliffRockMeshData.geo) : null),
    [cliffRockMeshData, getRockBounds],
  );

  const SCENERY_DENSITY_MULTIPLIER = 1.8;
  const BOULDER_COUNT = Math.floor(760 * SCENERY_DENSITY_MULTIPLIER);
  const CLIFF_ROCK_COUNT = Math.floor(420 * SCENERY_DENSITY_MULTIPLIER);

  const innerRadius = PLAY_EDGE + 28;
  const outerRadius = TERRAIN_SIZE * 0.46;
  const terrainHalf = TERRAIN_SIZE * 0.5 - 10;
  const playableHalf = (GRID_SIZE * CELL_SIZE) / 2;
  const playablePadding = 10;

  const buildMatrices = (
    count: number,
    seedBase: number,
    targetSizeMin: number,
    targetSizeMax: number,
    maxTilt: number,
    embedDepth: number,
    nearBias: number,
    radialJitter: number,
    clusterChance: number,
    baseRotationX: number,
    bounds: RockBoundsInfo | null,
  ): THREE.Matrix4[] => {
    if (!bounds) return [];

    const matrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const transformedSupport = new THREE.Vector3();

    const clusterCenters = Array.from({ length: 34 }, (_, index) => {
      const angle = seededRandom(seedBase + index * 17, 211) * Math.PI * 2;
      const radiusT = Math.pow(seededRandom(seedBase + index * 29, 223), 0.65);
      const radius = THREE.MathUtils.lerp(innerRadius + 40, outerRadius, radiusT);
      return {
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
      };
    });

    let attempts = 0;
    const maxAttempts = count * 28;
    while (matrices.length < count && attempts < maxAttempts) {
      const i = attempts;
      attempts++;
      let x = 0;
      let z = 0;

      const shouldUseCluster = seededRandom(seedBase + i * 7, 307) < clusterChance;
      if (shouldUseCluster) {
        const center = clusterCenters[Math.floor(seededRandom(seedBase + i * 11, 313) * clusterCenters.length)];
        const a = seededRandom(seedBase + i * 13, 317) * Math.PI * 2;
        const r = THREE.MathUtils.lerp(4, 44, seededRandom(seedBase + i * 19, 331));
        x = center.x + Math.cos(a) * r;
        z = center.z + Math.sin(a) * r;
      } else {
        const a = seededRandom(seedBase + i * 23, 347) * Math.PI * 2;
        const radiusT = Math.pow(seededRandom(seedBase + i * 31, 353), nearBias);
        const r = THREE.MathUtils.lerp(innerRadius, outerRadius, radiusT);
        x = Math.cos(a) * r + (seededRandom(seedBase + i * 37, 359) - 0.5) * radialJitter;
        z = Math.sin(a) * r + (seededRandom(seedBase + i * 41, 367) - 0.5) * radialJitter;
      }

      if (Math.abs(x) < innerRadius && Math.abs(z) < innerRadius) {
        if (Math.abs(x) > Math.abs(z)) {
          x = Math.sign(x || 1) * (innerRadius + 6);
        } else {
          z = Math.sign(z || 1) * (innerRadius + 6);
        }
      }

      const dist = Math.sqrt(x * x + z * z);
      const distT = THREE.MathUtils.clamp((dist - innerRadius) / Math.max(outerRadius - innerRadius, 1), 0, 1);
      const targetSize = THREE.MathUtils.lerp(
        targetSizeMin,
        targetSizeMax,
        Math.pow(seededRandom(seedBase + i * 47, 379), 0.85),
      );
      const scale = (targetSize / bounds.baseSize) * THREE.MathUtils.lerp(1.0, 1.38, distT);
      const footprintRadius = Math.max(0.5, bounds.footprintRadius * scale);

      const centerBound = terrainHalf - footprintRadius;
      if (centerBound <= playableHalf + playablePadding) {
        continue;
      }
      x = THREE.MathUtils.clamp(x, -centerBound, centerBound);
      z = THREE.MathUtils.clamp(z, -centerBound, centerBound);

      if (Math.abs(x) < playableHalf + playablePadding && Math.abs(z) < playableHalf + playablePadding) {
        continue;
      }

      const pitch = (seededRandom(seedBase + i * 53, 389) - 0.5) * maxTilt * 0.25;
      const yaw = seededRandom(seedBase + i * 59, 397) * Math.PI * 2;
      const roll = (seededRandom(seedBase + i * 61, 401) - 0.5) * maxTilt * 0.25;
      dummy.rotation.set(baseRotationX + pitch, yaw, roll);
      dummy.scale.setScalar(scale);

      dummy.position.set(0, 0, 0);
      dummy.updateMatrix();

      let settleY = Infinity;
      let minGround = Infinity;
      let maxGround = -Infinity;
      let invalidSupport = false;
      for (let pointIndex = 0; pointIndex < bounds.supportPoints.length; pointIndex++) {
        transformedSupport.copy(bounds.supportPoints[pointIndex]).applyMatrix4(dummy.matrix);
        const sx = x + transformedSupport.x;
        const sz = z + transformedSupport.z;
        if (Math.abs(sx) > terrainHalf || Math.abs(sz) > terrainHalf) {
          invalidSupport = true;
          break;
        }
        if (Math.abs(sx) < playableHalf + 2 && Math.abs(sz) < playableHalf + 2) {
          invalidSupport = true;
          break;
        }

        const supportGround = estimateTerrainHeight(sx, sz);
        const candidateY = supportGround - transformedSupport.y;
        if (candidateY < settleY) {
          settleY = candidateY;
        }
        if (supportGround < minGround) minGround = supportGround;
        if (supportGround > maxGround) maxGround = supportGround;
      }

      if (invalidSupport || !Number.isFinite(settleY)) {
        continue;
      }

      const localRelief = maxGround - minGround;
      if (localRelief > 3.2) {
        continue;
      }

      const settledY = settleY - embedDepth;

      dummy.position.set(x, settledY, z);
      dummy.updateMatrix();

      let maxFloatGap = 0;
      let invalidFloatCheck = false;
      for (let checkIndex = 0; checkIndex < bounds.floatCheckPoints.length; checkIndex++) {
        transformedSupport.copy(bounds.floatCheckPoints[checkIndex]).applyMatrix4(dummy.matrix);
        const wx = transformedSupport.x;
        const wz = transformedSupport.z;
        if (Math.abs(wx) > terrainHalf || Math.abs(wz) > terrainHalf) {
          invalidFloatCheck = true;
          break;
        }
        const ground = estimateTerrainHeight(wx, wz);
        const gap = transformedSupport.y - ground;
        if (gap > maxFloatGap) maxFloatGap = gap;
      }

      if (invalidFloatCheck) {
        continue;
      }

      if (maxFloatGap > 0.003) {
        dummy.position.y -= maxFloatGap + 0.03;
        dummy.updateMatrix();
      }

      matrices.push(dummy.matrix.clone());
    }

    return matrices;
  };

  const boulderMatrices = useMemo(
    () => buildMatrices(BOULDER_COUNT, 5200, 4.2, 9.4, 0.2, 0.045, 0.72, 44, 0.34, 0, boulderBounds),
    [boulderBounds],
  );
  const cliffRockMatrices = useMemo(
    () => buildMatrices(CLIFF_ROCK_COUNT, 9200, 6.4, 13.8, 0.16, 0.05, 0.78, 52, 0.3, 0, cliffRockBounds),
    [cliffRockBounds],
  );

  useEffect(() => {
    const hydrate = (mesh: THREE.InstancedMesh | null, matrices: THREE.Matrix4[]) => {
      if (!mesh || matrices.length === 0) return;
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.count = matrices.length;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
    };

    hydrate(boulderMeshRef.current, boulderMatrices);
    hydrate(cliffRockMeshRef.current, cliffRockMatrices);
  }, [boulderMatrices, cliffRockMatrices]);

  return (
    <group>
      {boulderMeshData && (
        <instancedMesh
          ref={boulderMeshRef}
          args={[boulderMeshData.geo, boulderMeshData.mat, BOULDER_COUNT]}
        />
      )}
      {cliffRockMeshData && (
        <instancedMesh
          ref={cliffRockMeshRef}
          args={[cliffRockMeshData.geo, cliffRockMeshData.mat, CLIFF_ROCK_COUNT]}
        />
      )}
    </group>
  );
});

// ── Rover
const Rover = React.memo(({ pathPoints, stepRef, isMiningRef, roverPosRef, speedRef, wearLevel }: {
  pathPoints: THREE.Vector3[];
  stepRef: React.MutableRefObject<number>;
  isMiningRef: React.MutableRefObject<boolean>;
  roverPosRef: React.MutableRefObject<THREE.Vector3>;
  speedRef: React.MutableRefObject<number>;
  wearLevel: number;
}) => {
  const { scene } = useGLTF('/models/Rover.glb');
  const roverRef = useRef<THREE.Group>(null);
  const velocityRef = useRef(new THREE.Vector3());
  const headingRef = useRef(new THREE.Vector2(0, 1));
  const smoothHeadingRef = useRef(new THREE.Vector2(0, 1));
  const yawRef = useRef(0);
  const currentMoveSpeedRef = useRef(0); // for acceleration/deceleration
  const swayPhaseRef = useRef(0);
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

  useEffect(() => {
    if (!roverRef.current) return;

    roverRef.current.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      materials.forEach((material) => {
        if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
        const stdMaterial = material as THREE.MeshStandardMaterial;

        if (!stdMaterial.userData.baseColor) {
          stdMaterial.userData.baseColor = stdMaterial.color.clone();
        }
        if (stdMaterial.userData.baseRoughness === undefined) {
          stdMaterial.userData.baseRoughness = stdMaterial.roughness;
        }

        const baseColor = stdMaterial.userData.baseColor as THREE.Color;
        const dustyColor = baseColor.clone().lerp(new THREE.Color('#8d6e55'), wearLevel * 0.48);
        stdMaterial.color.copy(dustyColor);
        stdMaterial.roughness = THREE.MathUtils.clamp(
          (stdMaterial.userData.baseRoughness as number) + wearLevel * 0.28,
          0,
          1,
        );
        stdMaterial.needsUpdate = true;
      });
    });
  }, [wearLevel]);

  useFrame((_, rawDelta) => {
    if (!roverRef.current || pathPoints.length === 0) return;
    // Clamp delta to avoid huge jumps on tab-switch or lag spikes
    const delta = Math.min(rawDelta, 0.05);

    const idx = Math.min(stepRef.current, pathPoints.length - 1);
    const target = pathPoints[idx];
    const position = roverRef.current.position;
    const velocity = velocityRef.current;

    const toTargetX = target.x - position.x;
    const toTargetZ = target.z - position.z;
    const horizontalDistance = Math.hypot(toTargetX, toTargetZ);

    const speedMultiplier = Math.max(0.1, speedRef.current);
    const targetMoveSpeed = (isMiningRef.current ? 2.2 : 5.8) * speedMultiplier;

    // Smooth acceleration / deceleration
    const accelRate = horizontalDistance > 0.05 ? 4.0 : 8.0; // accelerate slower, decelerate faster
    const desiredSpeed = horizontalDistance > 0.0001 ? targetMoveSpeed : 0;
    currentMoveSpeedRef.current = THREE.MathUtils.lerp(
      currentMoveSpeedRef.current,
      desiredSpeed,
      Math.min(1, accelRate * delta),
    );
    const moveSpeed = currentMoveSpeedRef.current;

    if (horizontalDistance > 0.0001 && moveSpeed > 0.001) {
      const moveStep = Math.min(horizontalDistance, moveSpeed * delta);
      const moveX = (toTargetX / horizontalDistance) * moveStep;
      const moveZ = (toTargetZ / horizontalDistance) * moveStep;
      position.x += moveX;
      position.z += moveZ;
      velocity.x = moveX / Math.max(delta, 1e-5);
      velocity.z = moveZ / Math.max(delta, 1e-5);
    } else {
      position.x = target.x;
      position.z = target.z;
      velocity.x = THREE.MathUtils.lerp(velocity.x, 0, Math.min(1, 6 * delta));
      velocity.z = THREE.MathUtils.lerp(velocity.z, 0, Math.min(1, 6 * delta));
    }

    // Smooth Y-axis terrain following (reduced from 10 to 4)
    const desiredY = estimateTerrainHeight(position.x, position.z) + groundOffset + ROVER_GROUND_CLEARANCE;
    position.y = THREE.MathUtils.lerp(position.y, desiredY, Math.min(1, 4 * delta));

    // Update shared rover position ref for sync
    roverPosRef.current.copy(position);

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);

    // Update raw heading from velocity
    if (horizontalSpeed > 0.05) {
      headingRef.current.set(velocity.x, velocity.z).normalize();
    }

    // Smooth the heading itself to avoid jittery direction changes
    const smoothRate = Math.min(1, 5 * delta);
    smoothHeadingRef.current.set(
      THREE.MathUtils.lerp(smoothHeadingRef.current.x, headingRef.current.x, smoothRate),
      THREE.MathUtils.lerp(smoothHeadingRef.current.y, headingRef.current.y, smoothRate),
    );
    if (smoothHeadingRef.current.lengthSq() > 0.0001) {
      smoothHeadingRef.current.normalize();
    }

    // Smooth yaw rotation (reduced from 10 to 4)
    const targetYaw = Math.atan2(smoothHeadingRef.current.x, smoothHeadingRef.current.y);
    const yawDiff = ((targetYaw - yawRef.current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    yawRef.current += yawDiff * Math.min(1, 4 * delta);
    roverRef.current.rotation.y = yawRef.current;

    // Terrain-following pitch and roll
    const dirX = smoothHeadingRef.current.x;
    const dirZ = smoothHeadingRef.current.y;
    const rightX = dirZ;
    const rightZ = -dirX;
    const sample = 1.0;

    const hFront = estimateTerrainHeight(position.x + dirX * sample, position.z + dirZ * sample);
    const hBack = estimateTerrainHeight(position.x - dirX * sample, position.z - dirZ * sample);
    const hLeft = estimateTerrainHeight(position.x - rightX * sample, position.z - rightZ * sample);
    const hRight = estimateTerrainHeight(position.x + rightX * sample, position.z + rightZ * sample);

    const targetPitch = THREE.MathUtils.clamp(Math.atan2(hBack - hFront, sample * 2), -0.25, 0.25);
    const targetRoll = THREE.MathUtils.clamp(Math.atan2(hLeft - hRight, sample * 2), -0.25, 0.25);

    // Smooth pitch/roll (reduced from 8 to 3)
    roverRef.current.rotation.x = THREE.MathUtils.lerp(
      roverRef.current.rotation.x,
      targetPitch,
      Math.min(1, 3 * delta),
    );

    // Subtle body sway while moving (simulates terrain micro-bumps)
    const swayAmount = THREE.MathUtils.clamp(horizontalSpeed / 6, 0, 1) * 0.008;
    swayPhaseRef.current += delta * 3.5;
    const swayRoll = Math.sin(swayPhaseRef.current) * swayAmount;

    roverRef.current.rotation.z = THREE.MathUtils.lerp(
      roverRef.current.rotation.z,
      targetRoll + swayRoll,
      Math.min(1, 3 * delta),
    );

    if (isMiningRef.current) {
      const vibration = Math.sin(Date.now() * 0.025) * 0.0014;
      roverRef.current.position.y += vibration;
    }
  });

  return (
    <group ref={roverRef}>
      <Clone object={scene} scale={ROVER_SCALE} castShadow receiveShadow />
    </group>
  );
});

// ── Obstacles placed cell-to-cell like minerals (no random offset)
const Obstacles = React.memo(({ map }: { map: MapData }) => {
  const { scene: rockScene } = useGLTF('/models/Rocks.glb');
  const groundOffset = useMemo(
    () => getModelGroundOffset(rockScene, '/models/Rocks.glb', OBSTACLE_SCALE),
    [rockScene],
  );

  const obstacleCells = useMemo(() => {
    const result: { key: string; x: number; y: number; z: number; rot: number }[] = [];
    map.grid.forEach((row, gridY) =>
      row.forEach((cell, gridX) => {
        if (cell !== '#') return;
        const [wx, , wz] = getPosition(gridX, gridY);
        result.push({
          key: `obs-${gridY}-${gridX}`,
          x: wx,
          y: estimateTerrainHeight(wx, wz) + groundOffset + OBSTACLE_GROUND_CLEARANCE,
          z: wz,
          rot: getRandomRotation(gridX, gridY),
        });
      })
    );
    return result;
  }, [map, groundOffset]);

  if (!obstacleCells.length) return null;

  return (
    <>
      {obstacleCells.map(({ key, x, y, z, rot }) => (
        <group key={key} position={[x, y, z]} rotation={[0, rot, 0]}>
          <Clone object={rockScene} scale={OBSTACLE_SCALE} castShadow receiveShadow />
        </group>
      ))}
    </>
  );
});

// ── Individual mineral
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
    () => estimateTerrainHeight(position[0], position[2]) + groundOffset + (type === 'Y' ? GOLD_GROUND_CLEARANCE : MINERAL_GROUND_CLEARANCE),
    [position, groundOffset, type],
  );
  const collectedRef = useRef(collected);
  useEffect(() => { collectedRef.current = collected; }, [collected]);
  const scaleRef = useRef(1);

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
    return undefined;
  }, [type]);

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
      ? Math.max(0, scaleRef.current - delta * 6)
      : Math.min(1, scaleRef.current + delta * 4);
    mineralRef.current.scale.setScalar(scale * scaleRef.current);
    mineralRef.current.visible = scaleRef.current > 0.01;
  });

  return (
    <group ref={mineralRef} position={[position[0], yPos, position[2]]} rotation={[0, rotation, 0]}>
      <Clone ref={cloneRef} object={scene} scale={1} castShadow receiveShadow inject={inject} />
    </group>
  );
}, (prev, next) => prev.collected === next.collected);

// ── Minerals
const MapMinerals = React.memo(({
  map,
  simulationResult,
  mineralCollectionMap,
  collectedStep,
}: {
  map: MapData;
  simulationResult: SimulationResult | null;
  mineralCollectionMap: Map<string, number>;
  collectedStep: number;
}) => {
  const mineralCells = useMemo(() => {
    const cells: Array<{ row: number; col: number; type: 'Y' | 'B' | 'G' }> = [];

    if (simulationResult?.all_minerals && Object.keys(simulationResult.all_minerals).length > 0) {
      const parseKey = /\((\d+),\s*(\d+)\)/;
      for (const [key, rawType] of Object.entries(simulationResult.all_minerals)) {
        const match = key.match(parseKey);
        if (!match) continue;
        if (rawType !== 'Y' && rawType !== 'B' && rawType !== 'G') continue;

        cells.push({
          row: Number(match[1]),
          col: Number(match[2]),
          type: rawType,
        });
      }
      return cells;
    }

    map.grid.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (cell !== 'Y' && cell !== 'B' && cell !== 'G') return;
        cells.push({ row: rowIndex, col: columnIndex, type: cell });
      });
    });

    return cells;
  }, [map, simulationResult]);

  return (
    <>
      {mineralCells.map(({ row, col, type }) => {
        const collectedAt = mineralCollectionMap.get(`${row}_${col}`);
        const [rx, , rz] = getPosition(col, row);
        return (
          <Mineral
            key={`min-${row}-${col}`}
            position={[rx, 0, rz]}
            type={type}
            rotation={getRandomRotation(col, row)}
            collected={collectedAt !== undefined && collectedAt < collectedStep}
          />
        );
      })}
    </>
  );
});

// ── Mars terrain mesh with vertex colours
const MarsSurface = React.memo(() => {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!meshRef.current) return;
    const geometry = meshRef.current.geometry as THREE.PlaneGeometry;
    const pos = geometry.attributes.position;

    const heights: number[] = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const h = estimateTerrainHeight(pos.getX(i), pos.getY(i));
      pos.setZ(i, h);
      heights[i] = h;
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    // Find height range (loop to avoid stack overflow with spread)
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] < minH) minH = heights[i];
      if (heights[i] > maxH) maxH = heights[i];
    }
    const range = maxH - minH || 1;
    const colors = new Float32Array(pos.count * 3);

    // Unified Mars palette - no more dark brown play area
    const marsDustColor = new THREE.Color('#A0522D'); // Base Martian sienna
    const rimColor = new THREE.Color('#C9704A');      // Orange-red for the rim
    const valleyColor = new THREE.Color('#6B3A2A');   // Darker rust for low points
    const peakColor = new THREE.Color('#D27D4B');     // Sandy orange for peaks
    const tmpColor = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const dE = Math.max(Math.abs(vx) - (OFFSET + 2), Math.abs(vy) - (OFFSET + 2), 0);

      // Height-based coloring for everyone to keep it uniform
      const t = (heights[i] - minH) / range;
      if (t < 0.5) {
        tmpColor.lerpColors(valleyColor, marsDustColor, t * 2);
      } else {
        tmpColor.lerpColors(marsDustColor, peakColor, (t - 0.5) * 2);
      }

      // If it's the rim zone, blend slightly towards the rim color
      if (dE > 0 && dE < RIM_WIDTH + 10) {
        const rimInfluence = Math.sin(Math.min(dE / RIM_WIDTH, 1) * Math.PI);
        tmpColor.lerp(rimColor, rimInfluence * 0.4);
      }

      // Subtle surface noise variation (applied everywhere)
      const variation = (seededRandom(Math.floor(vx * 4 + 5000), Math.floor(vy * 4 + 5000)) - 0.5) * 0.06;
      tmpColor.r = THREE.MathUtils.clamp(tmpColor.r + variation, 0, 1);
      tmpColor.g = THREE.MathUtils.clamp(tmpColor.g + variation * 0.7, 0, 1);
      tmpColor.b = THREE.MathUtils.clamp(tmpColor.b + variation * 0.5, 0, 1);

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }, []);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS]} />
      <meshStandardMaterial vertexColors roughness={0.8} metalness={0.1} />
    </mesh>
  );
});

const CameraController = ({ 
  roverPosRef, 
  mode 
}: { 
  roverPosRef: React.MutableRefObject<THREE.Vector3>,
  mode: CameraMode
}) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const lastTargetRef = useRef(new THREE.Vector3());
  const initializedRef = useRef(false);

  // For detached mode movement
  const keys = useRef<Record<string, boolean>>({});
  const lastModeRef = useRef<CameraMode>(mode);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = true; };
    const up = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const clampCameraAboveSurface = useCallback(() => {
    const minY = estimateTerrainHeight(camera.position.x, camera.position.z) + CAMERA_GROUND_CLEARANCE;
    if (camera.position.y < minY) {
      camera.position.y = minY;
    }
  }, [camera]);

  const clampTargetAboveSurface = useCallback((controls: OrbitControlsImpl) => {
    const minTargetY = estimateTerrainHeight(controls.target.x, controls.target.z) + 0.4;
    if (controls.target.y < minTargetY) {
      controls.target.y = minTargetY;
    }
  }, []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // Detect mode change for zoom reset
    if (lastModeRef.current !== 'follow' && mode === 'follow') {
      // Zoom in when coming back to follow
      const targetPos = roverPosRef.current.clone();
      const idealOffset = new THREE.Vector3(0, 12, 18);
      camera.position.lerp(targetPos.clone().add(idealOffset), 0.1);
    }
    lastModeRef.current = mode;

    if (mode === 'detached') {
      // Manual movement in detached mode
      const speed = 60 * delta;
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

      const moveVector = new THREE.Vector3();
      if (keys.current['w']) moveVector.addScaledVector(forward, speed);
      if (keys.current['s']) moveVector.addScaledVector(forward, -speed);
      if (keys.current['a']) moveVector.addScaledVector(right, -speed);
      if (keys.current['d']) moveVector.addScaledVector(right, speed);
      if (keys.current['q']) moveVector.y += speed;
      if (keys.current['e']) moveVector.y -= speed;

      const proposedPosition = camera.position.clone().add(moveVector);
      const clampedX = THREE.MathUtils.clamp(
        proposedPosition.x,
        -DETACHED_CAMERA_HALF_EXTENT,
        DETACHED_CAMERA_HALF_EXTENT,
      );
      const clampedZ = THREE.MathUtils.clamp(
        proposedPosition.z,
        -DETACHED_CAMERA_HALF_EXTENT,
        DETACHED_CAMERA_HALF_EXTENT,
      );
      const clampedY = Math.min(proposedPosition.y, DETACHED_CAMERA_MAX_HEIGHT);

      const moved =
        Math.abs(clampedX - camera.position.x) > 1e-6
        || Math.abs(clampedY - camera.position.y) > 1e-6
        || Math.abs(clampedZ - camera.position.z) > 1e-6;

      camera.position.set(clampedX, clampedY, clampedZ);

      if (moved) {
        const lookAtTarget = new THREE.Vector3();
        camera.getWorldDirection(lookAtTarget);
        controls.target.copy(camera.position).add(lookAtTarget.multiplyScalar(10));
      }

      controls.target.x = THREE.MathUtils.clamp(
        controls.target.x,
        -DETACHED_CAMERA_HALF_EXTENT,
        DETACHED_CAMERA_HALF_EXTENT,
      );
      controls.target.z = THREE.MathUtils.clamp(
        controls.target.z,
        -DETACHED_CAMERA_HALF_EXTENT,
        DETACHED_CAMERA_HALF_EXTENT,
      );
      clampCameraAboveSurface();
      controls.update(); 
      return;
    }

    if (mode === 'top') {
      const target = new THREE.Vector3(0, 0, 0); // Center of map
      camera.position.lerp(new THREE.Vector3(0, 150, 0.1), Math.min(1, 4 * delta));
      controls.target.lerp(target, Math.min(1, 4 * delta));
      clampCameraAboveSurface();
      clampTargetAboveSurface(controls);
      controls.update();
      return;
    }

    // Default 'follow' mode
    const target = roverPosRef.current.clone();
    target.y += 1.1;

    if (!initializedRef.current) {
      controls.target.copy(target);
      lastTargetRef.current.copy(target);
      initializedRef.current = true;
      clampCameraAboveSurface();
      clampTargetAboveSurface(controls);
      controls.update();
      return;
    }

    const tDelta = target.clone().sub(lastTargetRef.current);
    camera.position.add(tDelta);
    controls.target.copy(target);
    lastTargetRef.current.copy(target);
    clampCameraAboveSurface();
    clampTargetAboveSurface(controls);
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={mode === 'detached'}
      enableZoom={true}
      enableRotate={true}
      enableDamping={true}
      dampingFactor={0.08}
      zoomSpeed={2.8}
      minDistance={mode === 'top' ? 20 : 8}
      maxDistance={600}
      maxPolarAngle={mode === 'top' ? 0.1 : Math.PI / 2.05}
      minPolarAngle={0}
    />
  );
};

// ── Core animation controller — position-synced
const SimulationController = ({
  simulationResult, isPlayingRef, stepRef, isMiningRef,
  pathPoints, stepDuration, speedRef, roverPosRef, onStepBatch, onComplete,
}: {
  simulationResult: SimulationResult;
  isPlayingRef: React.MutableRefObject<boolean>;
  stepRef: React.MutableRefObject<number>;
  isMiningRef: React.MutableRefObject<boolean>;
  pathPoints: THREE.Vector3[];
  stepDuration: number;
  speedRef: React.MutableRefObject<number>;
  roverPosRef: React.MutableRefObject<THREE.Vector3>;
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

      // SYNC: only advance step if rover is close enough to current target
      const currentTarget = pathPoints[stepRef.current];
      if (currentTarget) {
        const roverPos = roverPosRef.current;
        const dx = roverPos.x - currentTarget.x;
        const dz = roverPos.z - currentTarget.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > ARRIVAL_THRESHOLD) {
          timerRef.current = 0;
          break;
        }
      }

      stepRef.current++;
      const step = stepRef.current;

      const log = simulationResult.logs[step] ?? null;
      isMiningRef.current = log ? log.action === 'mine' : false;

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
  stepOverride,
  showEnergyHeatmap = false,
  photoMode = false,
  hideHudOverlay = false,
  cameraMode = 'follow',
}) => {
  const stepRef = useRef(0);
  const isMiningRef = useRef(false);
  const isPlayingRef = useRef(false);

  const mapStartCell: [number, number] = map.start;

  const mapStartWorld: [number, number, number] = useMemo(() => {
    return [mapStartCell[1] * CELL_SIZE - OFFSET, 0, mapStartCell[0] * CELL_SIZE - OFFSET];
  }, [mapStartCell]);

  const roverPosRef = useRef(new THREE.Vector3(mapStartWorld[0], 0, mapStartWorld[2]));

  // Update rover ref when a new map is loaded
  useEffect(() => {
    if (!isPlayingRef.current) {
      roverPosRef.current.set(mapStartWorld[0], 0, mapStartWorld[2]);
    }
  }, [mapStartWorld]);

  const [speed, setSpeed] = useState(2);
  const speedRef = useRef(2);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const [localPaused, setLocalPaused] = useState(false);

  useEffect(() => {
    if (photoMode) {
      setLocalPaused(true);
    }
  }, [photoMode]);

  useEffect(() => {
    isPlayingRef.current = isPlaying && !localPaused && !photoMode;
  }, [isPlaying, localPaused, photoMode]);

  // Reset on new simulation
  useEffect(() => {
    if (!isPlaying || !simulationResult) return;
    stepRef.current = 0;
    isMiningRef.current = false;
    setLocalPaused(false);
    setCollectedStep(0);
    const [row, col] = simulationResult.start;
    roverPosRef.current.set(col * CELL_SIZE - OFFSET, 0, row * CELL_SIZE - OFFSET);
  }, [isPlaying, simulationResult]);

  const pathPoints = useMemo<THREE.Vector3[]>(() => {
    if (!simulationResult) return [];
    const [startRow, startCol] = simulationResult.start;
    const normalizedPath: [number, number][] = [...simulationResult.path];

    if (
      normalizedPath.length === 0
      || normalizedPath[0][0] !== startRow
      || normalizedPath[0][1] !== startCol
    ) {
      normalizedPath.unshift([startRow, startCol]);
    }

    const lastPoint = normalizedPath[normalizedPath.length - 1];
    if (
      simulationResult.returned_home
      && (
        !lastPoint
        || lastPoint[0] !== startRow
        || lastPoint[1] !== startCol
      )
    ) {
      normalizedPath.push([startRow, startCol]);
    }

    return normalizedPath.map(([row, col]) =>
      new THREE.Vector3(col * CELL_SIZE - OFFSET, 0, row * CELL_SIZE - OFFSET)
    );
  }, [simulationResult]);

  const pathHeights = useMemo<number[]>(() =>
    pathPoints.map(p => estimateTerrainHeight(p.x, p.z))
  , [pathPoints]);

  const mineralCollectionMap = useMemo(() => {
    const m = new Map<string, number>();
    simulationResult?.minerals.forEach(min => m.set(`${min.pos[0]}_${min.pos[1]}`, min.step));
    return m;
  }, [simulationResult]);

  const [collectedStep, setCollectedStep] = useState(0);

  useEffect(() => {
    if (stepOverride === null || !simulationResult || pathPoints.length === 0) return;
    const clamped = Math.max(0, Math.min(stepOverride ?? 0, pathPoints.length - 1));
    stepRef.current = clamped;
    setCollectedStep(clamped);

    const point = pathPoints[clamped];
    if (point) {
      const y = (pathHeights[clamped] ?? estimateTerrainHeight(point.x, point.z)) + 2;
      roverPosRef.current.set(point.x, y, point.z);
    }

    const log = simulationResult.logs[clamped] ?? null;
    isMiningRef.current = log ? log.action === 'mine' : false;
  }, [stepOverride, simulationResult, pathPoints, pathHeights]);

  const handleStepBatch = useCallback((step: number) => {
    setCollectedStep(step);
    onStep?.(step);
  }, [onStep]);

  const handleComplete = useCallback(() => {
    isPlayingRef.current = false;
    onComplete?.();
  }, [onComplete]);

  const startPos: [number, number, number] = useMemo(() => {
    if (simulationResult) {
      const [row, col] = simulationResult.start;
      return [col * CELL_SIZE - OFFSET, 14, row * CELL_SIZE - OFFSET + 18];
    }
    return [mapStartWorld[0], 14, mapStartWorld[2] + 18];
  }, [simulationResult, mapStartWorld]);

  const roverInitPoint = useMemo(() => {
    if (pathPoints.length > 0) return pathPoints[0];
    if (simulationResult) {
      const [row, col] = simulationResult.start;
      return new THREE.Vector3(col * CELL_SIZE - OFFSET, 0, row * CELL_SIZE - OFFSET);
    }
    return new THREE.Vector3(mapStartWorld[0], mapStartWorld[1], mapStartWorld[2]);
  }, [pathPoints, simulationResult, mapStartWorld]);

  const currentRoverPos: [number, number, number] = useMemo(() => {
    if (!pathPoints.length) return mapStartWorld;
    const idx = Math.min(collectedStep, pathPoints.length - 1);
    return [pathPoints[idx].x, pathHeights[idx] ?? 0, pathPoints[idx].z];
  }, [pathPoints, pathHeights, collectedStep, mapStartWorld]);

  const currentLog = useMemo(() => {
    if (!simulationResult?.logs?.length) return null;
    return simulationResult.logs[Math.min(collectedStep, simulationResult.logs.length - 1)] ?? null;
  }, [simulationResult, collectedStep]);
  const isMiningNow = currentLog?.action === 'mine';

  const isDay = currentLog?.is_day ?? true;
  const simHour = currentLog ? (6 + currentLog.time_hours) % 24 : 12;

  const sunPosition = useMemo<[number, number, number]>(() => {
    const angle = (simHour / 24) * Math.PI * 2;
    const radius = 140;
    const x = Math.cos(angle - Math.PI / 2) * radius;
    const z = Math.sin(angle - Math.PI / 2) * radius;
    const y = isDay ? 130 : 52;
    return [x, y, z];
  }, [simHour, isDay]);

  const fogColor = isDay ? '#d29a7b' : '#3a2e2b';

  const roverHeading = useMemo(() => {
    if (pathPoints.length < 2) return new THREE.Vector3(0, 0, 1);
    const idx = Math.min(collectedStep, pathPoints.length - 2);
    const from = pathPoints[idx];
    const to = pathPoints[idx + 1];
    const heading = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    if (heading.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, 1);
    return heading.normalize();
  }, [pathPoints, collectedStep]);

  const wearLevel = useMemo(() => {
    if (!simulationResult?.logs?.length) return 0;
    const end = Math.min(collectedStep, simulationResult.logs.length - 1);
    const logs = simulationResult.logs.slice(0, end + 1);
    if (!logs.length) return 0;
    const highSpeed = logs.filter((entry) => entry.speed >= 2).length;
    const distance = logs[logs.length - 1].distance_traveled;
    const wearScore = Math.min(100, distance * 0.9 + highSpeed * 1.8);
    return wearScore / 100;
  }, [simulationResult, collectedStep]);

  const SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20];
  const canPlay = !!simulationResult;
  const isActivelyPlaying = isPlaying && !localPaused && !photoMode;

  const miningPosition = useMemo<[number, number, number] | null>(() => {
    if (!isMiningNow || !currentLog?.position) return null;
    const [row, col] = currentLog.position;
    const wx = col * CELL_SIZE - OFFSET;
    const wz = row * CELL_SIZE - OFFSET;
    return [wx, estimateTerrainHeight(wx, wz), wz];
  }, [isMiningNow, currentLog]);

  return (
    <div className="w-full h-screen absolute inset-0 z-0">
      <Canvas
        shadows
        camera={{ position: startPos, fov: 60, far: RENDER_DISTANCE * 4, near: 0.1 }}
        gl={{ logarithmicDepthBuffer: true }}
        frameloop="always"
      >
        <Suspense fallback={null}>
          <>
            <Sky
              sunPosition={sunPosition}
              turbidity={isDay ? 0.22 : 0.55}
              rayleigh={isDay ? 0.62 : 0.4}
              mieCoefficient={isDay ? 0.005 : 0.012}
              mieDirectionalG={0.78}
            />
            {!isDay && <Stars radius={460} depth={120} count={2200} factor={4} fade speed={0.3} />}
            <ambientLight intensity={isDay ? 1.4 : 1.1} color={isDay ? '#ffffff' : '#d1d9e6'} />
            <hemisphereLight
              intensity={isDay ? 1.2 : 0.9}
              color={isDay ? '#ffffff' : '#b0c4de'}
              groundColor={isDay ? '#8b5e3c' : '#4a3a2e'}
            />
            <directionalLight
              position={sunPosition}
              intensity={isDay ? 1.8 : 1.2}
              castShadow
              shadow-mapSize={[512, 512]}
              shadow-camera-far={150}
              shadow-camera-left={-80}
              shadow-camera-right={80}
              shadow-camera-top={80}
              shadow-camera-bottom={-80}
              shadow-bias={-0.0005}
            />
            <pointLight
              position={[currentRoverPos[0], currentRoverPos[1] + 1.2, currentRoverPos[2]]}
              intensity={isDay ? 2.8 : 4.5}
              distance={40}
              color="#ffffff"
            />
          </>

          <Environment preset="city" />
          <ContactShadows 
            resolution={512} 
            scale={100} 
            blur={2.5} 
            opacity={0.4} 
            far={10} 
            color="#3e2a1e" 
            frames={1}
          />

          <MarsSurface />
          <EnergyHeatmapOverlay map={map} start={simulationResult?.start ?? mapStartCell} visible={showEnergyHeatmap} />
          <BaseBeacon position={mapStartWorld} />
          <SceneryInstanced />

          {pathPoints.length > 0 && <PathLine pathPoints={pathPoints} currentStep={collectedStep} />}

          <Obstacles map={map} />

          <MapMinerals
            map={map}
            simulationResult={simulationResult}
            mineralCollectionMap={mineralCollectionMap}
            collectedStep={collectedStep}
          />

          {miningPosition && <MiningEffect position={miningPosition} />}

          <Rover
            pathPoints={pathPoints.length > 0 ? pathPoints : [roverInitPoint]}
            stepRef={stepRef}
            isMiningRef={isMiningRef}
            roverPosRef={roverPosRef}
            speedRef={speedRef}
            wearLevel={wearLevel}
          />

          <RoverDustTrail position={currentRoverPos} heading={roverHeading} active={isActivelyPlaying} />
          <RoverHeadlights position={currentRoverPos} heading={roverHeading} active={!isDay} />

          {simulationResult && isPlaying && (
            <SimulationController
              key={`sim-${simulationResult.steps_used}`}
              simulationResult={simulationResult}
              isPlayingRef={isPlayingRef}
              stepRef={stepRef}
              isMiningRef={isMiningRef}
              pathPoints={pathPoints}
              stepDuration={stepDurationSec}
              speedRef={speedRef}
              roverPosRef={roverPosRef}
              onStepBatch={handleStepBatch}
              onComplete={handleComplete}
            />
          )}

          <EffectComposer multisampling={0}>
            <Bloom luminanceThreshold={1.2} mipmapBlur intensity={0.3} radius={0.3} />
            <ToneMapping mode={THREE.ACESFilmicToneMapping} />
            <Vignette eskil={false} offset={0.1} darkness={1.0} />
          </EffectComposer>

          <CameraController roverPosRef={roverPosRef} mode={cameraMode} />
        </Suspense>
      </Canvas>

      {/* ── Simulation controls overlay ── */}
      {canPlay && !hideHudOverlay && (
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
            <span style={{ color: '#9ca3af', fontSize: 11, alignSelf: 'center', marginRight: 4 }}>Speed</span>
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

          {/* Play / Pause */}
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
            <button
              onClick={() => setLocalPaused(p => !p)}
              disabled={!isPlaying || photoMode}
              style={{
                background: isActivelyPlaying ? 'transparent' : '#f3f4f6',
                border: '1px solid ' + (isActivelyPlaying ? '#4b5563' : '#f3f4f6'),
                borderRadius: 6,
                color: isActivelyPlaying ? '#d1d5db' : '#030712',
                fontSize: 18,
                padding: '4px 14px',
                cursor: isPlaying && !photoMode ? 'pointer' : 'not-allowed',
                opacity: isPlaying && !photoMode ? 1 : 0.4,
                transition: 'all 0.15s',
                lineHeight: 1,
              }}
              title={localPaused ? 'Resume' : 'Pause'}
            >
              {localPaused || !isActivelyPlaying ? '▶' : '⏸'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scene;