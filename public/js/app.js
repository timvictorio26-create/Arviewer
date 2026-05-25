const uploadForm = document.getElementById('upload-form');
const uploadStatus = document.getElementById('upload-status');
const modelsGrid = document.getElementById('models-grid');

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('model-file');
  const nameInput = document.getElementById('model-name');

  if (!fileInput.files[0]) {
    showStatus('Please select a 3D model file.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('model', fileInput.files[0]);
  formData.append('name', nameInput.value || fileInput.files[0].name);

  showStatus('Uploading...', '');

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showStatus(data.error || 'Upload failed', 'error');
      return;
    }

    showStatus('Model uploaded! QR code generated.', 'success');
    fileInput.value = '';
    nameInput.value = '';
    loadModels();
  } catch (err) {
    showStatus('Upload failed: ' + err.message, 'error');
  }
});

function showStatus(msg, type) {
  uploadStatus.textContent = msg;
  uploadStatus.className = `status ${type}`;
  uploadStatus.classList.remove('hidden');
}

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const models = await res.json();

    if (models.length === 0) {
      modelsGrid.innerHTML = '<p class="empty-state">No models uploaded yet.</p>';
      return;
    }

    modelsGrid.innerHTML = models.map(model => `
      <div class="model-card">
        <h3>${escapeHtml(model.name)}</h3>
        <div class="meta">
          Uploaded: ${new Date(model.createdAt).toLocaleDateString()}<br>
          ID: ${model.id.slice(0, 8)}...
        </div>
        <div class="qr-code">
          <img src="${model.qrCode}" alt="QR Code for ${escapeHtml(model.name)}">
        </div>
        <div class="actions">
          <a href="${model.viewerUrl}" class="btn btn-primary">View 3D</a>
          <a href="${model.qrCode}" download="qr-${model.id}.png" class="btn btn-primary">Download QR</a>
          <button onclick="deleteModel('${model.id}')" class="btn btn-danger">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    modelsGrid.innerHTML = '<p class="empty-state">Failed to load models.</p>';
  }
}

async function deleteModel(id) {
  if (!confirm('Delete this model and its QR code?')) return;

  try {
    await fetch(`/api/models/${id}`, { method: 'DELETE' });
    loadModels();
  } catch (err) {
    alert('Failed to delete model');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadModels();
