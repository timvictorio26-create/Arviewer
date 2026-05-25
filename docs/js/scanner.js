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
const HOLD_TIME = 1500;
const LERP_SPEED = 0.25;

const smoothed = {
  x: 0, y: 0, z: -1,
  rotX: 0, rotY: 0, rotZ: 0,
  scale: 1,
  initialized: false
};

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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function estimatePose(loc, vw, vh) {
  const { topLeftCorner: tl, topRightCorner: tr,
          bottomRightCorner: br, bottomLeftCorner: bl } = loc;

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

  const x = ((cx - vw / 2) / fy) * distance;
  const y = -((cy - vh / 2) / fy) * distance;
  const z = -distance;

  const hx = tr.x - tl.x;
  const hy = tr.y - tl.y;
  const rotZ = -Math.atan2(hy, hx);

  const tiltX = Math.atan2(topLen - bottomLen, avgSize) * 1.5;
  const tiltY = Math.atan2(rightLen - leftLen, avgSize) * 1.5;

  const modelScale = distance * 0.6;

  return { x, y, z, rotX: tiltX, rotY: tiltY, rotZ, scale: modelScale };
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

  return {
    x: vx * scale - offX,
    y: vy * scale - offY
  };
}

function loop() {
  requestAnimationFrame(loop);

  if (video.readyState < video.HAVE_ENOUGH_DATA) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  scanCanvas.width = vw;
  scanCanvas.height = vh;
  scanCtx.drawImage(video, 0, 0, vw, vh);
  const imageData = scanCtx.getImageData(0, 0, vw, vh);

  const code = jsQR(imageData.data, vw, vh, { inversionAttempts: 'dontInvert' });

  if (code && code.data) {
    const match = code.data.match(/[?&]id=([a-f0-9-]+)/i);
    if (match) {
      const modelId = match[1];
      lastDetection = Date.now();

      if (modelId !== currentModelId && !loading) {
        loadNewModel(modelId);
      }

      if (loadedObject) {
        const pose = estimatePose(code.location, vw, vh);

        if (!smoothed.initialized) {
          Object.assign(smoothed, pose, { initialized: true });
        } else {
          smoothed.x = lerp(smoothed.x, pose.x, LERP_SPEED);
          smoothed.y = lerp(smoothed.y, pose.y, LERP_SPEED);
          smoothed.z = lerp(smoothed.z, pose.z, LERP_SPEED);
          smoothed.rotX = lerp(smoothed.rotX, pose.rotX, LERP_SPEED);
          smoothed.rotY = lerp(smoothed.rotY, pose.rotY, LERP_SPEED);
          smoothed.rotZ = lerp(smoothed.rotZ, pose.rotZ, LERP_SPEED);
          smoothed.scale = lerp(smoothed.scale, pose.scale, LERP_SPEED);
        }

        loadedObject.position.set(smoothed.x, smoothed.y, smoothed.z);
        loadedObject.rotation.set(smoothed.rotX, smoothed.rotY, smoothed.rotZ);
        loadedObject.scale.setScalar(smoothed.scale);
        loadedObject.visible = true;
      }

      reticle.classList.add('detected');

      const dw = video.parentElement.clientWidth;
      const dh = video.parentElement.clientHeight;
      const tl = videoToDisplay(code.location.topLeftCorner.x, code.location.topLeftCorner.y, vw, vh);
      const tr = videoToDisplay(code.location.topRightCorner.x, code.location.topRightCorner.y, vw, vh);
      const bl = videoToDisplay(code.location.bottomLeftCorner.x, code.location.bottomLeftCorner.y, vw, vh);
      const br = videoToDisplay(code.location.bottomRightCorner.x, code.location.bottomRightCorner.y, vw, vh);

      setCorner('.tl', tl);
      setCorner('.tr', tr);
      setCorner('.bl', bl);
      setCorner('.br', br);
      reticle.style.display = 'block';
    }
  } else {
    if (Date.now() - lastDetection > HOLD_TIME && loadedObject) {
      loadedObject.visible = false;
      reticle.style.display = 'none';
      reticle.classList.remove('detected');
    }
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
      object.position.sub(center.multiplyScalar(s));
    }

    const wrapper = new THREE.Group();
    wrapper.add(object);
    wrapper.visible = false;
    scene.add(wrapper);

    loadedObject = wrapper;
    currentModelId = modelId;
    smoothed.initialized = false;

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

try {
  initThree();
} catch (err) {
  statusEl.textContent = '3D init error: ' + err.message;
}
startCamera();
