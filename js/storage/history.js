// Recently opened documents and per-document reading progress.
import { listDocuments, saveReadingState, getReadingState } from './library.js';

export async function recentDocuments(limit = 6) {
  const docs = await listDocuments();
  return docs.slice(0, limit);
}

export function recordPosition(docKey, { page, total, zoom, mode }) {
  if (!docKey) return Promise.resolve();
  return saveReadingState(docKey, {
    page,
    total,
    zoom,
    mode,
    progress: total ? Math.min(1, page / total) : 0
  }).catch(() => {});
}

export function readPosition(docKey) {
  if (!docKey) return Promise.resolve(null);
  return getReadingState(docKey).catch(() => null);
}
