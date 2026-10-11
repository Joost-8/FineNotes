/**
 * Writing a model file (the format bundle.ts reads): a tuned network in
 * place of the one a file holds, with a new name in its header. Every other
 * section (the language model) is copied as it is.
 *
 * PURE: no DOM, no Obsidian.
 */

import { type HwrMeta, type NetWeights } from "./bundle";

const MAGIC = 0x57484e46; // "FNHW", little-endian
const VERSION = 1;

/** Bytes padded with zeros (or `fill`) to a multiple of 4. */
function pad4(bytes: Uint8Array, fill = 0): Uint8Array {
  const extra = (4 - (bytes.length % 4)) % 4;
  if (extra === 0) return bytes;
  const out = new Uint8Array(bytes.length + extra).fill(fill);
  out.set(bytes);
  return out;
}

const f32 = (a: Float32Array): Uint8Array =>
  new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
const i8 = (a: Int8Array): Uint8Array =>
  pad4(new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)));

/** The `NET1` payload of a network, in the order bundle.ts reads it. */
export function netSection(net: NetWeights): Uint8Array {
  const parts: Uint8Array[] = [];
  if (net.mean && net.std) parts.push(f32(net.mean), f32(net.std));
  for (const pair of net.layers) {
    for (const d of pair) {
      parts.push(f32(d.wihScale), f32(d.whhScale), f32(d.bias), i8(d.wih), i8(d.whh));
    }
  }
  parts.push(f32(net.outScale), f32(net.outBias), i8(net.out));
  return concat(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

/**
 * The model file `original` with `net` as its network and `meta` merged
 * into its header. Throws when `original` is not a model file.
 */
export function writeBundle(
  original: Uint8Array,
  net: NetWeights,
  meta: Partial<HwrMeta>,
): Uint8Array {
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  if (original.byteLength < 12 || view.getUint32(0, true) !== MAGIC) {
    throw new Error("not a FineNotes handwriting model");
  }
  const metaLength = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(original.subarray(12, 12 + metaLength)),
  ) as HwrMeta;
  const json = new TextEncoder().encode(JSON.stringify({ ...header, ...meta }));
  const metaBytes = pad4(json, 0x20);
  const parts: Uint8Array[] = [u32(MAGIC), u32(VERSION), u32(metaBytes.length), metaBytes];
  let o = 12 + metaLength;
  while (o + 8 <= original.byteLength) {
    const tag = original.subarray(o, o + 4);
    const size = view.getUint32(o + 4, true);
    const payload =
      String.fromCharCode(...tag) === "NET1"
        ? netSection(net)
        : original.subarray(o + 8, o + 8 + size);
    parts.push(tag, u32(payload.length), pad4(payload));
    o += 8 + size + ((4 - (size % 4)) % 4);
  }
  return concat(parts);
}
