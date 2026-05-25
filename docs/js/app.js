import { saveModel, getAllModels, deleteModel as dbDelete } from './db.js';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';

const uploadForm = document.getElementById('upload-form');
const uploadBtn = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');
const modelsGrid = document.getElementById('models-grid');

function generateId() {
  return crypto.randomUUID();
}

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('model-file');
  const nameInput = document.getElementById('model-name');

  if (!fileInput.files[0]) {
    showStatus('Please select a 3D model file.', 'error');
    return;
  }

  const file = fileInput.files[0];
  const ext = file.name.split('.').pop().toLowerCase();
  const allowed = ['glb', 'gltf', 'obj', 'fbx', 'stl'];
  if (!allowed.includes(ext)) {
    showStatus(`File type .${ext} not supported. Use: ${allowed.map(e => '.' + e).join(', ')}`, 'error');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Processing...';
  showStatus('Reading file...', '');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const id = generateId();

    const baseUrl = window.location.href.replace(/\/[^/]*$/, '');
    const viewerUrl = `${baseUrl}/viewer.html?id=${id}`;

    showStatus('Generating QR code...', '');
    const qr = QRCode(0, 'M');
    qr.addData(viewerUrl);
    qr.make();
    const qrDataUrl = qr.createDataURL(10, 4);

    const entry = {
      id,
      name: nameInput.value || file.name,
      originalName: file.name,
      fileExt: ext,
      fileData: arrayBuffer,
      viewerUrl,
      qrCode: qrDataUrl,
      createdAt: new Date().toISOString()
    };

    showStatus('Saving to device...', '');
    await saveModel(entry);

    showStatus('Model saved! QR code generated.', 'success');
    fileInput.value = '';
    nameInput.value = '';
    loadModels();
  } catch (err) {
    showStatus('Failed: ' + err.message, 'error');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Generate QR';
  }
});

function showStatus(msg, type) {
  uploadStatus.textContent = msg;
  uploadStatus.className = `status ${type}`;
  uploadStatus.classList.remove('hidden');
}

async function loadModels() {
  try {
    const models = await getAllModels();

    if (models.length === 0) {
      modelsGrid.innerHTML = '<p class="empty-state">No models uploaded yet.</p>';
      return;
    }

    modelsGrid.innerHTML = models.map(model => {
      const sizeKB = model.fileData ? (model.fileData.byteLength / 1024).toFixed(0) : '?';
      const sizeLabel = sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
      return `
        <div class="model-card">
          <h3>${escapeHtml(model.name)}</h3>
          <div class="meta">
            ${new Date(model.createdAt).toLocaleDateString()} &middot; ${sizeLabel} &middot; .${model.fileExt}
          </div>
          <div class="qr-code">
            <img src="${model.qrCode}" alt="QR Code for ${escapeHtml(model.name)}">
          </div>
          <div class="actions">
            <a href="viewer.html?id=${model.id}" class="btn btn-primary">View 3D</a>
            <a href="${model.qrCode}" download="qr-${escapeHtml(model.name)}.png" class="btn btn-primary">Save QR</a>
            <button onclick="window._deleteModel('${model.id}')" class="btn btn-danger">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    modelsGrid.innerHTML = '<p class="empty-state">Failed to load models.</p>';
  }
}

window._deleteModel = async function(id) {
  if (!confirm('Delete this model and its QR code?')) return;
  try {
    await dbDelete(id);
    loadModels();
  } catch (err) {
    alert('Failed to delete model');
  }
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadModels();
