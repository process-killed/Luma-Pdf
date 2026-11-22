// IndexedDB wrapper — promise based, with an in-memory fallback when IDB is unavailable.
import { STORAGE } from '../config.js';

let dbPromise = null;
const memory = new Map();

function memoryStore(store) {
  if (!memory.has(store)) memory.set(store, new Map());
  return memory.get(store);
}

export function idbAvailable() {
  try { return !!window.indexedDB; } catch { return false; }
}

export function openDB() {
  if (!idbAvailable()) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(STORAGE.dbName, STORAGE.dbVersion);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORAGE.stores)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name === STORAGE.stores.documents) store.createIndex('lastOpened', 'lastOpened');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open local storage.'));
    req.onblocked = () => reject(new Error('Local storage is blocked by another tab.'));
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet(store, key) {
  if (!idbAvailable()) return memoryStore(store).get(key) ?? null;
  try {
    const s = await tx(store);
    return (await reqToPromise(s.get(key))) ?? null;
  } catch { return memoryStore(store).get(key) ?? null; }
}

export async function dbPut(store, value) {
  if (!idbAvailable()) { memoryStore(store).set(value.id, value); return value.id; }
  try {
    const s = await tx(store, 'readwrite');
    await reqToPromise(s.put(value));
    return value.id;
  } catch (e) {
    memoryStore(store).set(value.id, value);
    throw e;
  }
}

export async function dbDelete(store, key) {
  if (!idbAvailable()) { memoryStore(store).delete(key); return; }
  const s = await tx(store, 'readwrite');
  return reqToPromise(s.delete(key));
}

export async function dbGetAll(store) {
  if (!idbAvailable()) return Array.from(memoryStore(store).values());
  try {
    const s = await tx(store);
    return (await reqToPromise(s.getAll())) || [];
  } catch { return Array.from(memoryStore(store).values()); }
}

export async function dbClear(store) {
  if (!idbAvailable()) { memoryStore(store).clear(); return; }
  const s = await tx(store, 'readwrite');
  return reqToPromise(s.clear());
}

export async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      return { usage, quota, percent: quota ? (usage / quota) * 100 : 0 };
    } catch { /* ignore */ }
  }
  return { usage: 0, quota: 0, percent: 0 };
}
