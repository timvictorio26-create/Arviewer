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
const HOLD_TIME = 10000;
const SCAN_SCALE = 0.6;
const SCAN_EVERY = 3;
const SMOOTH_FACTOR = 0.12;
const MOVE_THRESHOLD = 0.15;

// World-space anchor — model is fixed in the real world like a physical object
const worldPos = new THREE.Vector3(0, 0, -1);
let lockedScale = 1;
let positionLocked = false;
let smoothInitialized = false;
let frameCount = 0;

const smoothPos = new THREE.Vector3(0, 0, -1);
let smoothScale = 1;
const smoothQuat = new THREE.Quaternion();

let deviceAlpha = 0, deviceBeta = 90, deviceGamma = 0;
let hasDeviceOrientation = false;

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

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(0.5, 1, 0.3);
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-0.5, 0.5, -0.3);
  scene.add(fillLight);
}

function initDeviceOrientation() {
  const handler = (e) => {
    if (e.alpha !== null) deviceAlpha = e.alpha;
    if (e.beta !== null) deviceBeta = e.beta;
    if (e.gamma !== null) deviceGamma = e.gamma;
    hasDeviceOrientation = true;
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
      statusEl.textContent = 'Camera not supported. Use Safari.';
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
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getCameraQuaternion() {
  if (!hasDeviceOrientation) return new THREE.Quaternion();

  const a = THREE.MathUtils.degToRad(deviceAlpha);
  const b = THREE.MathUtils.degToRad(deviceBeta);
  const g = THREE.MathUtils.degToRad(deviceGamma);

  const q = new THREE.Quaternion();
  q.setFromEuler(new THREE.Euler(b, a, -g, 'YXZ'));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), -Math.PI / 2
  ));

  const screenAngle = screen.orientation
    ? screen.orientation.angle
    : (window.orientation || 0);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), -THREE.MathUtils.degToRad(screenAngle)
  ));

  return q;
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

  return {
    position: new THREE.Vector3(
      ((cx - vw / 2) / fy) * distance,
      -((cy - vh / 2) / fy) * distance,
      -distance
    ),
    scale: distance * 0.6,
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
    scale = dh / vh; offX = (vw * scale - dw) / 2; offY = 0;
  } else {
    scale = dw / vw; offX = 0; offY = (vh * scale - dh) / 2;
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
    let modelKey = null, modelFile = null, modelName = null;
    const urlParams = new URLSearchParams(code.data.split('?')[1] || '');
    if (urlParams.get('file')) {
      modelFile = urlParams.get('file');
      modelName = urlParams.get('name') || 'Model';
      modelKey = modelFile;
    } else {
      const idMatch = code.data.match(/[?&]id=([a-f0-9-]+)/i);
      if (idMatch) modelKey = idMatch[1];
    }

    if (modelKey) {
      lastDetection = Date.now();

      if (modelKey !== currentModelId && !loading) {
        positionLocked = false;
        if (modelFile) loadSharedModel(modelFile, modelName, modelKey);
        else loadNewModel(modelKey);
      }

      const pose = estimatePose(code.location, sw, sh);
      const camQ = getCameraQuaternion();

      if (!positionLocked) {
        // First detection: anchor in world space
        worldPos.copy(pose.position).applyQuaternion(camQ);
        lockedScale = pose.scale;
        smoothPos.copy(pose.position);
        smoothScale = pose.scale;
        smoothQuat.copy(camQ.clone().invert());
        positionLocked = true;
        smoothInitialized = true;
      } else {
        // Compare QR-observed position with predicted position
        const camQInv = camQ.clone().invert();
        const predicted = worldPos.clone().applyQuaternion(camQInv);
        const drift = predicted.distanceTo(pose.position) / Math.abs(predicted.z || 1);
        if (drift > MOVE_THRESHOLD) {
          worldPos.copy(pose.position).applyQuaternion(camQ);
          lockedScale = pose.scale;
        }
      }

      // Show reticle corners
      const c = pose.corners;
      const rvw = video.videoWidth, rvh = video.videoHeight;
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
  if (frameCount % SCAN_EVERY === 0) scanFrame();

  if (loadedObject && smoothInitialized) {
    const camQ = getCameraQuaternion();
    const camQInv = camQ.clone().invert();

    // Transform world-space anchor to current camera space
    const targetPos = worldPos.clone().applyQuaternion(camQInv);
    smoothPos.lerp(targetPos, SMOOTH_FACTOR);
    smoothScale += (lockedScale - smoothScale) * SMOOTH_FACTOR;
    smoothQuat.slerp(camQInv, SMOOTH_FACTOR);

    loadedObject.position.copy(smoothPos);
    loadedObject.quaternion.copy(smoothQuat);
    loadedObject.scale.setScalar(smoothScale);
    loadedObject.visible = true;
  }

  if (Date.now() - lastDetection > HOLD_TIME) {
    if (loadedObject) loadedObject.visible = false;
    positionLocked = false;
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
    if (!model) { statusEl.textContent = 'Model not found on this device'; loading = false; return; }
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    clearLoadedObject();
    const mimeTypes = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', stl: 'application/octet-stream' };
    const blob = new Blob([model.fileData], { type: mimeTypes[model.fileExt] || 'application/octet-stream' });
    currentBlobUrl = URL.createObjectURL(blob);
    const object = await loadObject(currentBlobUrl, model.fileExt);
    normalizeAndWrap(object, model.name, modelId);
  } catch (err) { statusEl.textContent = 'Failed to load model'; }
  loading = false;
}

async function loadSharedModel(fileUrl, name, key) {
  loading = true;
  statusEl.textContent = 'Loading shared model...';
  try {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    clearLoadedObject();
    const ext = fileUrl.split('.').pop().toLowerCase();
    const object = await loadObject(fileUrl, ext);
    normalizeAndWrap(object, name, key);
  } catch (err) { statusEl.textContent = 'Failed to load — may still be deploying'; }
  loading = false;
}

async function loadObject(url, ext) {
  if (ext === 'glb' || ext === 'gltf') return (await new GLTFLoader().loadAsync(url)).scene;
  if (ext === 'obj') return await new OBJLoader().loadAsync(url);
  if (ext === 'stl') {
    const geo = await new STLLoader().loadAsync(url);
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x00d4ff, metalness: 0.3, roughness: 0.6 }));
  }
  throw new Error('Unsupported format');
}

function clearLoadedObject() {
  if (loadedObject) {
    loadedObject.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (Array.isArray(c.material)) c.material.forEach(m => m.dispose()); else c.material.dispose(); }
    });
    scene.remove(loadedObject);
    loadedObject = null;
  }
}

function normalizeAndWrap(object, name, key) {
  const box = new THREE.Box3().setFromObject(object);
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray());
  if (maxDim > 0) {
    object.scale.setScalar(1 / maxDim);
    const sb = new THREE.Box3().setFromObject(object);
    const sc = sb.getCenter(new THREE.Vector3());
    object.position.set(-sc.x, -sb.min.y, -sc.z);
  }
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.visible = false;
  scene.add(wrapper);
  loadedObject = wrapper;
  currentModelId = key;
  smoothInitialized = false;
  positionLocked = false;
  statusEl.textContent = name;
  modelNameEl.textContent = name;
  modelNameEl.classList.remove('hidden');
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
  initDeviceOrientation();
  try { initThree(); } catch (err) { statusEl.textContent = '3D init error: ' + err.message; return; }
  await startCamera();
  startOverlay.classList.add('hidden');
});
