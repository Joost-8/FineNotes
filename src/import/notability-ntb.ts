/**
 * Notability's newer `.ntb` notes as FineNotes documents. Pure.
 *
 * An `.ntb` file is a zip: `version`, `noteBundle` (the note itself), `assets/`
 * (pictures, and the PDFs a note annotates), `manifest.json`, `index/` and
 * `thumbnail.png`. `noteBundle` is a FlatBuffers root table whose field 6 is
 * the event list. Each event has a type (field 4) and a payload (field 5):
 * the document's paper and fonts (1), CreatePage (3), AssetCloudPersisted
 * (2), typing (InsertChar 7, InsertString 8, RemoveChar 9, RemoveChars 10,
 * ReviveChars 11), styles (12, 13, 14), ink (15), shapes (18) and pictures or
 * text boxes or stickies (22), and the changes made to them later (ModifyInk
 * 17, ModifyShape 19, ModifyBlock 23, ModifyPositions 24, DeleteEntities 25).
 * The payload layouts are those of the Notability desktop app's own FlatBuffers
 * schema (`temporal-*.js` in its `app-dist`).
 *
 * Typed text is a sequence CRDT, replayed as the app does ({@link readText}):
 * every character has an id (its operation's id and its place in the
 * operation's string) and goes after the character named by its location, or
 * at the start of its container: the document, or a text box (the id of its
 * CreateBlock event). Removals hide characters and revivals show them again;
 * a style range runs between two characters.
 *
 * `manifest.json` holds `appVersion`, `subjectId` and `subjectName`. The subject
 * is the folder the note sits in in Notability's library: its own name only, not
 * the path above it, and it matches the zip's folder for all but two of 198
 * notes read. The folders of a backup come from the zip's paths
 * (`import-notebook.ts`), so the manifest is not read.
 *
 * Read from real notes of Notability 16 (2026-10). The layout follows the
 * Rust converter in the dev repo (`ntb/documents.rs`, `ntb.rs`, `render.rs`),
 * which renders them: a position is measured from its page's top, and its x
 * from the content's left edge (the inset is added back); the note's typed
 * text flows down the pages from the top; a single PDF's page n is note page n.
 *
 * Where this differs from the converter, on purpose:
 *
 * - A page is `paper` wide in document units, and as tall as its PDF page is
 *   at that width ({@link pageLayout}). The converter stretches every PDF page
 *   to the paper's own aspect, which moves ink off the words it marked on any
 *   PDF that is not the paper's shape; at the PDF's own aspect the highlights
 *   land on their words.
 * - The note is an operation log. A DeleteEntities event (25) names ink,
 *   shapes and blocks that were deleted; they are left out ({@link deletedIds}).
 *   The converter draws them, which brings back every sticky note or text box
 *   that was made and thrown away as a solid yellow rectangle. It also reads
 *   typed text wrongly (it takes InsertChar for a text boundary), and
 *   skips the later edits of where things are; both are replayed here.
 *
 * Decoding is ported from `ntb-parser.ts` in the dev repo, with the zlib calls
 * replaced by the zip reader the caller already ran.
 */

import type {
  Backdrop,
  ImageCrop,
  ImageElement,
  InkDocument,
  Page,
  Stroke,
  TextBoxElement,
} from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { newStickyNote } from "../model/sticky-notes";
import { PAGE_SIZES } from "../model/templates";
import {
  fontFor,
  hexColor,
  imageSize,
  ImportTally,
  median,
  packageRoot,
  plural,
  pressureForWidth,
  round2,
  sniffFile,
  type ImportAttachment,
  type ImportResult,
} from "./import-types";
import type { PdfPageSize } from "./notability";

export class NtbError extends Error {}

/** The page sizes of a note's PDFs, by entry path relative to the note (`assets/…`). */
export type NtbPdfSizes = ReadonlyMap<string, readonly PdfPageSize[]>;

type Pt = [number, number];
type Rgba = [number, number, number, number];

// --- Constants ------------------------------------------------------------------

/**
 * OpPayload types of the events FineNotes reads, named as in the Notability
 * desktop app's own FlatBuffers schema (`temporal-*.js` in its `app-dist`).
 */
const EVENT_DOCUMENT = 1;
const EVENT_CREATE_PAGE = 3;
const EVENT_INSERT_CHAR = 7;
const EVENT_INSERT_STRING = 8;
const EVENT_REMOVE_CHAR = 9;
const EVENT_REMOVE_CHARS = 10;
const EVENT_REVIVE_CHARS = 11;
const EVENT_MODIFY_STYLE = 12;
const EVENT_MODIFY_PARAGRAPH_STYLE = 13;
const EVENT_CLEAR_STYLE = 14;
const EVENT_CREATE_INK = 15;
const EVENT_MODIFY_INK = 17;
const EVENT_CREATE_SHAPE = 18;
const EVENT_MODIFY_SHAPE = 19;
const EVENT_CREATE_COMMENT = 30;
const EVENT_CREATE_BLOCK = 22;
const EVENT_MODIFY_BLOCK = 23;
const EVENT_MODIFY_POSITIONS = 24;
const EVENT_DELETE_ENTITIES = 25;

/** Boundary types of a style range's ends: the character it is by, or an end of the text. */
const BOUNDARY_BEFORE = 0;
const BOUNDARY_AFTER = 1;
const BOUNDARY_START_OF_DOC = 2;
const BOUNDARY_END_OF_DOC = 3;

/** Pen tools: 1 is a pencil, 2 a highlighter. */
const TOOL_PENCIL = 1;
const TOOL_HIGHLIGHTER = 2;

/** A pencil's width in the Notability pen's units (scaled to read like a pencil). */
const PENCIL_WIDTH_SCALE = 0.45 / 0.68;

/** The margin of a page, as a share of its width. */
const CONTENT_INSET_RATIO = 1 / 38.4;

/** A paper size in document units when the note does not say. */
const DEFAULT_PAPER_WIDTH = 679;
const DEFAULT_PAPER_HEIGHT = 891.18756;

/** Where the typed text starts, from the top of the first page (document units). */
const DEFAULT_TEXT_TOP = 3;

/** Line spacing when the paper has none (document units). */
const DEFAULT_LINE_SPACING = 20;

/** The colour of a ruled paper's lines. */
const RULE_COLOUR = "#a3b7d3";

/** Page px between the points a Bézier is sampled at. */
const SAMPLE_SPACING = 2;
const MAX_SAMPLES_PER_SEGMENT = 64;

/** Average character width, in font sizes, for estimating where lines wrap. */
const CHAR_WIDTH = 0.5;
const MONO_CHAR_WIDTH = 0.6;

/** Letter's width in page px, when the page sizes do not list it. */
const LETTER_WIDTH_FALLBACK = 1053;

const BLACK: Rgba = [0, 0, 0, 255];

/** Whether a set of zip entries is a `.ntb` note: a `noteBundle` and a `version`, at the top or one folder down. */
export function isNotabilityNtb(files: ReadonlyMap<string, Uint8Array>): boolean {
  return ntbRoot(files) !== null;
}

function ntbRoot(files: ReadonlyMap<string, Uint8Array>): string | null {
  const root = packageRoot(files, "noteBundle");
  return root !== null && files.has(`${root}version`) ? root : null;
}

/** The PDFs a note carries, by their path under the note (`assets/…`), for measuring. */
export function notabilityNtbPdfFiles(
  files: ReadonlyMap<string, Uint8Array>,
): Array<{ name: string; bytes: Uint8Array }> {
  const root = ntbRoot(files);
  if (root === null) return [];
  return [...files]
    .filter(
      ([path, bytes]) =>
        path.startsWith(`${root}assets/`) && /\.pdf$/i.test(path) && bytes.length > 0,
    )
    .map(([path, bytes]) => ({ name: path.slice(root.length), bytes }));
}

// --- Bytes ----------------------------------------------------------------------

const f32View = new DataView(new ArrayBuffer(4));

/** An IEEE 754 half-precision float, as a number. */
export function f16ToF32(value: number): number {
  const sign = (value & 0x8000) << 16;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  let bits: number;
  if (exponent === 0) {
    if (fraction === 0) {
      bits = sign;
    } else {
      const shift = Math.clz32(fraction) - 21;
      bits = sign | ((127 - 15 - shift + 1) << 23) | (((fraction << shift) & 0x03ff) << 13);
    }
  } else if (exponent === 0x1f) {
    bits = sign | 0x7f800000 | (fraction << 13);
  } else {
    bits = sign | ((exponent + 127 - 15) << 23) | (fraction << 13);
  }
  f32View.setUint32(0, bits >>> 0, true);
  return f32View.getFloat32(0, true);
}

/** A FlatBuffers buffer's reader: every read bounds-checked, `null` when out of range. */
export class FlatBuffer {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(pos: number): number | null {
    return pos >= 0 && pos < this.bytes.length ? this.bytes[pos] : null;
  }

  u16(pos: number): number | null {
    return pos >= 0 && pos + 2 <= this.bytes.length ? this.view.getUint16(pos, true) : null;
  }

  u32(pos: number): number | null {
    return pos >= 0 && pos + 4 <= this.bytes.length ? this.view.getUint32(pos, true) : null;
  }

  i32(pos: number): number | null {
    return pos >= 0 && pos + 4 <= this.bytes.length ? this.view.getInt32(pos, true) : null;
  }

  f32(pos: number): number | null {
    return pos >= 0 && pos + 4 <= this.bytes.length ? this.view.getFloat32(pos, true) : null;
  }

  u64(pos: number): bigint | null {
    return pos >= 0 && pos + 8 <= this.bytes.length ? this.view.getBigUint64(pos, true) : null;
  }

  slice(pos: number, length: number): Uint8Array | null {
    if (pos < 0 || length < 0 || pos + length > this.bytes.length) return null;
    return this.bytes.subarray(pos, pos + length);
  }

  rootTable(): number | null {
    return this.u32(0);
  }

  /** The position of a table's field, or `null` when the table does not have it. */
  field(table: number, index: number): number | null {
    const delta = this.i32(table);
    if (delta === null) return null;
    const vtable = table - delta;
    if (vtable < 0) return null;
    const length = this.u16(vtable);
    if (length === null) return null;
    const entry = 4 + index * 2;
    if (entry + 2 > length) return null;
    const offset = this.u16(vtable + entry);
    if (!offset) return null;
    return table + offset;
  }

  offsetField(table: number, index: number): number | null {
    const field = this.field(table, index);
    if (field === null) return null;
    const offset = this.u32(field);
    return offset === null ? null : field + offset;
  }

  stringField(table: number, index: number): string | null {
    const target = this.offsetField(table, index);
    if (target === null) return null;
    const length = this.u32(target);
    if (length === null) return null;
    const data = this.slice(target + 4, length);
    if (data === null) return null;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      return null;
    }
  }

  byteVector(table: number, index: number): Uint8Array | null {
    const target = this.offsetField(table, index);
    if (target === null) return null;
    const length = this.u32(target);
    return length === null ? null : this.slice(target + 4, length);
  }

  pointVector(table: number, index: number): Pt[] | null {
    const target = this.offsetField(table, index);
    if (target === null) return null;
    const length = this.u32(target);
    if (length === null) return null;
    const points: Pt[] = [];
    for (let i = 0; i < length; i++) {
      const pos = target + 4 + i * 8;
      const x = this.f32(pos);
      const y = this.f32(pos + 4);
      if (x === null || y === null) return null;
      points.push([x, y]);
    }
    return points;
  }

  tableVector(table: number, index: number): number[] | null {
    const target = this.offsetField(table, index);
    if (target === null) return null;
    const length = this.u32(target);
    if (length === null) return null;
    const tables: number[] = [];
    for (let i = 0; i < length; i++) {
      const slot = target + 4 + i * 4;
      const offset = this.u32(slot);
      if (offset === null) return null;
      tables.push(slot + offset);
    }
    return tables;
  }

  /** Two float32s in a struct field (a point or a size). */
  pairField(table: number, index: number): Pt | null {
    const field = this.field(table, index);
    if (field === null) return null;
    return this.pairAt(field);
  }

  pairAt(pos: number): Pt | null {
    const a = this.f32(pos);
    const b = this.f32(pos + 4);
    return a === null || b === null ? null : [a, b];
  }

  floatArray(pos: number, count: number): number[] | null {
    const values: number[] = [];
    for (let i = 0; i < count; i++) {
      const v = this.f32(pos + i * 4);
      if (v === null) return null;
      values.push(v);
    }
    return values;
  }

  /** Four bytes of a struct field, as RGBA. */
  rgbaField(table: number, index: number): Rgba | null {
    const field = this.field(table, index);
    return field === null ? null : this.rgbaAt(field);
  }

  rgbaAt(pos: number): Rgba | null {
    const b = this.slice(pos, 4);
    return b === null ? null : [b[0], b[1], b[2], b[3]];
  }
}

/**
 * An ink path, decoded: its points in document units and per-sample
 * pressures and width multipliers. A cubic path has 3m + 1 points (anchor,
 * control, control, anchor, …); a linear one is a polyline.
 */
export interface DecodedInk {
  points: Pt[];
  cubic: boolean;
  pressures: number[];
  fractions: number[];
}

/** An ink path's bytes, decoded (`null` when they do not parse). */
export function decodeInkPath(data: Uint8Array, origin: Pt, scale: Pt): DecodedInk[] | null {
  if (data.length < 8) return null;
  const precision = data[0];
  const sampleCount = data[1] | (data[2] << 8);
  const pathKind = data[3];
  if (sampleCount === 0 || (precision !== 0 && precision !== 1)) return null;
  const scalarSize = precision === 0 ? 2 : 4;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const readScalar = (offset: number): number | null => {
    if (offset < 0 || offset + scalarSize > data.length) return null;
    return precision === 0 ? f16ToF32(view.getUint16(offset, true)) : view.getFloat32(offset, true);
  };
  const readHalf = (offset: number): number =>
    offset >= 0 && offset + 2 <= data.length ? f16ToF32(view.getUint16(offset, true)) : 1;

  const paths: DecodedInk[] = [];
  let cursor = precision === 0 ? 8 : 12;

  if (pathKind === 7) {
    let points: Pt[] = [origin];
    for (let i = 1; i < sampleCount; i++) {
      if (cursor >= data.length) return null;
      const command = data[cursor];
      const x = readScalar(cursor + 1);
      const y = readScalar(cursor + 1 + scalarSize);
      if (x === null || y === null) return null;
      const point: Pt = [origin[0] + x * scale[0], origin[1] + y * scale[1]];
      if (command === 6) {
        points.push(point);
      } else if (command === 7) {
        if (points.length >= 2) paths.push({ points, cubic: false, pressures: [], fractions: [] });
        points = [point];
      } else {
        return null;
      }
      cursor += 1 + scalarSize * 2;
    }
    if (points.length >= 2 || sampleCount === 1) {
      paths.push({ points, cubic: false, pressures: [], fractions: [] });
    }
    return paths;
  }

  if (pathKind !== 3) return null;

  let points: Pt[] = [origin];
  let pressures: number[] = [];
  let fractions: number[] = [];
  for (let i = 1; i < sampleCount; i++) {
    pressures.push(readHalf(cursor));
    fractions.push(readHalf(cursor + 2));
    if (cursor + 6 >= data.length) return null;
    const command = data[cursor + 6];
    const count = command === 0 ? 6 : command === 3 ? 2 : -1;
    if (count < 0) return null;
    const values: number[] = [];
    for (let c = 0; c < count; c++) {
      const v = readScalar(cursor + 7 + c * scalarSize);
      if (v === null) return null;
      values.push(v);
    }
    if (command === 0) {
      points.push(
        [origin[0] + values[0] * scale[0], origin[1] + values[1] * scale[1]],
        [origin[0] + values[2] * scale[0], origin[1] + values[3] * scale[1]],
        [origin[0] + values[4] * scale[0], origin[1] + values[5] * scale[1]],
      );
    } else {
      if (points.length >= 2) paths.push({ points, cubic: true, pressures, fractions });
      points = [[origin[0] + values[0] * scale[0], origin[1] + values[1] * scale[1]]];
      pressures = [];
      fractions = [];
    }
    cursor += 7 + count * scalarSize;
  }
  pressures.push(readHalf(cursor));
  fractions.push(readHalf(cursor + 2));
  if (points.length >= 2 || sampleCount === 1) {
    paths.push({ points, cubic: true, pressures, fractions });
  }
  return paths;
}

/** Points turned about `origin` by `angle` radians. */
function rotatePoints(points: Pt[], origin: Pt, angle: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const point of points) {
    const x = point[0] - origin[0];
    const y = point[1] - origin[1];
    point[0] = origin[0] + x * cos - y * sin;
    point[1] = origin[1] + x * sin + y * cos;
  }
}

/** A rotated box's unrotated top-left corner: the file keeps the visible one. */
export function unrotateTopLeft(rotatedTopLeft: Pt, size: Pt, rotation: number): Pt {
  const halfWidth = size[0] * 0.5;
  const halfHeight = size[1] * 0.5;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    rotatedTopLeft[0] - halfWidth + halfWidth * cos - halfHeight * sin,
    rotatedTopLeft[1] - halfHeight + halfWidth * sin + halfHeight * cos,
  ];
}

/** An ellipse as 13 cubic points (a closed path of four Béziers). */
function ellipsePoints(center: Pt, rx: number, ry: number): Pt[] {
  const k = 0.5522848;
  const [cx, cy] = center;
  return [
    [cx + rx, cy],
    [cx + rx, cy + ry * k],
    [cx + rx * k, cy + ry],
    [cx, cy + ry],
    [cx - rx * k, cy + ry],
    [cx - rx, cy + ry * k],
    [cx - rx, cy],
    [cx - rx, cy - ry * k],
    [cx - rx * k, cy - ry],
    [cx, cy - ry],
    [cx + rx * k, cy - ry],
    [cx + rx, cy - ry * k],
    [cx + rx, cy],
  ];
}

// --- The note's model -----------------------------------------------------------

/** How a run of text looks. */
interface Style {
  fontSize: number;
  fontName: string;
  lineSpacingMultiplier: number;
  color: Rgba;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  indentLevel?: number;
  indentDecorationStyle?: number;
  indentDecorationNumber?: number;
}

/** A style over `length` characters (code points) from `start`. */
interface Span {
  start: number;
  length: number;
  style: Style;
}

interface Curve {
  page: number;
  /** Points in document units, measured from the content's left edge. */
  points: Pt[];
  cubic: boolean;
  width: number;
  colour: Rgba;
  tool: number;
  /** A line or a shape from a shape event; a stroke from ink otherwise. */
  shape: boolean;
  dashed: boolean;
  pressures: number[];
  fractions: number[];
}

interface Picture {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** The asset's entry path under the note, when the note has it. */
  asset: string | null;
  /** The asset's pixel size as the note says it, and the part of it shown. */
  logical: Pt | null;
  crop: [number, number, number, number] | null;
}

interface Sticky {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  colour: Rgba;
  ruled: boolean;
}

interface TextBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  text: string;
  spans: Span[];
  z: number;
}

interface Note {
  paperWidth: number;
  paperHeight: number;
  lineSpacing: number | undefined;
  defaultStyle: Style;
  curves: Curve[];
  pictures: Picture[];
  stickies: Sticky[];
  boxes: TextBox[];
  body: { text: string; spans: Span[] };
  /** Characters of text in containers the note never places: left out, and said so. */
  unplaced: number;
  /** The page each CreatePage event made, in order: its PDF, by path under the note, when it has one. */
  pageAssets: Array<string | null>;
  /** Each of those pages' size in points, as the CreatePage event states it, when it does. */
  pageSizes: Array<Pt | null>;
  /** Every asset the note holds, by its hash in hex, as a path under the note. */
  assets: Map<string, string>;
}

/** The page a position field names: the index at offset 8 of the field. */
function pageIndexOf(flat: FlatBuffer, table: number, index: number): number {
  const field = flat.field(table, index);
  if (field === null) return 0;
  return flat.u32(field + 8) ?? 0;
}

/** The position an event id names (two words), or `null`. */
function eventIdOf(flat: FlatBuffer, table: number, slot: number): string | null {
  const field = flat.field(table, slot);
  if (field === null) return null;
  const a = flat.u32(field);
  const b = flat.u32(field + 4);
  return a !== null && b !== null ? `${a}:${b}` : null;
}

function eventTypeOf(flat: FlatBuffer, event: number): number | null {
  const field = flat.field(event, 4);
  return field === null ? null : flat.u8(field);
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A vector of 8-byte ids at a payload's field (DeleteEntities' lists, the
 * `blocks`, `inks` and `shapes` of the Modify events), each as {@link eventIdOf}
 * writes it.
 */
function idVector(flat: FlatBuffer, payload: number, slot: number): string[] {
  const list = flat.offsetField(payload, slot);
  const count = list === null ? null : flat.u32(list);
  const ids: string[] = [];
  if (list === null || count === null) return ids;
  for (let i = 0; i < count; i++) {
    const a = flat.u32(list + 4 + i * 8);
    const b = flat.u32(list + 8 + i * 8);
    if (a === null || b === null) break;
    ids.push(`${a}:${b}`);
  }
  return ids;
}

/**
 * The ids that are deleted once DeleteEntities events (25) have all been
 * played, in the order of the log: ink, shapes, blocks and recordings that
 * were made and then deleted (field 0), less those an undo brought back
 * (field 1). Notability keeps the creating event, so a reader that skips this
 * brings every deleted thing back.
 */
export function deletedIds(flat: FlatBuffer, events: readonly number[]): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (eventTypeOf(flat, event) !== EVENT_DELETE_ENTITIES) continue;
    const payload = flat.offsetField(event, 5);
    if (payload === null) continue;
    for (const id of idVector(flat, payload, 0)) ids.add(id);
    for (const id of idVector(flat, payload, 1)) ids.delete(id);
  }
  return ids;
}

/**
 * What later events changed about a block, an ink stroke or a shape: its
 * page, place, turn, scale or size, and the colour and width of a pen mark.
 * Only what an event states is set; the creating event keeps the rest.
 */
interface PlacementEdit {
  page?: number;
  origin?: Pt;
  rotation?: number;
  scale?: Pt;
  size?: Pt;
  z?: number;
  colour?: Rgba;
  width?: number;
}

/** The float in a one-field table (SetFloat), or `undefined`. */
function setFloatAt(flat: FlatBuffer, payload: number, slot: number): number | undefined {
  const table = flat.offsetField(payload, slot);
  const field = table === null ? null : flat.field(table, 0);
  return field === null ? undefined : (flat.f32(field) ?? undefined);
}

/** The pair in a one-field table (SetSize), or `undefined`. */
function setPairAt(flat: FlatBuffer, payload: number, slot: number): Pt | undefined {
  const table = flat.offsetField(payload, slot);
  return table === null ? undefined : (flat.pairField(table, 0) ?? undefined);
}

/** The place, turn, scale and z order a Modify table states (the same slots in ModifyPosition and ModifyInk). */
function editFrom(
  flat: FlatBuffer,
  table: number,
  slots: { page: number; origin: number; rotation: number; scale: number; z: number },
): PlacementEdit {
  const edit: PlacementEdit = {};
  const pageField = flat.field(table, slots.page);
  const page = pageField === null ? null : flat.u32(pageField + 8);
  if (page !== null) edit.page = page;
  const origin = flat.pairField(table, slots.origin);
  if (origin) edit.origin = origin;
  const rotation = setFloatAt(flat, table, slots.rotation);
  if (rotation !== undefined) edit.rotation = rotation;
  const scale = setPairAt(flat, table, slots.scale);
  if (scale) edit.scale = scale;
  const zField = flat.field(table, slots.z);
  const z = zField === null ? null : flat.u64(zField);
  if (z !== null) edit.z = Number(z);
  return edit;
}

/**
 * The edits the log makes after the creating events, by id, folded in the
 * order of the log: ModifyBlock (23), ModifyPositions (24), ModifyInk (17) and
 * ModifyShape (19). A later edit of a field wins.
 */
function placementEdits(flat: FlatBuffer, events: readonly number[]): Map<string, PlacementEdit> {
  const edits = new Map<string, PlacementEdit>();
  const apply = (id: string, edit: PlacementEdit): void => {
    edits.set(id, { ...edits.get(id), ...edit });
  };
  for (const event of events) {
    const type = eventTypeOf(flat, event);
    const payload = flat.offsetField(event, 5);
    if (payload === null) continue;
    if (type === EVENT_MODIFY_POSITIONS) {
      const list = flat.tableVector(payload, 0) ?? [];
      for (const item of list) {
        const id = eventIdOf(flat, item, 0);
        if (id === null) continue;
        apply(id, editFrom(flat, item, { page: 1, origin: 2, rotation: 3, scale: 4, z: 5 }));
      }
    } else if (type === EVENT_MODIFY_BLOCK) {
      const edit = editFrom(flat, payload, { page: 2, origin: 3, rotation: 4, scale: 5, z: 9 });
      const size = flat.pairField(payload, 6);
      if (size) edit.size = size;
      for (const id of idVector(flat, payload, 0)) apply(id, edit);
    } else if (type === EVENT_MODIFY_INK || type === EVENT_MODIFY_SHAPE) {
      const ink = type === EVENT_MODIFY_INK;
      const edit = editFrom(flat, payload, { page: 1, origin: 2, rotation: 3, scale: 4, z: 13 });
      const colour = flat.rgbaField(payload, ink ? 6 : 10);
      if (colour) edit.colour = colour;
      const widthField = flat.field(payload, ink ? 7 : 11);
      const width = widthField === null ? null : flat.f32(widthField);
      if (width !== null) edit.width = width;
      for (const id of idVector(flat, payload, 0)) apply(id, edit);
    }
  }
  return edits;
}

/** The z order of a payload: its u64 at field 9, else the event's place. */
function zOrderOf(flat: FlatBuffer, payload: number, fallback: number): number {
  const field = flat.field(payload, 9);
  const value = field === null ? null : flat.u64(field);
  return value === null ? fallback : Number(value);
}

function defaultStyle(): Style {
  return {
    fontSize: 12,
    fontName: "Helvetica",
    lineSpacingMultiplier: 1,
    color: BLACK,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
  };
}

/** Reads a note's `noteBundle` and its assets. */
function parseNote(files: ReadonlyMap<string, Uint8Array>, root: string): Note {
  const bundle = files.get(`${root}noteBundle`);
  if (!bundle) throw new NtbError("the note has no noteBundle");
  const flat = new FlatBuffer(bundle);
  const top = flat.rootTable();
  const events = top === null ? null : flat.tableVector(top, 6);
  if (events === null) throw new NtbError("the note's event list could not be read");

  const assets = new Map<string, string>();
  for (const path of files.keys()) {
    if (!path.startsWith(`${root}assets/`)) continue;
    const name = path.slice(root.length + "assets/".length);
    const hash = name.split(".")[0];
    if (/^[0-9a-f]{128}$/i.test(hash)) assets.set(hash.toLowerCase(), path.slice(root.length));
  }
  const assetFor = (hash: Uint8Array): string | null => assets.get(hexOf(hash)) ?? null;

  let paperWidth = DEFAULT_PAPER_WIDTH;
  let paperHeight = DEFAULT_PAPER_HEIGHT;
  let lineSpacing: number | undefined;
  const style = defaultStyle();
  const curves: Curve[] = [];
  const pictures: Picture[] = [];
  const stickies: Sticky[] = [];
  const pageAssets: Array<string | null> = [];
  const pageSizes: Array<Pt | null> = [];
  const deleted = deletedIds(flat, events);
  const edits = placementEdits(flat, events);

  // The paper settings may come after the things placed on it: read them first.
  const ordered = [
    ...events.filter((event) => eventTypeOf(flat, event) === EVENT_DOCUMENT),
    ...events.filter((event) => eventTypeOf(flat, event) !== EVENT_DOCUMENT),
  ];

  for (const event of ordered) {
    const type = eventTypeOf(flat, event);
    const payload = flat.offsetField(event, 5);
    if (type === null || payload === null) continue;
    const id = eventIdOf(flat, event, 0);
    if (id !== null && deleted.has(id)) continue;
    const inset = paperWidth * CONTENT_INSET_RATIO;
    const edit = id === null ? undefined : edits.get(id);
    switch (type) {
      case EVENT_DOCUMENT: {
        const fontName = flat.stringField(payload, 4);
        if (fontName) style.fontName = fontName;
        const sizeField = flat.field(payload, 5);
        const size = sizeField === null ? null : flat.f32(sizeField);
        if (size !== null && Number.isFinite(size) && size > 0) style.fontSize = size;
        const paperRef = flat.offsetField(payload, 1);
        const paper = paperRef === null ? null : flat.offsetField(paperRef, 0);
        if (paper !== null) {
          const dims = flat.pairField(paper, 3);
          if (dims && [...dims].every((v) => Number.isFinite(v) && v > 0)) {
            paperWidth = dims[0];
            paperHeight = dims[1];
          }
          const paperStyle = flat.offsetField(paper, 0);
          const spacingField = paperStyle === null ? null : flat.field(paperStyle, 1);
          const spacing = spacingField === null ? null : flat.f32(spacingField);
          if (spacing !== null && Number.isFinite(spacing) && spacing > 0) lineSpacing = spacing;
        }
        break;
      }
      case EVENT_CREATE_PAGE:
        pageAssets.push(pageAssetOf(flat, payload, assetFor));
        pageSizes.push(pageSizeOf(flat, payload));
        break;
      case EVENT_CREATE_BLOCK: {
        const picture = pictureOf(flat, payload, inset, assetFor, edit);
        if (picture) {
          pictures.push(picture);
          break;
        }
        const sticky = stickyOf(flat, payload, inset, edit);
        if (sticky) stickies.push(sticky);
        break;
      }
      case EVENT_CREATE_INK:
        curves.push(...inkCurves(flat, payload, inset, edit));
        break;
      case EVENT_CREATE_SHAPE: {
        const curve = shapeCurve(flat, payload, inset, edit);
        if (curve) curves.push(curve);
        break;
      }
      default:
        break;
    }
  }

  const text = readText(flat, events, style, paperWidth * CONTENT_INSET_RATIO, deleted, edits);

  return {
    paperWidth,
    paperHeight,
    lineSpacing,
    defaultStyle: style,
    curves,
    pictures,
    stickies,
    boxes: text.boxes,
    body: text.body,
    unplaced: text.unplaced,
    pageAssets,
    pageSizes,
    assets,
  };
}

/**
 * The asset a CreatePage event's page is drawn from, as a path under the
 * note: the hash at `payload.1.1.0.0`, where a page of a PDF keeps it.
 */
function pageAssetOf(
  flat: FlatBuffer,
  payload: number,
  assetFor: (hash: Uint8Array) => string | null,
): string | null {
  const first = flat.offsetField(payload, 1);
  const second = first === null ? null : flat.offsetField(first, 1);
  const asset = second === null ? null : flat.offsetField(second, 0);
  const hashField = asset === null ? null : flat.field(asset, 0);
  const hash = hashField === null ? null : flat.slice(hashField, 64);
  return hash ? assetFor(hash) : null;
}

/**
 * A CreatePage event's page size in points (`payload.1.3`): the size of the
 * PDF page it shows, rounded, or the paper's for a page with no PDF.
 */
function pageSizeOf(flat: FlatBuffer, payload: number): Pt | null {
  const first = flat.offsetField(payload, 1);
  const size = first === null ? null : flat.pairField(first, 3);
  return size && size.every((v) => Number.isFinite(v) && v > 0) ? size : null;
}

/** A picture (ImageMediaObject-like block) on its page, or `null` for anything else. */
function pictureOf(
  flat: FlatBuffer,
  payload: number,
  inset: number,
  assetFor: (hash: Uint8Array) => string | null,
  edit?: PlacementEdit,
): Picture | null {
  const media = flat.offsetField(payload, 10);
  const asset = media === null ? null : flat.offsetField(media, 0);
  if (media === null || asset === null) return null;
  const hashField = flat.field(asset, 0);
  const hash = hashField === null ? null : flat.slice(hashField, 64);
  const mime = flat.stringField(asset, 2) ?? "image/jpeg";
  if (!hash || !mime.startsWith("image/")) return null;
  const at = edit?.origin ?? flat.pairField(payload, 3);
  const size = edit?.size ?? flat.pairField(payload, 6);
  if (!at || !size) return null;
  const rotation = flat.field(payload, 4);
  const angle = edit?.rotation ?? (rotation === null ? 0 : (flat.f32(rotation) ?? 0));
  const [x, y] = unrotateTopLeft([at[0] - inset, at[1]], size, angle);
  const logical = flat.pairField(media, 1);
  let crop: [number, number, number, number] | null = null;
  const cropField = flat.field(payload, 11);
  const values = cropField === null ? null : flat.floatArray(cropField, 4);
  if (values && values[2] > 0 && values[3] > 0) {
    const whole =
      logical !== null &&
      values[0] <= 0.5 &&
      values[1] <= 0.5 &&
      values[0] + values[2] >= logical[0] - 0.5 &&
      values[1] + values[3] >= logical[1] - 0.5;
    if (!whole) crop = [values[0], values[1], values[2], values[3]];
  }
  return {
    page: edit?.page ?? pageIndexOf(flat, payload, 2),
    x,
    y,
    w: size[0],
    h: size[1],
    rotation: angle,
    asset: assetFor(hash),
    logical,
    crop,
  };
}

/**
 * A sticky note: a paper with no picture in it (the media block has no asset)
 * and a colour of its own. Every text box is a block with a paper too, but its
 * paper has no colour (it is transparent): in a real library of 199 notes, 894 papers
 * had none and the one real sticky note had one. Taking a colourless paper for
 * a sticky painted every text box as a solid yellow rectangle.
 */
function stickyOf(
  flat: FlatBuffer,
  payload: number,
  inset: number,
  edit?: PlacementEdit,
): Sticky | null {
  const paper = flat.offsetField(payload, 15);
  const at = edit?.origin ?? flat.pairField(payload, 3);
  const size = edit?.size ?? flat.pairField(payload, 6);
  if (paper === null || !at || !size) return null;
  const colour = flat.rgbaField(paper, 4);
  if (colour === null) return null;
  const ruling = flat.field(paper, 1);
  const spacing = ruling === null ? null : flat.f32(ruling);
  return {
    page: edit?.page ?? pageIndexOf(flat, payload, 2),
    x: at[0] - inset,
    y: at[1],
    w: size[0],
    h: size[1],
    colour,
    ruled: spacing !== null && spacing > 0,
  };
}

/** The strokes of an ink event: one curve per path the bytes hold. */
function inkCurves(
  flat: FlatBuffer,
  payload: number,
  inset: number,
  edit?: PlacementEdit,
): Curve[] {
  const origin = edit?.origin ?? flat.pairField(payload, 1);
  if (!origin) return [];
  const rawScale = edit?.scale ?? flat.pairField(payload, 3);
  const scaleOk =
    rawScale !== null &&
    rawScale.every((v) => Number.isFinite(v)) &&
    Math.abs(rawScale[0]) > 1e-6 &&
    Math.abs(rawScale[1]) > 1e-6;
  const scale: Pt = scaleOk && rawScale ? rawScale : [1, 1];
  const encoded = flat.byteVector(payload, 9);
  if (!encoded) return [];
  const strokeOrigin: Pt = [origin[0] - inset, origin[1]];
  const decoded = decodeInkPath(encoded, strokeOrigin, scale);
  if (!decoded) return [];
  const rotationField = flat.field(payload, 2);
  const rotation = edit?.rotation ?? (rotationField === null ? 0 : (flat.f32(rotationField) ?? 0));
  const widthField = flat.field(payload, 8);
  const width = edit?.width ?? (widthField === null ? null : flat.f32(widthField));
  if (width === null) return [];
  const strokeScale = (Math.abs(scale[0]) + Math.abs(scale[1])) * 0.5;
  const toolField = flat.field(payload, 4);
  const tool = toolField === null ? 0 : (flat.u8(toolField) ?? 0);
  const lineField = flat.field(payload, 5);
  const lineStyle = lineField === null ? 1 : (flat.u8(lineField) ?? 1);
  const colour = edit?.colour ?? flat.rgbaField(payload, 7) ?? BLACK;
  const page = edit?.page ?? pageIndexOf(flat, payload, 0);
  return decoded.map((path) => {
    if (Math.abs(rotation) > 1e-6) rotatePoints(path.points, strokeOrigin, rotation);
    return {
      page,
      points: path.points,
      cubic: path.cubic,
      width: width * strokeScale * (tool === TOOL_PENCIL ? PENCIL_WIDTH_SCALE : 1),
      colour,
      tool,
      shape: false,
      dashed: lineStyle > 1,
      pressures: path.pressures,
      fractions: path.fractions,
    };
  });
}

/** A line, a polygon or an ellipse drawn with the shape tool. */
function shapeCurve(
  flat: FlatBuffer,
  payload: number,
  inset: number,
  edit?: PlacementEdit,
): Curve | null {
  const rawOrigin = edit?.origin ?? flat.pairField(payload, 1);
  const shape = flat.offsetField(payload, 5);
  const kindField = flat.field(payload, 4);
  const kind = kindField === null ? null : flat.u8(kindField);
  if (!rawOrigin || shape === null || kind === null) return null;
  const origin: Pt = [rawOrigin[0] - inset, rawOrigin[1]];
  let points: Pt[];
  let cubic: boolean;
  if (kind === 1) {
    const start = flat.pairField(shape, 0) ?? [0, 0];
    const end = flat.pairField(shape, 3);
    if (!end) return null;
    const a: Pt = [origin[0] + start[0], origin[1] + start[1]];
    const b: Pt = [origin[0] + end[0], origin[1] + end[1]];
    const control = flat.pairField(shape, 1);
    if (!control) {
      points = [a, b];
      cubic = false;
    } else {
      const c: Pt = [origin[0] + control[0], origin[1] + control[1]];
      const c1: Pt = [a[0] + (c[0] - a[0]) * (2 / 3), a[1] + (c[1] - a[1]) * (2 / 3)];
      const c2: Pt = [b[0] + (c[0] - b[0]) * (2 / 3), b[1] + (c[1] - b[1]) * (2 / 3)];
      points = [a, c1, c2, b];
      cubic = true;
    }
  } else if (kind === 2) {
    const relative = flat.pointVector(shape, 0);
    if (!relative || relative.length === 0) return null;
    points = relative.map((p): Pt => [p[0] + origin[0], p[1] + origin[1]]);
    const first = points[0];
    const last = points[points.length - 1];
    if (points.length >= 3 && (first[0] !== last[0] || first[1] !== last[1]))
      points.push([first[0], first[1]]);
    cubic = false;
  } else if (kind === 3) {
    const dims = flat.pairField(shape, 1);
    if (!dims) return null;
    points = ellipsePoints(
      [origin[0] + dims[0] * 0.5, origin[1] + dims[1] * 0.5],
      Math.abs(dims[0]) * 0.5,
      Math.abs(dims[1]) * 0.5,
    );
    cubic = true;
  } else {
    return null;
  }
  const rotationField = flat.field(payload, 2);
  const rotation = edit?.rotation ?? (rotationField === null ? 0 : (flat.f32(rotationField) ?? 0));
  if (Math.abs(rotation) > 1e-6) rotatePoints(points, origin, rotation);
  const widthField = flat.field(payload, 10);
  const width = edit?.width ?? (widthField === null ? null : flat.f32(widthField));
  if (width === null) return null;
  const toolField = flat.field(payload, 6);
  const tool = toolField === null ? 0 : (flat.u8(toolField) ?? 0);
  const dashField = flat.field(payload, 7);
  const dash = dashField === null ? 1 : (flat.u8(dashField) ?? 1);
  return {
    page: edit?.page ?? pageIndexOf(flat, payload, 0),
    points,
    cubic,
    width,
    colour: edit?.colour ?? flat.rgbaField(payload, 9) ?? BLACK,
    tool,
    shape: true,
    dashed: dash > 1,
    pressures: [],
    fractions: [],
  };
}

// --- Text ----------------------------------------------------------------------

interface TextStylePatch {
  /** Put the run back to the note's default look before the other fields apply. */
  clear?: boolean;
  fontSize?: number;
  fontName?: string;
  colour?: Rgba;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

interface ParagraphPatch {
  /** Put the paragraph back to the default (no list, no indent) before the other fields apply. */
  clear?: boolean;
  indentLevel?: number;
  lineSpacingMultiplier?: number;
  decorationStyle?: number;
}

interface Ranged<T> {
  start: number;
  end: number;
  patch: T;
}

/**
 * A character's id: the operation that typed it, and its place in that
 * operation's string (an InsertChar's one character is at 0). This is the
 * schema's `SeqId` struct: a u16 site, a u32 time and a u32 index, 12 bytes.
 */
interface CharId {
  site: number;
  time: number;
  index: number;
}

/** An operation's own id (the schema's `Id`: a u16 site and a u32 time). */
interface OpStamp {
  site: number;
  time: number;
}

/** The root of every text container's tree: the schema's site `0xffff`, time 0. */
const ROOT_ID: CharId = { site: 0xffff, time: 0, index: 0 };

/** One typed character in a container's tree. */
interface CharNode {
  id: CharId;
  /** The id of the container (the document, or a block) the character is in. */
  container: string;
  ch: string;
  /** Characters typed straight after this one, newest first. */
  children: CharNode[];
  /** The Remove or Revive that last said whether the character is shown. */
  decidedBy: OpStamp | null;
  removed: boolean;
}

/** An insert of characters into a container. */
interface InsertOp {
  kind: "insert";
  stamp: OpStamp;
  container: string;
  /** The character it goes after; `null` for the start of the container. */
  anchor: CharId | null;
  chars: string[];
}

/** A removal or a revival of characters. */
interface MarkOp {
  kind: "remove" | "revive";
  stamp: OpStamp;
  targets: CharId[];
}

/** Every container's characters: the trees by container, and every node by id. */
interface Forest {
  roots: Map<string, CharNode>;
  nodes: Map<string, CharNode>;
}

function charKey(id: CharId): string {
  return `${id.site}:${id.time}:${id.index}`;
}

/**
 * Whether `a` sorts before `b` in Notability's order for ids: by time, then
 * site, then, within one operation's string, the later character first.
 */
function charIdLess(a: CharId, b: CharId): boolean {
  if (a.time !== b.time) return a.time < b.time;
  if (a.site !== b.site) return a.site < b.site;
  return a.index > b.index;
}

function stampLater(a: OpStamp, b: OpStamp): boolean {
  return a.time !== b.time ? a.time > b.time : a.site > b.site;
}

/** The 12-byte `SeqId` at a position. */
function charIdAt(flat: FlatBuffer, pos: number): CharId | null {
  const site = flat.u16(pos);
  const time = flat.u32(pos + 4);
  const index = flat.u32(pos + 8);
  return site === null || time === null || index === null ? null : { site, time, index };
}

/** The `SeqId` struct a payload has in a field, or `null`. */
function charIdField(flat: FlatBuffer, table: number, slot: number): CharId | null {
  const field = flat.field(table, slot);
  return field === null ? null : charIdAt(flat, field);
}

/** The `SeqId` structs of a vector field (RemoveChars, ReviveChars: field 0). */
function charIdVector(flat: FlatBuffer, table: number, slot: number): CharId[] {
  const list = flat.offsetField(table, slot);
  const count = list === null ? null : flat.u32(list);
  const ids: CharId[] = [];
  if (list === null || count === null) return ids;
  for (let i = 0; i < count; i++) {
    const id = charIdAt(flat, list + 4 + i * 12);
    if (id === null) break;
    ids.push(id);
  }
  return ids;
}

/** The id an event carries in its field 0. */
function stampOf(flat: FlatBuffer, event: number): OpStamp | null {
  const field = flat.field(event, 0);
  const site = field === null ? null : flat.u16(field);
  const time = field === null ? null : flat.u32(field + 4);
  return site === null || time === null ? null : { site, time };
}

function rootOf(forest: Forest, container: string): CharNode {
  let root = forest.roots.get(container);
  if (!root) {
    root = { id: ROOT_ID, container, ch: "", children: [], decidedBy: null, removed: false };
    forest.roots.set(container, root);
  }
  return root;
}

/**
 * Plays an insert: the characters go in as a run after their anchor, before
 * the anchor's older children (those with a smaller id), as the app's tree
 * does. `false` when the anchor has not been typed yet.
 */
function playInsert(forest: Forest, op: InsertOp): boolean {
  const parent =
    op.anchor === null ? rootOf(forest, op.container) : forest.nodes.get(charKey(op.anchor));
  if (!parent) return false;
  if (op.chars.length === 0) return true;
  const run: CharNode[] = op.chars.map((ch, index) => ({
    id: { site: op.stamp.site, time: op.stamp.time, index },
    container: parent.container,
    ch,
    children: [],
    decidedBy: null,
    removed: false,
  }));
  if (forest.nodes.has(charKey(run[0].id))) return true;
  const last = run[run.length - 1].id;
  let at = 0;
  while (at < parent.children.length && !charIdLess(parent.children[at].id, last)) at++;
  parent.children = parent.children.slice(0, at).concat(run, parent.children.slice(at));
  for (const node of run) forest.nodes.set(charKey(node.id), node);
  return true;
}

/**
 * Plays a Remove or Revive: each character takes the state of the latest
 * operation (by id) that named it. Without `loose`, `false` when a target has
 * not been typed yet; with it, the targets that exist are marked.
 */
function playMark(forest: Forest, op: MarkOp, loose: boolean): boolean {
  const nodes = op.targets.map((id) => forest.nodes.get(charKey(id)));
  if (!loose && nodes.some((node) => node === undefined)) return false;
  for (const node of nodes) {
    if (!node) continue;
    if (node.decidedBy === null || stampLater(op.stamp, node.decidedBy)) {
      node.decidedBy = op.stamp;
      node.removed = op.kind === "remove";
    }
  }
  return true;
}

/**
 * Replays the typing of every container. Operations whose characters are not
 * there yet wait for them; those that never get them are applied to what is
 * there. Returns the characters of the inserts that never found their anchor.
 */
function replayText(forest: Forest, ops: ReadonlyArray<InsertOp | MarkOp>): number {
  let pending = [...ops];
  while (pending.length > 0) {
    const waiting = pending.filter((op) =>
      op.kind === "insert" ? !playInsert(forest, op) : !playMark(forest, op, false),
    );
    const stuck = waiting.length === pending.length;
    pending = waiting;
    if (stuck) break;
  }
  let lost = 0;
  for (const op of pending) {
    if (op.kind === "insert") lost += op.chars.length;
    else playMark(forest, op, true);
  }
  return lost;
}

/** One container's characters in reading order, with what style ranges need to map ids to text. */
interface Sequence {
  /** Every character, removed ones too, in order. */
  nodes: CharNode[];
  /** The index in `nodes` of a character by its key. */
  indexOf: Map<string, number>;
  /** For each index in `nodes` (and one past the end), how many shown characters come before it. */
  shownBefore: number[];
  /** The UTF-16 offset of each shown character (and of the end) in `text`. */
  unitStart: number[];
  /** What is shown. */
  text: string;
  /** The code-point index of each UTF-16 offset of `text` (and of its end). */
  codePointAt: number[];
}

function sequenceOf(root: CharNode): Sequence {
  const nodes: CharNode[] = [];
  const stack = [...root.children].reverse();
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    nodes.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  const indexOf = new Map<string, number>();
  const shownBefore: number[] = [];
  const unitStart: number[] = [];
  const pieces: string[] = [];
  let units = 0;
  nodes.forEach((node, i) => {
    indexOf.set(charKey(node.id), i);
    shownBefore.push(unitStart.length);
    if (node.removed) return;
    unitStart.push(units);
    pieces.push(node.ch);
    units += node.ch.length;
  });
  shownBefore.push(unitStart.length);
  unitStart.push(units);
  // U+2028, Notability's line break inside a paragraph, is one unit like the newline it becomes.
  const text = pieces.join("").replace(/\u2028/g, "\n");
  const codePointAt: number[] = [];
  let k = 0;
  for (const ch of text) {
    for (let u = 0; u < ch.length; u++) codePointAt.push(k);
    k++;
  }
  codePointAt.push(k);
  return { nodes, indexOf, shownBefore, unitStart, text, codePointAt };
}

/**
 * A style range's end: a character's id and the boundary type. A range runs
 * from its start (a "before" start is the character itself) up to its end (a
 * "before" end is not included, an "after" end is).
 */
interface Boundary {
  id: CharId;
  type: number;
}

/** The 16-byte `Boundary` struct (a `SeqId` and an i8 type) in a field. */
function boundaryField(flat: FlatBuffer, table: number, slot: number): Boundary | null {
  const field = flat.field(table, slot);
  const id = field === null ? null : charIdAt(flat, field);
  const type = field === null ? null : flat.u8(field + 12);
  return id === null || type === null ? null : { id, type };
}

/** A style operation: the range it covers, and the patch to put on it. */
type StyleOp = {
  start: Boundary;
  end: Boundary;
  /** The container the operation names, for a range with no character to go by. */
  container: string;
} & ({ paragraph: false; patch: TextStylePatch } | { paragraph: true; patch: ParagraphPatch });

/**
 * Where a boundary falls among a container's characters, counting removed
 * ones: a "before" boundary is at its character, an "after" one just past it.
 */
function boundaryIndex(sequence: Sequence, boundary: Boundary, isEnd: boolean): number | null {
  switch (boundary.type) {
    case BOUNDARY_START_OF_DOC:
      return isEnd ? null : 0;
    case BOUNDARY_END_OF_DOC:
      return sequence.nodes.length;
    case BOUNDARY_BEFORE:
    case BOUNDARY_AFTER: {
      const at = sequence.indexOf.get(charKey(boundary.id));
      return at === undefined ? null : at + (boundary.type === BOUNDARY_AFTER ? 1 : 0);
    }
    default:
      return null;
  }
}

/** The code-point range of a container's shown text that a style operation covers. */
function styledRange(
  forest: Forest,
  sequences: ReadonlyMap<string, Sequence>,
  op: StyleOp,
): { container: string; start: number; end: number } | null {
  const named = [op.start, op.end]
    .filter((b) => b.type === BOUNDARY_BEFORE || b.type === BOUNDARY_AFTER)
    .map((b) => forest.nodes.get(charKey(b.id))?.container)
    .find((c) => c !== undefined);
  const container = named ?? op.container;
  const sequence = sequences.get(container);
  if (!sequence) return null;
  const from = boundaryIndex(sequence, op.start, false);
  const to = boundaryIndex(sequence, op.end, true);
  if (from === null || to === null || to < from) return null;
  const codePoint = (index: number): number =>
    sequence.codePointAt[sequence.unitStart[sequence.shownBefore[index]]];
  return { container, start: codePoint(from), end: codePoint(to) };
}

/** The character a code point (the InsertChar's u32) is, tolerating a value that is none. */
function charOf(scalar: number): string {
  return scalar <= 0x10ffff ? String.fromCodePoint(scalar) : "\ufffd";
}

/** What a container's style operations put on its text. */
interface StyleRanges {
  chars: Ranged<TextStylePatch>[];
  paragraphs: Ranged<ParagraphPatch>[];
}

/**
 * The note's text: the typed text, and the text boxes (blocks that are text
 * containers). The note is an operation log, replayed here as Notability
 * does: InsertChar (7) and InsertString (8) put characters after an earlier
 * character (or at the start of their container, the document or a block);
 * RemoveChar (9) and RemoveChars (10) hide characters and ReviveChars (11)
 * shows them again. Style ranges (12, 13, 14) run between two characters, so
 * they are mapped to the text that is left.
 */
function readText(
  flat: FlatBuffer,
  events: number[],
  base: Style,
  inset: number,
  deleted: ReadonlySet<string>,
  edits: ReadonlyMap<string, PlacementEdit>,
): { body: { text: string; spans: Span[] }; boxes: TextBox[]; unplaced: number } {
  const documentEvent = events.find((event) => eventTypeOf(flat, event) === EVENT_DOCUMENT);
  const documentId =
    (documentEvent === undefined ? null : eventIdOf(flat, documentEvent, 0)) ?? "0:0";
  const ops: Array<InsertOp | MarkOp> = [];
  const styleOps: StyleOp[] = [];
  const comments = new Set<string>();

  for (const event of events) {
    const kind = eventTypeOf(flat, event);
    const payload = flat.offsetField(event, 5);
    const stamp = stampOf(flat, event);
    if (kind === EVENT_CREATE_COMMENT) {
      const id = eventIdOf(flat, event, 0);
      if (id !== null) comments.add(id);
    }
    if (payload === null || stamp === null) continue;
    switch (kind) {
      case EVENT_INSERT_CHAR: {
        const field = flat.field(payload, 1);
        const scalar = field === null ? null : flat.u32(field);
        if (scalar === null) break;
        ops.push({
          kind: "insert",
          stamp,
          container: eventIdOf(flat, payload, 2) ?? documentId,
          anchor: charIdField(flat, payload, 0),
          chars: [charOf(scalar)],
        });
        break;
      }
      case EVENT_INSERT_STRING: {
        const text = flat.stringField(payload, 1);
        if (text === null) break;
        ops.push({
          kind: "insert",
          stamp,
          container: eventIdOf(flat, payload, 2) ?? documentId,
          anchor: charIdField(flat, payload, 0),
          chars: Array.from(text),
        });
        break;
      }
      case EVENT_REMOVE_CHAR: {
        const target = charIdField(flat, payload, 0);
        if (target) ops.push({ kind: "remove", stamp, targets: [target] });
        break;
      }
      case EVENT_REMOVE_CHARS:
        ops.push({ kind: "remove", stamp, targets: charIdVector(flat, payload, 0) });
        break;
      case EVENT_REVIVE_CHARS:
        ops.push({ kind: "revive", stamp, targets: charIdVector(flat, payload, 0) });
        break;
      case EVENT_MODIFY_STYLE:
      case EVENT_MODIFY_PARAGRAPH_STYLE:
      case EVENT_CLEAR_STYLE: {
        // A ModifyParagraphStyle names its two newlines by id alone: "before" each, and
        // the start or end of the text where it names none.
        const plain = (slot: number, edge: number): Boundary | null => {
          const id = charIdField(flat, payload, slot);
          return id ? { id, type: BOUNDARY_BEFORE } : { id: ROOT_ID, type: edge };
        };
        const start =
          kind === EVENT_MODIFY_PARAGRAPH_STYLE
            ? plain(0, BOUNDARY_START_OF_DOC)
            : boundaryField(flat, payload, 0);
        const end =
          kind === EVENT_MODIFY_PARAGRAPH_STYLE
            ? plain(1, BOUNDARY_END_OF_DOC)
            : boundaryField(flat, payload, 1);
        if (!start || !end) break;
        const paragraphField = kind === EVENT_CLEAR_STYLE ? flat.field(payload, 2) : null;
        const paragraph =
          kind === EVENT_MODIFY_PARAGRAPH_STYLE ||
          (paragraphField !== null && (flat.u8(paragraphField) ?? 0) !== 0);
        const slot = kind === EVENT_MODIFY_STYLE ? 2 : kind === EVENT_CLEAR_STYLE ? 3 : 7;
        const common = {
          start,
          end,
          container: eventIdOf(flat, payload, slot) ?? documentId,
        };
        const clear = kind === EVENT_CLEAR_STYLE;
        styleOps.push(
          paragraph
            ? { ...common, paragraph, patch: clear ? { clear } : paragraphPatch(flat, payload) }
            : { ...common, paragraph, patch: clear ? { clear } : textStylePatch(flat, payload) },
        );
        break;
      }
      default:
        break;
    }
  }

  const forest: Forest = { roots: new Map(), nodes: new Map() };
  const lost = replayText(forest, ops);
  const sequences = new Map<string, Sequence>();
  for (const [container, root] of forest.roots) sequences.set(container, sequenceOf(root));

  const styles = new Map<string, StyleRanges>();
  for (const op of styleOps) {
    const range = styledRange(forest, sequences, op);
    if (!range) continue;
    let entry = styles.get(range.container);
    if (!entry) {
      entry = { chars: [], paragraphs: [] };
      styles.set(range.container, entry);
    }
    const { start, end } = range;
    if (op.paragraph) entry.paragraphs.push({ start, end, patch: op.patch });
    else entry.chars.push({ start, end, patch: op.patch });
  }
  const spansOf = (container: string, text: string): Span[] => {
    const entry = styles.get(container);
    return buildSpans(text, base, entry?.chars ?? [], entry?.paragraphs ?? []);
  };

  const boxes: TextBox[] = [];
  const placed = new Set<string>();
  events.forEach((event, index) => {
    if (eventTypeOf(flat, event) !== EVENT_CREATE_BLOCK) return;
    const id = eventIdOf(flat, event, 0);
    const sequence = id === null ? undefined : sequences.get(id);
    if (id === null || !sequence || sequence.text === "") return;
    // A text box that was deleted leaves its text behind in the log.
    if (deleted.has(id)) {
      placed.add(id);
      return;
    }
    const payload = flat.offsetField(event, 5);
    if (payload === null) return;
    const edit = edits.get(id);
    const at = edit?.origin ?? flat.pairField(payload, 3);
    const size = edit?.size ?? flat.pairField(payload, 6);
    if (!at || !size || ![...at, ...size].every((v) => Number.isFinite(v))) return;
    const rotationField = flat.field(payload, 4);
    const rotation =
      edit?.rotation ?? (rotationField === null ? 0 : (flat.f32(rotationField) ?? 0));
    const [x, y] = unrotateTopLeft([at[0] - inset, at[1]], size, rotation);
    placed.add(id);
    boxes.push({
      page: edit?.page ?? pageIndexOf(flat, payload, 2),
      x,
      y,
      w: size[0],
      h: size[1],
      rotation,
      text: sequence.text,
      spans: spansOf(id, sequence.text),
      z: edit?.z ?? zOrderOf(flat, payload, index),
    });
  });
  boxes.sort((a, b) => (a.page !== b.page ? a.page - b.page : a.z - b.z));

  const main = sequences.get(documentId)?.text ?? "";
  let unplaced = lost;
  for (const [container, sequence] of sequences) {
    if (container === documentId || placed.has(container) || comments.has(container)) continue;
    unplaced += Array.from(sequence.text).length;
  }
  return { body: { text: main, spans: spansOf(documentId, main) }, boxes, unplaced };
}

function textStylePatch(flat: FlatBuffer, payload: number): TextStylePatch {
  const sizeOff = flat.offsetField(payload, 8);
  const sizeField = sizeOff === null ? null : flat.field(sizeOff, 0);
  const fontSize = sizeField === null ? undefined : (flat.f32(sizeField) ?? undefined);
  const nameOff = flat.offsetField(payload, 7);
  const fontName = nameOff === null ? undefined : (flat.stringField(nameOff, 0) ?? undefined);
  const colourOff = flat.offsetField(payload, 9);
  const colourField = colourOff === null ? null : flat.field(colourOff, 0);
  const colour = colourField === null ? undefined : (flat.rgbaAt(colourField) ?? undefined);
  return {
    fontSize,
    fontName,
    colour,
    bold: nestedBool(flat, payload, 3),
    italic: nestedBool(flat, payload, 4),
    underline: nestedBool(flat, payload, 5),
    strikethrough: nestedBool(flat, payload, 13),
  };
}

/** A flag in a nested table: false when the table has no field, undefined when there is no table. */
function nestedBool(flat: FlatBuffer, payload: number, outer: number): boolean | undefined {
  const table = flat.offsetField(payload, outer);
  if (table === null) return undefined;
  const field = flat.field(table, 0);
  const value = field === null ? null : flat.u8(field);
  return value !== null && value !== undefined && value !== 0;
}

function paragraphPatch(flat: FlatBuffer, payload: number): ParagraphPatch {
  const nested = (outer: number): number | null => {
    const table = flat.offsetField(payload, outer);
    const field = table === null ? null : flat.field(table, 0);
    return field === null ? null : flat.u8(field);
  };
  const spacingOff = flat.offsetField(payload, 4);
  const spacingField = spacingOff === null ? null : flat.field(spacingOff, 0);
  const spacing = spacingField === null ? null : flat.f32(spacingField);
  return {
    indentLevel: nested(2) ?? undefined,
    lineSpacingMultiplier: spacing ?? undefined,
    decorationStyle: nested(5) ?? undefined,
  };
}

/** The style at every character of a text, with list numbers assigned. */
function buildSpans(
  text: string,
  base: Style,
  styleRanges: Ranged<TextStylePatch>[],
  paragraphRanges: Ranged<ParagraphPatch>[],
): Span[] {
  const chars = Array.from(text);
  const count = chars.length;
  const styles: Style[] = chars.map(() => ({ ...base, color: [...base.color] as Rgba }));
  for (const range of styleRanges) {
    const to = Math.min(range.end, count);
    for (let i = Math.min(range.start, count); i < to; i++) {
      const s = styles[i];
      const p = range.patch;
      if (p.clear) {
        s.fontSize = base.fontSize;
        s.fontName = base.fontName;
        s.color = base.color;
        s.bold = s.italic = s.underline = s.strikethrough = false;
      }
      if (p.fontSize !== undefined) s.fontSize = p.fontSize;
      if (p.fontName !== undefined) s.fontName = p.fontName;
      if (p.colour !== undefined) s.color = p.colour;
      if (p.bold !== undefined) s.bold = p.bold;
      if (p.italic !== undefined) s.italic = p.italic;
      if (p.underline !== undefined) s.underline = p.underline;
      if (p.strikethrough !== undefined) s.strikethrough = p.strikethrough;
    }
  }
  for (const range of paragraphRanges) {
    const to = Math.min(range.end, count);
    for (let i = Math.min(range.start, count); i < to; i++) {
      const s = styles[i];
      const p = range.patch;
      if (p.clear) {
        s.indentLevel = s.indentDecorationStyle = undefined;
        s.lineSpacingMultiplier = base.lineSpacingMultiplier;
      }
      if (p.indentLevel !== undefined) s.indentLevel = p.indentLevel;
      if (p.lineSpacingMultiplier !== undefined) s.lineSpacingMultiplier = p.lineSpacingMultiplier;
      if (p.decorationStyle !== undefined) s.indentDecorationStyle = p.decorationStyle;
    }
  }

  // Numbered lists count their own lines, a level at a time.
  const counters = new Array<number>(16).fill(0);
  let lineStart = true;
  for (let i = 0; i < count; i++) {
    if (lineStart && styles[i].indentDecorationStyle === 2) {
      const level = Math.min(styles[i].indentLevel ?? 0, counters.length - 1);
      counters[level]++;
      for (let l = level + 1; l < counters.length; l++) counters[l] = 0;
      styles[i].indentDecorationNumber = counters[level];
    }
    lineStart = chars[i] === "\n";
  }

  const spans: Span[] = [];
  let start = 0;
  while (start < count) {
    let end = start + 1;
    while (end < count && sameStyle(styles[start], styles[end])) end++;
    spans.push({ start, length: end - start, style: styles[start] });
    start = end;
  }
  if (spans.length === 0) spans.push({ start: 0, length: 0, style: base });
  return spans;
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.fontName === b.fontName &&
    a.lineSpacingMultiplier === b.lineSpacingMultiplier &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.indentLevel === b.indentLevel &&
    a.indentDecorationStyle === b.indentDecorationStyle &&
    a.indentDecorationNumber === b.indentDecorationNumber &&
    a.color.every((v, i) => v === b.color[i])
  );
}

/** The style at each character (code point) of a text. */
function styleList(spans: Span[], count: number, fallback: Style): Style[] {
  const out: Style[] = new Array<Style>(count).fill(fallback);
  for (const span of spans)
    for (let i = span.start; i < span.start + span.length && i < count; i++) out[i] = span.style;
  return out;
}

interface LogicalLine {
  text: string;
  style: Style;
}

/** A text's lines, each with its list marker in front and the style at its start. */
function logicalLines(text: string, styles: Style[], fallback: Style): LogicalLine[] {
  const lines: LogicalLine[] = [];
  // The line being read: its characters, and the style of its first character.
  let chars: string[] = [];
  let lineStyle: Style | undefined;
  let index = 0;
  for (const ch of text) {
    if (ch === "\r") {
      index++;
      continue;
    }
    if (lineStyle === undefined) lineStyle = styles[index] ?? fallback;
    if (ch === "\n") {
      lines.push({ text: `${listMarker(lineStyle) ?? ""}${chars.join("")}`, style: lineStyle });
      chars = [];
      lineStyle = undefined;
    } else {
      chars.push(ch);
    }
    index++;
  }
  if (chars.length > 0 || lineStyle !== undefined) {
    const last = lineStyle ?? fallback;
    lines.push({ text: `${listMarker(last) ?? ""}${chars.join("")}`, style: last });
  }
  return lines;
}

/** A list line's marker, indented by its level (bullets, numbers, checklists). */
function listMarker(style: Style): string | undefined {
  const indent = "  ".repeat(Math.max(0, Math.min(6, style.indentLevel ?? 0)));
  switch (style.indentDecorationStyle) {
    case 1:
      return `${indent}• `;
    case 2:
      return `${indent}${style.indentDecorationNumber ?? 1}. `;
    case 3:
      return `${indent}☐ `;
    default:
      return undefined;
  }
}

/** How many rows a line takes at a width, estimated from its font. */
function rowsOf(text: string, style: Style, maxWidth: number): number {
  const factor = fontFor(style.fontName) === "mono" ? MONO_CHAR_WIDTH : CHAR_WIDTH;
  const charWidth = style.fontSize * factor;
  let rows = 1;
  let x = 0;
  for (let i = 0; i < Array.from(text).length; i++) {
    if (x + charWidth > maxWidth && x > 0) {
      rows++;
      x = 0;
    }
    x += charWidth;
  }
  return rows;
}

/** A line's advance, in document units: whole multiples of the paper's line spacing. */
function advanceFor(lineHeight: number, spacing: number): number {
  if (lineHeight <= 0) return spacing;
  return spacing * Math.max(1, Math.ceil(lineHeight / spacing));
}

/** A visual key: lines with the same key share one text box. */
function looks(style: Style): string {
  return [
    style.fontSize,
    style.fontName,
    style.color.join(","),
    style.bold,
    style.italic,
    style.underline,
    style.strikethrough,
  ].join("|");
}

// --- Page layout ---------------------------------------------------------------

/**
 * Where a page's content goes on a FineNotes page. Pure.
 *
 * A note's position is in document units on a page `paper.width` wide, from the
 * page's top-left. FineNotes pages are `widthPx` wide, so a position times
 * `scale` (`widthPx / paper.width`) is its place on the page, with x
 * measured from the content's left edge (the inset is added back by the
 * caller). A page of a PDF is the PDF page at that same width, so it is
 * `widthPx * source.height / source.width` tall: FineNotes draws a PDF page
 * as large as fits, centred, so a page of the PDF's own shape has it fill
 * the page, top to bottom, and nothing shifts. A page with no PDF is the
 * paper's own height.
 */
export function pageLayout(
  paper: { width: number; height: number },
  widthPx: number,
  source: { width: number; height: number } | null,
): { width: number; height: number; scale: number } {
  const scale = widthPx / paper.width;
  const usable = source && source.width > 0 && source.height > 0;
  const height = usable ? (widthPx * source.height) / source.width : paper.height * scale;
  return { width: widthPx, height: Math.max(1, Math.round(height)), scale };
}

/** A CreatePage size as a page size, or `null`. */
function sizeOfPage(size: Pt | null | undefined): PdfPageSize | null {
  return size ? { width: size[0], height: size[1] } : null;
}

// --- The reader ----------------------------------------------------------------

/**
 * Convert one `.ntb` note. `fileTitle` names it; `pdfSizes` gives the page
 * sizes of its PDFs (without them a PDF page is the note's paper size).
 */
export function readNotabilityNtb(
  files: ReadonlyMap<string, Uint8Array>,
  fileTitle: string,
  pdfSizes: NtbPdfSizes = new Map(),
): ImportResult {
  const root = ntbRoot(files);
  if (root === null) throw new NtbError("not a Notability .ntb note");
  const note = parseNote(files, root);
  const name = fileTitle || "Imported note";
  const warnings: string[] = [];
  const attachments: ImportAttachment[] = [];
  const attach = (bytes: Uint8Array, label: string): string => {
    const { mime, ext } = sniffFile(bytes);
    const fileName = `${name} - ${label} ${attachments.length + 1}.${ext}`;
    attachments.push({ name: fileName, bytes, mime });
    return fileName;
  };
  const tally = new ImportTally();

  const letter = PAGE_SIZES.find((s) => s.id === "letter");
  const pageWidthPx = letter?.width ?? LETTER_WIDTH_FALLBACK;
  const k = pageWidthPx / note.paperWidth;
  const inset = note.paperWidth * CONTENT_INSET_RATIO;
  const spacing = note.lineSpacing ?? DEFAULT_LINE_SPACING;
  const maxWidth = note.paperWidth - 2 * inset;

  // --- Typed text, cut into text boxes per page and style ----------------------
  const logical = logicalLines(
    note.body.text,
    styleList(note.body.spans, Array.from(note.body.text).length, note.defaultStyle),
    note.defaultStyle,
  );
  let cursor = DEFAULT_TEXT_TOP;
  const placedLines = logical.map((line) => {
    const lineHeight = line.style.fontSize * Math.max(1, line.style.lineSpacingMultiplier);
    const advance = advanceFor(lineHeight, spacing);
    const top = cursor;
    cursor += rowsOf(line.text, line.style, maxWidth) * advance;
    return { ...line, top, advance };
  });
  type Block = {
    page: number;
    top: number;
    advance: number;
    style: Style;
    key: string;
    lines: string[];
  };
  const blocks: Block[] = [];
  for (const line of placedLines) {
    const page = Math.floor(line.top / note.paperHeight);
    const local = line.top - page * note.paperHeight;
    const key = looks(line.style);
    const last = blocks[blocks.length - 1];
    if (last && last.page === page && last.key === key) {
      last.lines.push(line.text);
    } else {
      blocks.push({
        page,
        top: local,
        advance: line.advance,
        style: line.style,
        key,
        lines: [line.text],
      });
    }
  }
  for (const block of blocks) {
    while (block.lines.length > 0 && block.lines[block.lines.length - 1].trim() === "")
      block.lines.pop();
  }

  // --- Text boxes from the note's own boxes --------------------------------------
  const boxTexts: Array<{ page: number; box: Omit<TextBoxElement, "id"> }> = [];
  for (const box of note.boxes) {
    const styles = styleList(box.spans, Array.from(box.text).length, note.defaultStyle);
    const lines = logicalLines(box.text, styles, note.defaultStyle);
    const text = lines
      .map((line) => line.text)
      .join("\n")
      .replace(/\s+$/, "");
    if (text.trim() === "") continue;
    const first = styles[0] ?? note.defaultStyle;
    const colours = new Set<string>();
    Array.from(box.text).forEach((ch, i) => {
      if (ch.trim() !== "") colours.add(styles[i]?.color.join(",") ?? "");
    });
    if (colours.size > 1) tally.add("mixed", box.page + 1);
    if (Math.abs(box.rotation) > 0.01) tally.add("rotatedText", box.page + 1);
    const element: Omit<TextBoxElement, "id"> = {
      x: round2((box.x + inset) * k),
      y: round2(box.y * k),
      w: round2(Math.max(8, box.w * k)),
      h: round2(Math.max(24, box.h * k)),
      text,
      color: hexColor(first.color[0] / 255, first.color[1] / 255, first.color[2] / 255),
      fontSize: round2(Math.max(1, first.fontSize * k)),
    };
    const font = fontFor(first.fontName);
    if (font !== "sans") element.font = font;
    if (first.bold) element.bold = true;
    if (first.italic) element.italic = true;
    if (first.underline) element.underline = true;
    if (first.strikethrough) element.strike = true;
    boxTexts.push({ page: box.page, box: element });
  }

  // --- The PDFs ----------------------------------------------------------------------
  // The PDFs the pages are made from: those the CreatePage events name, or else
  // the note's one PDF. A single PDF's page n is note page n (as the converter
  // renders it); with several, each page takes the PDF's next page, in order.
  const named = [...new Set(note.pageAssets.filter((path): path is string => path !== null))];
  const pdfPaths =
    named.length > 0 ? named : [...note.assets.values()].filter((path) => /\.pdf$/i.test(path));
  const pdfAttachments = new Map<string, string | null>();
  for (const path of pdfPaths) {
    const bytes = files.get(root + path);
    pdfAttachments.set(path, bytes && bytes.length > 0 ? attach(bytes, "PDF") : null);
  }
  if ([...pdfAttachments.values()].some((path) => path === null)) {
    warnings.push("A PDF the note uses is missing from the file; its pages are blank.");
  }
  const singlePdf = pdfPaths.length === 1 ? pdfPaths[0] : null;
  const pdfPageOf = new Map<number, { path: string; page: number }>();
  if (singlePdf === null) {
    const used = new Map<string, number>();
    note.pageAssets.forEach((path, index) => {
      if (path === null) return;
      const next = used.get(path) ?? 0;
      used.set(path, next + 1);
      pdfPageOf.set(index, { path, page: next });
    });
  }
  if (pdfPaths.length > 1) {
    warnings.push(
      `The note has ${plural(pdfPaths.length, "PDF")}; its pages were matched to them in order, ` +
        "which the file does not confirm.",
    );
  }
  if (pdfPaths.some((path) => !pdfSizes.has(path)) && note.pageSizes.every((size) => !size)) {
    warnings.push(
      "The PDF's page sizes could not be read, so its pages are taken as the note's paper size.",
    );
  }

  // --- Pages --------------------------------------------------------------------------
  let pageCount = 1;
  const need = (page: number): void => {
    pageCount = Math.max(pageCount, page + 1);
  };
  for (const curve of note.curves) need(curve.page);
  for (const picture of note.pictures) need(picture.page);
  for (const sticky of note.stickies) need(sticky.page);
  for (const box of note.boxes) need(box.page);
  for (const { page } of boxTexts) need(page);
  for (const block of blocks) need(block.page);
  for (const index of pdfPageOf.keys()) need(index);
  if (singlePdf !== null) {
    const sizes = pdfSizes.get(singlePdf);
    if (sizes) pageCount = Math.max(pageCount, sizes.length);
    else
      pageCount = Math.max(pageCount, note.pageAssets.filter((path) => path === singlePdf).length);
  }

  // Every page is the paper's width; a page of a PDF is as tall as that PDF page
  // is at that width, so FineNotes draws the PDF to fill the page and the ink
  // (placed at the same scale from the page's top-left) lies on its words.
  const pages: Page[] = [];
  for (let i = 0; i < pageCount; i++) {
    let backdrop: Backdrop =
      note.lineSpacing !== undefined
        ? { kind: "ruled-wide", spacing: round2(note.lineSpacing * k), color: RULE_COLOUR }
        : { kind: "blank" };
    let source: PdfPageSize | null = null;
    if (singlePdf !== null) {
      const attachment = pdfAttachments.get(singlePdf) ?? null;
      const sizes = pdfSizes.get(singlePdf);
      if (attachment && (sizes === undefined || i < sizes.length)) {
        backdrop = { kind: "pdf", path: attachment, page: i };
        source = sizes?.[i] ?? sizeOfPage(note.pageSizes[i]);
      }
    } else {
      const placed = pdfPageOf.get(i);
      const attachment = placed ? (pdfAttachments.get(placed.path) ?? null) : null;
      if (placed && attachment) {
        backdrop = { kind: "pdf", path: attachment, page: placed.page };
        source = pdfSizes.get(placed.path)?.[placed.page] ?? sizeOfPage(note.pageSizes[i]);
      }
    }
    const layout = pageLayout(
      { width: note.paperWidth, height: note.paperHeight },
      pageWidthPx,
      source,
    );
    pages.push({
      id: `p${i + 1}`,
      kind: "ink",
      geometry: { width: layout.width, height: layout.height },
      backdrop,
      strokes: [],
      images: [],
      textBoxes: [],
    });
  }

  // Ink, in the order the note drew it.
  let strokeN = 0;
  for (const curve of note.curves) {
    const stroke = strokeOf(curve, k, inset);
    if (!stroke) continue;
    if (curve.dashed) tally.add("dashed", curve.page + 1);
    pages[curve.page].strokes.push({ ...stroke, id: `s${++strokeN}` });
  }

  // Pictures and stickies.
  let imageN = 0;
  for (const picture of note.pictures) {
    const bytes = picture.asset ? files.get(root + picture.asset) : undefined;
    if (!picture.asset || !bytes || picture.w <= 0 || picture.h <= 0) {
      tally.add("missing", picture.page + 1);
      continue;
    }
    const path = attach(bytes, "picture");
    const element: Omit<ImageElement, "id"> = {
      path,
      x: round2((picture.x + inset) * k),
      y: round2(picture.y * k),
      w: round2(picture.w * k),
      h: round2(picture.h * k),
    };
    if (Math.abs(picture.rotation) > 0.01) element.rotation = round2(picture.rotation);
    const crop = pictureCrop(picture, bytes);
    if (crop) element.crop = crop;
    pages[picture.page].images.push({ ...element, id: `i${++imageN}` });
  }
  for (const sticky of note.stickies) {
    const colour = hexColor(sticky.colour[0] / 255, sticky.colour[1] / 255, sticky.colour[2] / 255);
    const element = newStickyNote(
      `i${++imageN}`,
      {
        x: round2((sticky.x + inset) * k),
        y: round2(sticky.y * k),
        w: round2(sticky.w * k),
        h: round2(sticky.h * k),
      },
      colour,
    );
    pages[sticky.page].images.push(element);
    if (sticky.ruled) tally.add("stickyRuled", sticky.page + 1);
  }

  // Text boxes: the typed text first, then the note's own boxes, in their order.
  let textN = 0;
  for (const block of blocks) {
    const first = block.style;
    const element: Omit<TextBoxElement, "id"> = {
      x: round2(inset * k),
      y: round2(block.top * k),
      w: round2(Math.max(8, maxWidth * k)),
      text: block.lines.join("\n"),
      color: hexColor(first.color[0] / 255, first.color[1] / 255, first.color[2] / 255),
      fontSize: round2(Math.max(1, first.fontSize * k)),
    };
    if (first.fontSize > 0) {
      const ratio = block.advance / first.fontSize;
      if (Number.isFinite(ratio) && ratio > 0.5 && ratio < 4) element.lineHeight = round2(ratio);
    }
    const font = fontFor(first.fontName);
    if (font !== "sans") element.font = font;
    if (first.bold) element.bold = true;
    if (first.italic) element.italic = true;
    if (first.underline) element.underline = true;
    if (first.strikethrough) element.strike = true;
    if (element.text.trim() === "") continue;
    pages[block.page].textBoxes.push({ ...element, id: `t${++textN}` });
  }
  for (const { page, box } of boxTexts) {
    pages[page].textBoxes.push({ ...box, id: `t${++textN}` });
  }

  // --- What came over another way, or not at all --------------------------------------
  if (note.unplaced > 0) {
    warnings.push(
      `About ${note.unplaced.toLocaleString("en-US")} characters of typed text could not be placed ` +
        "(their text box is not in the file); they were left out.",
    );
  }
  const lines = [
    tally.line("missing", (n) => `${plural(n, "picture")} could not be found in the file.`),
    tally.line(
      "mixed",
      (n) =>
        `${plural(n, "text box has", "text boxes have")} words in more than one colour; ` +
        "a text box here has one, so the first was kept.",
    ),
    tally.line(
      "rotatedText",
      (n) => `${plural(n, "rotated text box", "rotated text boxes")} came over upright.`,
    ),
    tally.line("dashed", (n) => `${plural(n, "dashed line")} came over solid.`),
    tally.line(
      "stickyRuled",
      (n) =>
        `${plural(n, "sticky note's ruling", "sticky notes' ruling")} could not be brought over.`,
    ),
  ];
  for (const line of lines) if (line) warnings.push(line);

  const drawn =
    note.curves.length +
    note.pictures.length +
    note.stickies.length +
    boxTexts.length +
    blocks.length;
  if (drawn === 0 && pdfPaths.length === 0) warnings.push("No handwriting was found in this note.");

  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: pageWidthPx, scale: 1 },
    pages,
  };
  return { source: "notability", title: name, doc, attachments, warnings };
}

/** The stroke a curve becomes: its points in page px, each with its pressure. */
function strokeOf(curve: Curve, k: number, inset: number): Omit<Stroke, "id"> | null {
  if (curve.points.length === 0) return null;
  const base = curve.width * k;
  const varying = spreads(curve.pressures) || spreads(curve.fractions);
  const multiplier = (anchor: number): number => {
    if (curve.tool === TOOL_HIGHLIGHTER) return 1;
    const p = valueAt(curve.pressures, anchor);
    const f = valueAt(curve.fractions, anchor);
    if (curve.tool === TOOL_PENCIL)
      return clamp(f, 0.15, 3) * (0.38 + 0.3 * Math.sqrt(clamp(p, 0.05, 2.5)));
    return varying ? clamp(f, 0.2, 3) * Math.sqrt(clamp(p, 0.2, 2.5)) : 1;
  };
  const samples =
    curve.cubic && curve.points.length >= 4 && (curve.points.length - 1) % 3 === 0
      ? sampleBezier(curve.points, multiplier, k)
      : curve.points.map((p, i) => ({ x: p[0], y: p[1], m: multiplier(i) }));
  if (samples.length === 0) return null;
  const size = round2(Math.max(0.1, base * median(samples.map((s) => s.m))));
  const pts: number[] = [];
  for (const s of samples) {
    pts.push(round2((s.x + inset) * k), round2(s.y * k), pressureForWidth(base * s.m, size));
  }
  const stroke: Omit<Stroke, "id"> = {
    color: hexColor(curve.colour[0] / 255, curve.colour[1] / 255, curve.colour[2] / 255),
    size,
    tool: curve.tool === TOOL_HIGHLIGHTER ? "highlighter" : "pen",
    pts,
  };
  if (curve.shape && !curve.cubic && samples.length === 2) stroke.shape = "line";
  return stroke;
}

interface Sample {
  x: number;
  y: number;
  m: number;
}

/** A cubic path's points along it, every {@link SAMPLE_SPACING} px, with the width multiplier at each. */
function sampleBezier(points: Pt[], multiplier: (anchor: number) => number, k: number): Sample[] {
  const out: Sample[] = [{ x: points[0][0], y: points[0][1], m: multiplier(0) }];
  for (let seg = 0; seg * 3 + 3 < points.length; seg++) {
    const [a, b, c, d] = points.slice(seg * 3, seg * 3 + 4);
    const length =
      Math.hypot(b[0] - a[0], b[1] - a[1]) +
      Math.hypot(c[0] - b[0], c[1] - b[1]) +
      Math.hypot(d[0] - c[0], d[1] - c[1]);
    const steps = Math.max(
      1,
      Math.min(MAX_SAMPLES_PER_SEGMENT, Math.ceil((length * k) / SAMPLE_SPACING)),
    );
    const m0 = multiplier(seg);
    const m1 = multiplier(seg + 1);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({
        x: u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
        y: u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
        m: m0 + (m1 - m0) * t,
      });
    }
  }
  return out.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
}

function spreads(values: readonly number[]): boolean {
  if (values.length === 0) return false;
  return values.some((v) => Math.abs(v - values[0]) > 0.03);
}

function valueAt(values: readonly number[], index: number): number {
  if (values.length === 0) return 1;
  const v = values[Math.min(index, values.length - 1)];
  return Number.isFinite(v) ? v : 1;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A picture's crop as fractions of the picture, or undefined for the whole picture. */
function pictureCrop(picture: Picture, bytes: Uint8Array): ImageCrop | undefined {
  if (!picture.crop) return undefined;
  const pixels = imageSize(bytes);
  const size: Pt | null = picture.logical ?? (pixels ? [pixels.width, pixels.height] : null);
  if (!size || size[0] <= 0 || size[1] <= 0) return undefined;
  const [cx, cy, cw, ch] = picture.crop;
  const x = clamp(cx / size[0], 0, 1);
  const y = clamp(cy / size[1], 0, 1);
  const w = Math.min(1 - x, cw / size[0]);
  const h = Math.min(1 - y, ch / size[1]);
  if (!(w > 0 && h > 0)) return undefined;
  if (x < 0.001 && y < 0.001 && w > 0.999 && h > 0.999) return undefined;
  const r = (v: number): number => Math.round(v * 10000) / 10000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}
