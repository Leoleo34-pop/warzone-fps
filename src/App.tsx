import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

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
}

type GameState = 'MENU' | 'PARACHUTE' | 'GROUND' | 'GAMEOVER';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isReloadingRef = useRef(false);
  const gameRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    yawObject: THREE.Object3D;
    pitchObject: THREE.Object3D;
    weaponGroup: THREE.Group;
    weaponOriginalPos: THREE.Vector3;
    enemies: Enemy[];
    bullets: Bullet[];
    enemyBullets: Bullet[];
    buildings: Building[];
    keys: Record<string, boolean>;
    velocity: THREE.Vector3;
    canJump: boolean;
    isSprinting: boolean;
    isADS: boolean;
    isShooting: boolean;
    lastShotTime: number;
    playerHealth: number;
    ammoCurrent: number;
    ammoReserve: number;
    enemiesRemaining: number;
    gameState: 'PARACHUTE' | 'GROUND';
    isGameStarted: boolean;
    isGameOver: boolean;
    clock: THREE.Clock;
    animationId: number | null;
  } | null>(null);

  const [gameState, setGameState] = useState<GameState>('MENU');
  const [playerHealth, setPlayerHealth] = useState(100);
  const [ammoCurrent, setAmmoCurrent] = useState(30);
  const [ammoReserve, setAmmoReserve] = useState(90);
  const [enemiesRemaining, setEnemiesRemaining] = useState(8);
  const [altitude, setAltitude] = useState(150);
  const [isReloading, setIsReloading] = useState(false);
  const [gameResult, setGameResult] = useState<'victory' | 'defeat' | null>(null);
  const [hitFlash, setHitFlash] = useState(false);
  const [showResumeOverlay, setShowResumeOverlay] = useState(false);

  const initGame = useCallback(() => {
    if (!containerRef.current) return;

    // Clean up previous game
    if (gameRef.current) {
      if (gameRef.current.animationId) {
        cancelAnimationFrame(gameRef.current.animationId);
      }
      gameRef.current.renderer.dispose();
      containerRef.current.innerHTML = '';
    }

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a2332);
    scene.fog = new THREE.FogExp2(0x1a2332, 0.008);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Camera rig
    const yawObject = new THREE.Object3D();
    const pitchObject = new THREE.Object3D();
    yawObject.add(camera);
    pitchObject.add(yawObject);
    scene.add(pitchObject);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x6688aa, 0.8);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5ea, 1.5);
    sunLight.position.set(60, 180, 60);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 400;
    const d = 150;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x362d1e, 0.4);
    scene.add(hemiLight);

    // Build map
    const buildings: Building[] = [];
    buildMap(scene, buildings);

    // Weapon
    const weaponGroup = new THREE.Group();
    const weaponOriginalPos = new THREE.Vector3(0.3, -0.25, -0.5);
    createWeapon(weaponGroup);
    weaponGroup.position.copy(weaponOriginalPos);
    camera.add(weaponGroup);

    // Store game state
    gameRef.current = {
      scene,
      camera,
      renderer,
      yawObject,
      pitchObject,
      weaponGroup,
      weaponOriginalPos,
      enemies: [],
      bullets: [],
      enemyBullets: [],
      buildings,
      keys: {},
      velocity: new THREE.Vector3(),
      canJump: false,
      isSprinting: false,
      isADS: false,
      isShooting: false,
      lastShotTime: 0,
      playerHealth: 100,
      ammoCurrent: 30,
      ammoReserve: 90,
      enemiesRemaining: 8,
      gameState: 'PARACHUTE',
      isGameStarted: true,
      isGameOver: false,
      clock: new THREE.Clock(),
      animationId: null,
    };

    // Spawn enemies
    spawnEnemies(scene, gameRef.current);

    // Start game loop
    gameLoop();
  }, []);

  function buildMap(scene: THREE.Scene, buildings: Building[]) {
    // Ground
    const groundGeo = new THREE.PlaneGeometry(400, 400);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2d3748,
      roughness: 0.9,
      metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid
    const gridHelper = new THREE.GridHelper(400, 80, 0x4a5568, 0x2d3748);
    gridHelper.position.y = 0.02;
    scene.add(gridHelper);

    // Buildings
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.7, metalness: 0.2 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.6, metalness: 0.3 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x1e3a5f, roughness: 0.3, metalness: 0.5, emissive: 0x0a1628, emissiveIntensity: 0.3 });

    const buildingDefs = [
      { x: -40, z: -40, w: 20, h: 18, d: 20 },
      { x: 40, z: -50, w: 25, h: 22, d: 18 },
      { x: -50, z: 40, w: 18, h: 15, d: 25 },
      { x: 45, z: 35, w: 22, h: 20, d: 20 },
      { x: 0, z: -75, w: 35, h: 14, d: 18 },
      { x: -70, z: -10, w: 16, h: 12, d: 30 },
      { x: 70, z: -15, w: 20, h: 16, d: 16 },
      { x: 0, z: 60, w: 30, h: 10, d: 14 },
    ];

    buildingDefs.forEach(b => {
      // Main structure
      const geom = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mesh = new THREE.Mesh(geom, buildingMat);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      // Roof
      const roofGeom = new THREE.BoxGeometry(b.w + 1, 0.8, b.d + 1);
      const roofMesh = new THREE.Mesh(roofGeom, roofMat);
      roofMesh.position.set(b.x, b.h + 0.4, b.z);
      roofMesh.castShadow = true;
      scene.add(roofMesh);

      // Windows
      const windowCount = Math.floor(b.w / 5);
      for (let i = 0; i < windowCount; i++) {
        const winGeom = new THREE.PlaneGeometry(2, 2.5);
        const win = new THREE.Mesh(winGeom, windowMat);
        const wx = b.x - b.w / 2 + 3 + i * 5;
        win.position.set(wx, b.h * 0.5, b.z + b.d / 2 + 0.01);
        scene.add(win);
      }

      // Store collision box
      buildings.push({
        minX: b.x - b.w / 2 - 0.5,
        maxX: b.x + b.w / 2 + 0.5,
        minZ: b.z - b.d / 2 - 0.5,
        maxZ: b.z + b.d / 2 + 0.5,
        height: b.h,
      });
    });

    // Containers
    const containerColors = [0x991b1b, 0x1e3a8a, 0x065f46, 0xb45309, 0x581c87];
    for (let i = 0; i < 20; i++) {
      const cColor = containerColors[Math.floor(Math.random() * containerColors.length)];
      const cMat = new THREE.MeshStandardMaterial({ color: cColor, roughness: 0.5, metalness: 0.4 });
      const cGeo = new THREE.BoxGeometry(4, 3, 10);
      const cMesh = new THREE.Mesh(cGeo, cMat);

      let rx = (Math.random() - 0.5) * 200;
      let rz = (Math.random() - 0.5) * 200;

      // Avoid spawning inside buildings
      let validPos = false;
      let attempts = 0;
      while (!validPos && attempts < 10) {
        validPos = true;
        for (const b of buildings) {
          if (rx > b.minX - 3 && rx < b.maxX + 3 && rz > b.minZ - 6 && rz < b.maxZ + 6) {
            validPos = false;
            rx = (Math.random() - 0.5) * 200;
            rz = (Math.random() - 0.5) * 200;
            break;
          }
        }
        attempts++;
      }

      cMesh.position.set(rx, 1.5, rz);
      cMesh.rotation.y = Math.random() > 0.5 ? 0 : Math.PI / 2;
      cMesh.castShadow = true;
      cMesh.receiveShadow = true;
      scene.add(cMesh);

      // Add container collision
      if (cMesh.rotation.y === 0) {
        buildings.push({
          minX: rx - 2.5,
          maxX: rx + 2.5,
          minZ: rz - 5.5,
          maxZ: rz + 5.5,
          height: 3,
        });
      } else {
        buildings.push({
          minX: rx - 5.5,
          maxX: rx + 5.5,
          minZ: rz - 2.5,
          maxZ: rz + 2.5,
          height: 3,
        });
      }
    }

    // Barriers / walls
    for (let i = 0; i < 8; i++) {
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.8 });
      const wallGeo = new THREE.BoxGeometry(8, 1.5, 0.5);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      const wx = (Math.random() - 0.5) * 160;
      const wz = (Math.random() - 0.5) * 160;
      wall.position.set(wx, 0.75, wz);
      wall.rotation.y = Math.random() * Math.PI;
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);
    }
  }

  function createWeapon(weaponGroup: THREE.Group) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.3 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.9, roughness: 0.2 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4, metalness: 0.6 });

    // Barrel
    const barrelGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.55, 8);
    barrelGeo.rotateX(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, metalMat);
    barrel.position.set(0, -0.04, -0.35);
    weaponGroup.add(barrel);

    // Handguard
    const handguardGeo = new THREE.BoxGeometry(0.06, 0.06, 0.25);
    const handguard = new THREE.Mesh(handguardGeo, bodyMat);
    handguard.position.set(0, -0.06, -0.2);
    weaponGroup.add(handguard);

    // Receiver
    const receiverGeo = new THREE.BoxGeometry(0.07, 0.09, 0.35);
    const receiver = new THREE.Mesh(receiverGeo, bodyMat);
    receiver.position.set(0, -0.08, 0.02);
    weaponGroup.add(receiver);

    // Magazine
    const magGeo = new THREE.BoxGeometry(0.04, 0.16, 0.06);
    const mag = new THREE.Mesh(magGeo, metalMat);
    mag.position.set(0, -0.2, 0.05);
    mag.rotation.x = 0.15;
    weaponGroup.add(mag);

    // Stock
    const stockGeo = new THREE.BoxGeometry(0.05, 0.1, 0.25);
    const stock = new THREE.Mesh(stockGeo, bodyMat);
    stock.position.set(0, -0.07, 0.28);
    weaponGroup.add(stock);

    // Scope rail
    const railGeo = new THREE.BoxGeometry(0.04, 0.02, 0.15);
    const rail = new THREE.Mesh(railGeo, metalMat);
    rail.position.set(0, -0.02, -0.02);
    weaponGroup.add(rail);

    // Red dot sight
    const sightGeo = new THREE.BoxGeometry(0.035, 0.04, 0.06);
    const sight = new THREE.Mesh(sightGeo, accentMat);
    sight.position.set(0, 0.0, -0.02);
    weaponGroup.add(sight);

    // Grip
    const gripGeo = new THREE.BoxGeometry(0.035, 0.08, 0.04);
    const grip = new THREE.Mesh(gripGeo, bodyMat);
    grip.position.set(0, -0.16, 0.12);
    grip.rotation.x = -0.2;
    weaponGroup.add(grip);
  }

  function spawnEnemies(scene: THREE.Scene, game: NonNullable<typeof gameRef.current>) {
    game.enemies = [];
    game.enemiesRemaining = 8;

    for (let i = 0; i < 8; i++) {
      const enemyGroup = new THREE.Group();

      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.6 });
      const armorMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.3 });
      const pantsMat = new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.7 });

      // Torso
      const torsoGeom = new THREE.BoxGeometry(0.8, 1.0, 0.5);
      const torso = new THREE.Mesh(torsoGeom, bodyMat);
      torso.position.y = 1.2;
      torso.castShadow = true;
      enemyGroup.add(torso);

      // Head
      const headGeom = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      const head = new THREE.Mesh(headGeom, armorMat);
      head.position.y = 1.9;
      head.castShadow = true;
      enemyGroup.add(head);

      // Legs
      const legGeom = new THREE.BoxGeometry(0.25, 0.7, 0.3);
      const leftLeg = new THREE.Mesh(legGeom, pantsMat);
      leftLeg.position.set(-0.2, 0.35, 0);
      leftLeg.castShadow = true;
      enemyGroup.add(leftLeg);

      const rightLeg = new THREE.Mesh(legGeom, pantsMat);
      rightLeg.position.set(0.2, 0.35, 0);
      rightLeg.castShadow = true;
      enemyGroup.add(rightLeg);

      // Arms
      const armGeom = new THREE.BoxGeometry(0.2, 0.7, 0.2);
      const leftArm = new THREE.Mesh(armGeom, bodyMat);
      leftArm.position.set(-0.55, 1.2, 0);
      leftArm.castShadow = true;
      enemyGroup.add(leftArm);

      const rightArm = new THREE.Mesh(armGeom, bodyMat);
      rightArm.position.set(0.55, 1.2, 0);
      rightArm.castShadow = true;
      enemyGroup.add(rightArm);

      // Enemy weapon
      const eWeaponGeo = new THREE.BoxGeometry(0.06, 0.06, 0.5);
      const eWeapon = new THREE.Mesh(eWeaponGeo, armorMat);
      eWeapon.position.set(0.55, 1.1, -0.2);
      enemyGroup.add(eWeapon);

      // Position
      let ex = (Math.random() - 0.5) * 160;
      let ez = (Math.random() - 0.5) * 160;

      // Avoid buildings
      let validPos = false;
      let attempts = 0;
      while (!validPos && attempts < 20) {
        validPos = true;
        for (const b of game.buildings) {
          if (ex > b.minX - 1 && ex < b.maxX + 1 && ez > b.minZ - 1 && ez < b.maxZ + 1) {
            validPos = false;
            ex = (Math.random() - 0.5) * 160;
            ez = (Math.random() - 0.5) * 160;
            break;
          }
        }
        attempts++;
      }

      enemyGroup.position.set(ex, 0, ez);

      game.enemies.push({
        mesh: enemyGroup,
        health: 100,
        shootTimer: Math.random() * 3 + 1,
        speed: 0.03 + Math.random() * 0.02,
        patrolAngle: Math.random() * Math.PI * 2,
        patrolCenter: new THREE.Vector3(ex, 0, ez),
      });

      scene.add(enemyGroup);
    }
  }

  function gameLoop() {
    const game = gameRef.current;
    if (!game || game.isGameOver) return;

    game.animationId = requestAnimationFrame(gameLoop);

    const delta = Math.min(game.clock.getDelta(), 0.05); // Cap delta to avoid large jumps
    const currentTime = performance.now();

    if (game.gameState === 'PARACHUTE') {
      updateParachute(game, delta);
    } else if (game.gameState === 'GROUND') {
      updateGround(game, delta, currentTime);
    }

    game.renderer.render(game.scene, game.camera);
  }

  function updateParachute(game: NonNullable<typeof gameRef.current>, delta: number) {
    const descentSpeed = 12.0;
    const glideSpeed = 15.0;

    // Descend
    game.pitchObject.position.y -= descentSpeed * delta;

    // Glide controls
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(game.yawObject.quaternion);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(game.yawObject.quaternion);
    right.y = 0;
    right.normalize();

    const moveVec = new THREE.Vector3();
    if (game.keys['w'] || game.keys['arrowup']) moveVec.add(forward);
    if (game.keys['s'] || game.keys['arrowdown']) moveVec.sub(forward);
    if (game.keys['d'] || game.keys['arrowright']) moveVec.add(right);
    if (game.keys['a'] || game.keys['arrowleft']) moveVec.sub(right);

    if (moveVec.length() > 0) {
      moveVec.normalize();
      game.pitchObject.position.add(moveVec.multiplyScalar(glideSpeed * delta));
    }

    // Keep in bounds
    game.pitchObject.position.x = Math.max(-180, Math.min(180, game.pitchObject.position.x));
    game.pitchObject.position.z = Math.max(-180, Math.min(180, game.pitchObject.position.z));

    // Update altitude display
    const alt = Math.max(0, Math.floor(game.pitchObject.position.y));
    setAltitude(alt);

    // Landing
    if (game.pitchObject.position.y <= 1.8) {
      game.pitchObject.position.y = 1.8;
      game.gameState = 'GROUND';
      game.canJump = true;
      game.velocity.set(0, 0, 0);
      setGameState('GROUND');
    }
  }

  function updateGround(game: NonNullable<typeof gameRef.current>, delta: number, currentTime: number) {
    // Shooting
    if (game.isShooting) {
      shootWeapon(game, currentTime);
    }

    // Movement
    game.isSprinting = !!game.keys['shift'] && !!game.keys['w'] && !game.isADS;
    const baseSpeed = game.isSprinting ? 12.0 : 6.0;
    const adsSpeed = 3.0;
    const speed = game.isADS ? adsSpeed : baseSpeed;

    // Get forward and right vectors from yaw
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(game.yawObject.quaternion);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3(1, 0, 0);
    right.applyQuaternion(game.yawObject.quaternion);
    right.y = 0;
    right.normalize();

    const moveDir = new THREE.Vector3();
    if (game.keys['w'] || game.keys['arrowup']) moveDir.add(forward);
    if (game.keys['s'] || game.keys['arrowdown']) moveDir.sub(forward);
    if (game.keys['d'] || game.keys['arrowright']) moveDir.add(right);
    if (game.keys['a'] || game.keys['arrowleft']) moveDir.sub(right);

    if (moveDir.length() > 0) {
      moveDir.normalize();
    }

    // Apply movement with acceleration/deceleration
    const targetVelX = moveDir.x * speed;
    const targetVelZ = moveDir.z * speed;
    const accel = 10.0;

    game.velocity.x += (targetVelX - game.velocity.x) * accel * delta;
    game.velocity.z += (targetVelZ - game.velocity.z) * accel * delta;

    // Gravity
    game.velocity.y -= 25.0 * delta;

    // Apply velocity
    const newPos = game.pitchObject.position.clone();
    newPos.x += game.velocity.x * delta;
    newPos.z += game.velocity.z * delta;
    newPos.y += game.velocity.y * delta;

    // Ground collision
    if (newPos.y < 1.8) {
      newPos.y = 1.8;
      game.velocity.y = 0;
      game.canJump = true;
    }

    // Building collision
    const playerRadius = 0.8;
    for (const b of game.buildings) {
      if (newPos.y - 1.8 < b.height) { // Only collide if player is below building top
        const closestX = Math.max(b.minX, Math.min(newPos.x, b.maxX));
        const closestZ = Math.max(b.minZ, Math.min(newPos.z, b.maxZ));

        const distX = newPos.x - closestX;
        const distZ = newPos.z - closestZ;
        const dist = Math.sqrt(distX * distX + distZ * distZ);

        if (dist < playerRadius) {
          // Push player out
          if (dist > 0) {
            const pushX = (distX / dist) * (playerRadius - dist);
            const pushZ = (distZ / dist) * (playerRadius - dist);
            newPos.x += pushX;
            newPos.z += pushZ;
          } else {
            newPos.x += playerRadius;
          }
          // Stop velocity in collision direction
          game.velocity.x *= 0.5;
          game.velocity.z *= 0.5;
        }
      }
    }

    // Map bounds
    newPos.x = Math.max(-190, Math.min(190, newPos.x));
    newPos.z = Math.max(-190, Math.min(190, newPos.z));

    game.pitchObject.position.copy(newPos);

    // Update bullets
    updateBullets(game);

    // Update enemies
    updateEnemies(game, delta);

    // Update enemy bullets
    updateEnemyBullets(game);
  }

  function shootWeapon(game: NonNullable<typeof gameRef.current>, currentTime: number) {
    if (isReloadingRef.current) return;
    if (game.ammoCurrent <= 0) {
      reloadWeapon(game);
      return;
    }

    const fireRate = 100; // ms between shots
    if (currentTime - game.lastShotTime < fireRate) return;
    game.lastShotTime = currentTime;

    game.ammoCurrent--;
    setAmmoCurrent(game.ammoCurrent);

    // Weapon recoil animation
    game.weaponGroup.position.z = game.weaponOriginalPos.z + 0.06;
    setTimeout(() => {
      if (gameRef.current) {
        gameRef.current.weaponGroup.position.z = gameRef.current.weaponOriginalPos.z;
      }
    }, 50);

    // Camera recoil
    game.pitchObject.rotation.x += 0.008 + Math.random() * 0.005;

    // Create bullet
    const bulletGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);

    const bulletPos = new THREE.Vector3();
    game.camera.getWorldPosition(bulletPos);
    bulletMesh.position.copy(bulletPos);

    const bulletDir = new THREE.Vector3();
    game.camera.getWorldDirection(bulletDir);

    // Spread
    const spread = game.isADS ? 0.005 : 0.025;
    bulletDir.x += (Math.random() - 0.5) * spread;
    bulletDir.y += (Math.random() - 0.5) * spread;
    bulletDir.z += (Math.random() - 0.5) * spread;
    bulletDir.normalize();

    game.scene.add(bulletMesh);
    game.bullets.push({
      mesh: bulletMesh,
      dir: bulletDir,
      speed: 4.0,
      life: 80,
    });

    // Muzzle flash
    createMuzzleFlash(game);
  }

  function createMuzzleFlash(game: NonNullable<typeof gameRef.current>) {
    const flashGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(0, -0.04, -0.6);
    game.weaponGroup.add(flash);
    setTimeout(() => {
      game.weaponGroup.remove(flash);
      flash.geometry.dispose();
      (flash.material as THREE.Material).dispose();
    }, 40);
  }

  function reloadWeapon(game: NonNullable<typeof gameRef.current>) {
    if (isReloadingRef.current || game.ammoReserve <= 0 || game.ammoCurrent >= 30) return;

    isReloadingRef.current = true;
    setIsReloading(true);
    game.weaponGroup.rotation.x = 0.4;

    setTimeout(() => {
      if (!gameRef.current) return;
      const needed = 30 - gameRef.current.ammoCurrent;
      const toReload = Math.min(needed, gameRef.current.ammoReserve);
      gameRef.current.ammoCurrent += toReload;
      gameRef.current.ammoReserve -= toReload;
      gameRef.current.weaponGroup.rotation.x = 0;
      isReloadingRef.current = false;
      setAmmoCurrent(gameRef.current.ammoCurrent);
      setAmmoReserve(gameRef.current.ammoReserve);
      setIsReloading(false);
    }, 1500);
  }

  function updateBullets(game: NonNullable<typeof gameRef.current>) {
    for (let i = game.bullets.length - 1; i >= 0; i--) {
      const b = game.bullets[i];
      b.mesh.position.addScaledVector(b.dir, b.speed);
      b.life--;

      let hit = false;

      // Check enemy hits
      for (let j = game.enemies.length - 1; j >= 0; j--) {
        const enemy = game.enemies[j];
        const enemyCenter = new THREE.Vector3(
          enemy.mesh.position.x,
          enemy.mesh.position.y + 1.2,
          enemy.mesh.position.z
        );
        const dist = b.mesh.position.distanceTo(enemyCenter);

        if (dist < 1.5) {
          enemy.health -= 34;
          hit = true;
          createImpactEffect(game.scene, b.mesh.position.clone());

          if (enemy.health <= 0) {
            game.scene.remove(enemy.mesh);
            game.enemies.splice(j, 1);
            game.enemiesRemaining--;
            setEnemiesRemaining(game.enemiesRemaining);

            if (game.enemiesRemaining <= 0) {
              triggerVictory(game);
            }
          }
          break;
        }
      }

      // Check building hits
      if (!hit) {
        for (const bld of game.buildings) {
          if (b.mesh.position.x > bld.minX && b.mesh.position.x < bld.maxX &&
              b.mesh.position.z > bld.minZ && b.mesh.position.z < bld.maxZ &&
              b.mesh.position.y < bld.height) {
            hit = true;
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
    const playerPos = game.pitchObject.position;

    game.enemies.forEach(enemy => {
      const enemyPos = enemy.mesh.position;
      const dx = playerPos.x - enemyPos.x;
      const dz = playerPos.z - enemyPos.z;
      const distToPlayer = Math.sqrt(dx * dx + dz * dz);

      if (distToPlayer < 80 && distToPlayer > 2) {
        // Face player
        const angle = Math.atan2(dx, dz);
        enemy.mesh.rotation.y = angle;

        // Move towards player if far
        if (distToPlayer > 10) {
          const moveX = (dx / distToPlayer) * enemy.speed;
          const moveZ = (dz / distToPlayer) * enemy.speed;

          const newEX = enemyPos.x + moveX;
          const newEZ = enemyPos.z + moveZ;

          // Simple building avoidance for enemies
          let blocked = false;
          for (const b of game.buildings) {
            if (newEX > b.minX - 0.5 && newEX < b.maxX + 0.5 &&
                newEZ > b.minZ - 0.5 && newEZ < b.maxZ + 0.5) {
              blocked = true;
              break;
            }
          }

          if (!blocked) {
            enemyPos.x = newEX;
            enemyPos.z = newEZ;
          } else {
            // Try to go around
            enemyPos.x += moveZ * 0.5;
            enemyPos.z -= moveX * 0.5;
          }
        }

        // Shoot at player
        enemy.shootTimer -= delta;
        if (enemy.shootTimer <= 0 && distToPlayer < 50) {
          enemy.shootTimer = 1.5 + Math.random() * 1.5;
          enemyShoot(game, enemyPos, playerPos);
        }
      } else if (distToPlayer >= 80) {
        // Patrol
        enemy.patrolAngle += delta * 0.8;
        const patrolRadius = 8;
        const targetX = enemy.patrolCenter.x + Math.cos(enemy.patrolAngle) * patrolRadius;
        const targetZ = enemy.patrolCenter.z + Math.sin(enemy.patrolAngle) * patrolRadius;

        const pdx = targetX - enemyPos.x;
        const pdz = targetZ - enemyPos.z;
        const pDist = Math.sqrt(pdx * pdx + pdz * pdz);

        if (pDist > 0.5) {
          enemyPos.x += (pdx / pDist) * enemy.speed * 0.5;
          enemyPos.z += (pdz / pDist) * enemy.speed * 0.5;
          enemy.mesh.rotation.y = Math.atan2(pdx, pdz);
        }
      }
    });
  }

  function enemyShoot(game: NonNullable<typeof gameRef.current>, fromPos: THREE.Vector3, targetPos: THREE.Vector3) {
    const ebGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const ebMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const ebMesh = new THREE.Mesh(ebGeo, ebMat);

    const startPos = new THREE.Vector3(fromPos.x, fromPos.y + 1.4, fromPos.z);
    ebMesh.position.copy(startPos);

    const dir = new THREE.Vector3(
      targetPos.x - startPos.x,
      targetPos.y - startPos.y,
      targetPos.z - startPos.z
    ).normalize();

    // Enemy accuracy (some randomness)
    const inaccuracy = 0.08;
    dir.x += (Math.random() - 0.5) * inaccuracy;
    dir.y += (Math.random() - 0.5) * inaccuracy;
    dir.z += (Math.random() - 0.5) * inaccuracy;
    dir.normalize();

    game.scene.add(ebMesh);
    game.enemyBullets.push({
      mesh: ebMesh,
      dir: dir,
      speed: 2.0,
      life: 100,
    });
  }

  function updateEnemyBullets(game: NonNullable<typeof gameRef.current>) {
    const playerPos = game.pitchObject.position;

    for (let i = game.enemyBullets.length - 1; i >= 0; i--) {
      const eb = game.enemyBullets[i];
      eb.mesh.position.addScaledVector(eb.dir, eb.speed);
      eb.life--;

      // Check hit on player
      const dist = eb.mesh.position.distanceTo(playerPos);
      if (dist < 1.2) {
        game.playerHealth -= 12;
        setPlayerHealth(Math.max(0, game.playerHealth));
        setHitFlash(true);
        setTimeout(() => setHitFlash(false), 300);

        game.scene.remove(eb.mesh);
        eb.mesh.geometry.dispose();
        (eb.mesh.material as THREE.Material).dispose();
        game.enemyBullets.splice(i, 1);

        if (game.playerHealth <= 0) {
          triggerGameOver(game);
        }
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

  function createImpactEffect(scene: THREE.Scene, pos: THREE.Vector3) {
    // Spark particles
    for (let i = 0; i < 4; i++) {
      const pGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
      const pMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
      const p = new THREE.Mesh(pGeo, pMat);
      p.position.copy(pos);
      p.position.x += (Math.random() - 0.5) * 0.5;
      p.position.y += (Math.random() - 0.5) * 0.5;
      p.position.z += (Math.random() - 0.5) * 0.5;
      scene.add(p);
      setTimeout(() => {
        scene.remove(p);
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      }, 150);
    }
  }

  function triggerGameOver(game: NonNullable<typeof gameRef.current>) {
    game.isGameOver = true;
    game.isGameStarted = false;
    if (game.animationId) cancelAnimationFrame(game.animationId);
    document.exitPointerLock();
    setGameResult('defeat');
    setGameState('GAMEOVER');
  }

  function triggerVictory(game: NonNullable<typeof gameRef.current>) {
    game.isGameOver = true;
    game.isGameStarted = false;
    if (game.animationId) cancelAnimationFrame(game.animationId);
    document.exitPointerLock();
    setGameResult('victory');
    setGameState('GAMEOVER');
  }

  // Event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game || !game.isGameStarted || game.isGameOver) return;

      const key = e.code.replace('Key', '').toLowerCase();
      game.keys[key] = true;

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        game.keys['shift'] = true;
      }

      if (e.code === 'Space' && game.gameState === 'GROUND' && game.canJump) {
        game.velocity.y = 8;
        game.canJump = false;
        e.preventDefault();
      }

      if (e.code === 'KeyR' && game.gameState === 'GROUND') {
        reloadWeapon(game);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const game = gameRef.current;
      if (!game) return;

      const key = e.code.replace('Key', '').toLowerCase();
      game.keys[key] = false;

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        game.keys['shift'] = false;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      const game = gameRef.current;
      if (!game || !game.isGameStarted || game.isGameOver) return;
      if (document.pointerLockElement !== game.renderer.domElement) return;

      const sensitivity = 0.002;
      const movementX = e.movementX || 0;
      const movementY = e.movementY || 0;

      game.yawObject.rotation.y -= movementX * sensitivity;
      game.pitchObject.rotation.x -= movementY * sensitivity;

      // Clamp vertical look
      game.pitchObject.rotation.x = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, game.pitchObject.rotation.x));
    };

    const handleMouseDown = (e: MouseEvent) => {
      const game = gameRef.current;
      if (!game || !game.isGameStarted || game.isGameOver) return;
      if (document.pointerLockElement !== game.renderer.domElement) return;

      if (e.button === 0 && game.gameState === 'GROUND') {
        game.isShooting = true;
      } else if (e.button === 2 && game.gameState === 'GROUND') {
        game.isADS = true;
        game.camera.fov = 45;
        game.camera.updateProjectionMatrix();
        game.weaponGroup.position.set(0, -0.18, -0.4);
        document.body.classList.add('ads-active');
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const game = gameRef.current;
      if (!game) return;

      if (e.button === 0) {
        game.isShooting = false;
      } else if (e.button === 2) {
        game.isADS = false;
        game.camera.fov = 75;
        game.camera.updateProjectionMatrix();
        game.weaponGroup.position.copy(game.weaponOriginalPos);
        document.body.classList.remove('ads-active');
      }
    };

    const handleContextMenu = (e: Event) => {
      e.preventDefault();
    };

    const handleResize = () => {
      const game = gameRef.current;
      if (!game) return;
      game.camera.aspect = window.innerWidth / window.innerHeight;
      game.camera.updateProjectionMatrix();
      game.renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const handlePointerLockChange = () => {
      const game = gameRef.current;
      if (!game) return;
      if (document.pointerLockElement !== game.renderer.domElement && game.isGameStarted && !game.isGameOver) {
        setShowResumeOverlay(true);
      } else {
        setShowResumeOverlay(false);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gameRef.current) {
        if (gameRef.current.animationId) {
          cancelAnimationFrame(gameRef.current.animationId);
        }
        gameRef.current.renderer.dispose();
      }
    };
  }, []);

  const startGame = () => {
    initGame();
    setGameState('PARACHUTE');
    setPlayerHealth(100);
    setAmmoCurrent(30);
    setAmmoReserve(90);
    setEnemiesRemaining(8);
    setAltitude(150);
    setGameResult(null);
    setIsReloading(false);

    // Request pointer lock after a small delay
    setTimeout(() => {
      if (gameRef.current) {
        gameRef.current.renderer.domElement.requestPointerLock();
      }
    }, 100);
  };

  const restartGame = () => {
    if (gameRef.current) {
      if (gameRef.current.animationId) {
        cancelAnimationFrame(gameRef.current.animationId);
      }
      gameRef.current.renderer.dispose();
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    }

    initGame();
    setGameState('PARACHUTE');
    setPlayerHealth(100);
    setAmmoCurrent(30);
    setAmmoReserve(90);
    setEnemiesRemaining(8);
    setAltitude(150);
    setGameResult(null);
    setIsReloading(false);

    setTimeout(() => {
      if (gameRef.current) {
        gameRef.current.renderer.domElement.requestPointerLock();
      }
    }, 100);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950">
      {/* 3D Canvas Container */}
      <div id="canvas-container" ref={containerRef} />

      {/* Crosshair */}
      {(gameState === 'PARACHUTE' || gameState === 'GROUND') && (
        <div id="crosshair" />
      )}

      {/* Hit flash overlay */}
      {hitFlash && (
        <div className="absolute inset-0 pointer-events-none hit-flash z-30" />
      )}

      {/* Main Menu */}
      {gameState === 'MENU' && (
        <div className="absolute inset-0 bg-slate-950/95 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-md">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl text-center">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-wider text-amber-500 mb-2 uppercase drop-shadow-md">
              Warzone Tactical
            </h1>
            <p className="text-slate-400 mb-6 text-sm">
              Infiltration en parachute - Atterrissez dans la zone industrielle et éliminez toutes les menaces.
            </p>

            <div className="bg-slate-800/80 rounded-xl p-4 mb-6 text-left text-sm space-y-2 border border-slate-700/60">
              <div className="font-semibold text-amber-400 mb-1">COMMANDES :</div>
              <div className="flex justify-between text-slate-300">
                <span>Mouvements :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">ZQSD / Flèches</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Saut :</span>
                <span className="font-mono bg-slate-700 px-2 py-0.5 rounded text-xs">Espace</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Tir :</span>
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

      {/* Game Over Screen */}
      {gameState === 'GAMEOVER' && (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-6 backdrop-blur-md">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center shadow-2xl">
            <h2 className={`text-4xl font-extrabold mb-2 tracking-wide ${gameResult === 'victory' ? 'text-amber-500' : 'text-red-500'}`}>
              {gameResult === 'victory' ? '🏆 VICTOIRE TACTIQUE' : '💀 OPÉRATION ÉCHOUÉE'}
            </h2>
            <p className="text-slate-400 mb-6 text-sm">
              {gameResult === 'victory'
                ? 'Tous les hostiles de la zone ont été neutralisés avec succès.'
                : 'Vous avez succombé aux tirs ennemis dans la zone.'}
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

      {/* HUD */}
      {(gameState === 'PARACHUTE' || gameState === 'GROUND') && (
        <div className="absolute inset-0 pointer-events-none p-4 md:p-6 flex flex-col justify-between z-20">
          {/* Top HUD */}
          <div className="flex justify-between items-start">
            {/* Status Banner */}
            <div className={`backdrop-blur-md px-4 py-2 rounded-xl text-xs font-mono tracking-widest shadow-lg ${
              gameState === 'PARACHUTE'
                ? 'bg-slate-900/85 border border-amber-500/50 text-amber-400 animate-pulse-slow'
                : 'bg-slate-900/85 border border-emerald-500/50 text-emerald-400'
            }`}>
              {gameState === 'PARACHUTE'
                ? <>🪂 ALTITUDE : <span className="font-bold">{altitude}m</span></>
                : <>⚔️ ZONE ATTEINTE - COMBAT ENGAGÉ</>
              }
            </div>

            {/* Enemies remaining */}
            <div className="bg-slate-900/80 border border-slate-700/60 backdrop-blur-md px-4 py-2 rounded-xl text-xs font-mono shadow-lg flex items-center space-x-3">
              <span className="text-red-400 font-bold">HOSTILES :</span>
              <span className="text-white font-bold text-sm">{enemiesRemaining}</span>
            </div>
          </div>

          {/* Bottom HUD */}
          <div className="flex justify-between items-end">
            {/* Health */}
            <div className="bg-slate-900/85 border border-slate-700/60 backdrop-blur-md p-4 rounded-xl shadow-lg w-56 md:w-64">
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

            {/* Ammo */}
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
      )}

      {/* Click to play overlay (when pointer lock is lost during game) */}
      {showResumeOverlay && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm cursor-pointer"
          onClick={() => {
            if (gameRef.current) {
              gameRef.current.renderer.domElement.requestPointerLock();
              setShowResumeOverlay(false);
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
