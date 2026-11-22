// Local document library: saved PDFs, annotations, bookmarks, reading state.
import { STORAGE } from '../config.js';
import { dbGet, dbPut, dbDelete, dbGetAll, dbClear, idbAvailable, storageEstimate } from './database.js';
import { uid } from '../utils/files.js';

const DOC = STORAGE.stores.documents;
const ANN = STORAGE.stores.annotations;
const BM = STORAGE.stores.bookmarks;
const READ = STORAGE.stores.reading;

export function libraryAvailable() { return idbAvailable(); }

/** Save a PDF blob locally. `blob` may be a File or a Blob. */
export async function saveDocument({ name, blob, pageCount = 0, size = 0, tags = [] }) {
  const now = Date.now();
  const record = {
    id: uid('doc'),
    name: name || 'document.pdf',
    size: size || blob.size,
    pageCount,
    tags,
    favorite: false,
    createdAt: now,
    lastOpened: now,
    blob
  };
  await dbPut(DOC, record);
  return record;
}

export async function listDocuments() {
  const docs = await dbGetAll(DOC);
  return docs.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
}

export async function getDocument(id) { return dbGet(DOC, id); }

export async function touchDocument(id, patch = {}) {
  const doc = await dbGet(DOC, id);
  if (!doc) return null;
  const next = { ...doc, ...patch, lastOpened: Date.now() };
  await dbPut(DOC, next);
  return next;
}

export async function renameDocument(id, name) { return touchDocument(id, { name }); }

export async function toggleFavorite(id) {
  const doc = await dbGet(DOC, id);
  if (!doc) return null;
  return touchDocument(id, { favorite: !doc.favorite });
}

export async function removeDocument(id) {
  await dbDelete(DOC, id);
  await dbDelete(ANN, id);
  await dbDelete(BM, id);
  await dbDelete(READ, id);
}

export async function clearLibrary() {
  await dbClear(DOC);
  await dbClear(ANN);
  await dbClear(BM);
  await dbClear(READ);
}

/* ---------- Annotations ---------- */
export async function saveAnnotations(docKey, annotations) {
  await dbPut(ANN, { id: docKey, annotations, updatedAt: Date.now() });
}

export async function getAnnotations(docKey) {
  const rec = await dbGet(ANN, docKey);
  return rec?.annotations || [];
}

export async function clearAnnotations(docKey) { await dbDelete(ANN, docKey); }

/* ---------- Bookmarks ---------- */
export async function getBookmarks(docKey) {
  const rec = await dbGet(BM, docKey);
  return rec?.bookmarks || [];
}

export async function saveBookmarks(docKey, bookmarks) {
  await dbPut(BM, { id: docKey, bookmarks, updatedAt: Date.now() });
}

/* ---------- Reading position ---------- */
export async function saveReadingState(docKey, state) {
  await dbPut(READ, { id: docKey, ...state, updatedAt: Date.now() });
}

export async function getReadingState(docKey) {
  return dbGet(READ, docKey);
}

export async function listReadingStates() { return dbGetAll(READ); }

export { storageEstimate };
