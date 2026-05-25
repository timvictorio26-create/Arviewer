import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { getModel } from './db.js';

const video = document.getElementById('ar-video');
const scanCanvas = document.getElementById('scan-canvas');
const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
const arCanvas = document.getElementById('ar-canvas');
const statusEl = document.getElementById('ar-status');
const modelNameEl = document.getElementById('ar-model-name');
const reticle = document.getElementById('ar-reticle');

let currentModelId = null;
let currentBlobUrl = null;
let loadedObject = null;
let lastDetection = 0;
let loading = false;

const CAMERA_FOV = 60;
const HOLD_TIME = 8000;
const SCAN_SCALE = 0.6;
const SCAN_EVERY = 3;
const POS_LERP = 0.05;
const ROT_LERP = 0.04;
const SCALE_LERP = 0.05;
const TILT_LERP = 0.06;
const JUMP_THRESHOLD = 0.15;

let targetPos = new THREE.Vector3(0, 0, -1);
let targetRotZ = 0;
let targetScale = 1;
const smoothPos = new THREE.Vector3(0, 0, -1);
let smoothRotZ = 0;
let smoothScale = 1;
let smoothTiltX = 0;
let deviceBeta = 90;
let smoothInitialized = false;
let frameCount = 0;

let scene, camera, renderer;

function initThree() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.001, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  renderer = new THREE.WebGLRenderer({ canvas: arCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setClearColor(0x000000, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(0.5, 1, 0.3);
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-0.5, 0.5, -0.3);
  scene.add(fillLight);
}

// Use device orientation (gyroscope) to determine camera tilt.
// beta = 0°: device flat (looking straight down at table)
// beta = 90°: device upright (looking forward at wall)
function initDeviceOrientation() {
  const handler = (e) => {
    if (e.beta !== null) {
      deviceBeta = Math.max(0, Math.min(90, e.beta));
    }
  };

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(response => {
      if (response === 'granted') {
        window.addEventListener('deviceorientation', handler);
      }
    }).catch(() => {});
  } else {
    window.addEventListener('deviceorientation', handler);
  }
}

async function startCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl.textContent = 'Camera not supported on this browser. Use Safari.';
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    handleResize();
    initDeviceOrientation();
    loop();
  } catch (err) {
    statusEl.textContent = 'Camera error: ' + (err.name || err.message || err);
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

function estimatePose(loc, scanW, scanH) {
  const s = 1 / SCAN_SCALE;
  const tl = { x: loc.topLeftCorner.x * s, y: loc.topLeftCorner.y * s };
  const tr = { x: loc.topRightCorner.x * s, y: loc.topRightCorner.y * s };
  const br = { x: loc.bottomRightCorner.x * s, y: loc.bottomRightCorner.y * s };
  const bl = { x: loc.bottomLeftCorner.x * s, y: loc.bottomLeftCorner.y * s };

  const vw = scanW * s;
  const vh = scanH * s;

  const cx = (tl.x + tr.x + br.x + bl.x) / 4;
  const cy = (tl.y + tr.y + br.y + bl.y) / 4;

  const topLen = dist(tl, tr);
  const rightLen = dist(tr, br);
  const bottomLen = dist(br, bl);
  const leftLen = dist(bl, tl);
  const avgSize = (topLen + rightLen + bottomLen + leftLen) / 4;

  const fovRad = (CAMERA_FOV * Math.PI) / 180;
  const fy = vh / (2 * Math.tan(fovRad / 2));
  const qrWorldSize = 0.06;
  const distance = (fy * qrWorldSize) / avgSize;

  const px = ((cx - vw / 2) / fy) * distance;
  const py = -((cy - vh / 2) / fy) * distance;
  const pz = -distance;

  const hx = tr.x - tl.x;
  const hy = tr.y - tl.y;
  const rotZ = -Math.atan2(hy, hx);

  const modelScale = distance * 0.6;

  return {
    position: new THREE.Vector3(px, py, pz),
    rotZ,
    scale: modelScale,
    corners: { tl, tr, bl, br }
  };
}

function videoToDisplay(vx, vy, vw, vh) {
  const container = video.parentElement;
  const dw = container.clientWidth;
  const dh = container.clientHeight;
  const videoAspect = vw / vh;
  const displayAspect = dw / dh;

  let scale, offX, offY;
  if (videoAspect > displayAspect) {
    scale = dh / vh;
    offX = (vw * scale - dw) / 2;
    offY = 0;
  } else {
    scale = dw / vw;
    offX = 0;
    offY = (vh * scale - dh) / 2;
  }

  return { x: vx * scale - offX, y: vy * scale - offY };
}

function scanFrame() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sw = Math.floor(vw * SCAN_SCALE);
  const sh = Math.floor(vh * SCAN_SCALE);

  scanCanvas.width = sw;
  scanCanvas.height = sh;
  scanCtx.drawImage(video, 0, 0, sw, sh);
  const imageData = scanCtx.getImageData(0, 0, sw, sh);

  const code = jsQR(imageData.data, sw, sh, { inversionAttempts: 'attemptBoth' });

  if (code && code.data) {
    const match = code.data.match(/[?&]id=([a-f0-9-]+)/i);
    if (match) {
      const modelId = match[1];
      lastDetection = Date.now();

      if (modelId !== currentModelId && !loading) {
        loadNewModel(modelId);
      }

      const pose = estimatePose(code.location, sw, sh);

      if (!smoothInitialized) {
        targetPos.copy(pose.position);
        targetRotZ = pose.rotZ;
        targetScale = pose.scale;
        smoothPos.copy(pose.position);
        smoothRotZ = pose.rotZ;
        smoothScale = pose.scale;
        smoothInitialized = true;
      } else {
        const jump = targetPos.distanceTo(pose.position);
        const maxJump = JUMP_THRESHOLD * Math.abs(targetPos.z);
        if (jump < maxJump) {
          targetPos.copy(pose.position);
          targetRotZ = pose.rotZ;
          targetScale = pose.scale;
        } else {
          targetPos.lerp(pose.position, 0.3);
          targetRotZ = lerpAngle(targetRotZ, pose.rotZ, 0.3);
          targetScale += (pose.scale - targetScale) * 0.3;
        }
      }

      const c = pose.corners;
      const rvw = video.videoWidth;
      const rvh = video.videoHeight;
      setCorner('.tl', videoToDisplay(c.tl.x, c.tl.y, rvw, rvh));
      setCorner('.tr', videoToDisplay(c.tr.x, c.tr.y, rvw, rvh));
      setCorner('.bl', videoToDisplay(c.bl.x, c.bl.y, rvw, rvh));
      setCorner('.br', videoToDisplay(c.br.x, c.br.y, rvw, rvh));
      reticle.style.display = 'block';
      reticle.classList.add('detected');
    }
  }
}

function loop() {
  requestAnimationFrame(loop);
  if (video.readyState < video.HAVE_ENOUGH_DATA) return;

  frameCount++;
  if (frameCount % SCAN_EVERY === 0) {
    scanFrame();
  }

  // Compute tilt from device orientation:
  // beta=90 (upright, looking at wall) → tiltX = 0 (model Y = screen Y)
  // beta=0  (flat, looking at table)   → tiltX = -π/2 (model Y = toward camera)
  const targetTiltX = (deviceBeta * Math.PI / 180) - Math.PI / 2;
  smoothTiltX += (targetTiltX - smoothTiltX) * TILT_LERP;

  if (loadedObject && smoothInitialized) {
    smoothPos.lerp(targetPos, POS_LERP);
    smoothRotZ = lerpAngle(smoothRotZ, targetRotZ, ROT_LERP);
    smoothScale += (targetScale - smoothScale) * SCALE_LERP;

    loadedObject.position.copy(smoothPos);
    loadedObject.rotation.set(smoothTiltX, 0, smoothRotZ);
    loadedObject.scale.setScalar(smoothScale);
    loadedObject.visible = true;
  }

  if (Date.now() - lastDetection > HOLD_TIME) {
    if (loadedObject) loadedObject.visible = false;
    reticle.style.display = 'none';
    reticle.classList.remove('detected');
  }

  renderer.render(scene, camera);
}

function setCorner(selector, pos) {
  const el = reticle.querySelector(selector);
  el.style.left = pos.x + 'px';
  el.style.top = pos.y + 'px';
}

async function loadNewModel(modelId) {
  loading = true;
  statusEl.textContent = 'Loading model...';

  try {
    const model = await getModel(modelId);
    if (!model) {
      statusEl.textContent = 'Model not found on this device';
      loading = false;
      return;
    }

    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);

    if (loadedObject) {
      loadedObject.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      scene.remove(loadedObject);
      loadedObject = null;
    }

    const mimeTypes = {
      glb: 'model/gltf-binary', gltf: 'model/gltf+json',
      obj: 'text/plain', stl: 'application/octet-stream',
      fbx: 'application/octet-stream'
    };
    const blob = new Blob([model.fileData], {
      type: mimeTypes[model.fileExt] || 'application/octet-stream'
    });
    currentBlobUrl = URL.createObjectURL(blob);

    let object;
    const ext = model.fileExt;
    if (ext === 'glb' || ext === 'gltf') {
      object = (await new GLTFLoader().loadAsync(currentBlobUrl)).scene;
    } else if (ext === 'obj') {
      object = await new OBJLoader().loadAsync(currentBlobUrl);
    } else if (ext === 'stl') {
      const geo = await new STLLoader().loadAsync(currentBlobUrl);
      object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x00d4ff, metalness: 0.3, roughness: 0.6
      }));
    }

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const s = 1 / maxDim;
      object.scale.setScalar(s);

      const scaledBox = new THREE.Box3().setFromObject(object);
      const sc = scaledBox.getCenter(new THREE.Vector3());
      object.position.set(-sc.x, -scaledBox.min.y, -sc.z);
    }

    const wrapper = new THREE.Group();
    wrapper.add(object);
    wrapper.visible = false;
    scene.add(wrapper);

    loadedObject = wrapper;
    currentModelId = modelId;
    smoothInitialized = false;

    statusEl.textContent = model.name;
    modelNameEl.textContent = model.name;
    modelNameEl.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = 'Failed to load model';
  }
  loading = false;
}

function handleResize() {
  const container = video.parentElement;
  const w = container.clientWidth;
  const h = container.clientHeight;

  arCanvas.width = w * window.devicePixelRatio;
  arCanvas.height = h * window.devicePixelRatio;
  arCanvas.style.width = w + 'px';
  arCanvas.style.height = h + 'px';

  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', handleResize);

const startOverlay = document.getElementById('ar-start-overlay');
const startBtn = document.getElementById('ar-start-btn');

startBtn.addEventListener('click', async () => {
  // Request device orientation permission (iOS requires user gesture)
  initDeviceOrientation();

  try {
    initThree();
  } catch (err) {
    statusEl.textContent = '3D init error: ' + err.message;
    return;
  }

  await startCamera();
  startOverlay.classList.add('hidden');
});
