// Password protection and unlocking, powered by qpdf compiled to WebAssembly.
// Everything runs in the tab; the file never leaves the device.
import { bytesOf, openForRender } from './pdf-utils.js';
import { openFromBytes } from '../viewer/pdf-engine.js';
import { pdfName } from '../utils/files.js';

const QPDF_BASE = new URL('../../vendor/qpdf/', import.meta.url).href;
const qpdfLog = [];
let factoryPromise = null;
let scriptPromise = null;

function loadQpdfScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (typeof window.Module === 'function') { resolve(window.Module); return; }
    const script = document.createElement('script');
    script.src = QPDF_BASE + 'qpdf.js';
    script.onload = () => (typeof window.Module === 'function'
      ? resolve(window.Module)
      : reject(new Error('qpdf loaded but did not expose its module.')));
    script.onerror = () => reject(new Error('The qpdf engine could not be loaded. Check that vendor/qpdf/ is deployed.'));
    document.head.append(script);
  });
  return scriptPromise;
}

async function qpdfInstance() {
  if (factoryPromise) return factoryPromise;
  factoryPromise = (async () => {
    const factory = await loadQpdfScript();
    return factory({
      locateFile: (file) => QPDF_BASE + file,
      noInitialRun: true,
      // Emscripten binds these at construction, so they must be wired here.
      print: (text) => qpdfLog.push(text),
      printErr: (text) => qpdfLog.push(text)
    });
  })();
  return factoryPromise;
}

/**
 * Run qpdf on a byte buffer. Returns the output bytes.
 * @param {string[]} args qpdf arguments; use /in.pdf and /out.pdf for the files
 * @param {Uint8Array} bytes
 */
async function runQpdf(args, bytes) {
  const instance = await qpdfInstance();
  qpdfLog.length = 0;
  const log = qpdfLog;
  try {
    instance.FS.writeFile('/in.pdf', bytes);
    try { instance.FS.unlink('/out.pdf'); } catch { /* no stale output */ }
    instance.callMain(args);
    let data = null;
    try { data = instance.FS.readFile('/out.pdf'); } catch { data = null; }
    // Surface qpdf's own message so the catch below can explain it properly.
    if (!data || !data.length) throw new Error(log.join(' ') || 'qpdf produced no output.');
    return new Uint8Array(data);
  } catch (err) {
    const detail = log.join(' ').trim();
    const message = detail || err?.message || 'qpdf failed.';
    if (/invalid password/i.test(message)) throw new Error('That password is not correct for this PDF.');
    if (/encrypted/i.test(message)) throw new Error('This PDF is encrypted. Unlock it first, then run this tool again.');
    throw new Error(message.replace(/^qpdf:\s*/i, '').slice(0, 300));
  } finally {
    try { instance.FS.unlink('/in.pdf'); } catch { /* ignore */ }
  }
}

/** Open the bytes with PDF.js using a password — the reliable way to check it. */
async function opensWithPassword(bytes, password) {
  try {
    const doc = await openFromBytes(bytes, { password });
    const pages = doc.numPages;
    return { ok: true, pages };
  } catch (err) {
    if (/password/i.test(err?.message || '') || err?.name === 'PasswordException') {
      return { ok: false, reason: 'password' };
    }
    return { ok: false, reason: 'broken' };
  }
}

async function encryptionState(file) {
  try {
    const { doc } = await openForRender(file);
    return { encrypted: false, pages: doc.numPages };
  } catch (err) {
    if (/password/i.test(err?.message || '') || err?.name === 'PasswordException') {
      return { encrypted: true, pages: 0 };
    }
    return { encrypted: false, pages: 0 };
  }
}

export const protectPdf = {
  id: 'protect-pdf',
  name: 'Protect or unlock PDF',
  desc: 'Add an AES-256 password, or remove a password you know.',
  icon: 'lock',
  category: 'secure',
  inputs: { files: 'pdf', multiple: false },
  params: [
    { key: 'mode', label: 'Action', type: 'select', default: 'lock', options: [
      { value: 'lock', label: 'Add a password' },
      { value: 'unlock', label: 'Remove a password' }
    ] },
    { key: 'password', label: 'Password', type: 'password', default: '', placeholder: 'Password to open the document' },
    { key: 'owner', label: 'Owner password (optional)', type: 'password', default: '', placeholder: 'Defaults to the same password' },
    { key: 'allowPrinting', label: 'Allow printing', type: 'checkbox', default: true },
    { key: 'allowCopying', label: 'Allow copying text', type: 'checkbox', default: true },
    { key: 'allowModifying', label: 'Allow editing', type: 'checkbox', default: false }
  ],
  async run({ files, values, progress }) {
    const file = files[0];
    const bytes = await bytesOf(file);
    const mode = values.mode === 'unlock' ? 'unlock' : 'lock';
    const password = String(values.password || '');
    if (!password) throw new Error('Enter a password first.');

    progress(0.15, 'Loading the qpdf engine');
    const state = await encryptionState(file);
    if (mode === 'lock' && state.encrypted) {
      throw new Error('This PDF is already encrypted. Unlock it first if you want to change the password.');
    }

    if (mode === 'lock') {
      const owner = String(values.owner || '') || password;
      const args = ['--encrypt', password, owner, '256',
        values.allowPrinting ? '--print=full' : '--print=none',
        values.allowModifying ? '--modify=all' : '--modify=none',
        values.allowCopying ? '--extract=y' : '--extract=n',
        '--', '/in.pdf', '/out.pdf'];
      progress(0.5, 'Encrypting with AES-256');
      const out = await runQpdf(args, bytes);
      const check = await opensWithPassword(out, password);
      if (!check.ok) throw new Error('The encrypted file did not verify. Try again, or with a shorter password.');
      return {
        blob: new Blob([out], { type: 'application/pdf' }),
        filename: pdfName(file.name, '-protected'),
        summary: `Protected with AES-256 — ${Math.round(out.length / 1024)} KB.`,
        details: [
          'Anyone who knows the password can open it. There is no recovery: keep the password safe.',
          values.allowPrinting ? 'Printing allowed.' : 'Printing blocked.',
          values.allowCopying ? 'Text copying allowed.' : 'Text copying blocked.',
          values.allowModifying ? 'Editing allowed.' : 'Editing blocked.'
        ],
        preview: { kind: 'pdf' }
      };
    }

    progress(0.35, 'Checking the password');
    const check = await opensWithPassword(bytes, password);
    if (!check.ok) {
      throw new Error(check.reason === 'password'
        ? 'That password is not correct for this PDF.'
        : 'This file could not be opened even with that password — it may be damaged.');
    }
    progress(0.5, 'Removing the password');
    const out = await runQpdf(['--password=' + password, '--decrypt', '--', '/in.pdf', '/out.pdf'], bytes);
    const unlocked = await opensWithPassword(out, '');
    if (!unlocked.ok) throw new Error('The decrypted file did not open. The password may be an owner-only password.');
    return {
      blob: new Blob([out], { type: 'application/pdf' }),
      filename: pdfName(file.name, '-unlocked'),
      summary: `Password removed — ${Math.round(out.length / 1024)} KB, now opens without one.`,
      details: ['Only works when you know the current password. Luma PDF cannot crack encrypted files.'],
      preview: { kind: 'pdf' }
    };
  }
};

export const formFields = {
  id: 'form-fields',
  name: 'List form fields',
  desc: 'Read every AcroForm field in a PDF: names, types and current values.',
  icon: 'clipboard',
  category: 'secure',
  inputs: { files: 'pdf', multiple: false },
  params: [],
  async run({ files }) {
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.load(await bytesOf(files[0]), { ignoreEncryption: true });
    const form = doc.getForm();
    const fields = form.getFields();
    if (!fields.length) {
      const text = 'This PDF has no interactive form fields.';
      return {
        blob: new Blob([text], { type: 'text/plain' }),
        filename: 'form-fields.txt',
        summary: 'No form fields found.',
        details: ['Interactive fields live in the PDF AcroForm; flat forms are just drawn text.'],
        preview: { kind: 'text', text }
      };
    }
    const lines = fields.map((field) => {
      const type = field.constructor.name.replace('PDF', '');
      let value = '';
      try { value = String(field.getText?.() ?? (field.isChecked?.() ? 'checked' : '') ?? ''); } catch { /* ignore */ }
      return `${field.getName()} — ${type}${value ? ' — "' + value + '"' : ''}`;
    });
    const text = `Form fields (${fields.length}):\n\n${lines.join('\n')}\n\nOpen this PDF in the Luma PDF viewer to fill them in.`;
    return {
      blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
      filename: 'form-fields.txt',
      summary: `${fields.length} form field${fields.length === 1 ? '' : 's'} found.`,
      details: lines.slice(0, 8),
      preview: { kind: 'text', text }
    };
  }
};
