import React, { useRef, useEffect, Suspense, useMemo, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars, useGLTF, Clone, OrbitControls, ContactShadows, Environment, Float, PerspectiveCamera } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette, ToneMapping } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MapData, SimulationResult } from '../types';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

// Preload models
useGLTF.preload('/models/Rover.glb');
useGLTF.preload('/models/Rocks.glb');
useGLTF.preload('/models/Gold ore.glb');
useGLTF.preload('/models/Crystal.glb');

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
}

// ==== SETTINGS ====
const ROVER_GROUND_CLEARANCE = 0.04;
const ROVER_SCALE = 0.7;
const OBSTACLE_HEIGHT_OFFSET = -1.2;
const OBSTACLE_SCALE = 4.5;
const OBSTACLE_RANDOM_OFFSET = 0.5;
const MINERAL_GROUND_CLEARANCE = 0.02;
const GOLD_GROUND_CLEARANCE = 0.04;
const MINERAL_SCALE = 0.15;
const GOLD_SCALE = 5;
const MINERAL_RANDOM_OFFSET = 0.6;
const RENDER_DISTANCE = 1400;
const TERRAIN_SIZE = 2200;
const TERRAIN_SEGMENTS = 250;
const ARRIVAL_THRESHOLD = 1.2;
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
  const rawOffset = Number.isFinite(box.min.y) ? -box.min.y * scale : 0;
  const offset = Math.max(0, rawOffset);
  MODEL_GROUND_OFFSET_CACHE.set(key, offset);
  return offset;
}

// ── Path lines: future plan (ghost) + traversed route (live)
const PathLine = React.memo(({ pathPoints, currentStep }: { pathPoints: THREE.Vector3[]; currentStep: number }) => {
  const traversedGeometry = useMemo(() => {
    if (pathPoints.length < 2) return null;
    const end = Math.min(Math.max(currentStep, 1), pathPoints.length - 1);
    const points = pathPoints
      .slice(0, end + 1)
      .map((point) => new THREE.Vector3(point.x, point.y + 0.42, point.z));
    if (points.length < 2) return null;
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [pathPoints, currentStep]);

  const futureGeometry = useMemo(() => {
    if (pathPoints.length < 2) return null;
    const start = Math.min(Math.max(currentStep, 0), pathPoints.length - 1);
    const points = pathPoints
      .slice(start)
      .map((point) => new THREE.Vector3(point.x, point.y + 0.4, point.z));
    if (points.length < 2) return null;
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [pathPoints, currentStep]);

  if (!futureGeometry && !traversedGeometry) return null;

  return (
    <>
      {futureGeometry && (
        // @ts-ignore
        <line geometry={futureGeometry}>
          <lineBasicMaterial color="#9eddf0" opacity={0.2} transparent linewidth={1} />
        </line>
      )}
      {traversedGeometry && (
        // @ts-ignore
        <line geometry={traversedGeometry}>
          <lineBasicMaterial color="#f5b56a" opacity={0.88} transparent linewidth={1.4} />
        </line>
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
      // Only place scenery rocks OUTSIDE the play area
      if (Math.abs(x) < PLAY_EDGE + 5 && Math.abs(z) < PLAY_EDGE + 5) continue;
      const dist = Math.sqrt(x * x + z * z);
      const sc = (seededRandom(i * 3 + 2, 19) * 30 + 10) * (dist > 200 ? dist / 100 : 1);
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

  useFrame((_, delta) => {
    if (!roverRef.current || pathPoints.length === 0) return;

    const frameDelta = Math.min(delta, 1 / 30);

    const idx = Math.min(stepRef.current, pathPoints.length - 1);
    const target = pathPoints[idx];
    const position = roverRef.current.position;
    const velocity = velocityRef.current;

    const directToTarget = new THREE.Vector2(target.x - position.x, target.z - position.z);
    const directDistance = directToTarget.length();
    const maxNavigateStep = CELL_SIZE * 1.05;
    const hasLongHop = directDistance > maxNavigateStep;
    const navTargetX = hasLongHop
      ? position.x + (directToTarget.x / directDistance) * CELL_SIZE
      : target.x;
    const navTargetZ = hasLongHop
      ? position.z + (directToTarget.y / directDistance) * CELL_SIZE
      : target.z;

    const spd = Math.max(0.1, speedRef.current);
    const accelScale = (isMiningRef.current ? 6 : 18) * spd;
    const maxHorizontalSpeed = 14 * spd;
    
    // Stop applying acceleration if we reached the final waypoint
    const distToTarget = Math.hypot(target.x - position.x, target.z - position.z);
    const isAtEnd = idx === pathPoints.length - 1 && distToTarget < 0.1;
    
    if (!isAtEnd) {
      velocity.x += THREE.MathUtils.clamp((navTargetX - position.x) * accelScale, -20 * spd, 20 * spd) * frameDelta;
      velocity.z += THREE.MathUtils.clamp((navTargetZ - position.z) * accelScale, -20 * spd, 20 * spd) * frameDelta;
    }

    const horizontalDamping = isAtEnd ? Math.exp(-15 * frameDelta) : Math.exp(-6 * frameDelta);
    velocity.x *= horizontalDamping;
    velocity.z *= horizontalDamping;

    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    if (horizontalSpeed > maxHorizontalSpeed && !isAtEnd) {
      const scale = maxHorizontalSpeed / horizontalSpeed;
      velocity.x *= scale;
      velocity.z *= scale;
    }

    position.x += velocity.x * frameDelta;
    position.z += velocity.z * frameDelta;

    const desiredY = estimateTerrainHeight(position.x, position.z) + groundOffset + ROVER_GROUND_CLEARANCE;
    velocity.y += (desiredY - position.y) * 50 * frameDelta;
    velocity.y -= 7.5 * frameDelta;
    velocity.y *= Math.exp(-7.5 * frameDelta);
    position.y += velocity.y * frameDelta;

    if (position.y < desiredY) {
      position.y = desiredY;
      if (velocity.y < 0) velocity.y = 0;
    }

    // Update shared rover position ref for sync
    roverPosRef.current.copy(position);

    if (horizontalSpeed > 0.05) {
      headingRef.current.set(velocity.x, velocity.z).normalize();
    }

    const targetYaw = Math.atan2(headingRef.current.x, headingRef.current.y);
    const yawDiff = ((targetYaw - yawRef.current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    yawRef.current += yawDiff * Math.min(1, 10 * frameDelta);
    roverRef.current.rotation.y = yawRef.current;

    const dirX = headingRef.current.x;
    const dirZ = headingRef.current.y;
    const rightX = dirZ;
    const rightZ = -dirX;
    const sample = 1.0;

    const hFront = estimateTerrainHeight(position.x + dirX * sample, position.z + dirZ * sample);
    const hBack = estimateTerrainHeight(position.x - dirX * sample, position.z - dirZ * sample);
    const hLeft = estimateTerrainHeight(position.x - rightX * sample, position.z - rightZ * sample);
    const hRight = estimateTerrainHeight(position.x + rightX * sample, position.z + rightZ * sample);

    const targetPitch = THREE.MathUtils.clamp(Math.atan2(hBack - hFront, sample * 2), -0.35, 0.35);
    const targetRoll = THREE.MathUtils.clamp(Math.atan2(hLeft - hRight, sample * 2), -0.35, 0.35);

    roverRef.current.rotation.x = THREE.MathUtils.lerp(
      roverRef.current.rotation.x,
      targetPitch,
      Math.min(1, 8 * frameDelta),
    );
    roverRef.current.rotation.z = THREE.MathUtils.lerp(
      roverRef.current.rotation.z,
      targetRoll,
      Math.min(1, 8 * frameDelta),
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

const CameraController = ({ roverPosRef }: { roverPosRef: React.MutableRefObject<THREE.Vector3> }) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const lastTargetRef = useRef(new THREE.Vector3());
  const initializedRef = useRef(false);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const target = roverPosRef.current.clone();
    target.y += 1.1;

    if (!initializedRef.current) {
      controls.target.copy(target);
      lastTargetRef.current.copy(target);
      initializedRef.current = true;
      controls.update();
      return;
    }

    const delta = target.clone().sub(lastTargetRef.current);
    camera.position.add(delta);
    controls.target.copy(target);
    lastTargetRef.current.copy(target);
    controls.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      enableZoom={true}
      enableRotate={true}
      enableDamping={true}
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={340}
      maxPolarAngle={Math.PI / 2.05}
      minPolarAngle={0.08}
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
}) => {
  const stepRef = useRef(0);
  const isMiningRef = useRef(false);
  const isPlayingRef = useRef(false);

  const mapStartCell: [number, number] = useMemo(() => {
    for (let row = 0; row < map.grid.length; row++) {
      for (let col = 0; col < map.grid[row].length; col++) {
        if (map.grid[row][col] === 'S') {
          return [row, col];
        }
      }
    }
    return [0, 0];
  }, [map]);

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

  const [speed, setSpeed] = useState(0.25);
  const speedRef = useRef(0.25);
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
    if (isPlaying) {
      stepRef.current = 0;
      isMiningRef.current = false;
      setLocalPaused(false);
      setCollectedStep(0);
      if (simulationResult) {
        const [row, col] = simulationResult.start;
        roverPosRef.current.set(col * CELL_SIZE - OFFSET, 0, row * CELL_SIZE - OFFSET);
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
  const isMiningNow = currentLog?.action === 'mine' && (currentLog?.minerals_collected?.length ?? 0) > 0;

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
        camera={{ position: startPos, fov: 60, far: RENDER_DISTANCE * 2, near: 0.1 }}
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

          <ObstaclesInstanced map={map} />

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

          <fog attach="fog" args={[fogColor, 10, RENDER_DISTANCE]} />
          <CameraController roverPosRef={roverPosRef} />
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
            <span style={{ color: '#9ca3af', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Manual camera control
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Scene;