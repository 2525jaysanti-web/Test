// IndexedDB persistence: the current project (JSON) and drawing files (Blobs).
const DB_NAME = 'takeoff-pro';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const store = {
  saveProject: (project) => tx('projects', 'readwrite', (s) => s.put(project)),
  getProject: (id) => tx('projects', 'readonly', (s) => s.get(id)),
  listProjects: () => tx('projects', 'readonly', (s) => s.getAll()),
  deleteProject: (id) => tx('projects', 'readwrite', (s) => s.delete(id)),

  saveFile: (id, blob, name) => tx('files', 'readwrite', (s) => s.put({ id, blob, name })),
  getFile: async (id) => (await tx('files', 'readonly', (s) => s.get(id)))?.blob ?? null,
  deleteFile: (id) => tx('files', 'readwrite', (s) => s.delete(id)),

  setMeta: (key, value) => tx('meta', 'readwrite', (s) => s.put({ key, value })),
  getMeta: async (key) => (await tx('meta', 'readonly', (s) => s.get(key)))?.value,
};

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}
