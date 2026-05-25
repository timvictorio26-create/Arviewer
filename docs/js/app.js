import { saveModel, getAllModels, deleteModel as dbDelete } from './db.js';
import { getToken, setToken, clearToken, validateToken, uploadModelFile, getModelPageUrl } from './github.js';
import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';

const uploadForm = document.getElementById('upload-form');
const uploadBtn = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');
const modelsGrid = document.getElementById('models-grid');
const setupSection = document.getElementById('setup-section');
const connectedBadge = document.getElementById('connected-badge');
const tokenInput = document.getElementById('github-token');
const saveTokenBtn = document.getElementById('save-token-btn');
const tokenStatus = document.getElementById('token-status');
const disconnectBtn = document.getElementById('disconnect-btn');

function generateId() {
  return crypto.randomUUID();
}

// --- Token Management ---

async function checkConnection() {
  const token = getToken();
  if (token) {
    const valid = await validateToken();
    if (valid) {
      setupSection.classList.add('hidden');
      connectedBadge.classList.remove('hidden');
      return true;
    }
    clearToken();
  }
  setupSection.classList.remove('hidden');
  connectedBadge.classList.add('hidden');
  return false;
}

saveTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) return;

  saveTokenBtn.disabled = true;
  saveTokenBtn.textContent = 'Verifying...';
  setToken(token);

  const valid = await validateToken();
  if (valid) {
    tokenStatus.textContent = 'Connected!';
    tokenStatus.className = 'status success';
    tokenStatus.classList.remove('hidden');
    tokenInput.value = '';
    await checkConnection();
  } else {
    clearToken();
    tokenStatus.textContent = 'Invalid token. Check permissions and try again.';
    tokenStatus.className = 'status error';
    tokenStatus.classList.remove('hidden');
  }
  saveTokenBtn.disabled = false;
  saveTokenBtn.textContent = 'Connect';
});

disconnectBtn.addEventListener('click', () => {
  clearToken();
  checkConnection();
});

// --- Upload ---

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

  const hasGithub = getToken() && await validateToken();

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Processing...';
  showStatus('Reading file...', '');

  try {
    const arrayBuffer = await file.arrayBuffer();
    const id = generateId();
    const modelName = nameInput.value || file.name;
    const filename = `${id}.${ext}`;

    let viewerUrl;

    if (hasGithub) {
      showStatus('Publishing to GitHub (this may take a moment)...', '');
      await uploadModelFile(filename, arrayBuffer, `Add model: ${modelName}`);
      viewerUrl = getModelPageUrl(filename, modelName);
      showStatus('Generating QR code...', '');
    } else {
      const baseUrl = window.location.href.replace(/\/[^/]*$/, '');
      viewerUrl = `${baseUrl}/viewer.html?id=${id}`;
      showStatus('Saving locally (connect GitHub to share with others)...', '');
    }

    const qr = QRCode(0, 'M');
    qr.addData(viewerUrl);
    qr.make();
    const qrDataUrl = qr.createDataURL(10, 4);

    const entry = {
      id,
      name: modelName,
      originalName: file.name,
      fileExt: ext,
      fileData: arrayBuffer,
      filename,
      viewerUrl,
      qrCode: qrDataUrl,
      shared: hasGithub,
      createdAt: new Date().toISOString()
    };

    await saveModel(entry);

    if (hasGithub) {
      showStatus('Published! QR code is shareable with anyone. Note: it may take 1-2 minutes for GitHub Pages to deploy the file.', 'success');
    } else {
      showStatus('Saved locally. Connect GitHub to make QR codes shareable.', 'success');
    }
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

// --- Model Library ---

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
      const sharedBadge = model.shared ? '<span class="shared-badge">Shared</span>' : '<span class="local-badge">Local only</span>';
      return `
        <div class="model-card">
          <h3>${escapeHtml(model.name)} ${sharedBadge}</h3>
          <div class="meta">
            ${new Date(model.createdAt).toLocaleDateString()} &middot; ${sizeLabel} &middot; .${model.fileExt}
          </div>
          <div class="qr-code">
            <img src="${model.qrCode}" alt="QR Code for ${escapeHtml(model.name)}">
          </div>
          <div class="actions">
            <a href="${model.viewerUrl}" class="btn btn-primary" target="_blank">View 3D</a>
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
  if (!confirm('Delete this model from your local library?')) return;
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

checkConnection();
loadModels();
