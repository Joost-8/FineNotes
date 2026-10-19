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
import { normalizePageTitle, normalizeSections } from "./contents";
import { normalizeLinks } from "./links";
import { MIN_TEXT_BOX_WIDTH, isCornerRadius, isTextPadding, normalizeBorder } from "./text-style";
import { SAVE_LEVEL, deflateToBase64, inflateFromBase64 } from "./compress";
import { readDash, readFill, readHeads, readRadius } from "./shape-style";
import { readPalette } from "./palette";
import { readFurniture } from "./furniture";
import { readTabColor } from "./page-tabs";
import { normalizeTable } from "./table";
import { normalizeGraph } from "./graph-element";
import { normalizeComment } from "./comments";
import {
  type AttachmentFolders,
  type Backdrop,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageSection,
  type InkLink,
  type PageGeometry,
  type Recording,
  type PracticeInfo,
  type PrintedText,
  type Ruling,
  type ShapeKind,
  type Stroke,
  type TextAlign,
  type GraphElement,
  type TableElement,
  type PageComment,
  type TextBoxElement,
  type TextFont,
  type ViewState,
  POINT_STRIDE,
  RULINGS,
  SAMPLE_STRIDE,
  SHAPE_KINDS,
  readImageOpacity,
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
  fill?: string;
  dash?: string;
  radius?: number;
  heads?: { start?: string; end?: string };
  nib?: number;
  t0?: number;
  samples?: number[];
}

interface StoredPage {
  id: string;
  kind: string;
  geometry: PageGeometry;
  backdrop: Backdrop;
  epoch?: number;
  bookmarked?: boolean;
  tab?: string;
  title?: string;
  sections?: PageSection[];
  links?: InkLink[];
  images: ImageElement[];
  textBoxes: TextBoxElement[];
  tables?: TableElement[];
  graphs?: GraphElement[];
  comments?: PageComment[];
  strokes: StoredStroke[];
}

/** Document-wide fields added after v2 shipped; absent from older files. */
interface StoredMeta {
  recognizedHash?: string;
  single?: boolean;
  folders?: AttachmentFolders;
  scroll?: "horizontal";
  readOnly?: true;
  practice?: PracticeInfo;
  palette?: { id: string; name: string; colors: string[] };
  furniture?: { header?: string; numbers?: "center" | "right" };
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
    fill: stroke.fill,
    dash: stroke.dash,
    radius: stroke.radius,
    heads: stroke.heads ? { start: stroke.heads.start, end: stroke.heads.end } : undefined,
    nib: typeof stroke.nib === "number" && Number.isFinite(stroke.nib) ? stroke.nib : undefined,
    // Absent means "unknown", which is not the same as 0 (ledger: clamping
    // an out-of-range value invents a meaning it does not have).
    t0: isTime(stroke.t0) ? Math.round(stroke.t0) : undefined,
    samples: stroke.samples?.length ? quantizeSamples(stroke.samples) : undefined,
  };
}

/** Steps per unit a sample's pressure is stored in. */
const SAMPLE_PRESSURE_STEPS = 1000;

/**
 * Raw samples as integers: x and y in hundredths of a page px, pressure in
 * thousandths, time in whole ms. Only whole samples are kept.
 */
function quantizeSamples(samples: readonly number[]): number[] {
  const usable = samples.length - (samples.length % SAMPLE_STRIDE);
  const out: number[] = [];
  for (let i = 0; i < usable; i += SAMPLE_STRIDE) {
    out.push(
      Math.round(finiteOrZero(samples[i]) * COORD_STEPS),
      Math.round(finiteOrZero(samples[i + 1]) * COORD_STEPS),
      Math.round(Math.min(1, Math.max(0, finiteOrZero(samples[i + 2]))) * SAMPLE_PRESSURE_STEPS),
      Math.round(finiteOrZero(samples[i + 3])),
    );
  }
  return out;
}

/** Stored samples back to page px; a bad value becomes 0, so the rest stay aligned. */
function readSamples(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length < SAMPLE_STRIDE) return undefined;
  const usable = raw.length - (raw.length % SAMPLE_STRIDE);
  const out: number[] = [];
  for (let i = 0; i < usable; i += SAMPLE_STRIDE) {
    out.push(
      finiteOrZero(raw[i]) / COORD_STEPS,
      finiteOrZero(raw[i + 1]) / COORD_STEPS,
      finiteOrZero(raw[i + 2]) / SAMPLE_PRESSURE_STEPS,
      finiteOrZero(raw[i + 3]),
    );
  }
  return out;
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
    tab: readTabColor(page.tab),
    title: normalizePageTitle(page.title),
    sections: page.sections && page.sections.length > 0 ? page.sections : undefined,
    links: page.links && page.links.length > 0 ? page.links : undefined,
    images: page.images,
    textBoxes: page.textBoxes,
    tables: page.tables && page.tables.length > 0 ? page.tables : undefined,
    graphs: page.graphs && page.graphs.length > 0 ? page.graphs : undefined,
    comments: page.comments && page.comments.length > 0 ? page.comments : undefined,
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
    readOnly: doc.readOnly === true ? true : undefined,
    practice: normalizePractice(doc.practice),
    palette: readPalette(doc.palette),
    furniture: readFurniture(doc.furniture),
  };
  return Object.values(meta).some((value) => value !== undefined) ? meta : undefined;
}

/**
 * Everything but the pages, with `pages` left empty. The pages go last, so
 * the stored JSON is this object's JSON with the pages' own JSON put between
 * its final `[` and `]}` (see {@link assembleJson}).
 */
function storeHead(doc: InkDocument): StoredDocument {
  return {
    version: SCHEMA_VERSION,
    view: doc.view,
    meta: storeMeta(doc),
    recordings: doc.recordings?.length ? doc.recordings : undefined,
    pages: [],
  };
}

function storeDocument(doc: InkDocument): StoredDocument {
  const stored = storeHead(doc);
  // Set after the other keys, so it keeps its place as the last one.
  stored.pages = doc.pages.map(storePage);
  return stored;
}

/** The document as a `v<n>:<base64>` payload, always at the current schema version. */
export function encodeDocument(doc: InkDocument): string {
  return `v${SCHEMA_VERSION}:${deflateToBase64(JSON.stringify(storeDocument(doc)))}`;
}

/** What closes the stored JSON after the last page. */
const PAGES_CLOSE = "]}";

/** The stored JSON up to and including the `[` that opens the page list. */
function headJson(doc: InkDocument): string {
  const json = JSON.stringify(storeHead(doc));
  // Only true while `pages` is the last key; a key added after it would
  // break every snapshot, and the tests that compare them with the plain
  // encoder say so.
  if (!json.endsWith(`[${PAGES_CLOSE}`)) throw new Error("`pages` is not the last stored key");
  return json.slice(0, -PAGES_CLOSE.length);
}

/** One page as it is written, and a number naming that exact text. */
export interface PageFragment {
  readonly json: string;
  /**
   * Equal slots, equal text; new text, a new slot. A worker that keeps the
   * pages' bytes by slot (fragment-store.ts) is sent only the slots it lacks.
   */
  readonly slot: number;
}

/**
 * A document as it is written, at one moment: the stored JSON is `head`,
 * then the pages' JSON joined by commas, then `]}`.
 */
export interface DocumentSnapshot {
  readonly head: string;
  readonly pages: readonly PageFragment[];
}

/** The stored JSON of a snapshot: exactly what `JSON.stringify` makes of the whole document. */
export function assembleJson(snapshot: DocumentSnapshot): string {
  return snapshot.head + snapshot.pages.map((page) => page.json).join(",") + PAGES_CLOSE;
}

/** A page's fragment, and the cache generation it was made in. */
interface CachedFragment extends PageFragment {
  readonly generation: number;
}

/** A fragment's generation once its page has been touched. */
const STALE = -1;

/**
 * A payload and the JSON it holds: as read (one string), or as last
 * written (the snapshot's parts, which are the cached fragments' own
 * strings, so comparing them is mostly comparing references).
 */
type Known =
  | { readonly payload: string; readonly json: string }
  | { readonly payload: string; readonly head: string; readonly pages: readonly string[] };

/** Runs a step-wise computation to its end, without stopping. */
export function runSteps<T>(steps: Generator<unknown, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * Encodes one note's document again and again, as a view saves it, at the
 * quicker {@link SAVE_LEVEL}. A document that has not changed since it was
 * read or last encoded gets the very same payload back, so a note opened and
 * closed untouched is not rewritten (the payload on disk was likely made at
 * another level), and sync sees no change.
 *
 * It also keeps each page's JSON, so a save in the background serialises
 * only the pages that changed (background-save.ts). Whoever changes a page
 * says so: {@link touch} for pages it can name, {@link touchAll} for
 * anything else. Nothing here can see a change made in place, so a change
 * not reported is a page saved as it was: when in doubt, touch everything.
 * {@link encode}, the synchronous save, trusts none of it and serialises
 * every page afresh, as it always did.
 */
export class DocumentEncoder {
  private known: Known | null = null;
  /** Whether the last encode handed back the known payload. */
  reused = false;
  private fragments = new WeakMap<Page, CachedFragment>();
  /** Fragments made in an older generation are stale: {@link touchAll} starts a new one. */
  private generation = 0;
  private nextSlot = 1;
  private touches = 0;
  /**
   * Pages {@link encode} found changed although nothing had touched them: a
   * change the cache missed. Should stay 0; the view reports it.
   */
  missed = 0;

  /** How many touches so far: a saver compares it to see whether anything changed since its snapshot. */
  get edits(): number {
    return this.touches;
  }

  /** These pages changed. */
  touch(pages: Iterable<Page>): void {
    this.touches++;
    for (const page of pages) {
      const cached = this.fragments.get(page);
      if (cached)
        this.fragments.set(page, { json: cached.json, slot: cached.slot, generation: STALE });
    }
  }

  /**
   * The pages of `doc` with these ids changed. Every page with such an id
   * counts, since an id can repeat in a file and a command acts on the
   * first page that has it.
   */
  touchIds(doc: InkDocument, ids: Iterable<string>): void {
    const wanted = new Set(ids);
    this.touch(doc.pages.filter((page) => wanted.has(page.id)));
  }

  /** Something changed, or may have, anywhere: every page is serialised again at the next save. */
  touchAll(): void {
    this.touches++;
    this.generation++;
  }

  /** The page's fragment, if nothing has touched the page since it was made. */
  private current(page: Page): CachedFragment | undefined {
    const cached = this.fragments.get(page);
    return cached && cached.generation === this.generation ? cached : undefined;
  }

  /** Serialise the page now. Unchanged text keeps its string and its slot. */
  private refresh(page: Page, audit = false): CachedFragment {
    const json = JSON.stringify(storePage(page));
    const old = this.fragments.get(page);
    let fragment: CachedFragment;
    if (old && old.json === json) {
      fragment = { json: old.json, slot: old.slot, generation: this.generation };
    } else {
      if (audit && old && old.generation === this.generation) this.missed++;
      fragment = { json, slot: this.nextSlot++, generation: this.generation };
    }
    this.fragments.set(page, fragment);
    return fragment;
  }

  /** The document as written now; pages touched since they were serialised are serialised here. */
  snapshot(doc: InkDocument): DocumentSnapshot {
    return {
      head: headJson(doc),
      pages: doc.pages.map((page) => this.current(page) ?? this.refresh(page)),
    };
  }

  /**
   * {@link snapshot}, a page at a time: each step serialises one page that
   * changed and yields its fragment; the result is the snapshot. Edits may
   * land between steps: the pages they touch are serialised again, and the
   * snapshot is taken in the same step as the last pass that found nothing
   * to do, so it is the whole document at one moment.
   */
  *snapshotSteps(doc: InkDocument): Generator<PageFragment, DocumentSnapshot> {
    for (;;) {
      let refreshed = false;
      for (const page of doc.pages) {
        if (this.current(page)) continue;
        refreshed = true;
        yield this.refresh(page);
      }
      if (!refreshed) return this.snapshot(doc);
    }
  }

  /**
   * Whether `snapshot` is exactly the JSON of the known payload, a page per
   * step. A payload read from disk is one string, compared piece by piece
   * rather than by building the snapshot's whole JSON.
   */
  *matchesKnown(snapshot: DocumentSnapshot): Generator<void, boolean> {
    const known = this.known;
    if (!known) return false;
    const { head, pages } = snapshot;
    if ("pages" in known) {
      if (known.head !== head || known.pages.length !== pages.length) return false;
      for (let i = 0; i < pages.length; i++) {
        if (known.pages[i] !== pages[i].json) return false;
        yield;
      }
      return true;
    }
    const { json } = known;
    let length = head.length + Math.max(0, pages.length - 1) + PAGES_CLOSE.length;
    for (const page of pages) length += page.json.length;
    if (length !== json.length || !json.startsWith(head)) return false;
    let at = head.length;
    for (let i = 0; i < pages.length; i++) {
      if (i > 0 && json[at++] !== ",") return false;
      if (!json.startsWith(pages[i].json, at)) return false;
      at += pages[i].json.length;
      yield;
    }
    return json.startsWith(PAGES_CLOSE, at);
  }

  /** The payload known to hold exactly the JSON last matched, if any. */
  get knownPayload(): string | null {
    return this.known?.payload ?? null;
  }

  /** `payload` holds exactly `snapshot`: the next save of the same JSON reuses it. */
  accept(snapshot: DocumentSnapshot, payload: string): void {
    this.known = { payload, head: snapshot.head, pages: snapshot.pages.map((page) => page.json) };
  }

  /**
   * The document as a `v<n>:<base64>` payload, made here and now: every
   * page serialised afresh (whatever the cache holds), then compressed on
   * this thread unless the known payload already holds that JSON.
   */
  encode(doc: InkDocument): string {
    const snapshot: DocumentSnapshot = {
      head: headJson(doc),
      pages: doc.pages.map((page) => this.refresh(page, true)),
    };
    const known = this.known;
    this.reused = runSteps(this.matchesKnown(snapshot));
    const payload =
      this.reused && known
        ? known.payload
        : `v${SCHEMA_VERSION}:${deflateToBase64(assembleJson(snapshot), SAVE_LEVEL)}`;
    this.accept(snapshot, payload);
    return payload;
  }

  /**
   * `payload` was just read; `json` is what it unpacks to, when the reader
   * has it at hand (`parseInkFile` does), or it is unpacked here. The payload
   * is reused for as long as the document would be written as exactly that
   * JSON — so a note an older version wrote, or one the loader repaired, is
   * written afresh at the first save. Nothing is encoded here: comparing at
   * the first save, which serialises the document anyway, gives the same
   * answer, and opening a large notebook does not unpack and serialise it a
   * second time.
   */
  remember(payload: string, json?: string): void {
    this.known = null;
    const prefix = `v${SCHEMA_VERSION}:`;
    if (!payload.startsWith(prefix)) return;
    let stored = json;
    if (stored === undefined) {
      try {
        stored = inflateFromBase64(payload.slice(prefix.length));
      } catch {
        return;
      }
    }
    this.known = { json: stored, payload };
  }
}

// --- Reading: small guards ------------------------------------------------------

/** Anything with fields to read. Arrays pass too; their named fields are simply absent. */
/** A page's contents title, spread into the page only when there is one. */
function titleOf(raw: unknown): { title?: string } {
  const title = normalizePageTitle(raw);
  return title === undefined ? {} : { title };
}

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
  // A shape's style; anything unreadable is simply not there.
  const fill = readFill(raw.fill);
  if (fill) stroke.fill = fill;
  const dash = readDash(raw.dash);
  if (dash) stroke.dash = dash;
  const radius = readRadius(raw.radius);
  if (radius) stroke.radius = radius;
  const heads = readHeads(raw.heads);
  if (heads) stroke.heads = heads;
  if (typeof raw.nib === "number" && Number.isFinite(raw.nib)) stroke.nib = raw.nib;
  if (isTime(raw.t0)) stroke.t0 = Math.round(raw.t0);
  const samples = readSamples(raw.samples);
  if (samples) stroke.samples = samples;
  return stroke;
}

/** A practice file's info, or undefined when there is none worth keeping. */
function normalizePractice(raw: unknown): PracticeInfo | undefined {
  if (!isRecord(raw)) return undefined;
  const set = typeof raw.set === "number" && Number.isInteger(raw.set) && raw.set > 0 ? raw.set : 0;
  if (!set) return undefined;
  return {
    format: typeof raw.format === "number" && raw.format > 0 ? Math.round(raw.format) : 1,
    set,
    ...(typeof raw.device === "string" && raw.device ? { device: raw.device } : {}),
    ...(typeof raw.input === "string" && raw.input ? { input: raw.input } : {}),
  };
}

/** Printed lines, each kept only when it has text and a place. */
function normalizePrinted(raw: unknown): PrintedText[] {
  if (!Array.isArray(raw)) return [];
  const out: PrintedText[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.text !== "string") continue;
    const x = num(item.x, Number.NaN);
    const y = num(item.y, Number.NaN);
    const size = num(item.size, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(size > 0)) continue;
    out.push({
      x,
      y,
      text: item.text,
      size,
      ...(item.bold === true ? { bold: true } : {}),
      ...(typeof item.color === "string" ? { color: item.color } : {}),
      ...(typeof item.prompt === "string" && item.prompt ? { prompt: item.prompt } : {}),
    });
  }
  return out;
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
      return {
        kind: "pdf",
        path: b.path,
        page: Math.max(0, Math.round(num(b.page, 0))),
        ...(b.annotations === false ? { annotations: false as const } : {}),
      };
    }
    return { kind: "blank" };
  }
  if (typeof b.kind === "string" && (RULINGS as readonly string[]).includes(b.kind)) {
    const printed = normalizePrinted(b.printed);
    return {
      kind: b.kind as Ruling,
      ...(typeof b.spacing === "number" && b.spacing > 0 ? { spacing: b.spacing } : {}),
      ...(typeof b.color === "string" ? { color: b.color } : {}),
      ...(typeof b.paperColor === "string" ? { paperColor: b.paperColor } : {}),
      ...(printed.length > 0 ? { printed } : {}),
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
    ...(raw.flipX === true ? { flipX: true } : {}),
    ...(raw.flipY === true ? { flipY: true } : {}),
    ...(raw.locked === true ? { locked: true } : {}),
    ...(raw.front === true ? { front: true as const } : {}),
    ...(readImageOpacity(raw.opacity) !== undefined
      ? { opacity: readImageOpacity(raw.opacity) }
      : {}),
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
    w: Math.max(raw.fit === true ? 8 : MIN_TEXT_BOX_WIDTH, num(raw.w, 320)),
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
  const border = normalizeBorder(raw.border);
  if (border) style.border = border;
  if (isCornerRadius(raw.radius)) style.radius = raw.radius;
  if (isTextPadding(raw.padding)) style.padding = raw.padding;
  if (raw.caps === true) style.caps = true;
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

function normalizePage(
  raw: unknown,
  index: number,
  fallbackWidth: number,
  seenSections: Set<string> = new Set(),
  seenLinks: Set<string> = new Set(),
): Page {
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
  const tables: TableElement[] = [];
  const tablesRaw = Array.isArray(page.tables) ? page.tables : [];
  let lastTableId = maxNumericId(tablesRaw, "g");
  tablesRaw.forEach((table) => {
    const normalized = normalizeTable(table, () => `g${++lastTableId}`);
    if (normalized) tables.push(normalized);
  });
  const graphs: GraphElement[] = [];
  const graphsRaw = Array.isArray(page.graphs) ? page.graphs : [];
  let lastGraphId = maxNumericId(graphsRaw, "f");
  graphsRaw.forEach((graph) => {
    const normalized = normalizeGraph(graph, () => `f${++lastGraphId}`);
    if (normalized) graphs.push(normalized);
  });
  const comments: PageComment[] = [];
  const commentsRaw = Array.isArray(page.comments) ? page.comments : [];
  let lastCommentId = maxNumericId(commentsRaw, "cm");
  commentsRaw.forEach((comment) => {
    const normalized = normalizeComment(comment, () => `cm${++lastCommentId}`);
    if (normalized) comments.push(normalized);
  });
  const strokes = readStrokes(page.strokes);
  return {
    id: typeof page.id === "string" ? page.id : `p${index + 1}`,
    kind: "ink",
    geometry: normalizeGeometry(page.geometry, fallbackWidth),
    backdrop: normalizeBackdrop(page.backdrop),
    strokes,
    images,
    textBoxes,
    ...(isEpoch(page.epoch) ? { epoch: Math.round(page.epoch) } : {}),
    // Only a literal `true`: anything else in the file is "not bookmarked".
    ...(page.bookmarked === true ? { bookmarked: true as const } : {}),
    ...(readTabColor(page.tab) ? { tab: readTabColor(page.tab) } : {}),
    ...titleOf(page.title),
    ...sectionsOf(page.sections, seenSections),
    ...linksOf(page.links, strokes, seenLinks),
    ...(tables.length > 0 ? { tables } : {}),
    ...(graphs.length > 0 ? { graphs } : {}),
    ...(comments.length > 0 ? { comments } : {}),
  };
}

/** A page's links, spread into the page only when any of them still holds ink there. */
function linksOf(
  raw: unknown,
  strokes: readonly Stroke[],
  seen: Set<string>,
): { links?: InkLink[] } {
  const links = normalizeLinks(raw, new Set(strokes.map((s) => s.id)), seen);
  return links.length > 0 ? { links } : {};
}

/** A page's sections, spread into the page only when it has any. */
function sectionsOf(raw: unknown, seen: Set<string>): { sections?: PageSection[] } {
  const sections = normalizeSections(raw, seen);
  return sections.length > 0 ? { sections } : {};
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
    const seenSections = new Set<string>();
    const seenLinks = new Set<string>();
    pages = raw.pages.map((p, i) => normalizePage(p, i, view.width, seenSections, seenLinks));
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
  if (meta.readOnly === true) doc.readOnly = true;
  const practice = normalizePractice(meta.practice);
  if (practice) doc.practice = practice;
  const palette = readPalette(meta.palette);
  if (palette) doc.palette = palette;
  const furniture = readFurniture(meta.furniture);
  if (furniture) doc.furniture = furniture;
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
  return decodePayload(payload, fallbackWidth).doc;
}

/** {@link decodeDocument}, also handing back the JSON the payload unpacked to. */
function decodePayload(payload: string, fallbackWidth: number): { doc: InkDocument; json: string } {
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
  return { doc: readDocument(parsed, fallbackWidth), json };
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
  /** The block's payload as it was read, when there is a block. */
  payload?: string;
  /** What the payload unpacked to, when it decoded (for `DocumentEncoder.remember`). */
  json?: string;
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
  try {
    const { doc, json } = decodePayload(block[1], fallbackWidth);
    return { body: before + after, doc, payload: block[1], json };
  } catch {
    return { body: before + after, doc: null, payload: block[1] };
  }
}

/**
 * Put a note together: the body as it was (only the pre-0.2.0 frontmatter keys
 * renamed, trailing whitespace trimmed), a blank line, then the data block.
 */
export function buildInkFile(body: string, doc: InkDocument, encoder?: DocumentEncoder): string {
  return inkFileText(body, encoder ? encoder.encode(doc) : encodeDocument(doc));
}

/** {@link buildInkFile} around a payload already made (in the background, by a worker). */
export function inkFileText(body: string, payload: string): string {
  const text = migrateFrontmatter(body).trimEnd();
  const block = `%%${BLOCK_LABEL}\n${payload}\n%%\n`;
  return text.length > 0 ? `${text}\n\n${block}` : block;
}
