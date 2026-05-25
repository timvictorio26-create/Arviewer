const REPO_OWNER = 'timvictorio26-create';
const REPO_NAME = 'Arviewer';
const BRANCH = 'main';
const API = 'https://api.github.com';

export function getToken() {
  return localStorage.getItem('arviewer_github_token');
}

export function setToken(token) {
  localStorage.setItem('arviewer_github_token', token);
}

export function clearToken() {
  localStorage.removeItem('arviewer_github_token');
}

export async function validateToken() {
  const token = getToken();
  if (!token) return false;
  const res = await fetch(`${API}/user`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return res.ok;
}

export async function uploadModelFile(filename, arrayBuffer, commitMessage) {
  const token = getToken();
  if (!token) throw new Error('GitHub token not configured');

  const base64 = arrayBufferToBase64(arrayBuffer);
  const path = `docs/models/${filename}`;

  const res = await fetch(`${API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: base64,
      branch: BRANCH
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Upload failed (${res.status})`);
  }

  return res.json();
}

export function getModelPageUrl(filename, modelName) {
  const base = `https://${REPO_OWNER}.github.io/${REPO_NAME}`;
  const params = new URLSearchParams({ file: `models/${filename}`, name: modelName });
  return `${base}/viewer.html?${params}`;
}

export function getRawUrl(filename) {
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/docs/models/${filename}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
