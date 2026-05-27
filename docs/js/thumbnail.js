import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export async function generateThumbnail(url, ext, size = 240) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(size, size);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0ede8);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(1.5, 2, 1.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-1, 0.5, -1);
  scene.add(fill);

  let object;
  try {
    if (ext === 'glb' || ext === 'gltf') {
      object = (await new GLTFLoader().loadAsync(url)).scene;
    } else if (ext === 'obj') {
      object = await new OBJLoader().loadAsync(url);
    } else if (ext === 'stl') {
      const geo = await new STLLoader().loadAsync(url);
      object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.2, roughness: 0.5 }));
    } else {
      throw new Error('Unsupported format');
    }
  } catch (err) {
    renderer.dispose();
    throw err;
  }

  const box = new THREE.Box3().setFromObject(object);
  const dims = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(dims.x, dims.y, dims.z);
  if (maxDim > 0) object.scale.setScalar(1 / maxDim);
  const scaledBox = new THREE.Box3().setFromObject(object);
  const center = scaledBox.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -scaledBox.min.y, -center.z);
  scene.add(object);

  const modelH = new THREE.Box3().setFromObject(object).max.y;
  camera.position.set(1.6, modelH * 0.7 + 0.7, 1.6);
  camera.lookAt(0, modelH * 0.35, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  object.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
      else c.material.dispose();
    }
  });
  renderer.dispose();

  return dataUrl;
}
