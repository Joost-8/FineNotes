/**
 * Synthetic Supernote notes for the converter's tests: blocks laid out as
 * supernotelib reads them, with pictures run-length encoded by a plain
 * encoder of our own.
 */

import { unzlibSync, zlibSync } from "fflate";

export const SN_WIDTH = 1404;
export const SN_HEIGHT = 1872;

export interface SnLayerSpec {
  /** Colour codes, one per pixel; encoded as RATTA_RLE. */
  codes?: Uint8Array;
  /** The picture's bytes as they are, instead of `codes`. */
  raw?: Uint8Array;
  protocol?: string;
  /** Write the layer block with no `LAYERBITMAP`. */
  noBitmap?: boolean;
  /** Point the page at this address instead of a real layer block. */
  address?: number;
}

export interface SnPageSpec {
  /** Keyed by layer name: MAINLAYER, LAYER1-3, BGLAYER. */
  layers?: Record<string, SnLayerSpec>;
  /** A page of the original format: `DATA` and `PROTOCOL`. */
  data?: { bytes: Uint8Array; protocol: string };
  /** More page tags: LAYERSEQ, LAYERINFO, PAGESTYLE, ORIENTATION. */
  tags?: [string, string][];
}

export interface SnSpec {
  /** Bytes the file starts with; default `note` + `SN_FILE_VER_20230015`. */
  start?: string;
  equipment?: string;
  pages: SnPageSpec[];
  /** One title per entry, on that 1-based page; `broken` writes a block with no picture. */
  titles?: { page: number; broken?: boolean }[];
  keywords?: { page: number; text: string }[];
  links?: number;
  /** Replace the footer's address in the last four bytes. */
  footerAddress?: number;
}

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A blank page of colour codes, background everywhere. */
export function blankCodes(width = SN_WIDTH, height = SN_HEIGHT): Uint8Array {
  return new Uint8Array(width * height).fill(0x62);
}

/** RATTA_RLE in its plainest form: a pair per run of at most 128. */
export function encodeRle(codes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < codes.length) {
    let n = 1;
    while (i + n < codes.length && codes[i + n] === codes[i] && n < 128) n++;
    out.push(codes[i], n - 1);
    i += n;
  }
  return Uint8Array.from(out);
}

/** An original-format page: 16-bit pixels, stored a quarter turn round. */
export function asaPicture(pixel: (x: number, y: number) => number): Uint8Array {
  const stored = 1888;
  const raw = new Uint8Array(SN_WIDTH * stored * 2).fill(0xff);
  for (let x = 0; x < SN_WIDTH; x++) {
    for (let y = 0; y < SN_HEIGHT; y++) {
      const v = pixel(x, y);
      const at = ((SN_WIDTH - 1 - x) * stored + y) * 2;
      raw[at] = v & 0xff;
      raw[at + 1] = v >> 8;
    }
  }
  return zlibSync(raw);
}

class FileWriter {
  private parts: Uint8Array[] = [];
  private length = 0;

  raw(bytes: Uint8Array): number {
    const at = this.length;
    this.parts.push(bytes);
    this.length += bytes.length;
    return at;
  }

  block(content: Uint8Array): number {
    const head = new Uint8Array(4);
    new DataView(head.buffer).setUint32(0, content.length, true);
    const at = this.raw(head);
    this.raw(content);
    return at;
  }

  tags(entries: [string, string | number][]): number {
    return this.block(ascii(entries.map(([k, v]) => `<${k}:${v}>`).join("")));
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** A Supernote note as bytes. */
export function buildSupernote(spec: SnSpec): Uint8Array {
  const w = new FileWriter();
  w.raw(ascii(spec.start ?? "noteSN_FILE_VER_20230015"));
  const header = w.tags([
    ["MODULE_LABEL", "none"],
    ["FILE_TYPE", "NOTE"],
    ...(spec.equipment ? [["APPLY_EQUIPMENT", spec.equipment] as [string, string]] : []),
  ]);

  const pageAddresses = spec.pages.map((page) => {
    const tags: [string, string | number][] = [["PAGESTYLE", "style_white"]];
    for (const [name, layer] of Object.entries(page.layers ?? {})) {
      if (layer.address !== undefined) {
        tags.push([name, layer.address]);
        continue;
      }
      const bitmap = layer.noBitmap
        ? 0
        : w.block(layer.raw ?? encodeRle(layer.codes ?? blankCodes()));
      tags.push([
        name,
        w.tags([
          ["LAYERTYPE", "NOTE"],
          ["LAYERPROTOCOL", layer.protocol ?? "RATTA_RLE"],
          ["LAYERNAME", name],
          ...(bitmap ? [["LAYERBITMAP", bitmap] as [string, number]] : []),
        ]),
      ]);
    }
    if (page.data) {
      tags.push(["PROTOCOL", page.data.protocol], ["DATA", w.block(page.data.bytes)]);
    }
    for (const [k, v] of page.tags ?? []) {
      const i = tags.findIndex(([key]) => key === k);
      if (i >= 0) tags.splice(i, 1);
      tags.push([k, v]);
    }
    return w.tags(tags);
  });

  const footer: [string, string | number][] = [["FILE_FEATURE", header]];
  const original = (spec.start ?? "").startsWith("SN_FILE_ASA_");
  pageAddresses.forEach((a, i) => footer.push([original ? "PAGE" : `PAGE${i + 1}`, a]));
  (spec.titles ?? []).forEach((t, i) => {
    const block = t.broken
      ? w.tags([["TITLESTYLE", "1"]])
      : w.tags([
          ["TITLERECT", "100,100,400,80"],
          ["TITLEBITMAP", w.block(new Uint8Array([0x62, 0x7f]))],
        ]);
    const page = String(t.page).padStart(4, "0");
    footer.push([`TITLE_${page}${String(100 + i).padStart(4, "0")}0100`, block]);
  });
  (spec.keywords ?? []).forEach((kw, i) => {
    const site = w.block(ascii(kw.text));
    const block = w.tags([
      ["KEYWORDPAGE", kw.page],
      ["KEYWORDSITE", site],
      ["KEYWORDRECT", "0,0,10,10"],
    ]);
    footer.push([
      `KEYWORD_${String(kw.page).padStart(4, "0")}${String(i).padStart(4, "0")}`,
      block,
    ]);
  });
  for (let i = 0; i < (spec.links ?? 0); i++) {
    footer.push([`LINKO_0001${String(i).padStart(4, "0")}`, w.tags([["LINKTYPE", "0"]])]);
  }
  const footerAt = w.tags(footer);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, spec.footerAddress ?? footerAt, true);
  w.raw(tail);
  return w.bytes();
}

/** A PNG's size, colour type and pixels (filter type 0 rows only), with CRCs checked by length. */
export function decodePng(png: Uint8Array): {
  width: number;
  height: number;
  colourType: number;
  pixels: Uint8Array;
} {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const idat: Uint8Array[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      colourType = data[9];
    } else if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }
  const joined = new Uint8Array(idat.reduce((s, d) => s + d.length, 0));
  let o = 0;
  for (const d of idat) {
    joined.set(d, o);
    o += d.length;
  }
  const raw = unzlibSync(joined);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType] ?? 1;
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * (stride + 1)] !== 0) throw new Error("unexpected PNG filter");
    pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { width, height, colourType, pixels };
}
