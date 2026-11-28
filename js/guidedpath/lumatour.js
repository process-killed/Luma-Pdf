/**
 * The portable `.lumatour` package: a ZIP with a versioned manifest, a thumbnail and the
 * narration audio. No PDF is included — tours are tied to a document by fingerprint.
 *
 * Imported packages are treated as untrusted: paths, sizes, MIME types and the manifest
 * schema are all validated before anything is written to storage.
 */
import { GUIDEDPATH } from '../config.js';
import { validateStep, migrateTour, safeExternalUrl } from './model.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------- ZIP writer (stored entries) ---------------- */
function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

/** Build a ZIP from [{ name, bytes }]. Entries are stored (audio is already compressed). */
export function zipSync(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosDateTime();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true);            // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.bytes.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, entry.bytes);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + entry.bytes.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

/* ---------------- ZIP reader ---------------- */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot read compressed tour files. Update your browser and try again.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const MAX_ENTRIES = 256;
const SAFE_PATH = /^[A-Za-z0-9_\-][A-Za-z0-9_\-./]*$/;

function assertSafePath(name) {
  if (!name || name.length > 200) throw new Error('Archive contains an invalid file name.');
  if (!SAFE_PATH.test(name)) throw new Error(`Archive contains an unsafe path: ${name}`);
  if (name.includes('..') || name.startsWith('/') || name.includes('\\')) {
    throw new Error(`Archive contains an unsafe path: ${name}`);
  }
}

/** Read a ZIP into a Map of name → Uint8Array. */
export async function unzip(blob) {
  if (blob.size > GUIDEDPATH.maxPackageBytes) throw new Error('That tour file is too large to open.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);

  // find the end-of-central-directory record (scan backwards, max 64 KiB comment)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('That file is not a valid .lumatour package.');

  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new Error('That tour package has too many files.');

  const files = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) {
      throw new Error('That tour package is corrupted.');
    }
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    assertSafePath(name);

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('That tour package is corrupted.');
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) files.set(name, raw.slice());
    else if (method === 8) files.set(name, await inflateRaw(raw));
    else throw new Error(`Unsupported compression in ${name}.`);

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---------------- document fingerprint ---------------- */
/**
 * Stable document fingerprint: SHA-256 over the file size and its first and last 64 KiB.
 *
 * Page count is deliberately *not* part of the digest: it is not known when a tour is
 * first created, and mixing it in made the same file hash differently depending on when
 * it was fingerprinted. It never loads a whole PDF into memory, and it survives the file
 * being copied between devices.
 */
export async function fingerprintDocument(bytesOrBuffer) {
  const bytes = bytesOrBuffer instanceof Uint8Array ? bytesOrBuffer : new Uint8Array(bytesOrBuffer);
  const slice = 64 * 1024;
  const head = bytes.subarray(0, Math.min(slice, bytes.length));
  const tail = bytes.subarray(Math.max(0, bytes.length - slice));
  const header = encoder.encode(`${bytes.length}|`);
  const joined = new Uint8Array(header.length + head.length + tail.length);
  joined.set(header, 0);
  joined.set(head, header.length);
  joined.set(tail, header.length + head.length);
  const digest = await crypto.subtle.digest('SHA-256', joined);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------------- package build ---------------- */
export async function buildPackage(tour, { assets = [], thumbnail = null } = {}) {
  const entries = [];
  const assetRefs = [];
  for (const asset of assets) {
    if (!asset?.blob) continue;
    const ext = (asset.mime || 'audio/webm').includes('mp4') ? 'm4a'
      : (asset.mime || '').includes('ogg') ? 'ogg'
        : (asset.mime || '').includes('mpeg') ? 'mp3'
          : (asset.mime || '').includes('wav') ? 'wav' : 'webm';
    const name = `assets/narration/${asset.id}.${ext}`;
    entries.push({ name, bytes: new Uint8Array(await asset.blob.arrayBuffer()) });
    assetRefs.push({ id: asset.id, path: name, mime: asset.mime || 'audio/webm', size: asset.size || asset.blob.size, duration: asset.duration || 0 });
  }

  if (thumbnail) {
    entries.push({ name: 'thumbnail.webp', bytes: new Uint8Array(await thumbnail.arrayBuffer()) });
  }

  const manifest = {
    format: GUIDEDPATH.formatId,
    formatVersion: GUIDEDPATH.formatVersion,
    tourId: tour.id,
    title: tour.title,
    description: tour.description || '',
    createdAt: tour.createdAt || Date.now(),
    updatedAt: Date.now(),
    document: {
      filename: tour.docName || '',
      fingerprint: tour.docFingerprint || '',
      pageCount: tour.pageCount || 0
    },
    steps: tour.steps,
    assets: assetRefs,
    stepCount: tour.steps.length,
    durationMs: tour.steps.reduce((s, x) => s + (x.duration || 0), 0)
  };

  entries.unshift({ name: 'manifest.json', bytes: encoder.encode(JSON.stringify(manifest, null, 2)) });
  entries.push({
    name: 'metadata/document.json',
    bytes: encoder.encode(JSON.stringify({
      filename: tour.docName || '',
      fingerprint: tour.docFingerprint || '',
      pageCount: tour.pageCount || 0,
      note: 'The PDF itself is not included in a .lumatour package.'
    }, null, 2))
  });

  const blob = zipSync(entries);
  const filename = `${(tour.title || 'guidedpath').replace(/[^\w\-. ]+/g, '_').slice(0, 60)}.lumatour`;
  return { blob, filename, manifest };
}

/* ---------------- package read + validate ---------------- */
export async function readPackage(file) {
  const files = await unzip(file);
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) throw new Error('This package has no manifest — it is not a Luma tour.');

  let manifest;
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes));
  } catch {
    throw new Error('The tour manifest is not valid JSON.');
  }
  if (manifest.format !== GUIDEDPATH.formatId) throw new Error('That file is not a Luma GuidedPath package.');
  const version = Number(manifest.formatVersion);
  if (!Number.isFinite(version) || version > GUIDEDPATH.formatVersion) {
    throw new Error(`This tour was made with a newer version of Luma (format ${manifest.formatVersion}). Update Luma to open it.`);
  }
  if (!Array.isArray(manifest.steps)) throw new Error('The tour has no steps.');
  if (manifest.steps.length > GUIDEDPATH.maxSteps) throw new Error('That tour has too many steps.');

  const pageCount = Number(manifest.document?.pageCount) || 0;
  const steps = [];
  for (const raw of manifest.steps) {
    const step = validateStep(raw, pageCount);
    if (step.link && !safeExternalUrl(step.link.url)) step.link = null;
    steps.push(step);
  }

  // narration assets: only referenced files, whitelisted MIME, size capped
  const assets = [];
  const byId = new Map();
  for (const ref of manifest.assets || []) {
    if (!ref || typeof ref.id !== 'string' || typeof ref.path !== 'string') continue;
    const bytes = files.get(ref.path);
    if (!bytes) continue;
    const mime = GUIDEDPATH.narrationMimes.includes(ref.mime) ? ref.mime : 'audio/webm';
    if (bytes.length > GUIDEDPATH.maxNarrationBytes) {
      throw new Error('A narration file in this package is too large.');
    }
    const asset = {
      id: ref.id,
      kind: 'narration',
      mime,
      size: bytes.length,
      duration: Number(ref.duration) || 0,
      blob: new Blob([bytes], { type: mime })
    };
    assets.push(asset);
    byId.set(ref.id, asset);
  }
  for (const step of steps) {
    if (step.narration && !byId.has(step.narration.assetId)) step.narration = null;
  }

  const thumbnailBytes = files.get('thumbnail.webp');
  const thumbnail = thumbnailBytes ? new Blob([thumbnailBytes], { type: 'image/webp' }) : null;

  const tour = migrateTour({
    id: `tour-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(manifest.title || 'Imported tour').slice(0, 120),
    description: String(manifest.description || '').slice(0, 2000),
    docName: String(manifest.document?.filename || '').slice(0, 260),
    docFingerprint: String(manifest.document?.fingerprint || '').slice(0, 128),
    pageCount,
    steps,
    importedAt: Date.now(),
    createdAt: Number(manifest.createdAt) || Date.now()
  });

  return { tour, assets, thumbnail, manifest };
}
