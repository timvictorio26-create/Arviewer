import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { getModel } from './db.js';

const video = document.getElementById('scanner-video');
const canvas = document.getElementById('scanner-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const statusEl = document.getElementById('scanner-status');
const modelDisplay = document.getElementById('model-display');
const modelNameDisplay = document.getElementById('model-name-display');
const threeCanvas = document.getElementById('three-canvas');
const scanIndicator = document.getElementById('scan-indicator');
const backToScanBtn = document.getElementById('back-to-scan');

let currentModelId = null;
let currentBlobUrl = null;
let scene, camera, renderer, controls;

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await video.play();
    requestAnimationFrame(scanFrame);
  } catch (err) {
    statusEl.textContent = 'Camera access denied. Please allow camera access and reload.';
  }
}

function scanFrame() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert'
    });

    if (code && code.data) {
      handleQRCode(code.data);
    }
  }

  requestAnimationFrame(scanFrame);
}

async function handleQRCode(data) {
  const match = data.match(/[?&]id=([a-f0-9-]+)/i);
  if (!match) return;

  const modelId = match[1];
  if (modelId === currentModelId) return;

  statusEl.textContent = 'Loading model...';
  scanIndicator.classList.add('loading');

  try {
    const model = await getModel(modelId);
    if (!model) {
      statusEl.textContent = 'Model not found on this device';
      scanIndicator.classList.remove('loading');
      return;
    }

    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
    }

    const mimeTypes = {
      glb: 'model/gltf-binary',
      gltf: 'model/gltf+json',
      obj: 'text/plain',
      stl: 'application/octet-stream',
      fbx: 'application/octet-stream'
    };
    const blob = new Blob([model.fileData], { type: mimeTypes[model.fileExt] || 'application/octet-stream' });
    currentBlobUrl = URL.createObjectURL(blob);

    currentModelId = modelId;
    modelNameDisplay.textContent = model.name;
    statusEl.textContent = `Showing: ${model.name} — scan another QR to switch`;

    await loadModel(currentBlobUrl, model.fileExt);
    modelDisplay.classList.remove('hidden');
    scanIndicator.classList.remove('loading');
    scanIndicator.classList.add('active');
    handleResize();
  } catch (err) {
    statusEl.textContent = 'Failed to load model';
    scanIndicator.classList.remove('loading');
  }
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(2, 2, 2);

  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  controls = new OrbitControls(camera, threeCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
  dirLight2.position.set(-5, 5, -7);
  scene.add(dirLight2);

  const gridHelper = new THREE.GridHelper(10, 10, 0x0f3460, 0x0f3460);
  scene.add(gridHelper);

  animate();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

async function loadModel(url, ext) {
  const existingModel = scene.getObjectByName('loaded-model');
  if (existingModel) {
    existingModel.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
    scene.remove(existingModel);
  }

  let object;
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    object = gltf.scene;
  } else if (ext === 'obj') {
    const loader = new OBJLoader();
    object = await loader.loadAsync(url);
  } else if (ext === 'stl') {
    const loader = new STLLoader();
    const geometry = await loader.loadAsync(url);
    const material = new THREE.MeshStandardMaterial({ color: 0x00d4ff, metalness: 0.3, roughness: 0.6 });
    object = new THREE.Mesh(geometry, material);
  } else {
    throw new Error('Unsupported format: ' + ext);
  }

  object.name = 'loaded-model';

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = 2 / maxDim;
    object.scale.setScalar(scale);
    object.position.sub(center.multiplyScalar(scale));
  }

  scene.add(object);

  camera.position.set(2, 1.5, 2);
  controls.target.set(0, 0, 0);
  controls.update();
}

function handleResize() {
  if (!renderer) return;
  const container = threeCanvas.parentElement;
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

backToScanBtn.addEventListener('click', () => {
  modelDisplay.classList.add('hidden');
  currentModelId = null;
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  scanIndicator.classList.remove('active');
  statusEl.textContent = 'Point camera at an ARViewer QR code';
});

window.addEventListener('resize', handleResize);

initThree();
startCamera();
