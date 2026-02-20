import React, { useRef, useEffect, Suspense, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Stars, useGLTF, Environment, Clone, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { MapData, RoverState } from '../types';
import { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

// Preload models
useGLTF.preload('/models/Rover.glb');
useGLTF.preload('/models/Rocks.glb');
useGLTF.preload('/models/Gold ore.glb');
useGLTF.preload('/models/Crystal.glb');

interface SceneProps {
  map: MapData;
  rover: RoverState;
  isDay: boolean;
}

// ==== BEÁLLÍTÁSOK - Itt lehet módosítani a méreteket és pozíciókat ====
const ROVER_HEIGHT_OFFSET = 0;  // Rover magassága a terep fölött (csökkentsd ha lejjebb akarod)
const ROVER_SCALE = 0.7;           // Rover mérete (nagyobb szám = nagyobb rover)

const OBSTACLE_HEIGHT_OFFSET = -0.2; // Kövek magassága a terep fölött
const OBSTACLE_SCALE = 4.5;       // Kövek mérete (nagyobb szám = nagyobb kövek)
const OBSTACLE_RANDOM_OFFSET = 0.5; // Kövek random eltolása (0 = nincs random, 1 = teljes cella)

const MINERAL_HEIGHT_OFFSET = -0.2; // Kristályok magassága a terep fölött
const MINERAL_SCALE = 0.15;         // Kristályok mérete
const MINERAL_RANDOM_OFFSET = 1.2;  // Kristályok random eltolása

const GOLD_HEIGHT_OFFSET = -0.2; // Aranyérc magassága a terep fölött
const GOLD_SCALE = 5;         // Aranyérc mérete (nagyobb szám = nagyobb arany)

const RENDER_DISTANCE = 1500;    // Látótávolság (nagyobb = messzebbre látsz)
// ====================================================================

const GRID_SIZE = 50;
const CELL_SIZE = 2; // Size of each cell in 3D space
const OFFSET = (GRID_SIZE * CELL_SIZE) / 2;

// Seeded random function for consistent randomization based on position
const seededRandom = (x: number, y: number): number => {
  const seed = x * 73856093 ^ y * 19349663;
  const t = Math.sin(seed) * 10000;
  return t - Math.floor(t);
};

const getPosition = (x: number, y: number): [number, number, number] => {
  return [x * CELL_SIZE - OFFSET, 0, y * CELL_SIZE - OFFSET];
};

// Get randomized position for obstacles and minerals
const getRandomizedPosition = (x: number, y: number, randomOffset: number): [number, number, number] => {
  const basePos = getPosition(x, y);
  const rand1 = seededRandom(x, y);
  const rand2 = seededRandom(y, x); // Different seed for z offset
  
  const offsetX = (rand1 - 0.5) * CELL_SIZE * randomOffset;
  const offsetZ = (rand2 - 0.5) * CELL_SIZE * randomOffset;
  
  return [basePos[0] + offsetX, basePos[1], basePos[2] + offsetZ];
};

// Get random rotation for objects
const getRandomRotation = (x: number, y: number): number => {
  const rand = seededRandom(x * 2 + 1, y * 3 + 2);
  return rand * Math.PI * 2; // Random rotation between 0 and 2π
};

// Díszítő elemek a pályán kívül (hegyek, nagy sziklák)
const Scenery = () => {
  const { scene } = useGLTF('/models/Rocks.glb');
  
  const sceneryObjects = useMemo(() => {
    const objects = [];
    const PLAYABLE_BOUND = 60; // A 50x50-es pálya határa
    const SCENERY_BOUND = 800; // Milyen messzire generáljunk díszleteket
    const count = 600; // Díszítő sziklák száma
    
    for (let i = 0; i < count * 3; i++) {
      if (objects.length >= count) break;
      
      const x = (Math.random() - 0.5) * SCENERY_BOUND * 2;
      const z = (Math.random() - 0.5) * SCENERY_BOUND * 2;
      
      // Ne rakjunk sziklát a játszható területre
      if (Math.abs(x) < PLAYABLE_BOUND && Math.abs(z) < PLAYABLE_BOUND) {
        continue;
      }
      
      // Magasság kiszámítása a zaj függvény alapján (ugyanaz mint a MarsSurface-ben)
      const localY = -z;
      const noise = 
        Math.sin(x * 0.05) * Math.cos(localY * 0.05) * 2 +
        Math.sin(x * 0.1) * Math.cos(localY * 0.1) * 1 +
        Math.sin(x * 0.2) * Math.cos(localY * 0.2) * 0.5;
        
      const distance = Math.sqrt(x*x + localY*localY);
      const macroHills = distance > 100 ? Math.sin(x * 0.01) * Math.cos(localY * 0.01) * (distance / 10) : 0;
        
      // Távolabbi hegyek legyenek sokkal nagyobbak
      const distanceScale = distance > 200 ? (distance / 100) : 1;
      
      const y = noise + macroHills - 2; // Kicsit süllyesszük a földbe
      const scale = (Math.random() * 30 + 10) * distanceScale; // Hatalmas hegyek a távolban
      const rotation = Math.random() * Math.PI * 2;
      
      objects.push({ x, y, z, scale, rotation });
    }
    return objects;
  }, []);

  return (
    <>
      {sceneryObjects.map((obj, i) => (
        <group key={i} position={[obj.x, obj.y, obj.z]} rotation={[0, obj.rotation, 0]}>
          <Clone object={scene} scale={obj.scale} castShadow receiveShadow />
        </group>
      ))}
    </>
  );
};

const Rover = ({ position, terrainRef }: { position: [number, number, number], terrainRef: React.RefObject<THREE.Mesh> }) => {
  const { scene } = useGLTF('/models/Rover.glb');
  const roverRef = useRef<THREE.Group>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const raycasterDown = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  
  // Smoothly interpolate rover position and align to terrain
  useFrame((state, delta) => {
    if (roverRef.current && terrainRef.current) {
      const targetPos = new THREE.Vector3(...position);
      
      // Raycast downward from above the rover to find terrain height
      raycaster.set(
        new THREE.Vector3(targetPos.x, 50, targetPos.z),
        raycasterDown
      );
      
      const intersects = raycaster.intersectObject(terrainRef.current);
      
      if (intersects.length > 0) {
        // Set Y position to terrain height + offset for rover height
        targetPos.y = intersects[0].point.y + ROVER_HEIGHT_OFFSET;
        
        // Align rover rotation to terrain normal for realistic tilting
        const normal = intersects[0].face?.normal;
        if (normal) {
          const targetQuaternion = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          const axis = new THREE.Vector3();
          
          // Calculate rotation to align with terrain
          const worldNormal = normal.clone().applyMatrix3(
            new THREE.Matrix3().getNormalMatrix(
              terrainRef.current.matrixWorld
            )
          ).normalize();
          
          targetQuaternion.setFromUnitVectors(up, worldNormal);
          roverRef.current.quaternion.slerp(targetQuaternion, 3 * delta);
        }
      }
      
      // Smooth position interpolation
      roverRef.current.position.lerp(targetPos, 5 * delta);
    }
  });

  return (
    <group ref={roverRef} position={[position[0], position[1] + ROVER_HEIGHT_OFFSET, position[2]]}>
      <Clone object={scene} scale={ROVER_SCALE} castShadow receiveShadow />
    </group>
  );
};

const Obstacle = ({ position, terrainRef, rotation }: { position: [number, number, number], terrainRef: React.RefObject<THREE.Mesh>, rotation: number }) => {
  const { scene } = useGLTF('/models/Rocks.glb');
  const obstacleRef = useRef<THREE.Group>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const raycasterDown = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const [yPosition, setYPosition] = React.useState(position[1] + OBSTACLE_HEIGHT_OFFSET);
  
  useEffect(() => {
    if (terrainRef.current) {
      const targetPos = new THREE.Vector3(...position);
      
      raycaster.set(
        new THREE.Vector3(targetPos.x, 50, targetPos.z),
        raycasterDown
      );
      
      const intersects = raycaster.intersectObject(terrainRef.current);
      
      if (intersects.length > 0) {
        setYPosition(intersects[0].point.y + OBSTACLE_HEIGHT_OFFSET);
      }
    }
  }, [terrainRef, position, raycaster, raycasterDown]);
  
  return (
    <group ref={obstacleRef} position={[position[0], yPosition, position[2]]} rotation={[0, rotation, 0]}>
      <Clone object={scene} scale={OBSTACLE_SCALE} castShadow receiveShadow />
    </group>
  );
};

const Mineral = ({ position, type, terrainRef, rotation }: { position: [number, number, number], type: 'Y' | 'B' | 'G', terrainRef: React.RefObject<THREE.Mesh>, rotation: number }) => {
  const modelPath = type === 'Y' ? '/models/Gold ore.glb' : '/models/Crystal.glb';
  const { scene } = useGLTF(modelPath);
  const mineralRef = useRef<THREE.Group>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const raycasterDown = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  
  // Use different height offset and scale for gold ore vs crystals
  const heightOffset = type === 'Y' ? GOLD_HEIGHT_OFFSET : MINERAL_HEIGHT_OFFSET;
  const scale = type === 'Y' ? GOLD_SCALE : MINERAL_SCALE;
  
  const [yPosition, setYPosition] = React.useState(position[1] + heightOffset);
  
  const injectMaterial = useMemo(() => {
    if (type === 'B') return { color: '#0000ff' };
    if (type === 'G') return { color: '#00ff00' };
    return undefined;
  }, [type]);

  useEffect(() => {
    if (terrainRef.current) {
      const targetPos = new THREE.Vector3(...position);
      
      raycaster.set(
        new THREE.Vector3(targetPos.x, 50, targetPos.z),
        raycasterDown
      );
      
      const intersects = raycaster.intersectObject(terrainRef.current);
      
      if (intersects.length > 0) {
        setYPosition(intersects[0].point.y + heightOffset);
      }
    }
  }, [terrainRef, position, raycaster, raycasterDown, heightOffset]);

  return (
    <group ref={mineralRef} position={[position[0], yPosition, position[2]]} rotation={[0, rotation, 0]}>
      <Clone object={scene} scale={scale} castShadow receiveShadow inject={injectMaterial ? <meshStandardMaterial color={injectMaterial.color} /> : undefined} />
    </group>
  );
};

const MarsSurface = React.forwardRef<THREE.Mesh>((props, ref) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useEffect(() => {
    if (meshRef.current) {
      const geometry = meshRef.current.geometry as THREE.PlaneGeometry;
      const position = geometry.attributes.position;
      
      // Add procedural displacement to create terrain variation
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        
        // Create hills and valleys using perlin-like noise simulation
        const noise = 
          Math.sin(x * 0.05) * Math.cos(y * 0.05) * 2 +
          Math.sin(x * 0.1) * Math.cos(y * 0.1) * 1 +
          Math.sin(x * 0.2) * Math.cos(y * 0.2) * 0.5 +
          Math.random() * 0.3;
          
        // Távolabbi hegyek generálása a pályán kívül
        const distance = Math.sqrt(x*x + y*y);
        const macroHills = distance > 100 ? Math.sin(x * 0.01) * Math.cos(y * 0.01) * (distance / 10) : 0;
        
        // Pálya széle (ring)
        let boundaryHeight = 0;
        const bound = 50; // A pálya széle (50x50-es grid, középponttól 50 egység)
        const transition = 5; // Átmenet hossza
        
        const distX = Math.max(0, Math.abs(x) - bound);
        const distY = Math.max(0, Math.abs(y) - bound);
        const distFromEdge = Math.max(distX, distY);
        
        if (distFromEdge > 0) {
            // Sima átmenet a falhoz
            const t = Math.min(distFromEdge / transition, 1);
            // ease-in-out
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            boundaryHeight = ease * 3; // Kb 20 pixel magas fal (3 egység a 3D térben)
        }
        
        position.setZ(i, noise + macroHills + boundaryHeight);
      }
      
      position.needsUpdate = true;
      geometry.computeVertexNormals();
    }
  }, []);
  
  // Expose ref to parent
  useEffect(() => {
    if (typeof ref === 'function') {
      ref(meshRef.current);
    } else if (ref) {
      (ref as React.MutableRefObject<THREE.Mesh | null>).current = meshRef.current;
    }
  }, [ref]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow castShadow>
      <planeGeometry args={[3000, 3000, 256, 256]} />
      <meshStandardMaterial 
        color="#C1440E" 
        roughness={0.95} 
        metalness={0.05}
        wireframe={false}
      />
    </mesh>
  );
});

const CameraController = ({ target }: { target: THREE.Vector3 }) => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.target.lerp(target, 0.1);
      controlsRef.current.update();
    }
  });
  
  return (
    <OrbitControls 
      ref={controlsRef}
      enablePan={false} 
      enableZoom={true}
      minDistance={5}
      maxDistance={30}
      enableRotate={true}
      maxPolarAngle={Math.PI / 2.2}
      minPolarAngle={Math.PI / 6}
    />
  );
};

const Scene: React.FC<SceneProps> = ({ map, rover, isDay }) => {
  const roverPos = getPosition(rover.x, rover.y);
  const terrainRef = useRef<THREE.Mesh>(null);
  
  // Initial camera position behind and above the rover
  const initialCameraPos: [number, number, number] = [
    roverPos[0],
    roverPos[1] + 8,
    roverPos[2] + 15
  ];

  return (
    <div className="w-full h-screen absolute inset-0 z-0">
      <Canvas 
        shadows 
        camera={{ 
          position: initialCameraPos, 
          fov: 60,
          far: RENDER_DISTANCE * 2,
          near: 0.1
        }}
        gl={{ logarithmicDepthBuffer: true }}
      >
        <Suspense fallback={null}>
          {isDay ? (
            <>
              <Sky sunPosition={[100, 20, 100]} turbidity={0.1} rayleigh={0.5} />
              <ambientLight intensity={0.5} />
              <directionalLight 
                position={[50, 50, 20]} 
                intensity={1.5} 
                castShadow 
                shadow-mapSize={[2048, 2048]}
                shadow-camera-far={200}
                shadow-camera-left={-100}
                shadow-camera-right={100}
                shadow-camera-top={100}
                shadow-camera-bottom={-100}
              />
            </>
          ) : (
            <>
              <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
              <ambientLight intensity={0.1} />
              <directionalLight position={[50, 50, 20]} intensity={0.2} color="#4444ff" />
              <pointLight position={roverPos} intensity={2} distance={20} color="#ffffff" castShadow />
            </>
          )}

          <MarsSurface ref={terrainRef} />
          <Scenery />

          {/* Render Map Elements */}
          {map?.grid?.map((row, y) => 
            row.map((cell, x) => {
              if (cell === '.') return null;
              if (cell === 'S') return null; // Start position, rover is rendered separately
              
              if (cell === '#') {
                const pos = getRandomizedPosition(x, y, OBSTACLE_RANDOM_OFFSET);
                const rot = getRandomRotation(x, y);
                return <Obstacle key={`${x}-${y}`} position={pos} terrainRef={terrainRef} rotation={rot} />;
              }
              if (cell === 'Y' || cell === 'B' || cell === 'G') {
                const pos = getRandomizedPosition(x, y, MINERAL_RANDOM_OFFSET);
                const rot = getRandomRotation(x, y);
                return <Mineral key={`${x}-${y}`} position={pos} type={cell} terrainRef={terrainRef} rotation={rot} />;
              }
              
              return null;
            })
          )}

          <Rover position={roverPos} terrainRef={terrainRef} />
          
          {/* Fog for atmosphere */}
          <fog attach="fog" args={[isDay ? '#d28c63' : '#050510', 50, RENDER_DISTANCE]} />
          
          <CameraController target={new THREE.Vector3(...roverPos)} />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default Scene;
