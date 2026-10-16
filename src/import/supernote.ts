/**
 * Supernote notes (`.note`, the same extension as Notability's) as FineNotes
 * documents. Pure.
 *
 * The format is undocumented; this follows supernotelib (jya-dev, Apache-2.0),
 * which reads it from files written by every firmware since 2019. A note is
 * not a zip. It starts with a four-letter file type and `SN_FILE_VER_` plus
 * eight digits (X and X2 series), or with `SN_FILE_ASA_` (the original A5
 * and A6). Everything else hangs off the last four bytes:
 *
 * - a block is a little-endian uint32 length and that many bytes, found by
 *   its address in the file;
 * - a metadata block is text, `<KEY:VALUE><KEY:VALUE>…`, a key repeating
 *   when it has several values;
 * - the file's last four bytes are the address of the footer block, whose
 *   `FILE_FEATURE` is the header's address, `PAGE1`, `PAGE2`, … the pages',
 *   `TITLE_<page><…>` the titles' and `KEYWORD_<page><…>` the keywords';
 * - a page block names its layers (`MAINLAYER`, `LAYER1`-`LAYER3`, `BGLAYER`,
 *   the template) by address, with their order (`LAYERSEQ`, top first) and
 *   visibility (`LAYERINFO`, JSON with `#` for `:`). A layer block's
 *   `LAYERBITMAP` is the address of its picture, compressed as `RATTA_RLE`.
 *   A page of the original format has no layers: `DATA` holds a zlib stream
 *   of 16-bit pixels (`SN_ASA_COMPRESS`), stored a quarter turn round.
 *
 * Strokes are stored too (`TOTALPATH`), in a layout nobody has published, so
 * each page comes over as one picture of its visible ink layers, grey on
 * transparent, covering the page. Templates come over as blank paper.
 */

import type { ImageElement, InkDocument, Page } from "../model/document";
import { unzlibSync } from "fflate";
import { SCHEMA_VERSION } from "../constants";
import { normalizePageTitle } from "../model/contents";
import { encodePng } from "./png-encode";
import { pageScale, type ImportAttachment, type ImportResult } from "./import-types";

export class SupernoteError extends Error {}

/** A metadata block: every value of each key, in the order written. */
type Tags = Map<string, string[]>;

/** A device's page in pixels, and the screen's width in millimetres. */
interface Device {
  width: number;
  height: number;
  widthMm: number;
}

/** A5X and the original A5: 10.3", 1404 × 1872 px at 226 ppi. */
const A5X: Device = { width: 1404, height: 1872, widthMm: 157.8 };
/** A6X and Nomad (A6X2): 7.8", 1404 × 1872 px at 300 ppi. */
const A6X: Device = { width: 1404, height: 1872, widthMm: 118.9 };
/** Manta (A5X2, `N5`): 10.7", 1920 × 2560 px at 300 ppi. */
const MANTA: Device = { width: 1920, height: 2560, widthMm: 162.6 };

/** The ink layers, bottom to top when a page does not say. */
const INK_LAYERS = ["MAINLAYER", "LAYER1", "LAYER2", "LAYER3"];

/** Every layer a page block may name. */
const LAYER_KEYS = [...INK_LAYERS, "BGLAYER"];

/** `RATTA_RLE`'s transparent background. */
const RLE_BACKGROUND = 0x62;

/** The first signature whose RLE uses the X2 series' finer greys. */
const X2_SIGNATURE = 20230015;

/** `SN_ASA_COMPRESS` pages are stored this many px tall (16 more than shown). */
const ASA_STORED_HEIGHT = 1888;

export const SUPERNOTE_BITMAP_WARNING =
  "Supernote handwriting comes over as pictures of each page; it can be written over but not edited stroke by stroke.";

const utf8 = new TextDecoder();

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

/** Whether a file is a Supernote note (and not a zipped Notability one). */
export function isSupernote(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 12) === "SN_FILE_ASA_") return true;
  return /^[A-Za-z]{4}$/.test(ascii(bytes, 0, 4)) && ascii(bytes, 4, 16) === "SN_FILE_VER_";
}

export function readSupernote(bytes: Uint8Array, fallbackTitle: string): ImportResult {
  if (!isSupernote(bytes)) throw new SupernoteError("not a Supernote note");
  const original = ascii(bytes, 0, 12) === "SN_FILE_ASA_";
  const x2 = !original && Number(ascii(bytes, 16, 24)) >= X2_SIGNATURE;
  const file = new BlockReader(bytes);

  let footer: Tags;
  let header: Tags;
  let pageTags: Tags[];
  try {
    footer = file.tags(file.uint32(bytes.length - 4));
    header = file.tags(address(first(footer, "FILE_FEATURE")));
    pageTags = [...footer.entries()]
      .filter(([key]) => /^PAGE\d*$/.test(key))
      .sort(([a], [b]) => Number(a.slice(4)) - Number(b.slice(4)))
      .flatMap(([, values]) => values.map((v) => file.tags(address(v))));
  } catch (e) {
    throw new SupernoteError(`the note's index could not be read: ${(e as Error).message}`);
  }
  if (pageTags.length === 0) throw new SupernoteError("the note has no pages");

  const device = deviceFor(first(header, "APPLY_EQUIPMENT") ?? "");
  const k = pageScale(device.width, device.widthMm);
  const name = fallbackTitle;
  const warnings = [SUPERNOTE_BITMAP_WARNING];
  const attachments: ImportAttachment[] = [];
  let unreadable = 0;
  let templated = 0;

  const pages: Page[] = pageTags.map((tags, i) => {
    const horizontal = ["1090", "1270"].includes(first(tags, "ORIENTATION") ?? "");
    const [w, h] = horizontal ? [device.height, device.width] : [device.width, device.height];
    const style = first(tags, "PAGESTYLE");
    if (style && style !== "style_white" && style !== "none") templated++;

    const picture = new Picture(w, h, x2);
    for (const layer of inkLayers(file, tags)) {
      try {
        picture.paint(layer.protocol, file.block(layer.bitmap));
      } catch {
        unreadable++;
      }
    }

    const geometry = { width: Math.round(w * k), height: Math.round(h * k) };
    const images: ImageElement[] = [];
    if (picture.inked) {
      const fileName = `${name} - page ${i + 1}.png`;
      attachments.push({ name: fileName, bytes: picture.png(), mime: "image/png" });
      images.push({ id: `i${i + 1}`, path: fileName, x: 0, y: 0, ...wh(geometry) });
    }
    return {
      id: `p${i + 1}`,
      kind: "ink",
      geometry,
      backdrop: { kind: "blank" },
      strokes: [],
      images,
      textBoxes: [],
    };
  });

  if (addTitles(file, footer, pages)) {
    warnings.push(
      "Supernote titles are handwriting: they are listed in the contents by page, not by their words.",
    );
  }
  if (unreadable > 0) {
    warnings.push(
      `${unreadable} layer${unreadable === 1 ? "" : "s"} of handwriting could not be read.`,
    );
  }
  if (templated > 0) {
    warnings.push(
      `${templated} page${templated === 1 ? "" : "s"} had a template, which comes over as blank paper.`,
    );
  }
  const links = [...footer.entries()]
    .filter(([key]) => key.startsWith("LINK"))
    .reduce((sum, [, values]) => sum + values.length, 0);
  if (links > 0) warnings.push(`${links} link${links === 1 ? "" : "s"} could not be brought over.`);

  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: pages[0].geometry.width, scale: 1 },
    pages,
  };
  return { source: "supernote", title: name, doc, attachments, warnings };
}

function wh(geometry: { width: number; height: number }): { w: number; h: number } {
  return { w: geometry.width, h: geometry.height };
}

/** The device a note was written on, from the header's `APPLY_EQUIPMENT`. */
function deviceFor(equipment: string): Device {
  if (equipment === "N5") return MANTA;
  if (/^(A6|N6)/.test(equipment)) return A6X;
  return A5X;
}

/** Reads blocks by address, refusing any that runs past the end of the file. */
class BlockReader {
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  uint32(at: number): number {
    return this.view.getUint32(at, true);
  }

  block(at: number): Uint8Array {
    if (at <= 0 || at + 4 > this.bytes.length) throw new SupernoteError(`no block at ${at}`);
    const end = at + 4 + this.uint32(at);
    if (end > this.bytes.length) throw new SupernoteError(`the block at ${at} runs past the end`);
    return this.bytes.subarray(at + 4, end);
  }

  /** A metadata block's tags; none for address 0. */
  tags(at: number): Tags {
    const tags: Tags = new Map();
    if (at === 0) return tags;
    for (const m of utf8.decode(this.block(at)).matchAll(/<([^:<>]+):(.*?)>/g)) {
      const values = tags.get(m[1]);
      if (values) values.push(m[2]);
      else tags.set(m[1], [m[2]]);
    }
    return tags;
  }
}

function first(tags: Tags, key: string): string | undefined {
  return tags.get(key)?.[0];
}

/** A tag's value as a block address; 0 for none or nonsense. */
function address(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

interface InkLayer {
  protocol: string;
  /** The address of its picture. */
  bitmap: number;
}

/**
 * A page's visible ink layers, bottom first. A page of the original format
 * is one layer. Layers that are hidden, empty or the template are left out.
 */
function inkLayers(file: BlockReader, tags: Tags): InkLayer[] {
  if (!LAYER_KEYS.some((key) => tags.has(key))) {
    const bitmap = address(first(tags, "DATA"));
    return bitmap ? [{ protocol: first(tags, "PROTOCOL") ?? "", bitmap }] : [];
  }
  const visible = layerVisibility(tags);
  const seq = (first(tags, "LAYERSEQ") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => INK_LAYERS.includes(s));
  const order = seq.length > 0 ? seq.reverse() : INK_LAYERS;
  const out: InkLayer[] = [];
  for (const key of order) {
    if (visible.get(key) === false) continue;
    let layer: Tags;
    try {
      layer = file.tags(address(first(tags, key)));
    } catch {
      continue;
    }
    const bitmap = address(first(layer, "LAYERBITMAP"));
    if (bitmap) out.push({ protocol: first(layer, "LAYERPROTOCOL") ?? "", bitmap });
  }
  return out;
}

/** Which layers `LAYERINFO` says are shown; a layer it does not mention is. */
function layerVisibility(tags: Tags): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const info = first(tags, "LAYERINFO");
  if (!info || info === "none") return out;
  const text = info.replace(/#/g, ":");
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    try {
      list = JSON.parse(atob(text));
    } catch {
      return out;
    }
  }
  if (!Array.isArray(list)) return out;
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const layer = item as { layerId?: unknown; isBackgroundLayer?: unknown; isVisible?: unknown };
    const key =
      layer.isBackgroundLayer === true
        ? "BGLAYER"
        : layer.layerId === 0
          ? "MAINLAYER"
          : `LAYER${String(layer.layerId)}`;
    out.set(key, layer.isVisible !== false);
  }
  return out;
}

/**
 * Lists each page that has a title in the contents, named after a keyword on
 * the page when there is one. Returns whether any title was found.
 */
function addTitles(file: BlockReader, footer: Tags, pages: Page[]): boolean {
  const keywords = new Map<number, string>();
  for (const [key, values] of footer) {
    if (!key.startsWith("KEYWORD_")) continue;
    for (const value of values) {
      try {
        const tags = file.tags(address(value));
        const page = Number(first(tags, "KEYWORDPAGE")) - 1;
        const text = utf8.decode(file.block(address(first(tags, "KEYWORDSITE")))).trim();
        if (text && !keywords.has(page)) keywords.set(page, text);
      } catch {
        // A keyword that cannot be read only loses its name.
      }
    }
  }

  let found = 0;
  for (const [key, values] of footer) {
    if (!key.startsWith("TITLE_")) continue;
    const page = pages[Number(key.slice(6, 10)) - 1];
    if (!page || page.title !== undefined) continue;
    const clean = values.some((value) => {
      try {
        const tags = file.tags(address(value));
        return tags.has("TITLEBITMAP") || tags.has("TITLERECT");
      } catch {
        return false;
      }
    });
    if (!clean) continue;
    found++;
    const index = pages.indexOf(page);
    page.title = normalizePageTitle(keywords.get(index)) ?? `Title ${found}`;
  }
  return found > 0;
}

/**
 * One page's ink, composited layer over layer as grey and alpha, two bytes a
 * pixel. A pixel no layer drew stays transparent.
 */
class Picture {
  private readonly pixels: Uint8Array;
  inked = false;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly x2: boolean,
  ) {
    this.pixels = new Uint8Array(width * height * 2);
  }

  /** Draws one layer over what is there; throws, drawing nothing, if it cannot be read. */
  paint(protocol: string, data: Uint8Array): void {
    if (protocol === "RATTA_RLE") {
      const runs = decodeRattaRle(data, this.width * this.height);
      let p = 0;
      for (let i = 0; i < runs.length; i += 2) {
        const grey = rleGrey(runs[i], this.x2);
        if (grey !== null) this.fill(p, runs[i + 1], grey);
        p += runs[i + 1];
      }
    } else if (protocol === "SN_ASA_COMPRESS") {
      this.paintAsa(data);
    } else {
      throw new SupernoteError(`unknown picture format ${protocol}`);
    }
  }

  png(): Uint8Array {
    return encodePng(this.width, this.height, this.pixels, 2);
  }

  private fill(from: number, length: number, grey: number): void {
    if (length > 0) this.inked = true;
    for (let p = from; p < from + length; p++) {
      this.pixels[p * 2] = grey;
      this.pixels[p * 2 + 1] = 255;
    }
  }

  /** The original format: 16-bit pixels, stored column by column from the right. */
  private paintAsa(data: Uint8Array): void {
    const raw = unzlibSync(data);
    const { width, height } = this;
    if (raw.length !== width * ASA_STORED_HEIGHT * 2 || height > ASA_STORED_HEIGHT) {
      throw new SupernoteError(`a picture of ${raw.length} bytes does not fit the page`);
    }
    for (let x = 0; x < width; x++) {
      const column = (width - 1 - x) * ASA_STORED_HEIGHT;
      for (let y = 0; y < height; y++) {
        const at = (column + y) * 2;
        const grey = asaGrey(raw[at] | (raw[at + 1] << 8));
        if (grey !== null) this.fill(y * width + x, 1, grey);
      }
    }
  }
}

/**
 * A `RATTA_RLE` colour code as a grey level, or `null` for the background.
 * Markers are drawn in their pen's grey. From signature 20230015 (X2 series)
 * the greys moved to codes that are their own level, the old codes became
 * darker "compatible" greys, and any other code is a level of anti-aliasing.
 */
export function rleGrey(code: number, x2: boolean): number | null {
  switch (code) {
    case RLE_BACKGROUND:
      return null;
    case 0x61: // black
    case 0x66: // black marker
      return 0x00;
    case 0x65: // white
      return 0xfe;
    case 0x63: // dark grey
      return x2 ? 0x30 : 0x9d;
    case 0x64: // grey
      return x2 ? 0x50 : 0xc9;
    case 0x67: // dark grey marker
    case 0x9e: // X2 dark grey marker
      return 0x9d;
    case 0x68: // grey marker
    case 0xca: // X2 grey marker
      return 0xc9;
    default:
      return code;
  }
}

/** A `SN_ASA_COMPRESS` pixel as a grey level, or `null` for the background. */
function asaGrey(value: number): number | null {
  switch (value) {
    case 0x0000:
      return 0x00;
    case 0x2104:
      return 0x9d;
    case 0xe1e2:
      return 0xc9;
    default:
      return null;
  }
}

/**
 * `RATTA_RLE` as runs: code, length, code, length, …, covering exactly
 * `pixels` pixels, or a {@link SupernoteError}.
 *
 * The data is byte pairs, a colour code and a length byte `n`: a run of
 * `n + 1`, or 0x4000 for `n = 0xff`. A length with its top bit set is held:
 * when the next pair has the same code the two make one run of
 * `1 + next + ((n & 0x7f) + 1) × 128`, otherwise it is a run of
 * `((n & 0x7f) + 1) × 128` on its own. A pair held at the very end is the
 * largest `((n & 0x7f) + 1) × 2^i` (i from 7 down to 0) that fits what is
 * left of the page.
 */
export function decodeRattaRle(data: Uint8Array, pixels: number): number[] {
  const runs: number[] = [];
  let total = 0;
  const emit = (code: number, length: number): void => {
    runs.push(code, length);
    total += length;
  };
  let held = -1;
  let heldLength = 0;
  for (let i = 0; i + 1 < data.length; i += 2) {
    const code = data[i];
    const length = data[i + 1];
    if (held >= 0) {
      const long = ((heldLength & 0x7f) + 1) << 7;
      const previous = held;
      held = -1;
      if (code === previous) {
        emit(code, 1 + length + long);
        continue;
      }
      emit(previous, long);
    }
    if (length === 0xff) emit(code, 0x4000);
    else if (length & 0x80) {
      held = code;
      heldLength = length;
    } else emit(code, length + 1);
  }
  if (held >= 0) {
    for (let shift = 7; shift >= 0; shift--) {
      const length = ((heldLength & 0x7f) + 1) << shift;
      if (length <= pixels - total) {
        emit(held, length);
        break;
      }
    }
  }
  if (total !== pixels) {
    throw new SupernoteError(`the picture has ${total} pixels where the page has ${pixels}`);
  }
  return runs;
}
