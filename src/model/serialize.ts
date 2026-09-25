/**
 * How a notebook is kept on disk. A note is ordinary Markdown with one data
 * block after the user's text:
 *
 *     %%goodobsidian
 *     v2:<base64 of the DEFLATEd JSON document>
 *     %%
 *
 * In that JSON the points are integers (coordinates in hundredths of a page
 * px, pressure in 255ths); everything else is stored as the model holds it.
 *
 * Reading forgives: a field that is missing or malformed falls back to its
 * default, and only a block that cannot be read at all is refused. Writing is
 * exact: the same document always gives the same bytes, keys in the same
 * order, so a note saved without changes does not change on disk.
 *
 * Nothing here touches the DOM or Obsidian.
 */

import {
  BLOCK_LABEL,
  DEFAULT_PAGE_HEIGHT,
  DEFAULT_PAPER_WIDTH,
  FRONTMATTER_FLAG,
  FRONTMATTER_VERSION,
  LEGACY_BLOCK_LABEL,
  LEGACY_FRONTMATTER_FLAG,
  LEGACY_FRONTMATTER_VERSION,
  PAPER_GROWTH_MARGIN,
  SCHEMA_VERSION,
} from "../constants";
import { normalizeAttachmentFolders } from "./attachment-folders";
import { deflateToBase64, inflateFromBase64 } from "./compress";
import {
  type AttachmentFolders,
  type Backdrop,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageGeometry,
  type Recording,
  type Ruling,
  type ShapeKind,
  type Stroke,
  type TextAlign,
  type TextBoxElement,
  type TextFont,
  type ViewState,
  POINT_STRIDE,
  RULINGS,
  SHAPE_KINDS,
  TEXT_ALIGNS,
  TEXT_FONTS,
  strokeBounds,
} from "./document";

/** A payload that cannot be read at all. Callers catch it and keep the note's text. */
export class SerializeError extends Error {
  override readonly name = "SerializeError";

  constructor(
    message: string,
    /** What went wrong underneath: the base64, DEFLATE or JSON error. */
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

// --- Points on the wire -------------------------------------------------------

/** A stored coordinate counts hundredths of a page px. */
const COORD_STEPS = 100;
/** Stored pressure counts 255ths, and is clamped to 0..255. */
const PRESSURE_STEPS = 255;

/**
 * A copy of `pts` cut to whole points, with `toCoord` applied to every x and y
 * and `toPressure` to every pressure. Cutting first means a ragged array from
 * disk can never be written past its end (ledger: stride loops must guard
 * every write).
 */
function mapComponents(
  pts: readonly number[],
  toCoord: (value: number) => number,
  toPressure: (value: number) => number,
): number[] {
  const out = pts.slice(0, pts.length - (pts.length % POINT_STRIDE));
  for (let i = 0; i < out.length; i++) {
    out[i] = i % POINT_STRIDE === POINT_STRIDE - 1 ? toPressure(out[i]) : toCoord(out[i]);
  }
  return out;
}

function clampPressure(steps: number): number {
  if (steps < 0) return 0;
  if (steps > PRESSURE_STEPS) return PRESSURE_STEPS;
  return steps;
}

/** Page-space points (floats, pressure 0..1) to the integers stored on disk. */
export function quantizePts(pts: number[]): number[] {
  return mapComponents(
    pts,
    (coord) => Math.round(coord * COORD_STEPS),
    (pressure) => clampPressure(Math.round(pressure * PRESSURE_STEPS)),
  );
}

/** Stored integers back to page-space points. */
export function dequantizePts(pts: number[]): number[] {
  return mapComponents(
    pts,
    (coord) => coord / COORD_STEPS,
    (pressure) => pressure / PRESSURE_STEPS,
  );
}

// --- Writing ------------------------------------------------------------------
//
// The stored shapes below list their keys in the order they are written, and
// that order is part of the format. An optional key that has nothing to say
// is set to `undefined`: JSON.stringify leaves it out and keeps the others in
// place.

interface StoredStroke {
  id: string;
  color: string;
  size: number;
  tool: string;
  pts: number[];
  shape?: string;
  t0?: number;
}

interface StoredPage {
  id: string;
  kind: string;
  geometry: PageGeometry;
  backdrop: Backdrop;
  epoch?: number;
  bookmarked?: boolean;
  images: ImageElement[];
  textBoxes: TextBoxElement[];
  strokes: StoredStroke[];
}

/** Document-wide fields added after v2 shipped; absent from older files. */
interface StoredMeta {
  recognizedHash?: string;
  single?: boolean;
  folders?: AttachmentFolders;
  scroll?: "horizontal";
}

interface StoredDocument {
  version: number;
  view: ViewState;
  meta?: StoredMeta;
  recordings?: Recording[];
  pages: StoredPage[];
}

/** A stroke `t0`: milliseconds from the page's first pen-down, so never negative. */
function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function storeStroke(stroke: Stroke): StoredStroke {
  return {
    id: stroke.id,
    color: stroke.color,
    size: stroke.size,
    tool: stroke.tool,
    pts: quantizePts(stroke.pts),
    shape: stroke.shape || undefined,
    // Absent means "unknown", which is not the same as 0 (ledger: clamping
    // an out-of-range value invents a meaning it does not have).
    t0: isTime(stroke.t0) ? Math.round(stroke.t0) : undefined,
  };
}

/**
 * The view, backdrop, geometry, images, text boxes and recordings are written
 * as they are held, every key in the order it was set.
 */
function storePage(page: Page): StoredPage {
  return {
    id: page.id,
    kind: page.kind,
    geometry: page.geometry,
    backdrop: page.backdrop,
    epoch: isEpoch(page.epoch) ? Math.round(page.epoch) : undefined,
    bookmarked: page.bookmarked === true ? true : undefined,
    images: page.images,
    textBoxes: page.textBoxes,
    strokes: page.strokes.map(storeStroke),
  };
}

/** The meta block, or `undefined` when none of its fields has anything to say. */
function storeMeta(doc: InkDocument): StoredMeta | undefined {
  const meta: StoredMeta = {
    recognizedHash: doc.recognizedHash || undefined,
    single: doc.single === true ? true : undefined,
    folders: normalizeAttachmentFolders(doc.folders),
    scroll: doc.scroll === "horizontal" ? "horizontal" : undefined,
  };
  return Object.values(meta).some((value) => value !== undefined) ? meta : undefined;
}

function storeDocument(doc: InkDocument): StoredDocument {
  return {
    version: SCHEMA_VERSION,
    view: doc.view,
    meta: storeMeta(doc),
    recordings: doc.recordings?.length ? doc.recordings : undefined,
    pages: doc.pages.map(storePage),
  };
}

/** The document as a `v<n>:<base64>` payload, always at the current schema version. */
export function encodeDocument(doc: InkDocument): string {
  return `v${SCHEMA_VERSION}:${deflateToBase64(JSON.stringify(storeDocument(doc)))}`;
}

// --- Reading: small guards ------------------------------------------------------

/** Anything with fields to read. Arrays pass too; their named fields are simply absent. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asShape(value: unknown): ShapeKind | undefined {
  return SHAPE_KINDS.includes(value as ShapeKind) ? (value as ShapeKind) : undefined;
}

/** What a stroke saved without them is drawn with. */
const DEFAULT_INK = "#1a1a1a";
const DEFAULT_PEN_SIZE = 3;

// --- Reading: the view and strokes ----------------------------------------------

/** The saved scroll position and zoom; each field falls back on its own. */
function readView(raw: unknown, fallbackWidth: number): ViewState {
  const { scrollY, width, scale } = isRecord(raw) ? raw : ({} as Record<string, unknown>);
  return {
    scrollY: num(scrollY, 0),
    width: num(width, fallbackWidth),
    scale: num(scale, 1),
  };
}

/**
 * One stored stroke, or `null` for an entry that is not an object. `position`
 * is its place in the stored list, junk entries included; a stroke saved
 * without an id is named after it (`s1`, `s2`, …).
 */
function readStroke(raw: unknown, position: number): Stroke | null {
  if (!isRecord(raw)) return null;
  const stroke: Stroke = {
    id: str(raw.id, `s${position + 1}`),
    color: str(raw.color, DEFAULT_INK),
    size: typeof raw.size === "number" && raw.size > 0 ? raw.size : DEFAULT_PEN_SIZE,
    tool: raw.tool === "highlighter" ? "highlighter" : "pen",
    // A bad number becomes 0 rather than being dropped: dropping it would
    // slide every later value into the wrong slot of its point (ledger:
    // substitute, never filter). JSON writes NaN and Infinity as null, which
    // is how they arrive here.
    pts: dequantizePts(Array.isArray(raw.pts) ? raw.pts.map(finiteOrZero) : []),
  };
  const shape = asShape(raw.shape);
  if (shape) stroke.shape = shape;
  if (isTime(raw.t0)) stroke.t0 = Math.round(raw.t0);
  return stroke;
}

function readStrokes(raw: unknown): Stroke[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readStroke).filter((stroke): stroke is Stroke => stroke !== null);
}

// --- Reading: pages and what is on them ------------------------------------------

/**
 * A non-positive dimension is treated as **absent**, not clamped to 1.
 * Clamping produced a 1-px page, which is a confident wrong answer; the
 * default is an honest one. See CLAUDE.md, "Clamping an out-of-range value
 * invents a meaning it does not have".
 */
function normalizeGeometry(raw: unknown, fallbackWidth: number): PageGeometry {
  const g = isRecord(raw) ? raw : {};
  const dim = (value: unknown, fallback: number): number => {
    const n = num(value, fallback);
    return n > 0 ? n : fallback;
  };
  return {
    width: dim(g.width, fallbackWidth),
    height: dim(g.height, DEFAULT_PAGE_HEIGHT),
  };
}

function normalizeBackdrop(raw: unknown): Backdrop {
  const b = isRecord(raw) ? raw : {};
  if (b.kind === "pdf") {
    // A PDF backdrop without a usable path is meaningless; fall back to blank
    // rather than dropping the page and its ink with it.
    if (typeof b.path === "string" && b.path.length > 0) {
      return { kind: "pdf", path: b.path, page: Math.max(0, Math.round(num(b.page, 0))) };
    }
    return { kind: "blank" };
  }
  if (typeof b.kind === "string" && (RULINGS as readonly string[]).includes(b.kind)) {
    return {
      kind: b.kind as Ruling,
      ...(typeof b.spacing === "number" && b.spacing > 0 ? { spacing: b.spacing } : {}),
      ...(typeof b.color === "string" ? { color: b.color } : {}),
      ...(typeof b.paperColor === "string" ? { paperColor: b.paperColor } : {}),
    };
  }
  // Unknown ruling from a newer build: keep the page, lose only the paper.
  return { kind: "blank" };
}

function normalizeImage(raw: unknown, mintId: () => string): ImageElement | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.path !== "string" || raw.path.length === 0) return null;
  return {
    id: typeof raw.id === "string" ? raw.id : mintId(),
    path: raw.path,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    w: Math.max(1, num(raw.w, 100)),
    h: Math.max(1, num(raw.h, 100)),
    ...(typeof raw.rotation === "number" && Number.isFinite(raw.rotation)
      ? { rotation: raw.rotation }
      : {}),
    ...normalizeCrop(raw.crop),
    ...(raw.locked === true ? { locked: true } : {}),
  };
}

/** Smallest crop side kept, as a fraction: a sliver is a mistake, not a crop. */
const MIN_CROP = 0.01;

/**
 * A crop is kept only when it is a real sub-rectangle of the picture. One
 * that is malformed, empty or reaches outside is dropped (the whole picture
 * shows) rather than clamped into a crop nobody chose.
 */
function normalizeCrop(raw: unknown): { crop?: ImageElement["crop"] } {
  if (!isRecord(raw)) return {};
  const { x, y, w, h } = raw;
  if (![x, y, w, h].every((v) => typeof v === "number" && Number.isFinite(v))) return {};
  const [cx, cy, cw, ch] = [x, y, w, h] as number[];
  const eps = 1e-9;
  if (cx < 0 || cy < 0 || cw < MIN_CROP || ch < MIN_CROP) return {};
  if (cx + cw > 1 + eps || cy + ch > 1 + eps) return {};
  // The whole picture is no crop at all.
  if (cx === 0 && cy === 0 && cw >= 1 && ch >= 1) return {};
  return { crop: { x: cx, y: cy, w: Math.min(cw, 1 - cx), h: Math.min(ch, 1 - cy) } };
}

function normalizeTextBox(raw: unknown, mintId: () => string): TextBoxElement | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.text !== "string") return null;
  return {
    id: typeof raw.id === "string" ? raw.id : mintId(),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    // A fitted box is as narrow as its text: a short word must not reopen 80 wide.
    w: Math.max(raw.fit === true ? 8 : 80, num(raw.w, 320)),
    // Absent means "grows with its text"; only a real, positive height is kept.
    ...(typeof raw.h === "number" && Number.isFinite(raw.h) && raw.h > 0
      ? { h: Math.max(24, raw.h) }
      : {}),
    ...(raw.fit === true ? { fit: true as const } : {}),
    text: raw.text,
    color: str(raw.color, DEFAULT_INK),
    fontSize: Math.max(12, num(raw.fontSize, 22)),
    ...normalizeTextStyle(raw),
  };
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The optional whole-box style fields. An unknown or malformed value is
 * dropped, which means "default" — never clamped onto a neighbouring value,
 * and `false` is never stored.
 */
function normalizeTextStyle(raw: Record<string, unknown>): Partial<TextBoxElement> {
  const style: Partial<TextBoxElement> = {};
  if (TEXT_FONTS.includes(raw.font as TextFont)) style.font = raw.font as TextFont;
  if (raw.bold === true) style.bold = true;
  if (raw.italic === true) style.italic = true;
  if (raw.underline === true) style.underline = true;
  if (raw.strike === true) style.strike = true;
  if (TEXT_ALIGNS.includes(raw.align as TextAlign)) style.align = raw.align as TextAlign;
  if (
    typeof raw.lineHeight === "number" &&
    Number.isFinite(raw.lineHeight) &&
    raw.lineHeight >= 0.8 &&
    raw.lineHeight <= 3
  ) {
    style.lineHeight = raw.lineHeight;
  }
  if (typeof raw.fill === "string" && HEX_COLOR.test(raw.fill)) style.fill = raw.fill;
  return style;
}

function normalizeRecording(raw: unknown, index: number): Recording | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.path !== "string" || raw.path.length === 0) return null;
  if (!isEpoch(raw.start)) return null;
  return {
    id: typeof raw.id === "string" ? raw.id : `r${index + 1}`,
    path: raw.path,
    start: Math.round(raw.start),
    duration: Math.max(0, Math.round(num(raw.duration, 0))),
    ...(typeof raw.transcript === "string" && raw.transcript.length > 0
      ? { transcript: raw.transcript }
      : {}),
  };
}

/**
 * The highest `<prefix><n>` id among stored elements. An element stored
 * without an id is minted one above it: numbering by list position (as
 * before 0.5) could repeat an id another element really has, and every
 * command finds its target by id.
 */
function maxNumericId(raw: readonly unknown[], prefix: string): number {
  let max = 0;
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.startsWith(prefix)) continue;
    const digits = item.id.slice(prefix.length);
    if (/^[0-9]+$/.test(digits)) max = Math.max(max, Number(digits));
  }
  return max;
}

function normalizePage(raw: unknown, index: number, fallbackWidth: number): Page {
  const page = isRecord(raw) ? raw : {};
  const images: ImageElement[] = [];
  const imagesRaw = Array.isArray(page.images) ? page.images : [];
  let lastImageId = maxNumericId(imagesRaw, "i");
  imagesRaw.forEach((im) => {
    const image = normalizeImage(im, () => `i${++lastImageId}`);
    if (image) images.push(image);
  });
  const textBoxes: TextBoxElement[] = [];
  const textBoxesRaw = Array.isArray(page.textBoxes) ? page.textBoxes : [];
  let lastTextBoxId = maxNumericId(textBoxesRaw, "t");
  textBoxesRaw.forEach((textBox) => {
    const normalized = normalizeTextBox(textBox, () => `t${++lastTextBoxId}`);
    if (normalized) textBoxes.push(normalized);
  });
  return {
    id: typeof page.id === "string" ? page.id : `p${index + 1}`,
    kind: "ink",
    geometry: normalizeGeometry(page.geometry, fallbackWidth),
    backdrop: normalizeBackdrop(page.backdrop),
    strokes: readStrokes(page.strokes),
    images,
    textBoxes,
    ...(isEpoch(page.epoch) ? { epoch: Math.round(page.epoch) } : {}),
    // Only a literal `true`: anything else in the file is "not bookmarked".
    ...(page.bookmarked === true ? { bookmarked: true as const } : {}),
  };
}

/**
 * v1 -> v2. An upstream region is an unbounded paper roll, so its page height
 * is derived from how far the ink actually reaches; anything shorter would
 * silently crop strokes the user drew.
 */
function migrateV1Region(raw: unknown, index: number, fallbackWidth: number): Page {
  const region = isRecord(raw) ? raw : {};
  const strokes = readStrokes(region.strokes);
  let lowest = 0;
  for (const stroke of strokes) {
    const b = strokeBounds(stroke);
    if (b && b.maxY > lowest) lowest = b.maxY;
  }
  return {
    id: typeof region.id === "string" ? region.id : `p${index + 1}`,
    kind: "ink",
    geometry: {
      width: fallbackWidth,
      height: Math.max(DEFAULT_PAGE_HEIGHT, Math.ceil(lowest + PAPER_GROWTH_MARGIN)),
    },
    backdrop: { kind: "blank" },
    strokes,
    images: [],
    textBoxes: [],
  };
}

// --- Reading: the document --------------------------------------------------------

/**
 * Build a valid document from whatever JSON the payload held. The reader goes
 * by the data's shape, never by its version number: `pages` if there are
 * any, else v1's `regions`, and a file from a newer build (or with a mangled
 * version) still opens if its pages are recognisable.
 */
function readDocument(raw: unknown, fallbackWidth: number): InkDocument {
  if (!isRecord(raw)) throw new SerializeError("the payload is not a JSON object");
  const view = readView(raw.view, fallbackWidth);

  let pages: Page[];
  if (Array.isArray(raw.pages)) {
    pages = raw.pages.map((p, i) => normalizePage(p, i, view.width));
  } else if (Array.isArray(raw.regions)) {
    pages = raw.regions.map((r, i) => migrateV1Region(r, i, view.width));
  } else {
    pages = [];
  }
  // A document always has a page (contracts/api.md §3).
  if (pages.length === 0) {
    pages.push(normalizePage({ id: "p1" }, 0, view.width));
  }

  const meta: Record<string, unknown> = isRecord(raw.meta) ? raw.meta : {};
  const folders = normalizeAttachmentFolders(meta.folders);
  const recordings: Recording[] = [];
  (Array.isArray(raw.recordings) ? raw.recordings : []).forEach((r, i) => {
    const recording = normalizeRecording(r, i);
    if (recording) recordings.push(recording);
  });

  // Optional fields are added in this order, which is the order a loaded
  // document lists them in.
  const doc: InkDocument = { version: SCHEMA_VERSION, view, pages };
  if (typeof meta.recognizedHash === "string") doc.recognizedHash = meta.recognizedHash;
  if (meta.single === true) doc.single = true;
  if (recordings.length > 0) doc.recordings = recordings;
  if (folders) doc.folders = folders;
  if (meta.scroll === "horizontal") doc.scroll = "horizontal";
  return doc;
}

/** Run one stage of unpacking, turning its failure into a {@link SerializeError}. */
function stage<T>(what: string, run: () => T): T {
  try {
    return run();
  } catch (cause) {
    throw new SerializeError(what, cause);
  }
}

/**
 * Read a `v<n>:<base64>` payload. Whitespace around it is ignored, and so is
 * the version beyond being a number. Throws {@link SerializeError} when the
 * payload cannot be read at all.
 */
export function decodeDocument(payload: string, fallbackWidth = DEFAULT_PAPER_WIDTH): InkDocument {
  const text = payload.trim();
  const colon = text.indexOf(":");
  if (!text.startsWith("v") || colon < 0) {
    throw new SerializeError("the payload does not start with `v<n>:`");
  }
  if (!Number.isFinite(Number(text.slice(1, colon)))) {
    throw new SerializeError("the payload's version is not a number");
  }
  const json = stage("the payload is not base64 of DEFLATE data", () =>
    inflateFromBase64(text.slice(colon + 1)),
  );
  const parsed = stage("the payload is not JSON", () => JSON.parse(json) as unknown);
  return readDocument(parsed, fallbackWidth);
}

// --- The note file ---------------------------------------------------------------

const BYTE_ORDER_MARK = 0xfeff;

/**
 * Where a body's leading frontmatter ends, or 0 when it has none. The
 * frontmatter opens with a `---` line at the very start (after at most one
 * byte order mark) and closes at the first later line that starts with
 * `---`; a line break right after that closing `---` belongs to it.
 */
function frontmatterEnd(body: string): number {
  let at = body.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0;
  if (!body.startsWith("---", at)) return 0;
  at += 3;
  if (body[at] === "\r") at++;
  if (body[at] !== "\n") return 0;
  const close = body.indexOf("\n---", at + 1);
  if (close < 0) return 0;
  let end = close + 4;
  if (body[end] === "\r") end++;
  if (body[end] === "\n") end++;
  return end;
}

/**
 * Split a note body into its leading YAML frontmatter (fences included) and
 * the prose after it. `frontmatter + prose` is always the body.
 */
export function splitFrontmatter(body: string): { frontmatter: string; prose: string } {
  const end = frontmatterEnd(body);
  return { frontmatter: body.slice(0, end), prose: body.slice(end) };
}

export interface ParsedInkFile {
  /** The note without its data block: the user's text and the managed text section. */
  body: string;
  /** The notebook, or `null` when the note has no block or its block cannot be read. */
  doc: InkDocument | null;
}

// Matches the `%%goodobsidian … %%` block — or the `%%inkedmark … %%` block a
// note written before 0.2.0 carries — with optional surrounding blank lines.
const BLOCK_RE = new RegExp(
  `\\n*[ \\t]*%%(?:${BLOCK_LABEL}|${LEGACY_BLOCK_LABEL})[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*%%[ \\t]*\\n?`,
);

/**
 * Rename the pre-0.2.0 frontmatter keys to the current ones, touching nothing
 * else: only the leading `---` block is looked at, and only lines that are
 * exactly those keys. Everything the user put in the frontmatter stays.
 */
export function migrateFrontmatter(body: string): string {
  if (!body.startsWith("---\n")) return body;
  const end = body.indexOf("\n---", 4);
  if (end < 0) return body;
  const renamed = body
    .slice(0, end)
    .split("\n")
    .map((line) => {
      for (const [legacy, current] of [
        [LEGACY_FRONTMATTER_FLAG, FRONTMATTER_FLAG],
        [LEGACY_FRONTMATTER_VERSION, FRONTMATTER_VERSION],
      ]) {
        if (line.startsWith(`${legacy}:`)) return `${current}:${line.slice(legacy.length + 1)}`;
      }
      return line;
    })
    .join("\n");
  return renamed + body.slice(end);
}

/**
 * Take a note apart: its body without the data block, and the decoded
 * notebook. The first block wins. A block that cannot be read is still taken
 * out of the body, and gives no document rather than an error.
 */
export function parseInkFile(markdown: string, fallbackWidth = DEFAULT_PAPER_WIDTH): ParsedInkFile {
  const block = BLOCK_RE.exec(markdown);
  if (!block) return { body: markdown, doc: null };
  const before = markdown.slice(0, block.index);
  const after = markdown.slice(block.index + block[0].length);
  let doc: InkDocument | null;
  try {
    doc = decodeDocument(block[1], fallbackWidth);
  } catch {
    doc = null;
  }
  return { body: before + after, doc };
}

/**
 * Put a note together: the body as it was (only the pre-0.2.0 frontmatter keys
 * renamed, trailing whitespace trimmed), a blank line, then the data block.
 */
export function buildInkFile(body: string, doc: InkDocument): string {
  const text = migrateFrontmatter(body).trimEnd();
  const block = `%%${BLOCK_LABEL}\n${encodeDocument(doc)}\n%%\n`;
  return text.length > 0 ? `${text}\n\n${block}` : block;
}
