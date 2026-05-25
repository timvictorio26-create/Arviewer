import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const video = document.getElementById('scanner-video');
const canvas = document.getElementById('scanner-canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const statusEl = document.getElementById('scanner-status');
const modelDisplay = document.getElementById('model-display');
const modelNameDisplay = document.getElementById('model-name-display');
const threeCanvas = document.getElementById('three-canvas');

let currentModelId = null;
let scene, camera, renderer, controls;
let scanning = true;
let animationFrameId = null;

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await video.play();
    requestAnimationFrame(scanFrame);
  } catch (err) {
    statusEl.textContent = 'Camera access denied. Please allow camera access.';
  }
}

function scanFrame() {
  if (!scanning) {
    requestAnimationFrame(scanFrame);
    return;
  }

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
  const match = data.match(/[?&]id=([a-f0-9-]+)/);
  if (!match) return;

  const modelId = match[1];
  if (modelId === currentModelId) return;

  statusEl.textContent = 'Loading model...';

  try {
    const res = await fetch(`/api/models/${modelId}`);
    if (!res.ok) {
      statusEl.textContent = 'Model not found';
      return;
    }

    const model = await res.json();
    currentModelId = modelId;
    modelNameDisplay.textContent = model.name;
    statusEl.textContent = `Showing: ${model.name}`;

    await loadModel(model.modelUrl);
    modelDisplay.classList.remove('hidden');
  } catch (err) {
    statusEl.textContent = 'Failed to load model';
  }
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  camera = new THREE.PerspectiveCamera(60, threeCanvas.clientWidth / threeCanvas.clientHeight, 0.01, 1000);
  camera.position.set(2, 2, 2);

  renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
  renderer.setSize(threeCanvas.clientWidth, threeCanvas.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  controls = new OrbitControls(camera, threeCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
  dirLight2.position.set(-5, 5, -7);
  scene.add(dirLight2);

  const gridHelper = new THREE.GridHelper(10, 10, 0x0f3460, 0x0f3460);
  scene.add(gridHelper);

  animate();
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

async function loadModel(url) {
  const existingModel = scene.getObjectByName('loaded-model');
  if (existingModel) {
    scene.remove(existingModel);
  }

  const ext = url.split('.').pop().toLowerCase();

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
    throw new Error('Unsupported format');
  }

  object.name = 'loaded-model';

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 2 / maxDim;
  object.scale.setScalar(scale);
  object.position.sub(center.multiplyScalar(scale));

  scene.add(object);

  camera.position.set(2, 2, 2);
  controls.reset();
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

modelDisplay.addEventListener('click', (e) => {
  if (e.target === modelDisplay || e.target.id === 'model-info') {
    modelDisplay.classList.add('hidden');
    currentModelId = null;
    statusEl.textContent = 'Point camera at an ARViewer QR code';
  }
});

window.addEventListener('resize', handleResize);

initThree();
startCamera();
handleResize();
