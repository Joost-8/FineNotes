/**
 * A minimal PNG encoder, for converters that hand back a page as a picture.
 * Pure.
 *
 * 8 bits per channel, no interlacing, filter type 0 (none) on every row: the
 * pictures are mostly empty, which DEFLATE packs well without row filters.
 */

import { zlibSync } from "fflate";

/** Channels per pixel: grey, grey + alpha, RGB, RGBA. */
export type PngChannels = 1 | 2 | 3 | 4;

/** PNG's colour type for each channel count. */
const COLOUR_TYPE: Readonly<Record<PngChannels, number>> = { 1: 0, 2: 4, 3: 2, 4: 6 };

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;

/** CRC-32 (the zlib/PNG polynomial) of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A PNG of `width` × `height` pixels. `pixels` holds the rows top to bottom,
 * `channels` bytes a pixel, with no padding.
 */
export function encodePng(
  width: number,
  height: number,
  pixels: Uint8Array,
  channels: PngChannels,
): Uint8Array {
  const stride = width * channels;
  if (!(width > 0 && height > 0) || pixels.length !== stride * height) {
    throw new Error(`PNG: ${pixels.length} bytes for ${width}×${height}×${channels}`);
  }
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = COLOUR_TYPE[channels];

  const chunks = [
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(raw, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(SIGNATURE.length + chunks.reduce((sum, c) => sum + c.length, 0));
  out.set(SIGNATURE);
  let at = SIGNATURE.length;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** One chunk: length, type, data and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
