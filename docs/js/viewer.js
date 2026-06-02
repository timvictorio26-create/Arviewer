import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { getModel } from './db.js';

const canvas = document.getElementById('viewer-canvas');
const titleEl = document.getElementById('viewer-title');
const startOverlay = document.getElementById('walkthrough-start');
const startBtn = document.getElementById('walkthrough-start-btn');
const instructionsEl = document.getElementById('walkthrough-instructions');
const mobileControls = document.getElementById('mobile-controls');
const joystick = document.getElementById('joystick');
const joystickThumb = document.getElementById('joystick-thumb');
const btnUp = document.getElementById('btn-up');
const btnDown = document.getElementById('btn-down');

const params = new URLSearchParams(window.location.search);
const modelId = params.get('id');
const modelFile = params.get('file');
const modelName = params.get('name');

const EYE_HEIGHT = 1.65;
const MOVE_SPEED = 3.0;
const LOOK_SENSITIVITY = 0.0025;
const TOUCH_LOOK_SENSITIVITY = 0.005;
const PI_2 = Math.PI / 2;

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

let scene, camera, renderer;
let floorY = 0;
const modelCenter = new THREE.Vector3();
const modelSize = new THREE.Vector3();

const camState = {
  position: new THREE.Vector3(0, EYE_HEIGHT, 5),
  yaw: 0,
  pitch: 0
};

const keys = {};
const touchMove = { id: null, x: 0, y: 0 };
const touchLook = { id: null, lastX: 0, lastY: 0 };
let vertInput = 0;
const clock = new THREE.Clock();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8e6e1);
  scene.fog = new THREE.Fog(0xe8e6e1, 30, 150);

  const container = canvas.parentElement;
  camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.05, 1000);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(50, 100, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(sun);

  setupControls();
  window.addEventListener('resize', onResize);
  animate();
}

function setupControls() {
  if (isTouch) {
    instructionsEl.textContent = 'Left joystick to walk. Drag screen to look. Arrows to go up/down.';
    mobileControls.classList.remove('hidden');
    setupTouchControls();
    startBtn.addEventListener('click', () => startOverlay.classList.add('hidden'));
  } else {
    instructionsEl.textContent = 'Click to enter. WASD to walk, mouse to look. Space/Shift = up/down. Esc to exit.';
    setupDesktopControls();
  }
}

function setupDesktopControls() {
  startBtn.addEventListener('click', () => canvas.requestPointerLock());

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      startOverlay.classList.add('hidden');
    } else {
      startOverlay.classList.remove('hidden');
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      camState.yaw -= e.movementX * LOOK_SENSITIVITY;
      camState.pitch -= e.movementY * LOOK_SENSITIVITY;
      camState.pitch = Math.max(-PI_2, Math.min(PI_2, camState.pitch));
    }
  });

  document.addEventListener('keydown', (e) => { keys[e.code] = true; });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });
}

function setupTouchControls() {
  joystick.addEventListener('touchstart', onJoystickStart, { passive: false });
  joystick.addEventListener('touchmove', onJoystickMove, { passive: false });
  joystick.addEventListener('touchend', onJoystickEnd);
  joystick.addEventListener('touchcancel', onJoystickEnd);

  canvas.addEventListener('touchstart', onLookStart, { passive: false });
  canvas.addEventListener('touchmove', onLookMove, { passive: false });
  canvas.addEventListener('touchend', onLookEnd);
  canvas.addEventListener('touchcancel', onLookEnd);

  btnUp.addEventListener('touchstart', (e) => { vertInput = 1; btnUp.classList.add('active'); e.preventDefault(); }, { passive: false });
  btnUp.addEventListener('touchend', () => { vertInput = 0; btnUp.classList.remove('active'); });
  btnUp.addEventListener('touchcancel', () => { vertInput = 0; btnUp.classList.remove('active'); });
  btnDown.addEventListener('touchstart', (e) => { vertInput = -1; btnDown.classList.add('active'); e.preventDefault(); }, { passive: false });
  btnDown.addEventListener('touchend', () => { vertInput = 0; btnDown.classList.remove('active'); });
  btnDown.addEventListener('touchcancel', () => { vertInput = 0; btnDown.classList.remove('active'); });
}

function onJoystickStart(e) {
  for (const t of e.changedTouches) {
    if (touchMove.id === null) {
      touchMove.id = t.identifier;
      joystick.classList.add('active');
      updateJoystick(t);
    }
  }
  e.preventDefault();
}

function onJoystickMove(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touchMove.id) updateJoystick(t);
  }
  e.preventDefault();
}

function onJoystickEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touchMove.id) {
      touchMove.id = null;
      touchMove.x = 0;
      touchMove.y = 0;
      joystickThumb.style.transform = '';
      joystick.classList.remove('active');
    }
  }
}

function updateJoystick(t) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const max = rect.width / 2;
  let dx = t.clientX - cx;
  let dy = t.clientY - cy;
  const dist = Math.sqrt(dx*dx + dy*dy);
  if (dist > max) { dx = dx * max / dist; dy = dy * max / dist; }
  touchMove.x = dx / max;
  touchMove.y = dy / max;
  joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
}

function onLookStart(e) {
  for (const t of e.changedTouches) {
    if (touchLook.id === null) {
      touchLook.id = t.identifier;
      touchLook.lastX = t.clientX;
      touchLook.lastY = t.clientY;
    }
  }
  e.preventDefault();
}

function onLookMove(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touchLook.id) {
      const dx = t.clientX - touchLook.lastX;
      const dy = t.clientY - touchLook.lastY;
      touchLook.lastX = t.clientX;
      touchLook.lastY = t.clientY;
      camState.yaw -= dx * TOUCH_LOOK_SENSITIVITY;
      camState.pitch -= dy * TOUCH_LOOK_SENSITIVITY;
      camState.pitch = Math.max(-PI_2, Math.min(PI_2, camState.pitch));
    }
  }
  e.preventDefault();
}

function onLookEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touchLook.id) touchLook.id = null;
  }
}

function updateMovement(dt) {
  let forward = 0, right = 0, vert = 0;

  if (isTouch) {
    forward = -touchMove.y;
    right = touchMove.x;
    vert = vertInput;
  } else {
    if (keys.KeyW || keys.ArrowUp) forward += 1;
    if (keys.KeyS || keys.ArrowDown) forward -= 1;
    if (keys.KeyA || keys.ArrowLeft) right -= 1;
    if (keys.KeyD || keys.ArrowRight) right += 1;
    if (keys.Space) vert += 1;
    if (keys.ShiftLeft || keys.ShiftRight || keys.KeyC) vert -= 1;
  }

  const mag = Math.sqrt(forward*forward + right*right);
  if (mag > 1) { forward /= mag; right /= mag; }

  const speed = MOVE_SPEED * dt;
  const cosY = Math.cos(camState.yaw);
  const sinY = Math.sin(camState.yaw);

  camState.position.x += (-sinY * forward + cosY * right) * speed;
  camState.position.z += (-cosY * forward - sinY * right) * speed;
  camState.position.y += vert * speed;

  camera.position.copy(camState.position);
  camera.quaternion.setFromEuler(new THREE.Euler(camState.pitch, camState.yaw, 0, 'YXZ'));
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  updateMovement(dt);
  renderer.render(scene, camera);
}

async function loadModelData() {
  if (modelFile) {
    titleEl.textContent = modelName || 'Loading...';
    document.title = `ARViewer - ${modelName || 'Model'}`;
    const ext = modelFile.split('.').pop().toLowerCase();
    try { await loadModelFromUrl(modelFile, ext); }
    catch (err) { titleEl.textContent = 'Failed to load model.'; }
    return;
  }

  if (modelId) {
    try {
      const model = await getModel(modelId);
      if (!model) { titleEl.textContent = 'Model not found on this device'; return; }
      titleEl.textContent = model.name;
      document.title = `ARViewer - ${model.name}`;
      const mimeTypes = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', stl: 'application/octet-stream' };
      const blob = new Blob([model.fileData], { type: mimeTypes[model.fileExt] || 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);
      await loadModelFromUrl(blobUrl, model.fileExt);
    } catch (err) { titleEl.textContent = 'Failed to load model'; }
    return;
  }

  titleEl.textContent = 'No model specified';
}

async function loadModelFromUrl(url, ext) {
  let object;
  if (ext === 'glb' || ext === 'gltf') {
    object = (await new GLTFLoader().loadAsync(url)).scene;
  } else if (ext === 'obj') {
    object = await new OBJLoader().loadAsync(url);
  } else if (ext === 'stl') {
    const geometry = await new STLLoader().loadAsync(url);
    object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xc8b89a, metalness: 0.1, roughness: 0.7 }));
  } else {
    titleEl.textContent = 'Unsupported format';
    return;
  }

  object.traverse(c => {
    if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
  });

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  // If model is tiny, scale to a reasonable building size
  if (maxDim < 5) {
    const s = 20 / maxDim;
    object.scale.setScalar(s);
    box.setFromObject(object);
    box.getSize(size);
  }

  modelSize.copy(size);
  box.getCenter(modelCenter);
  floorY = box.min.y;

  scene.add(object);

  const groundSize = Math.max(size.x, size.z) * 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: 0xd6d2cc, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(modelCenter.x, floorY - 0.02, modelCenter.z);
  ground.receiveShadow = true;
  scene.add(ground);

  // Stand back far enough to frame the whole model, on the +Z side,
  // looking toward -Z (yaw 0) straight at the model.
  const fovRad = (camera.fov * Math.PI) / 180;
  const fitDist = (maxDim / 2) / Math.tan(fovRad / 2);
  const camHeight = floorY + Math.max(EYE_HEIGHT, size.y * 0.5);
  const camZ = box.max.z + fitDist * 0.6 + 2;
  camState.position.set(modelCenter.x, camHeight, camZ);
  camState.yaw = 0;

  // Pitch down toward the model center
  const dy = modelCenter.y - camHeight;
  const dz = camZ - modelCenter.z;
  camState.pitch = Math.atan2(dy, dz);

  camera.position.copy(camState.position);
  camera.quaternion.setFromEuler(new THREE.Euler(camState.pitch, camState.yaw, 0, 'YXZ'));
}

function onResize() {
  const container = canvas.parentElement;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

init();
loadModelData();
