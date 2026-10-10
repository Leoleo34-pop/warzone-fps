import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Types
interface Enemy {
  mesh: THREE.Group;
  health: number;
  shootTimer: number;
  speed: number;
  patrolAngle: number;
  patrolCenter: THREE.Vector3;
}

interface Bullet {
  mesh: THREE.Mesh;
  dir: THREE.Vector3;
  speed: number;
  life: number;
}

interface Building {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  lodGroup?: THREE.LOD;
}

interface LODObject {
  lod: THREE.LOD;
  position: THREE.Vector3;
}

type GamePhase = 'MENU' | 'PARACHUTE' | 'GROUND' | 'GAMEOVER';

// ============================================
// CAMERA CONFIG - FPS Professional Settings
// ============================================
const CAMERA_CONFIG = {
  FOV: 95,
  FOV_ADS: 55,
  MOUSE_SENSITIVITY: 0.0022,
  PITCH_LIMIT: Math.PI / 2.05,
  PLAYER_HEIGHT: 1.7,
  PARACHUTE_HEIGHT: 120,
  PARACHUTE_DESCENT: 10,
  PARACHUTE_GLIDE: 18,
};

// ============================================
// MOVEMENT CONFIG
// ============================================
const MOVEMENT_CONFIG = {
  WALK_SPEED: 5.5,
  SPRINT_SPEED: 9.5,
  ADS_SPEED: 2.8,
  JUMP_VELOCITY: 7.5,
  GRAVITY: 22,
  GROUND_FRICTION: 10,
};

// ============================================
// VISUAL CONFIG (UE5-inspired)
// ============================================
const VISUAL_CONFIG = {
  SHADOW_MAP_SIZE: 4096,
  BLOOM_STRENGTH: 0.4,
  BLOOM_RADIUS: 0.5,
  BLOOM_THRESHOLD: 0.85,
  DAY_NIGHT_CYCLE_SPEED: 0.02, // radians per second
  LOD_DISTANCES: [0, 50, 120], // Near, Medium, Far
  ENV_MAP_INTENSITY: 0.6,
};

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isReloadingRef = useRef(false);

  const gameRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    composer: EffectComposer;
    yawObject: THREE.Object3D;
    pitchObject: THREE.Object3D;
    weaponGroup: THREE.Group;
    weaponOriginalPos: THREE.Vector3;
    enemies: Enemy[];
    bullets: Bullet[];
    enemyBullets: Bullet[];
    buildings: Building[];
    lodObjects: LODObject[];
    keys: Record<string, boolean>;
    mouseDown: { left: boolean; right: boolean };
    velocity: THREE.Vector3;
    canJump: boolean;
    lastShotTime: number;
    playerHealth: number;
    ammoCurrent: number;
    ammoReserve: number;
    enemiesRemaining: number;
    phase: 'PARACHUTE' | 'GROUND';
    isStarted: boolean;
    isOver: boolean;
    clock: THREE.Clock;
    animationId: number | null;
    recoilPitch: number;
    recoilYaw: number;
    isADS: () => boolean;
    // Lighting
    sunLight: THREE.DirectionalLight;
    ambientLight: THREE.AmbientLight;
    hemiLight: THREE.HemisphereLight;
    dayTime: number;
    // Color bleeding lights
    colorBleedLights: THREE.PointLight[];
    // Stats
    fps: number;
    frameCount: number;
    lastFpsUpdate: number;
  } | null>(null);

  const [gamePhase, setGamePhase] = useState<GamePhase>('MENU');
  const [playerHealth, setPlayerHealth] = useState(100);
  const [ammoCurrent, setAmmoCurrent] = useState(30);
  const [ammoReserve, setAmmoReserve] = useState(90);
  const [enemiesRemaining, setEnemiesRemaining] = useState(8);
  const [altitude, setAltitude] = useState(CAMERA_CONFIG.PARACHUTE_HEIGHT);
  const [isReloading, setIsReloading] = useState(false);
  const [gameResult, setGameResult] = useState<'victory' | 'defeat' | null>(null);
  const [hitFlash, setHitFlash] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [fps, setFps] = useState(60);
  const [timeOfDay, setTimeOfDay] = useState('Day');

  // ============================================
  // INITIALIZATION
  // ============================================
  const initGame = useCallback(() => {
    if (!containerRef.current) return;

    if (gameRef.current) {
      if (gameRef.current.animationId) cancelAnimationFrame(gameRef.current.animationId);
      gameRef.current.renderer.dispose();
      gameRef.current.composer.dispose();
      containerRef.current.innerHTML = '';
    }

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.004);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Camera rig
    const yawObject = new THREE.Object3D();
    const pitchObject = new THREE.Object3D();
    yawObject.add(pitchObject);
    pitchObject.add(camera);
    scene.add(yawObject);

    // Renderer with advanced settings
    const renderer = new THREE.WebGLRenderer({
      antialias: false, // We'll use FXAA instead
      powerPreference: 'high-performance',
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft shadows
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);

    // ============================================
    // POST-PROCESSING (TSR-like upscaling + Bloom)
    // ============================================
    const composer = new EffectComposer(renderer);

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Bloom (Lumen-inspired glow)
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      VISUAL_CONFIG.BLOOM_STRENGTH,
      VISUAL_CONFIG.BLOOM_RADIUS,
      VISUAL_CONFIG.BLOOM_THRESHOLD
    );
    composer.addPass(bloomPass);

    // FXAA (Anti-aliasing)
    const fxaaPass = new ShaderPass(FXAAShader);
    const pixelRatio = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
    fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);
    composer.addPass(fxaaPass);

    // ============================================
    // LIGHTING (Lumen-inspired)
    // ============================================
    // Ambient light (base illumination)
    const ambientLight = new THREE.AmbientLight(0x8899bb, 0.5);
    scene.add(ambientLight);

    // Hemisphere light (sky/ground color bleed)
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d1e, 0.6);
    scene.add(hemiLight);

    // Sun (directional light with shadows)
    const sunLight = new THREE.DirectionalLight(0xfff5ea, 2.0);
    sunLight.position.set(80, 150, 60);
    sunLight.castShadow = true;

    // High-res shadow map (Virtual Shadow Maps inspired)
    sunLight.shadow.mapSize.width = VISUAL_CONFIG.SHADOW_MAP_SIZE;
    sunLight.shadow.mapSize.height = VISUAL_CONFIG.SHADOW_MAP_SIZE;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    sunLight.shadow.bias = -0.0005; // Reduce shadow acne
    sunLight.shadow.normalBias = 0.02;

    const d = 180;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    // Environment map for reflections (Lumen-inspired)
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256, {
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    const cubeCamera = new THREE.CubeCamera(0.1, 1000, cubeRenderTarget);
    scene.add(cubeCamera);

    // ============================================
    // BUILD ENVIRONMENT
    // ============================================
    const buildings: Building[] = [];
    const lodObjects: LODObject[] = [];
    const colorBleedLights: THREE.PointLight[] = [];
    buildEnvironment(scene, buildings, lodObjects, colorBleedLights, cubeCamera);

    // Weapon
    const weaponGroup = new THREE.Group();
    const weaponOriginalPos = new THREE.Vector3(0.28, -0.22, -0.45);
    buildWeaponModel(weaponGroup);
    weaponGroup.position.copy(weaponOriginalPos);
    camera.add(weaponGroup);

    // Initialize game state
    gameRef.current = {
      scene, camera, renderer, composer,
      yawObject, pitchObject,
      weaponGroup, weaponOriginalPos,
      enemies: [], bullets: [], enemyBullets: [],
      buildings, lodObjects,
      keys: {},
      mouseDown: { left: false, right: false },
      velocity: new THREE.Vector3(),
      canJump: false,
      lastShotTime: 0,
      playerHealth: 100,
      ammoCurrent: 30,
      ammoReserve: 90,
      enemiesRemaining: 8,
      phase: 'PARACHUTE',
      isStarted: true,
      isOver: false,
      clock: new THREE.Clock(),
      animationId: null,
      recoilPitch: 0,
      recoilYaw: 0,
      isADS: () => gameRef.current?.mouseDown.right ?? false,
      sunLight, ambientLight, hemiLight,
      dayTime: 0,
      colorBleedLights,
      fps: 60,
      frameCount: 0,
      lastFpsUpdate: performance.now(),
    };

    // Initial position
    yawObject.position.set(
      (Math.random() - 0.5) * 40,
      CAMERA_CONFIG.PARACHUTE_HEIGHT,
      (Math.random() - 0.5) * 40
    );
    pitchObject.rotation.x = -0.3;

    // Spawn enemies
    spawnEnemies(scene, gameRef.current);

    // Update environment map once
    cubeCamera.position.set(0, 10, 0);
    cubeCamera.update(renderer, scene);

    // Start loop
    gameLoop();
  }, []);

  // ============================================
  // ENVIRONMENT (Nanite + Lumen inspired)
  // ============================================
  function buildEnvironment(
    scene: THREE.Scene,
    buildings: Building[],
    lodObjects: LODObject[],
    colorBleedLights: THREE.PointLight[],
    cubeCamera: THREE.CubeCamera
  ) {
    // Ground with PBR material
    const groundGeo = new THREE.PlaneGeometry(400, 400, 64, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x3d4a3d,
      roughness: 0.95,
      metalness: 0.02,
      envMap: cubeCamera.renderTarget.texture,
      envMapIntensity: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid
    const grid = new THREE.GridHelper(400, 80, 0x4a5568, 0x374151);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).opacity = 0.3;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    // Buildings with LOD
    const buildingDefs = [
      { x: -40, z: -40, w: 22, h: 18, d: 22, color: 0x8b4513 },
      { x: 42, z: -50, w: 26, h: 22, d: 18, color: 0x696969 },
      { x: -52, z: 42, w: 18, h: 15, d: 26, color: 0xa0522d },
      { x: 48, z: 38, w: 24, h: 20, d: 22, color: 0x708090 },
      { x: 0, z: -78, w: 36, h: 14, d: 18, color: 0x8b7355 },
      { x: -72, z: -8, w: 16, h: 12, d: 30, color: 0xb22222 },
      { x: 72, z: -12, w: 20, h: 16, d: 16, color: 0x556b2f },
      { x: 0, z: 62, w: 32, h: 10, d: 14, color: 0x8b4513 },
      { x: -20, z: 80, w: 18, h: 8, d: 12, color: 0x696969 },
      { x: 60, z: -80, w: 14, h: 10, d: 20, color: 0xa0522d },
    ];

    buildingDefs.forEach(b => {
      const lod = new THREE.LOD();

      // HIGH DETAIL (Nanite-inspired: millions of polygons simulated)
      const highDetail = createBuildingHighDetail(b.w, b.h, b.d, b.color, cubeCamera);
      lod.addLevel(highDetail, VISUAL_CONFIG.LOD_DISTANCES[0]);

      // MEDIUM DETAIL
      const medDetail = createBuildingMediumDetail(b.w, b.h, b.d, b.color);
      lod.addLevel(medDetail, VISUAL_CONFIG.LOD_DISTANCES[1]);

      // LOW DETAIL
      const lowDetail = createBuildingLowDetail(b.w, b.h, b.d, b.color);
      lod.addLevel(lowDetail, VISUAL_CONFIG.LOD_DISTANCES[2]);

      lod.position.set(b.x, 0, b.z);
      scene.add(lod);

      buildings.push({
        minX: b.x - b.w / 2 - 0.3,
        maxX: b.x + b.w / 2 + 0.3,
        minZ: b.z - b.d / 2 - 0.3,
        maxZ: b.z + b.d / 2 + 0.3,
        height: b.h,
        lodGroup: lod,
      });

      lodObjects.push({
        lod,
        position: new THREE.Vector3(b.x, 0, b.z),
      });

      // Color bleeding light (Lumen-inspired)
      const bleedLight = new THREE.PointLight(b.color, 0.8, 15);
      bleedLight.position.set(b.x, b.h / 2, b.z + b.d / 2 + 1);
      scene.add(bleedLight);
      colorBleedLights.push(bleedLight);
    });

    // Containers with LOD
    const containerColors = [0x991b1b, 0x1e3a8a, 0x065f46, 0xb45309, 0x581c87];
    for (let i = 0; i < 22; i++) {
      const color = containerColors[Math.floor(Math.random() * containerColors.length)];
      const lod = new THREE.LOD();

      // High detail container
      const highContainer = createContainerHighDetail(color, cubeCamera);
      lod.addLevel(highContainer, 0);

      // Low detail container
      const lowContainer = createContainerLowDetail(color);
      lod.addLevel(lowContainer, 60);

      let rx = (Math.random() - 0.5) * 220;
      let rz = (Math.random() - 0.5) * 220;
      const rotY = Math.random() > 0.5 ? 0 : Math.PI / 2;

      let valid = false;
      let attempts = 0;
      while (!valid && attempts < 15) {
        valid = true;
        for (const b of buildings) {
          if (rx > b.minX - 6 && rx < b.maxX + 6 && rz > b.minZ - 6 && rz < b.maxZ + 6) {
            valid = false;
            rx = (Math.random() - 0.5) * 220;
            rz = (Math.random() - 0.5) * 220;
            break;
          }
        }
        attempts++;
      }

      lod.position.set(rx, 0, rz);
      lod.rotation.y = rotY;
      scene.add(lod);

      if (rotY === 0) {
        buildings.push({ minX: rx - 2.5, maxX: rx + 2.5, minZ: rz - 5.5, maxZ: rz + 5.5, height: 3 });
      } else {
        buildings.push({ minX: rx - 5.5, maxX: rx + 5.5, minZ: rz - 2.5, maxZ: rz + 2.5, height: 3 });
      }

      lodObjects.push({ lod, position: new THREE.Vector3(rx, 0, rz) });
    }

    // Barriers
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.9 });
      const geo = new THREE.BoxGeometry(6, 1.2, 0.6);
      const wall = new THREE.Mesh(geo, mat);
      const wx = (Math.random() - 0.5) * 180;
      const wz = (Math.random() - 0.5) * 180;
      wall.position.set(wx, 0.6, wz);
      wall.rotation.y = Math.random() * Math.PI;
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);
    }
  }

  // ============================================
  // LOD BUILDING GENERATORS
  // ============================================
  function createBuildingHighDetail(w: number, h: number, d: number, color: number, envMap: THREE.CubeCamera): THREE.Group {
    const group = new THREE.Group();

    // Main structure with PBR
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      envMap: envMap.renderTarget.texture,
      envMapIntensity: VISUAL_CONFIG.ENV_MAP_INTENSITY,
    });
    const geom = new THREE.BoxGeometry(w, h, d, 4, 4, 4); // Subdivided for detail
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Roof
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x4b5563,
      roughness: 0.6,
      metalness: 0.3,
      envMap: envMap.renderTarget.texture,
      envMapIntensity: 0.4,
    });
    const roofGeom = new THREE.BoxGeometry(w + 1.2, 0.6, d + 1.2);
    const roof = new THREE.Mesh(roofGeom, roofMat);
    roof.position.y = h + 0.3;
    roof.castShadow = true;
    group.add(roof);

    // Windows (detailed)
    const windowMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      roughness: 0.1,
      metalness: 0.8,
      emissive: 0x1a365d,
      emissiveIntensity: 0.5,
      envMap: envMap.renderTarget.texture,
      envMapIntensity: 0.8,
    });

    const windowCount = Math.floor(w / 4);
    for (let i = 0; i < windowCount; i++) {
      const winGeom = new THREE.BoxGeometry(1.8, 2.2, 0.1);
      const win = new THREE.Mesh(winGeom, windowMat);
      const wx = -w / 2 + 3 + i * 4;
      win.position.set(wx, h * 0.5, d / 2 + 0.05);
      win.castShadow = true;
      group.add(win);

      // Window frame
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.8 });
      const frameGeom = new THREE.BoxGeometry(2.0, 2.4, 0.05);
      const frame = new THREE.Mesh(frameGeom, frameMat);
      frame.position.set(wx, h * 0.5, d / 2 + 0.02);
      group.add(frame);
    }

    // Door
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 });
    const doorGeom = new THREE.BoxGeometry(2, 3, 0.1);
    const door = new THREE.Mesh(doorGeom, doorMat);
    door.position.set(0, 1.5, d / 2 + 0.05);
    group.add(door);

    // Details: pipes, vents
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const pipeGeom = new THREE.CylinderGeometry(0.15, 0.15, h * 0.8, 8);
      const pipe = new THREE.Mesh(pipeGeom, pipeMat);
      pipe.position.set(-w / 2 + 1 + i * 2, h * 0.4, -d / 2 - 0.2);
      pipe.castShadow = true;
      group.add(pipe);
    }

    return group;
  }

  function createBuildingMediumDetail(w: number, h: number, d: number, color: number): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 });
    const geom = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.6 });
    const roofGeom = new THREE.BoxGeometry(w + 1, 0.5, d + 1);
    const roof = new THREE.Mesh(roofGeom, roofMat);
    roof.position.y = h + 0.25;
    group.add(roof);

    return group;
  }

  function createBuildingLowDetail(w: number, h: number, d: number, color: number): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const geom = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = h / 2;
    group.add(mesh);
    return group;
  }

  function createContainerHighDetail(color: number, envMap: THREE.CubeCamera): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.4,
      envMap: envMap.renderTarget.texture,
      envMapIntensity: 0.5,
    });
    const geom = new THREE.BoxGeometry(4, 3, 10, 2, 2, 2);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 1.5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Details: ridges
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const ridgeGeom = new THREE.BoxGeometry(4.1, 0.1, 0.2);
      const ridge = new THREE.Mesh(ridgeGeom, ridgeMat);
      ridge.position.set(0, 0.5 + i * 0.7, 0);
      group.add(ridge);
    }

    return group;
  }

  function createContainerLowDetail(color: number): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const geom = new THREE.BoxGeometry(4, 3, 10);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 1.5;
    group.add(mesh);
    return group;
  }

  // ============================================
  // WEAPON MODEL
  // ============================================
  function buildWeaponModel(group: THREE.Group) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.85, roughness: 0.25 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.95, roughness: 0.15 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.35, metalness: 0.6 });

    const barrelGeo = new THREE.CylinderGeometry(0.014, 0.016, 0.5, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, metalMat);
    barrel.position.set(0, -0.035, -0.32);
    group.add(barrel);

    const handguardGeo = new THREE.BoxGeometry(0.055, 0.055, 0.22);
    const handguard = new THREE.Mesh(handguardGeo, bodyMat);
    handguard.position.set(0, -0.055, -0.18);
    group.add(handguard);

    const receiverGeo = new THREE.BoxGeometry(0.065, 0.075, 0.32);
    const receiver = new THREE.Mesh(receiverGeo, bodyMat);
    receiver.position.set(0, -0.065, 0.02);
    group.add(receiver);

    const lowerGeo = new THREE.BoxGeometry(0.05, 0.04, 0.15);
    const lower = new THREE.Mesh(lowerGeo, bodyMat);
    lower.position.set(0, -0.12, 0.05);
    group.add(lower);

    const magGeo = new THREE.BoxGeometry(0.035, 0.14, 0.05);
    const mag = new THREE.Mesh(magGeo, metalMat);
    mag.position.set(0, -0.19, 0.04);
    mag.rotation.x = 0.12;
    group.add(mag);

    const stockGeo = new THREE.BoxGeometry(0.045, 0.085, 0.22);
    const stock = new THREE.Mesh(stockGeo, bodyMat);
    stock.position.set(0, -0.06, 0.26);
    group.add(stock);

    const gripGeo = new THREE.BoxGeometry(0.03, 0.07, 0.035);
    const grip = new THREE.Mesh(gripGeo, bodyMat);
    grip.position.set(0, -0.15, 0.1);
    grip.rotation.x = -0.25;
    group.add(grip);

    const railGeo = new THREE.BoxGeometry(0.035, 0.015, 0.14);
    const rail = new THREE.Mesh(railGeo, metalMat);
    rail.position.set(0, -0.02, -0.01);
    group.add(rail);

    const sightBase = new THREE.BoxGeometry(0.03, 0.03, 0.05);
    const sight = new THREE.Mesh(sightBase, accentMat);
    sight.position.set(0, 0.0, -0.01);
    group.add(sight);

    const lensGeo = new THREE.CircleGeometry(0.012, 8);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.6 });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(0, 0.0, -0.036);
    group.add(lens);

    const fgGeo = new THREE.BoxGeometry(0.025, 0.05, 0.03);
    const fg = new THREE.Mesh(fgGeo, bodyMat);
    fg.position.set(0, -0.1, -0.15);
    group.add(fg);
  }

  // ============================================
  // ENEMIES
  // ============================================
  function spawnEnemies(scene: THREE.Scene, game: NonNullable<typeof gameRef.current>) {
    game.enemies = [];
    game.enemiesRemaining = 8;

    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.6 });
      const armorMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.3 });
      const pantsMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.7 });

      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.5), bodyMat);
      torso.position.y = 1.2;
      torso.castShadow = true;
      group.add(torso);

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), armorMat);
      head.position.y = 1.9;
      head.castShadow = true;
      group.add(head);

      const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.25);
      const leftLeg = new THREE.Mesh(legGeo, pantsMat);
      leftLeg.position.set(-0.2, 0.35, 0);
      leftLeg.castShadow = true;
      group.add(leftLeg);
      const rightLeg = new THREE.Mesh(legGeo, pantsMat);
      rightLeg.position.set(0.2, 0.35, 0);
      rightLeg.castShadow = true;
      group.add(rightLeg);

      const armGeo = new THREE.BoxGeometry(0.18, 0.65, 0.18);
      const leftArm = new THREE.Mesh(armGeo, bodyMat);
      leftArm.position.set(-0.55, 1.2, 0);
      leftArm.castShadow = true;
      group.add(leftArm);
      const rightArm = new THREE.Mesh(armGeo, bodyMat);
      rightArm.position.set(0.55, 1.2, 0);
      rightArm.castShadow = true;
      group.add(rightArm);

      const eWeapon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.45), armorMat);
      eWeapon.position.set(0.55, 1.1, -0.2);
      group.add(eWeapon);

      let ex = (Math.random() - 0.5) * 180;
      let ez = (Math.random() - 0.5) * 180;
      let valid = false;
      let attempts = 0;
      while (!valid && attempts < 20) {
        valid = true;
        for (const b of game.buildings) {
          if (ex > b.minX - 2 && ex < b.maxX + 2 && ez > b.minZ - 2 && ez < b.maxZ + 2) {
            valid = false;
            ex = (Math.random() - 0.5) * 180;
            ez = (Math.random() - 0.5) * 180;
            break;
          }
        }
        attempts++;
      }

      group.position.set(ex, 0, ez);

      game.enemies.push({
        mesh: group,
        health: 100,
        shootTimer: Math.random() * 3 + 1.5,
        speed: 0.025 + Math.random() * 0.02,
        patrolAngle: Math.random() * Math.PI * 2,
        patrolCenter: new THREE.Vector3(ex, 0, ez),
      });

      scene.add(group);
    }
  }

  // ============================================
  // GAME LOOP
  // ============================================
  function gameLoop() {
    const game = gameRef.current;
    if (!game || game.isOver) return;

    game.animationId = requestAnimationFrame(gameLoop);

    const delta = Math.min(game.clock.getDelta(), 0.05);

    // FPS counter
    game.frameCount++;
    const now = performance.now();
    if (now - game.lastFpsUpdate > 500) {
      game.fps = Math.round((game.frameCount * 1000) / (now - game.lastFpsUpdate));
      setFps(game.fps);
      game.frameCount = 0;
      game.lastFpsUpdate = now;
    }

    // Day/night cycle (Lumen-inspired)
    game.dayTime += VISUAL_CONFIG.DAY_NIGHT_CYCLE_SPEED * delta;
    updateDayNightCycle(game);

    // Update LODs
    game.lodObjects.forEach(obj => {
      obj.lod.update(game.camera);
    });

    if (game.phase === 'PARACHUTE') {
      updateParachute(game, delta);
    } else {
      updateGround(game, delta);
    }

    // Decay recoil
    game.recoilPitch *= 0.85;
    game.recoilYaw *= 0.85;

    // Render with post-processing
    game.composer.render();
  }

  // ============================================
  // DAY/NIGHT CYCLE (Lumen-inspired)
  // ============================================
  function updateDayNightCycle(game: NonNullable<typeof gameRef.current>) {
    const t = game.dayTime;
    const sunAngle = t % (Math.PI * 2);

    // Sun position (circular path)
    const sunX = Math.cos(sunAngle) * 150;
    const sunY = Math.sin(sunAngle) * 150 + 50;
    const sunZ = 60;
    game.sunLight.position.set(sunX, Math.max(10, sunY), sunZ);

    // Sun color and intensity based on time
    const dayFactor = Math.max(0, Math.sin(sunAngle));
    const sunsetFactor = Math.max(0, 1 - Math.abs(sunAngle - Math.PI / 2) / (Math.PI / 2));

    // Day: warm white, Night: cool blue
    const dayColor = new THREE.Color(0xfff5ea);
    const nightColor = new THREE.Color(0x1a2332);
    const sunsetColor = new THREE.Color(0xff8844);

    const sunColor = dayColor.clone().lerp(nightColor, 1 - dayFactor);
    if (sunsetFactor > 0.3) {
      sunColor.lerp(sunsetColor, sunsetFactor * 0.5);
    }

    game.sunLight.color.copy(sunColor);
    game.sunLight.intensity = 0.5 + dayFactor * 1.8;

    // Ambient light
    game.ambientLight.intensity = 0.3 + dayFactor * 0.4;

    // Sky color
    const skyDay = new THREE.Color(0x87ceeb);
    const skyNight = new THREE.Color(0x0b0f19);
    const skySunset = new THREE.Color(0xff6b35);
    const skyColor = skyDay.clone().lerp(skyNight, 1 - dayFactor);
    if (sunsetFactor > 0.3) {
      skyColor.lerp(skySunset, sunsetFactor * 0.4);
    }
    game.scene.background = skyColor;
    game.scene.fog = new THREE.FogExp2(skyColor, 0.004);

    // Update time of day label
    if (dayFactor > 0.7) setTimeOfDay('Day');
    else if (dayFactor > 0.3) setTimeOfDay(sunAngle < Math.PI ? 'Sunset' : 'Sunrise');
    else setTimeOfDay('Night');
  }

  // ============================================
  // PARACHUTE PHASE
  // ============================================
  function updateParachute(game: NonNullable<typeof gameRef.current>, delta: number) {
    game.yawObject.position.y -= CAMERA_CONFIG.PARACHUTE_DESCENT * delta;

    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), game.yawObject.rotation.y);

    const right = new THREE.Vector3(1, 0, 0);
    right.applyAxisAngle(new THREE.Vector3(0, 1, 0), game.yawObject.rotation.y);

    const moveVec = new THREE.Vector3();
    if (game.keys['w'] || game.keys['arrowup']) moveVec.add(forward);
    if (game.keys['s'] || game.keys['arrowdown']) moveVec.sub(forward);
    if (game.keys['d'] || game.keys['arrowright']) moveVec.add(right);
    if (game.keys['a'] || game.keys['arrowleft']) moveVec.sub(right);

    if (moveVec.lengthSq() > 0) {
      moveVec.normalize();
      game.yawObject.position.addScaledVector(moveVec, CAMERA_CONFIG.PARACHUTE_GLIDE * delta);
    }

    game.yawObject.position.x = THREE.MathUtils.clamp(game.yawObject.position.x, -180, 180);
    game.yawObject.position.z = THREE.MathUtils.clamp(game.yawObject.position.z, -180, 180);

    setAltitude(Math.max(0, Math.floor(game.yawObject.position.y)));

    if (game.yawObject.position.y <= CAMERA_CONFIG.PLAYER_HEIGHT) {
      game.yawObject.position.y = CAMERA_CONFIG.PLAYER_HEIGHT;
      game.phase = 'GROUND';
      game.canJump = true;
      game.velocity.set(0, 0, 0);
      game.pitchObject.rotation.x = 0;
      setGamePhase('GROUND');
    }
  }

  // ============================================
  // GROUND PHASE
  // ============================================
  function updateGround(game: NonNullable<typeof gameRef.current>, delta: number) {
    const currentTime = performance.now();

    if (game.mouseDown.left) {
      shootWeapon(game, currentTime);
    }

    const yawAngle = game.yawObject.rotation.y;
    const forward = new THREE.Vector3(-Math.sin(yawAngle), 0, -Math.cos(yawAngle));
    const right = new THREE.Vector3(Math.cos(yawAngle), 0, -Math.sin(yawAngle));

    const inputDir = new THREE.Vector3();
    if (game.keys['w'] || game.keys['arrowup']) inputDir.add(forward);
    if (game.keys['s'] || game.keys['arrowdown']) inputDir.sub(forward);
    if (game.keys['d'] || game.keys['arrowright']) inputDir.add(right);
    if (game.keys['a'] || game.keys['arrowleft']) inputDir.sub(right);

    if (inputDir.lengthSq() > 0) inputDir.normalize();

    const isSprinting = !!game.keys['shift'] && !!game.keys['w'] && !game.isADS();
    let targetSpeed: number;
    if (game.isADS()) {
      targetSpeed = MOVEMENT_CONFIG.ADS_SPEED;
    } else if (isSprinting) {
      targetSpeed = MOVEMENT_CONFIG.SPRINT_SPEED;
    } else {
      targetSpeed = MOVEMENT_CONFIG.WALK_SPEED;
    }

    const targetVelX = inputDir.x * targetSpeed;
    const targetVelZ = inputDir.z * targetSpeed;
    const accelRate = MOVEMENT_CONFIG.GROUND_FRICTION;

    game.velocity.x += (targetVelX - game.velocity.x) * Math.min(accelRate * delta, 1);
    game.velocity.z += (targetVelZ - game.velocity.z) * Math.min(accelRate * delta, 1);
    game.velocity.y -= MOVEMENT_CONFIG.GRAVITY * delta;

    const pos = game.yawObject.position;
    const newX = pos.x + game.velocity.x * delta;
    const newZ = pos.z + game.velocity.z * delta;
    const newY = pos.y + game.velocity.y * delta;

    const playerRadius = 0.5;
    let finalX = newX;
    let finalZ = newZ;

    for (const b of game.buildings) {
      if (newY - CAMERA_CONFIG.PLAYER_HEIGHT < b.height) {
        const closestX = THREE.MathUtils.clamp(newX, b.minX, b.maxX);
        const closestZ = THREE.MathUtils.clamp(newZ, b.minZ, b.maxZ);
        const dx = newX - closestX;
        const dz = newZ - closestZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < playerRadius) {
          if (dist > 0.001) {
            finalX = closestX + (dx / dist) * playerRadius;
            finalZ = closestZ + (dz / dist) * playerRadius;
          } else {
            finalX = b.maxX + playerRadius;
          }
          game.velocity.x *= 0.3;
          game.velocity.z *= 0.3;
        }
      }
    }

    pos.x = THREE.MathUtils.clamp(finalX, -195, 195);
    pos.z = THREE.MathUtils.clamp(finalZ, -195, 195);
    pos.y = Math.max(CAMERA_CONFIG.PLAYER_HEIGHT, newY);

    if (pos.y <= CAMERA_CONFIG.PLAYER_HEIGHT) {
      pos.y = CAMERA_CONFIG.PLAYER_HEIGHT;
      game.velocity.y = 0;
      game.canJump = true;
    }

    updatePlayerBullets(game);
    updateEnemies(game, delta);
    updateEnemyBullets(game);
  }

  // ============================================
  // COMBAT
  // ============================================
  function shootWeapon(game: NonNullable<typeof gameRef.current>, currentTime: number) {
    if (isReloadingRef.current) return;
    if (game.ammoCurrent <= 0) {
      reloadWeapon(game);
      return;
    }

    const fireRate = 90;
    if (currentTime - game.lastShotTime < fireRate) return;
    game.lastShotTime = currentTime;

    game.ammoCurrent--;
    setAmmoCurrent(game.ammoCurrent);

    const kickOffset = game.isADS() ? 0.03 : 0.06;
    game.weaponGroup.position.z = game.weaponOriginalPos.z + kickOffset;
    setTimeout(() => {
      if (gameRef.current) {
        gameRef.current.weaponGroup.position.z = gameRef.current.weaponOriginalPos.z;
      }
    }, 45);

    const recoilAmount = game.isADS() ? 0.004 : 0.008;
    game.recoilPitch += recoilAmount + Math.random() * 0.003;
    game.recoilYaw += (Math.random() - 0.5) * 0.003;

    const bulletGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);

    const bulletPos = new THREE.Vector3();
    game.camera.getWorldPosition(bulletPos);
    bulletMesh.position.copy(bulletPos);

    const bulletDir = new THREE.Vector3();
    game.camera.getWorldDirection(bulletDir);

    const spread = game.isADS() ? 0.003 : 0.02;
    bulletDir.x += (Math.random() - 0.5) * spread;
    bulletDir.y += (Math.random() - 0.5) * spread;
    bulletDir.z += (Math.random() - 0.5) * spread;
    bulletDir.normalize();

    game.scene.add(bulletMesh);
    game.bullets.push({ mesh: bulletMesh, dir: bulletDir, speed: 4.5, life: 80 });

    createMuzzleFlash(game);
  }

  function createMuzzleFlash(game: NonNullable<typeof gameRef.current>) {
    const flashGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7, transparent: true, opacity: 0.95 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(0, -0.035, -0.55);
    game.weaponGroup.add(flash);

    const flashLight = new THREE.PointLight(0xffaa00, 3, 8);
    flashLight.position.copy(flash.position);
    game.weaponGroup.add(flashLight);

    setTimeout(() => {
      game.weaponGroup.remove(flash);
      game.weaponGroup.remove(flashLight);
      flash.geometry.dispose();
      (flash.material as THREE.Material).dispose();
      flashLight.dispose();
    }, 40);
  }

  function reloadWeapon(game: NonNullable<typeof gameRef.current>) {
    if (isReloadingRef.current || game.ammoReserve <= 0 || game.ammoCurrent >= 30) return;

    isReloadingRef.current = true;
    setIsReloading(true);
    game.weaponGroup.rotation.x = 0.35;

    setTimeout(() => {
      if (!gameRef.current) return;
      const needed = 30 - gameRef.current.ammoCurrent;
      const toLoad = Math.min(needed, gameRef.current.ammoReserve);
      gameRef.current.ammoCurrent += toLoad;
      gameRef.current.ammoReserve -= toLoad;
      gameRef.current.weaponGroup.rotation.x = 0;
      isReloadingRef.current = false;
      setAmmoCurrent(gameRef.current.ammoCurrent);
      setAmmoReserve(gameRef.current.ammoReserve);
      setIsReloading(false);
    }, 1400);
  }

  function updatePlayerBullets(game: NonNullable<typeof gameRef.current>) {
    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const b = game.bullets[i];
      b.mesh.position.addScaledVector(b.dir, b.speed);
      b.life--;

      let hit = false;

      for (let j = game.enemies.length - 1; j >= 0; j--) {
        const enemy = game.enemies[j];
        const enemyCenter = new THREE.Vector3(
          enemy.mesh.position.x,
          enemy.mesh.position.y + 1.2,
          enemy.mesh.position.z
        );
        const dist = b.mesh.position.distanceTo(enemyCenter);

        if (dist < 1.4) {
          const headPos = new THREE.Vector3(
            enemy.mesh.position.x,
            enemy.mesh.position.y + 1.9,
            enemy.mesh.position.z
          );
          const headDist = b.mesh.position.distanceTo(headPos);
          const damage = headDist < 0.5 ? 100 : 34;

          enemy.health -= damage;
          hit = true;
          createImpactEffect(game.scene, b.mesh.position.clone(), damage > 50 ? 0xff0000 : 0xfde047);

          if (enemy.health <= 0) {
            game.scene.remove(enemy.mesh);
            game.enemies.splice(j, 1);
            game.enemiesRemaining--;
            setEnemiesRemaining(game.enemiesRemaining);
            if (game.enemiesRemaining <= 0) triggerVictory(game);
          }
          break;
        }
      }

      if (!hit) {
        for (const bld of game.buildings) {
          if (b.mesh.position.x > bld.minX && b.mesh.position.x < bld.maxX &&
              b.mesh.position.z > bld.minZ && b.mesh.position.z < bld.maxZ &&
              b.mesh.position.y < bld.height) {
            hit = true;
            createImpactEffect(game.scene, b.mesh.position.clone(), 0x888888);
            break;
          }
        }
      }

      if (hit || b.life <= 0) {
        game.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        game.bullets.splice(i, 1);
      }
    }
  }

  function updateEnemies(game: NonNullable<typeof gameRef.current>, delta: number) {
    const playerPos = game.yawObject.position;

    for (const enemy of game.enemies) {
      const ePos = enemy.mesh.position;
      const dx = playerPos.x - ePos.x;
      const dz = playerPos.z - ePos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 80 && dist > 1.5) {
        enemy.mesh.rotation.y = Math.atan2(dx, dz);

        if (dist > 10) {
          const moveX = (dx / dist) * enemy.speed;
          const moveZ = (dz / dist) * enemy.speed;
          const newEX = ePos.x + moveX;
          const newEZ = ePos.z + moveZ;

          let blocked = false;
          for (const b of game.buildings) {
            if (newEX > b.minX - 0.5 && newEX < b.maxX + 0.5 &&
                newEZ > b.minZ - 0.5 && newEZ < b.maxZ + 0.5) {
              blocked = true;
              break;
            }
          }

          if (!blocked) {
            ePos.x = newEX;
            ePos.z = newEZ;
          } else {
            ePos.x += moveZ * 0.6;
            ePos.z -= moveX * 0.6;
          }
        }

        enemy.shootTimer -= delta;
        if (enemy.shootTimer <= 0 && dist < 55) {
          enemy.shootTimer = 1.5 + Math.random() * 2;
          enemyShoot(game, ePos, playerPos);
        }
      } else if (dist >= 80) {
        enemy.patrolAngle += delta * 0.7;
        const pr = 10;
        const tx = enemy.patrolCenter.x + Math.cos(enemy.patrolAngle) * pr;
        const tz = enemy.patrolCenter.z + Math.sin(enemy.patrolAngle) * pr;
        const pdx = tx - ePos.x;
        const pdz = tz - ePos.z;
        const pDist = Math.sqrt(pdx * pdx + pdz * pdz);
        if (pDist > 0.5) {
          ePos.x += (pdx / pDist) * enemy.speed * 0.5;
          ePos.z += (pdz / pDist) * enemy.speed * 0.5;
          enemy.mesh.rotation.y = Math.atan2(pdx, pdz);
        }
      }
    }
  }

  function enemyShoot(game: NonNullable<typeof gameRef.current>, from: THREE.Vector3, target: THREE.Vector3) {
    const geo = new THREE.SphereGeometry(0.07, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const mesh = new THREE.Mesh(geo, mat);

    const start = new THREE.Vector3(from.x, from.y + 1.4, from.z);
    mesh.position.copy(start);

    const dir = new THREE.Vector3(
      target.x - start.x,
      target.y - start.y,
      target.z - start.z
    ).normalize();

    const inacc = 0.07;
    dir.x += (Math.random() - 0.5) * inacc;
    dir.y += (Math.random() - 0.5) * inacc;
    dir.z += (Math.random() - 0.5) * inacc;
    dir.normalize();

    game.scene.add(mesh);
    game.enemyBullets.push({ mesh, dir, speed: 2.2, life: 90 });
  }

  function updateEnemyBullets(game: NonNullable<typeof gameRef.current>) {
    const playerPos = game.yawObject.position;

    for (let i = game.enemyBullets.length - 1; i >= 0; i--) {
      const eb = game.enemyBullets[i];
      eb.mesh.position.addScaledVector(eb.dir, eb.speed);
      eb.life--;

      const dist = eb.mesh.position.distanceTo(playerPos);
      if (dist < 1.0) {
        game.playerHealth -= 10;
        setPlayerHealth(Math.max(0, game.playerHealth));
        setHitFlash(true);
        setTimeout(() => setHitFlash(false), 250);

        game.scene.remove(eb.mesh);
        eb.mesh.geometry.dispose();
        (eb.mesh.material as THREE.Material).dispose();
        game.enemyBullets.splice(i, 1);

        if (game.playerHealth <= 0) triggerGameOver(game);
        continue;
      }

      if (eb.life <= 0) {
        game.scene.remove(eb.mesh);
        eb.mesh.geometry.dispose();
        (eb.mesh.material as THREE.Material).dispose();
        game.enemyBullets.splice(i, 1);
      }
    }
  }

  function createImpactEffect(scene: THREE.Scene, pos: THREE.Vector3, color: number) {
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      p.position.x += (Math.random() - 0.5) * 0.4;
      p.position.y += (Math.random() - 0.5) * 0.4;
      p.position.z += (Math.random() - 0.5) * 0.4;
      scene.add(p);
      setTimeout(() => {
        scene.remove(p);
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      }, 120);
    }
  }

  function triggerGameOver(game: NonNullable<typeof gameRef.current>) {
    game.isOver = true;
    game.isStarted = false;
    if (game.animationId) cancelAnimationFrame(game.animationId);
    document.exitPointerLock();
    setGameResult('defeat');
    setGamePhase('GAMEOVER');
  }

  function triggerVictory(game: NonNullable<typeof gameRef.current>) {
    game.isOver = true;
    game.isStarted = false;
    if (game.animationId) cancelAnimationFrame(game.animationId);
    document.exitPointerLock();
    setGameResult('victory');
    setGamePhase('GAMEOVER');
  }

  // ============================================
  // INPUT HANDLERS
  // ============================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game || !game.isStarted || game.isOver) return;

      const key = e.code.replace('Key', '').toLowerCase();
      game.keys[key] = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') game.keys['shift'] = true;

      if (e.code === 'Space' && game.phase === 'GROUND' && game.canJump) {
        game.velocity.y = MOVEMENT_CONFIG.JUMP_VELOCITY;
        game.canJump = false;
        e.preventDefault();
      }

      if (e.code === 'KeyR' && game.phase === 'GROUND') {
        reloadWeapon(game);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;
      const key = e.code.replace('Key', '').toLowerCase();
      game.keys[key] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') game.keys['shift'] = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const game = gameRef.current;
      if (!game || !game.isStarted || game.isOver) return;
      if (document.pointerLockElement !== game.renderer.domElement) return;

      const dx = e.movementX || 0;
      const dy = e.movementY || 0;

      game.yawObject.rotation.y -= dx * CAMERA_CONFIG.MOUSE_SENSITIVITY;
      game.pitchObject.rotation.x -= dy * CAMERA_CONFIG.MOUSE_SENSITIVITY;

      game.pitchObject.rotation.x += game.recoilPitch * 0.1;
      game.yawObject.rotation.y += game.recoilYaw * 0.1;

      game.pitchObject.rotation.x = THREE.MathUtils.clamp(
        game.pitchObject.rotation.x,
        -CAMERA_CONFIG.PITCH_LIMIT,
        CAMERA_CONFIG.PITCH_LIMIT
      );
    };

    const handleMouseDown = (e: MouseEvent) => {
      const game = gameRef.current;
      if (!game || !game.isStarted || game.isOver) return;
      if (document.pointerLockElement !== game.renderer.domElement) return;

      if (e.button === 0 && game.phase === 'GROUND') {
        game.mouseDown.left = true;
      } else if (e.button === 2 && game.phase === 'GROUND') {
        game.mouseDown.right = true;
        game.camera.fov = CAMERA_CONFIG.FOV_ADS;
        game.camera.updateProjectionMatrix();
        game.weaponGroup.position.set(0, -0.15, -0.35);
        document.body.classList.add('ads-active');
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const game = gameRef.current;
      if (!game) return;

      if (e.button === 0) {
        game.mouseDown.left = false;
      } else if (e.button === 2) {
        game.mouseDown.right = false;
        game.camera.fov = CAMERA_CONFIG.FOV;
        game.camera.updateProjectionMatrix();
        game.weaponGroup.position.copy(game.weaponOriginalPos);
        document.body.classList.remove('ads-active');
      }
    };

    const handleContextMenu = (e: Event) => e.preventDefault();

    const handleResize = () => {
      const game = gameRef.current;
      if (!game) return;
      game.camera.aspect = window.innerWidth / window.innerHeight;
      game.camera.updateProjectionMatrix();
      game.renderer.setSize(window.innerWidth, window.innerHeight);
      game.composer.setSize(window.innerWidth, window.innerHeight);

      // Update FXAA resolution
      const pixelRatio = game.renderer.getPixelRatio();
      const fxaaPass = game.composer.passes[2] as ShaderPass;
      if (fxaaPass && fxaaPass.material && fxaaPass.material.uniforms['resolution']) {
        fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
        fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);
      }
    };

    const handlePointerLockChange = () => {
      const game = gameRef.current;
      if (!game) return;
      if (document.pointerLockElement !== game.renderer.domElement && game.isStarted && !game.isOver) {
        setShowResume(true);
      } else {
        setShowResume(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('resize', handleResize);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (gameRef.current) {
        if (gameRef.current.animationId) cancelAnimationFrame(gameRef.current.animationId);
        gameRef.current.renderer.dispose();
        gameRef.current.composer.dispose();
      }
    };
  }, []);

  const startGame = () => {
    initGame();
    setGamePhase('PARACHUTE');
    setPlayerHealth(100);
    setAmmoCurrent(30);
    setAmmoReserve(90);
    setEnemiesRemaining(8);
    setAltitude(CAMERA_CONFIG.PARACHUTE_HEIGHT);
    setGameResult(null);
    setIsReloading(false);
    isReloadingRef.current = false;

    setTimeout(() => {
      if (gameRef.current) {
        gameRef.current.renderer.domElement.requestPointerLock();
      }
    }, 100);
  };

  const restartGame = () => {
    if (gameRef.current) {
      if (gameRef.current.animationId) cancelAnimationFrame(gameRef.current.animationId);
      gameRef.current.renderer.dispose();
      gameRef.current.composer.dispose();
      if (containerRef.current) containerRef.current.innerHTML = '';
    }
    startGame();
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950">
      <div id="canvas-container" ref={containerRef} />

      {(gamePhase === 'PARACHUTE' || gamePhase === 'GROUND') && (
        <div id="crosshair" />
      )}

      {hitFlash && (
        <div className="absolute inset-0 pointer-events-none hit-flash z-30" />
      )}

      {gamePhase === 'MENU' && (
        <div className="absolute inset-0 bg-slate-950/95 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-md">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl text-center fade-in">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-wider text-amber-500 mb-2 uppercase drop-shadow-md">
              Warzone Tactical
            </h1>
            <p className="text-slate-400 mb-4 text-sm">
              Infiltration en parachute — Éliminez tous les hostiles de la zone industrielle.
            </p>

            <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 text-xs text-amber-300">
              <p className="font-bold mb-1">✨ Améliorations UE5-Inspirées :</p>
              <p>• LOD Dynamique (Nanite) • Éclairage Global (Lumen) • Ombres 4K • FXAA + Bloom</p>
              <p>• Cycle Jour/Nuit • Reflets Temps Réel • Color Bleeding</p>
            </div>

            <div className="bg-slate-800/80 rounded-xl p-4 mb-6 text-left text-sm space-y-2 border border-slate-700/60">
              <div className="font-semibold text-amber-400 mb-2">⌨️ COMMANDES :</div>
              <div className="flex justify-between text-slate-300">
                <span>Déplacement :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">ZQSD / Flèches</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Regarder :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">Souris (1:1)</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Saut :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">Espace</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Tirer :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">Clic Gauche</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Viser (ADS) :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">Clic Droit</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Recharger :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">R</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Sprint :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">Shift</span>
              </div>
            </div>

            <button
              onClick={startGame}
              className="w-full py-4 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold uppercase tracking-wider rounded-xl shadow-lg transition transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
            >
              🪂 Lancer l'Infiltration
            </button>
          </div>
        </div>
      )}

      {gamePhase === 'GAMEOVER' && (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-md">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center shadow-2xl fade-in">
            <h2 className={`text-4xl font-extrabold mb-2 tracking-wide ${gameResult === 'victory' ? 'text-amber-500' : 'text-red-500'}`}>
              {gameResult === 'victory' ? '🏆 VICTOIRE TACTIQUE' : '💀 OPÉRATION ÉCHOUÉE'}
            </h2>
            <p className="text-slate-400 mb-6 text-sm">
              {gameResult === 'victory'
                ? 'Tous les hostiles ont été neutralisés.'
                : 'Vous avez succombé aux tirs ennemis.'}
            </p>
            <button
              onClick={restartGame}
              className="w-full py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold uppercase tracking-wider rounded-xl shadow transition cursor-pointer"
            >
              🔄 Redéployer
            </button>
          </div>
        </div>
      )}

      {(gamePhase === 'PARACHUTE' || gamePhase === 'GROUND') && (
        <div className="absolute inset-0 pointer-events-none p-4 md:p-6 flex flex-col justify-between z-20">
          <div className="flex justify-between items-start">
            <div className={`backdrop-blur-md px-4 py-2 rounded-xl text-xs font-mono tracking-widest shadow-lg ${
              gamePhase === 'PARACHUTE'
                ? 'bg-slate-900/85 border border-amber-500/50 text-amber-400 animate-pulse-slow'
                : 'bg-slate-900/85 border border-emerald-500/50 text-emerald-400'
            }`}>
              {gamePhase === 'PARACHUTE'
                ? <>🪂 ALTITUDE : <span className="font-bold">{altitude}m</span></>
                : <>⚔️ COMBAT ENGAGÉ • {timeOfDay}</>
              }
            </div>

            <div className="bg-slate-900/80 border border-slate-700/60 backdrop-blur-md px-4 py-2 rounded-xl text-xs font-mono shadow-lg flex items-center space-x-3">
              <span className="text-red-400 font-bold">HOSTILES :</span>
              <span className="text-white font-bold text-sm">{enemiesRemaining}</span>
            </div>
          </div>

          <div className="flex justify-between items-end">
            <div className="bg-slate-900/85 border border-slate-700/60 backdrop-blur-md p-4 rounded-xl shadow-lg w-52 md:w-64">
              <div className="flex justify-between text-xs font-bold mb-1.5 text-slate-300">
                <span>❤️ SANTÉ</span>
                <span className={playerHealth > 50 ? 'text-emerald-400' : playerHealth > 25 ? 'text-amber-400' : 'text-red-400'}>
                  {playerHealth}%
                </span>
              </div>
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    playerHealth > 50 ? 'bg-emerald-500' : playerHealth > 25 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${playerHealth}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col items-end space-y-2">
              <div className="perf-overlay bg-slate-900/85 border border-slate-700/60 backdrop-blur-md px-3 py-1.5 rounded-lg text-xs text-slate-400">
                FPS: <span className="text-emerald-400 font-bold">{fps}</span>
              </div>
              <div className="bg-slate-900/85 border border-slate-700/60 backdrop-blur-md px-5 py-3 rounded-xl shadow-lg text-right">
                <div className="text-xs text-amber-400 tracking-widest font-mono mb-1">M4-TACTICAL</div>
                <div className="text-2xl md:text-3xl font-extrabold font-mono">
                  <span className="text-white">{ammoCurrent}</span>
                  <span className="text-slate-500"> / </span>
                  <span className="text-slate-400">{ammoReserve}</span>
                </div>
                {isReloading && (
                  <div className="text-xs text-amber-400 font-bold mt-1 animate-pulse">
                    ⟳ RECHARGEMENT...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showResume && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer"
          onClick={() => {
            if (gameRef.current) {
              gameRef.current.renderer.domElement.requestPointerLock();
              setShowResume(false);
            }
          }}
        >
          <div className="bg-slate-900/90 border border-slate-700 px-8 py-4 rounded-xl text-center">
            <p className="text-white text-lg font-bold">🖱️ Cliquez pour reprendre le contrôle</p>
          </div>
        </div>
      )}
    </div>
  );
}
