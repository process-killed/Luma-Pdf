/**
 * Glue between the GuidedPath pages, the document library and the .lumatour format.
 */
import { listDocuments, getDocument, saveDocument } from '../storage/library.js';
import { fingerprintDocument, buildPackage, readPackage } from './lumatour.js';
import { listTours, getTour, saveTour, deleteTour, duplicateTour, putAsset, listAssets, pruneAssets } from './storage.js';
import { createStep } from './model.js';

/** Fingerprint a library document without keeping the whole file in memory. */
export async function fingerprintOf(blob, pageCount = 0) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return fingerprintDocument(bytes, pageCount);
}

/** Create a tour for a PDF the user just picked, saving the PDF to the library. */
export async function createTourFromFile(file, { title } = {}) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const doc = await saveDocument({
    name: file.name,
    blob: new Blob([bytes], { type: 'application/pdf' }),
    pageCount: 0,
    size: file.size
  });
  const fingerprint = await fingerprintDocument(bytes, 0);
  const tour = await saveTour({
    title: title || file.name.replace(/\.pdf$/i, ''),
    description: '',
    docId: doc.id,
    docName: file.name,
    docFingerprint: fingerprint,
    pageCount: 0,
    steps: [],
    thumbnail: null
  });
  return { tour, docId: doc.id };
}

/** Find the PDF a tour belongs to: stored id first, then a fingerprint scan. */
export async function resolveDocument(tour) {
  if (!tour) return null;
  if (tour.docId) {
    const doc = await getDocument(tour.docId);
    if (doc?.blob) {
      if (!tour.docFingerprint) return doc;
      const fp = await fingerprintOf(doc.blob, tour.pageCount || doc.pageCount || 0);
      if (fp === tour.docFingerprint) return doc;
    }
  }
  const docs = await listDocuments();
  for (const doc of docs) {
    if (!doc.blob) continue;
    if (tour.docName && doc.name !== tour.docName) continue;
    const fp = await fingerprintOf(doc.blob, tour.pageCount || doc.pageCount || 0);
    if (fp === tour.docFingerprint) return doc;
  }
  return null;
}

/** Attach a PDF the user picked by hand, verifying it is the right one. */
export async function attachDocument(tour, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fp = await fingerprintDocument(bytes, tour.pageCount || 0);
  if (tour.docFingerprint && fp !== tour.docFingerprint) {
    return { ok: false, reason: 'This PDF is a different document from the one the tour was recorded on.' };
  }
  const doc = await saveDocument({ name: file.name, blob: new Blob([bytes], { type: 'application/pdf' }), size: file.size });
  const updated = await saveTour({ ...tour, docId: doc.id, docName: file.name, docFingerprint: fp });
  return { ok: true, doc, tour: updated };
}

/** Render the current page into a small WebP thumbnail for the library card. */
export async function makeThumbnail(viewer, { width = 480 } = {}) {
  try {
    const pv = viewer?.pages?.[0];
    const canvas = pv?.canvas;
    if (!canvas || !canvas.width) return null;
    const scale = Math.min(1, width / canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.round(canvas.width * scale);
    out.height = Math.round(canvas.height * scale);
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/webp', 0.82));
    return blob;
  } catch {
    return null;
  }
}

export async function storeThumbnail(tourId, blob) {
  if (!blob) return null;
  return putAsset({ tourId, kind: 'thumbnail', blob, mime: 'image/webp' });
}

export async function exportTour(tour) {
  const assets = (await listAssets(tour.id)).filter((a) => a.kind === 'narration');
  const thumb = (await listAssets(tour.id)).find((a) => a.kind === 'thumbnail');
  return buildPackage(tour, { assets, thumbnail: thumb?.blob || null });
}

/** Import a .lumatour, storing the tour and its narration. */
export async function importTour(file) {
  const parsed = await readPackage(file);
  const tour = await saveTour(parsed.tour);
  for (const asset of parsed.assets) {
    await putAsset({ id: asset.id, tourId: tour.id, kind: 'narration', blob: asset.blob, mime: asset.mime, duration: asset.duration });
  }
  if (parsed.thumbnail) await storeThumbnail(tour.id, parsed.thumbnail);
  const doc = await resolveDocument(tour);
  if (doc) {
    // Remember the link so the tour opens straight away next time.
    const linked = await saveTour({ ...tour, docId: doc.id, docName: doc.name, needsDocument: false });
    return { tour: linked, doc, manifest: parsed.manifest };
  }
  return { tour: { ...tour, needsDocument: true }, doc: null, manifest: parsed.manifest };
}

/** Empty tour with a first step, for a document that is already open. */
export function starterTour({ docId, docName, docFingerprint, pageCount, title }) {
  return {
    title: title || (docName || 'Untitled tour').replace(/\.pdf$/i, ''),
    description: '',
    docId,
    docName,
    docFingerprint,
    pageCount,
    steps: [createStep('text', {
      page: 1,
      title: 'Welcome',
      text: '## Welcome\n\nThis is the first step of your GuidedPath. Edit this text, record your voice, or add more steps from the timeline.',
      duration: 4000
    })]
  };
}

export { listTours, getTour, saveTour, deleteTour, duplicateTour, listAssets, pruneAssets };
