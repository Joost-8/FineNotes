/**
 * Apple's LZ4 framing (`COMPRESSION_LZ4` in libcompression), as Goodnotes
 * stores stroke data: blocks of `bv41` + raw size + compressed size + an LZ4
 * block, or `bv4-` + raw size + the bytes as they are, ended by `bv4$`. Pure.
 */

export class Lz4Error extends Error {}

const MAGIC_COMPRESSED = 0x31347662; // "bv41", little-endian
const MAGIC_RAW = 0x2d347662; // "bv4-"
const MAGIC_END = 0x24347662; // "bv4$"

/**
 * The most an LZ4 block of `size` bytes can expand to: one length byte adds
 * at most 255 bytes. A block that claims more is refused before anything is
 * allocated, so a crafted file cannot ask for gigabytes.
 */
function maxExpansion(size: number): number {
  return size * 255 + 16;
}

/** Whether `bytes` start with Apple's LZ4 frame magic. */
export function isAppleLz4(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const magic = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  return magic === MAGIC_COMPRESSED || magic === MAGIC_RAW || magic === MAGIC_END;
}

/**
 * Decompress a whole frame sequence. Throws {@link Lz4Error} on anything
 * malformed. A block's matches may reach back into the blocks before it (a
 * stroke longer than one 64 KiB block does), so all expand into one buffer.
 */
export function decodeAppleLz4(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks: Array<{ magic: number; rawSize: number; data: Uint8Array }> = [];
  let total = 0;
  let at = 0;
  for (;;) {
    if (at + 4 > bytes.length) throw new Lz4Error("missing end marker");
    const magic = view.getUint32(at, true);
    if (magic === MAGIC_END) break;
    if (at + 8 > bytes.length) throw new Lz4Error("truncated block header");
    const rawSize = view.getUint32(at + 4, true);
    if (magic === MAGIC_COMPRESSED) {
      if (at + 12 > bytes.length) throw new Lz4Error("truncated block header");
      const size = view.getUint32(at + 8, true);
      if (at + 12 + size > bytes.length) throw new Lz4Error("block past end");
      if (rawSize > maxExpansion(size)) throw new Lz4Error("raw size too large for block");
      blocks.push({ magic, rawSize, data: bytes.subarray(at + 12, at + 12 + size) });
      at += 12 + size;
    } else if (magic === MAGIC_RAW) {
      if (at + 8 + rawSize > bytes.length) throw new Lz4Error("block past end");
      blocks.push({ magic, rawSize, data: bytes.subarray(at + 8, at + 8 + rawSize) });
      at += 8 + rawSize;
    } else {
      throw new Lz4Error("bad block magic");
    }
    total += rawSize;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const { magic, rawSize, data } of blocks) {
    if (magic === MAGIC_RAW) out.set(data, o);
    else expandBlock(data, out, o, o + rawSize);
    o += rawSize;
  }
  return out;
}

/** One raw LZ4 block, which must expand to exactly `rawSize` bytes. */
export function decodeBlock(src: Uint8Array, rawSize: number): Uint8Array {
  if (rawSize > maxExpansion(src.length)) throw new Lz4Error("raw size too large for block");
  const out = new Uint8Array(rawSize);
  expandBlock(src, out, 0, rawSize);
  return out;
}

/**
 * Expand `src` into `out` from `start`, to exactly `end`. Matches may copy
 * from anywhere in `out` before the write position.
 */
function expandBlock(src: Uint8Array, out: Uint8Array, start: number, end: number): void {
  const rawSize = end;
  let ip = 0;
  let op = start;
  const length = (n: number): number => {
    if (n !== 15) return n;
    for (;;) {
      if (ip >= src.length) throw new Lz4Error("length past end");
      const b = src[ip++];
      n += b;
      if (b !== 255) return n;
    }
  };
  while (ip < src.length) {
    const token = src[ip++];
    const literals = length(token >> 4);
    if (ip + literals > src.length || op + literals > rawSize)
      throw new Lz4Error("literals overrun");
    out.set(src.subarray(ip, ip + literals), op);
    ip += literals;
    op += literals;
    if (ip >= src.length) break;
    if (ip + 2 > src.length) throw new Lz4Error("offset past end");
    const offset = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw new Lz4Error("bad match offset");
    const match = length(token & 15) + 4;
    if (op + match > rawSize) throw new Lz4Error("match overrun");
    for (let i = 0; i < match; i++, op++) out[op] = out[op - offset];
  }
  if (op !== rawSize) {
    throw new Lz4Error(`expanded to ${op - start} bytes, expected ${rawSize - start}`);
  }
}
