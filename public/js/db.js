const DB_NAME = 'arviewer';
const DB_VERSION = 1;
const STORE_NAME = 'models';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(mode) {
  return openDB().then(db => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    return { db, store, transaction };
  });
}

export async function saveModel(entry) {
  const { store, transaction } = await tx('readwrite');
  return new Promise((resolve, reject) => {
    store.put(entry);
    transaction.oncomplete = () => resolve(entry);
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getModel(id) {
  const { store } = await tx('readonly');
  return new Promise((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllModels() {
  const { store } = await tx('readonly');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const models = request.result || [];
      models.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(models);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteModel(id) {
  const { store, transaction } = await tx('readwrite');
  return new Promise((resolve, reject) => {
    store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
