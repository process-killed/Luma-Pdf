/** GuidedPath persistence on IndexedDB, reusing the app's database helper. */
import { STORAGE, GUIDEDPATH } from '../config.js';
import { dbGet, dbPut, dbDelete, dbGetAll, idbAvailable, storageEstimate } from '../storage/database.js';
import { migrateTour } from './model.js';

const TOURS = STORAGE.stores.tours;
const ASSETS = STORAGE.stores.tourAssets;

export function toursAvailable() { return idbAvailable(); }

export async function listTours() {
  const tours = await dbGetAll(TOURS);
  return tours.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getTour(id) { return dbGet(TOURS, id); }

export async function saveTour(tour) {
  const now = Date.now();
  const record = {
    ...tour,
    formatVersion: GUIDEDPATH.formatVersion,
    createdAt: tour.createdAt || now,
    updatedAt: now
  };
  if (!record.id) record.id = `tour-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await dbPut(TOURS, record);
  } catch (err) {
    if (isQuotaError(err)) {
      throw new Error('Local storage is full. Delete a tour or export and remove a document, then try again.');
    }
    throw err;
  }
  return record;
}

export async function deleteTour(id) {
  await dbDelete(TOURS, id);
  const assets = await dbGetAll(ASSETS);
  await Promise.all(
    assets.filter((a) => a.tourId === id).map((a) => dbDelete(ASSETS, a.id))
  );
}

export async function duplicateTour(id) {
  const tour = await getTour(id);
  if (!tour) throw new Error('Tour not found.');
  const copy = {
    ...tour,
    id: undefined,
    title: `${tour.title} copy`,
    createdAt: Date.now(),
    steps: tour.steps.map((s) => ({ ...s, id: `${s.id}-c${Math.random().toString(36).slice(2, 6)}` }))
  };
  // narration assets are shared by id; duplicate their records so deleting one copy
  // cannot break the other
  for (const step of copy.steps) {
    if (!step.narration?.assetId) continue;
    const asset = await getAsset(step.narration.assetId);
    if (!asset) continue;
    const newId = `${asset.id}-c${Math.random().toString(36).slice(2, 6)}`;
    await putAsset({ ...asset, id: newId, tourId: copy.id });
    step.narration = { ...step.narration, assetId: newId };
  }
  return saveTour(copy);
}

/* ---------------- assets (narration, thumbnails) ---------------- */

export async function putAsset({ id, tourId, kind, blob, mime, duration }) {
  const record = {
    id: id || `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    tourId,
    kind: kind || 'narration',
    mime: mime || blob?.type || 'application/octet-stream',
    duration: duration || 0,
    size: blob?.size || 0,
    blob,
    createdAt: Date.now()
  };
  await dbPut(ASSETS, record);
  return record;
}

export async function getAsset(id) { return dbGet(ASSETS, id); }

export async function deleteAsset(id) { return dbDelete(ASSETS, id); }

export async function listAssets(tourId) {
  const all = await dbGetAll(ASSETS);
  return all.filter((a) => a.tourId === tourId);
}

/** Total bytes used by tours and their assets. */
export async function tourStorageUsage() {
  const [tours, assets] = await Promise.all([dbGetAll(TOURS), dbGetAll(ASSETS)]);
  const assetBytes = assets.reduce((sum, a) => sum + (a.size || a.blob?.size || 0), 0);
  const estimate = await storageEstimate().catch(() => null);
  return {
    tours: tours.length,
    assets: assets.length,
    assetBytes,
    quota: estimate?.quota || 0,
    usage: estimate?.usage || 0
  };
}

function isQuotaError(err) {
  return err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
}

/** Remove narration assets no step refers to any more. */
export async function pruneAssets(tourId) {
  const tour = await getTour(tourId);
  if (!tour) return 0;
  const used = new Set(tour.steps.map((s) => s.narration?.assetId).filter(Boolean));
  const assets = await listAssets(tourId);
  let removed = 0;
  for (const asset of assets) {
    if (asset.kind === 'thumbnail') continue;
    if (!used.has(asset.id)) { await deleteAsset(asset.id); removed++; }
  }
  return removed;
}

export { GUIDEDPATH };
