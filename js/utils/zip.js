/**
 * Minimal ZIP writer (STORE, no compression). Enough to bundle several generated
 * files into one download without pulling in a compression library.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

/**
 * @param {{name:string, data:Uint8Array|ArrayBuffer|string}[]} entries
 * @returns {Blob} application/zip
 */
export function createZip(entries) {
  const encoder = new TextEncoder();
  const files = entries.map((entry) => {
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data)
      : entry.data instanceof Uint8Array ? entry.data
        : new Uint8Array(entry.data);
    return { name: encoder.encode(entry.name.replace(/^\/+/, '')), data, crc: crc32(data) };
  });

  const { time, day } = dosTime();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameLen = file.name.length;
    const local = new Uint8Array(30 + nameLen);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);           // version needed
    dv.setUint16(6, 0x0800, true);       // UTF-8 names
    dv.setUint16(8, 0, true);            // store
    dv.setUint16(10, time, true);
    dv.setUint16(12, day, true);
    dv.setUint32(14, file.crc, true);
    dv.setUint32(18, file.data.length, true);
    dv.setUint32(22, file.data.length, true);
    dv.setUint16(26, nameLen, true);
    dv.setUint16(28, 0, true);
    local.set(file.name, 30);
    chunks.push(local, file.data);

    const cd = new Uint8Array(46 + nameLen);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, day, true);
    cdv.setUint32(16, file.crc, true);
    cdv.setUint32(20, file.data.length, true);
    cdv.setUint32(24, file.data.length, true);
    cdv.setUint16(28, nameLen, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    cd.set(file.name, 46);
    central.push(cd);

    offset += local.length + file.data.length;
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
