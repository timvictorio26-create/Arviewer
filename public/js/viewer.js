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
  camera.position.set(3, 2, 3);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  controls = new OrbitControls(camera, canvas);
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

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  animate();
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

  camera.position.set(3, 2, 3);
  controls.target.set(0, 0, 0);
  controls.update();
}

init();
loadModelData();
