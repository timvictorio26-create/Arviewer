import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { getModel } from './db.js';

const canvas = document.getElementById('viewer-canvas');
const titleEl = document.getElementById('viewer-title');
const params = new URLSearchParams(window.location.search);
const modelId = params.get('id');

let scene, camera, renderer, controls;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const container = canvas.parentElement;
  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 1000);
  camera.position.set(2.5, 2, 2.5);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.set(0, 0.5, 0);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
  dirLight2.position.set(-5, 5, -7);
  scene.add(dirLight2);

  addQRCodePlane();
  addAxisIndicators();

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  animate();
}

function addQRCodePlane() {
  // Flat plane representing the QR code / table surface at Y=0
  const planeSize = 2;
  const geo = new THREE.PlaneGeometry(planeSize, planeSize);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide
  });
  const plane = geo;

  // Create a checkerboard texture to represent the QR code
  const texSize = 256;
  const texCanvas = document.createElement('canvas');
  texCanvas.width = texSize;
  texCanvas.height = texSize;
  const ctx = texCanvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, texSize, texSize);

  // Dark border to represent QR code outline
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, texSize - 8, texSize - 8);

  // QR-like pattern
  const cellSize = texSize / 8;
  ctx.fillStyle = '#333333';
  // Corner markers
  for (const [ox, oy] of [[0, 0], [5, 0], [0, 5]]) {
    ctx.fillRect(ox * cellSize + 12, oy * cellSize + 12, cellSize * 3 - 4, cellSize * 3 - 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox * cellSize + 12 + cellSize * 0.6, oy * cellSize + 12 + cellSize * 0.6, cellSize * 1.8, cellSize * 1.8);
    ctx.fillStyle = '#333333';
    ctx.fillRect(ox * cellSize + 12 + cellSize * 1.0, oy * cellSize + 12 + cellSize * 1.0, cellSize * 1.0, cellSize * 1.0);
  }

  // "QR CODE" text
  ctx.fillStyle = '#666666';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('QR CODE', texSize / 2, texSize - 16);

  const texture = new THREE.CanvasTexture(texCanvas);

  const qrMat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.6,
    metalness: 0,
    side: THREE.DoubleSide
  });

  // Plane lies in XZ (horizontal) — Three.js PlaneGeometry faces Y by default
  const qrPlane = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), qrMat);
  qrPlane.rotation.x = -Math.PI / 2; // lay flat in XZ
  qrPlane.position.y = 0;
  qrPlane.name = 'qr-plane';
  scene.add(qrPlane);

  // Subtle table surface extending beyond QR
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a3e,
    roughness: 0.9,
    metalness: 0
  });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.001;
  scene.add(table);
}

function addAxisIndicators() {
  const len = 1.5;
  const headLen = 0.1;
  const headW = 0.05;

  // X axis — red
  const xArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.01, 0),
    len, 0xff4444, headLen, headW
  );
  scene.add(xArrow);

  // Y axis — green (into the table surface / along QR)
  const yArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.01, 0),
    len, 0x44ff44, headLen, headW
  );
  scene.add(yArrow);

  // Z axis — blue (up from table)
  const zArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.01, 0),
    len, 0x4488ff, headLen, headW
  );
  scene.add(zArrow);

  // Axis labels using sprites
  addLabel('X', new THREE.Vector3(len + 0.15, 0.01, 0), 0xff4444);
  addLabel('Y', new THREE.Vector3(0, 0.01, -(len + 0.15)), 0x44ff44);
  addLabel('Z', new THREE.Vector3(0, len + 0.15, 0), 0x4488ff);
}

function addLabel(text, position, color) {
  const canvas2 = document.createElement('canvas');
  canvas2.width = 64;
  canvas2.height = 64;
  const ctx = canvas2.getContext('2d');
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);

  const texture = new THREE.CanvasTexture(canvas2);
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(position);
  sprite.scale.set(0.3, 0.3, 0.3);
  scene.add(sprite);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

async function loadModelData() {
  if (!modelId) {
    titleEl.textContent = 'No model specified';
    return;
  }

  try {
    const model = await getModel(modelId);
    if (!model) {
      titleEl.textContent = 'Model not found on this device';
      return;
    }

    titleEl.textContent = model.name;
    document.title = `ARViewer - ${model.name}`;

    const mimeTypes = {
      glb: 'model/gltf-binary',
      gltf: 'model/gltf+json',
      obj: 'text/plain',
      stl: 'application/octet-stream',
      fbx: 'application/octet-stream'
    };
    const blob = new Blob([model.fileData], { type: mimeTypes[model.fileExt] || 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);

    await loadModel(blobUrl, model.fileExt);
  } catch (err) {
    titleEl.textContent = 'Failed to load model';
  }
}

async function loadModel(url, ext) {
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
    titleEl.textContent = 'Unsupported format';
    return;
  }

  // Normalize to fit in a 2-unit bounding box
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const s = 2 / maxDim;
    object.scale.setScalar(s);
  }

  // Recompute bounds after scaling
  const scaledBox = new THREE.Box3().setFromObject(object);
  const sc = scaledBox.getCenter(new THREE.Vector3());

  // Place model so it sits on the QR plane (Y=0 in viewer space)
  // Center horizontally (XZ), bottom touches Y=0
  object.position.set(-sc.x, -scaledBox.min.y, -sc.z);

  scene.add(object);

  // Adjust camera to frame the model
  const finalBox = new THREE.Box3().setFromObject(object);
  const modelHeight = finalBox.max.y;
  camera.position.set(2.5, modelHeight * 0.8 + 1, 2.5);
  controls.target.set(0, modelHeight * 0.4, 0);
  controls.update();
}

init();
loadModelData();
