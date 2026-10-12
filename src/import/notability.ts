/**
 * Notability notes (`.note`) as FineNotes documents. Pure.
 *
 * The format is undocumented. A `.note` file is a zip holding a folder with
 * `Session.plist` (a binary NSKeyedArchiver graph), `Images/`, `PDFs/`,
 * `Assets/` and `Recordings/`. Read from real notes of Notability 16
 * (2026-10, see `research/IMPORT-FORMATS.md` in the dev repo) and Julia
 * Evans' reverse engineering (2018).
 *
 * The note is one long column of pages `pageWidthInDocumentCoordsKey` wide,
 * in document units, y down. When it annotates a PDF,
 * `pageLayoutArray` lists its pages in order: a page of a PDF in `PDFs/`
 * (`kPageLayoutPDFFileNameKey`, `kPageLayoutPDFPageNumberKey`, 1-based) as
 * tall as that PDF page at the column's width, or a page inserted between
 * them (page number `INT64_MAX`), Letter-sized like a note without a PDF.
 *
 * The ink is one "spatial hash" of byte arrays, all little-endian:
 *
 * - `curvesnumpoints`: int32 per stroke, its number of points;
 * - `curvespoints`: float32 x, y per point. A stroke of 3m + 1 points is m
 *   cubic Béziers (anchor, control, control, anchor, …);
 * - `curveswidth`: float32 per stroke, its width;
 * - `curvesfractionalwidths`: float32 per anchor, a multiplier of that width
 *   (max(⌊n / 3⌋ + 1, 2) of them per stroke);
 * - `curvescolors`: RGBA bytes per stroke;
 * - `curvesstyles`: a byte per stroke; 6 is the highlighter, which is stored
 *   fully opaque.
 *
 * `mediaObjects` holds pictures (`ImageMediaObject`), text boxes
 * (`TextBlockMediaObject`) and sticky canvases (`CanvasMediaObject`), each at
 * a `documentOrigin` with an `unscaledContentSize`. The note's own typed text
 * is `richText.attributedString`, flowing down from the top of the column.
 */

import type {
  ImageElement,
  InkDocument,
  Page,
  Recording,
  Stroke,
  TextBoxElement,
} from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { PAGE_SIZES } from "../model/templates";
import { isDict, parseBinaryPlist, unarchive, type PlistValue } from "./bplist";
import {
  fontFor,
  hexColor,
  imageSize,
  ImportTally,
  median,
  mp4Info,
  packageRoot,
  plural,
  pressureForWidth,
  round2,
  sniffFile,
  type ImportAttachment,
  type ImportResult,
} from "./import-types";

export class NotabilityError extends Error {}

/** A PDF page's size, in points. */
export interface PdfPageSize {
  width: number;
  height: number;
}

/**
 * The page sizes of a note's PDFs, by file name in `PDFs/`. Measuring a PDF
 * needs pdf.js, so the caller does it ({@link notabilityPdfFiles}).
 */
export type PdfSizes = ReadonlyMap<string, readonly PdfPageSize[]>;

/** Below this opacity a stroke is taken for the highlighter. */
const HIGHLIGHTER_ALPHA = 0.95 * 255;

/** `curvesstyles` of the highlighter. */
const HIGHLIGHTER_STYLE = 6;

/** Page width in Notability's units when the note does not say. */
const DEFAULT_PAGE_WIDTH = 574;

/** Page px between the points a Bézier is sampled at. */
const SAMPLE_SPACING = 2;

/** `kPageLayoutPDFPageNumberKey` of a page inserted between PDF pages. */
const NOT_A_PDF_PAGE = 2 ** 31;

/** Where a text box's text starts inside its frame, in document units (measured on one note). */
const TEXT_BLOCK_INSET = { x: 20, y: 5 };

/** A Letter page's width in inches: Notability's column is this wide. */
const PAGE_INCHES = 8.5;

/** The note's own typed text: its left margin, and line height per font size (document units). */
const BODY_MARGIN = 15;
const BODY_LINE_HEIGHT = 1.2;

/** Whether a set of zip entries is a Notability note. */
export function isNotability(files: ReadonlyMap<string, Uint8Array>): boolean {
  return findSession(files) !== null;
}

function findSession(files: ReadonlyMap<string, Uint8Array>): string | null {
  const root = packageRoot(files, "Session.plist");
  return root === null ? null : `${root}Session.plist`;
}

/** The PDFs a note carries, by their file name in `PDFs/`, for measuring. */
export function notabilityPdfFiles(
  files: ReadonlyMap<string, Uint8Array>,
): Array<{ name: string; bytes: Uint8Array }> {
  const session = findSession(files);
  if (session === null) return [];
  const prefix = `${session.slice(0, -"Session.plist".length)}PDFs/`;
  return [...files]
    .filter(([path, bytes]) => path.startsWith(prefix) && !path.endsWith("/") && bytes.length > 0)
    .map(([path, bytes]) => ({ name: path.slice(prefix.length), bytes }));
}

/** One page of the column, in document units. */
interface Slot {
  top: number;
  height: number;
  pdf?: { file: string; page: number };
  bookmarked: boolean;
}

/**
 * Convert one note. `fileTitle` names it (the name it was exported under);
 * the note's inner name is used only when that is empty. `pdfSizes` gives
 * the page sizes of its PDFs; without them a PDF page is taken for Letter.
 */
export function readNotability(
  files: ReadonlyMap<string, Uint8Array>,
  fileTitle: string,
  pdfSizes: PdfSizes = new Map(),
): ImportResult {
  const sessionPath = findSession(files);
  if (sessionPath === null) throw new NotabilityError("not a Notability note");
  const root = sessionPath.slice(0, -"Session.plist".length);
  let tree: PlistValue;
  try {
    tree = unarchive(parseBinaryPlist(files.get(sessionPath) ?? new Uint8Array()));
  } catch (e) {
    throw new NotabilityError(`Session.plist could not be read: ${(e as Error).message}`);
  }

  const session =
    findDict(tree, (d) => d.$class === "NoteTakingSession") ??
    findDict(tree, (d) => "richText" in d);
  const richText = isDict(session) && isDict(session.richText) ? session.richText : null;
  const name =
    fileTitle ||
    (isDict(session) && typeof session.name === "string" && session.name) ||
    "Imported note";

  // Pages are Letter-sized at the column's width unless a PDF says otherwise.
  const unitWidth = numberIn(tree, "pageWidthInDocumentCoordsKey") ?? DEFAULT_PAGE_WIDTH;
  const letter = PAGE_SIZES.find((s) => s.id === "letter") ?? { width: 1053, height: 1362 };
  const k = letter.width / unitWidth;
  const letterUnits = letter.height / k;

  const warnings: string[] = [];
  const attachments: ImportAttachment[] = [];
  const attachFile = (path: string, label: string): string | null => {
    const bytes = files.get(root + path);
    if (!bytes || bytes.length === 0) return null;
    const { mime, ext } = sniffFile(bytes);
    const fileName = `${name} - ${label} ${attachments.length + 1}.${ext}`;
    attachments.push({ name: fileName, bytes, mime });
    return fileName;
  };

  // --- The column of pages ---------------------------------------------------
  const slots: Slot[] = [];
  let unmeasured = false;
  const pdfNames = new Map<string, string | null>();
  for (const entry of pageLayout(tree)) {
    const top = slots.reduce((sum, s) => sum + s.height, 0);
    const file = typeof entry.file === "string" ? entry.file : undefined;
    const number = entry.page;
    if (file && number !== undefined && number >= 1 && number < NOT_A_PDF_PAGE) {
      if (!pdfNames.has(file)) pdfNames.set(file, attachFile(`PDFs/${file}`, "PDF"));
      const size = pdfSizes.get(file)?.[number - 1];
      if (!size) unmeasured = true;
      const height = size && size.width > 0 ? (unitWidth * size.height) / size.width : letterUnits;
      slots.push({ top, height, pdf: { file, page: number - 1 }, bookmarked: entry.bookmarked });
    } else {
      slots.push({ top, height: letterUnits, bookmarked: entry.bookmarked });
    }
  }
  if (unmeasured && pdfNames.size > 0) {
    warnings.push("The PDF's page sizes could not be read, so its pages may be out of place.");
  }
  if ([...pdfNames.values()].some((path) => path === null)) {
    warnings.push("A PDF the note uses is missing from the file; its pages are blank.");
  }
  /** The page `y` (document units) falls on, adding Letter pages past the end. */
  const slotAt = (y: number): number => {
    while (
      slots.length === 0 ||
      y >= slots[slots.length - 1].top + slots[slots.length - 1].height
    ) {
      const last = slots[slots.length - 1];
      slots.push({
        top: last ? last.top + last.height : 0,
        height: letterUnits,
        bookmarked: false,
      });
    }
    let i = slots.length - 1;
    while (i > 0 && y < slots[i].top) i--;
    return i;
  };

  // --- What goes on the pages, in document units -------------------------------
  type Placed<T> = { at: number; item: T };
  const strokes: Placed<Omit<Stroke, "id">>[] = [];
  const images: Placed<Omit<ImageElement, "id">>[] = [];
  const texts: Placed<Omit<TextBoxElement, "id">>[] = [];

  // The note's own ink; text boxes and sticky canvases nest hashes of their own.
  const overlay = richText?.["Handwriting Overlay"];
  const own = isDict(overlay) && isDict(overlay.SpatialHash) ? overlay.SpatialHash : null;
  // Searching for it elsewhere must not find a media object's own ink.
  const outside = richText ? { ...richText, mediaObjects: [] } : tree;
  const hash =
    own && own.curvespoints instanceof Uint8Array
      ? own
      : findDict(outside, (d) => d.curvespoints instanceof Uint8Array);
  for (const placed of hash ? readCurves(hash, k) : []) {
    strokes.push({ at: slotAt(placed.top / k), item: placed.stroke });
  }

  for (const block of bodyText(richText, unitWidth)) {
    texts.push({ at: slotAt(block.y), item: { ...block.box } });
  }

  const tally = new ImportTally();
  // Media objects are counted by the page they land on once the column is laid out.
  const counted: Array<{ key: string; y: number }> = [];
  const usedAssets = new Set<string>();
  let picN = 0;
  const media = richText && Array.isArray(richText.mediaObjects) ? richText.mediaObjects : [];
  for (const object of media) {
    if (!isDict(object)) continue;
    const origin = parsePoint(object.documentOrigin);
    const size = parsePoint(object.unscaledContentSize);
    if (!origin || !size) {
      tally.add("other");
      continue;
    }
    if (object.$class === "ImageMediaObject") {
      const figure = isDict(object.figure) ? object.figure : null;
      const background = isDict(figure?.FigureBackgroundObjectKey)
        ? figure.FigureBackgroundObjectKey
        : null;
      const snapshot = isDict(background?.kImageObjectSnapshotKey)
        ? background.kImageObjectSnapshotKey
        : null;
      const relative = typeof snapshot?.relativePath === "string" ? snapshot.relativePath : "";
      // An animated picture keeps its original in `Assets/<id>/`; `Images/` holds a still.
      const asset = assetFile(files, root, object.assetsIdKey);
      if (asset) usedAssets.add(asset);
      const source = asset ?? (relative ? root + relative : "");
      const bytes = source ? files.get(source) : undefined;
      const path = source ? attachFile(source.slice(root.length), "picture") : null;
      if (!path || !bytes || size[0] <= 0 || size[1] <= 0) {
        counted.push({ key: "missing", y: origin[1] });
        continue;
      }
      picN++;
      const image: Omit<ImageElement, "id"> = {
        path,
        x: origin[0],
        y: origin[1],
        w: size[0],
        h: size[1],
      };
      const degrees = typeof object.rotationDegrees === "number" ? object.rotationDegrees : 0;
      if (Number.isFinite(degrees) && Math.abs(degrees) > 0.01) {
        image.rotation = round2((degrees * Math.PI) / 180);
      }
      // The crop is in the still's pixels; the original is shown whole.
      const crop = asset ? undefined : cropOf(figure?.FigureCropRectKey, bytes);
      if (crop) image.crop = crop;
      if (object.isFlippedHorizontal === true || object.isFlippedVertical === true) {
        counted.push({ key: "flipped", y: origin[1] });
      }
      images.push({ at: slotAt(origin[1]), item: image });
    } else if (object.$class === "TextBlockMediaObject") {
      const box = textBlock(object, origin, size);
      if (box) texts.push({ at: slotAt(origin[1]), item: box });
    } else if (object.$class === "CanvasMediaObject") {
      // A sticky canvas: its paper as a filled box, its ruling and its ink on top.
      const canvas = stickyCanvas(object, origin, size, unitWidth);
      texts.push({ at: slotAt(origin[1]), item: canvas.paper });
      for (const line of canvas.lines) strokes.push({ at: slotAt(origin[1]), item: line });
      const inner = findDict(object, (d) => d.curvespoints instanceof Uint8Array);
      for (const placed of inner ? readCurves(inner, k) : []) {
        const pts = placed.stroke.pts.slice();
        for (let i = 0; i < pts.length; i += 3) {
          pts[i] = round2(pts[i] + origin[0] * k);
          pts[i + 1] = round2(pts[i + 1] + origin[1] * k);
        }
        strokes.push({ at: slotAt(origin[1]), item: { ...placed.stroke, pts } });
      }
      counted.push({ key: "canvases", y: origin[1] });
    } else {
      counted.push({ key: "other", y: origin[1] });
    }
  }

  // Recordings: each audio file in `Recordings/`, with its length from the file.
  const recordings: Recording[] = [];
  for (const path of [...files.keys()].sort()) {
    if (!path.startsWith(`${root}Recordings/`) || path.endsWith("/") || path.endsWith(".plist")) {
      continue;
    }
    const bytes = files.get(path);
    if (!bytes || bytes.length === 0) continue;
    const info = mp4Info(bytes);
    const attached = attachFile(path.slice(root.length), "recording");
    if (!attached) continue;
    if (!info) tally.add("recordingLength");
    recordings.push({
      id: `r${recordings.length + 1}`,
      path: attached,
      start: info?.created ?? 0,
      duration: info?.duration ?? 0,
    });
  }

  // --- Pages ----------------------------------------------------------------------
  if (slots.length === 0) slotAt(0);
  const pages: Page[] = slots.map((slot, i) => {
    const pdfPath = slot.pdf ? pdfNames.get(slot.pdf.file) : null;
    const page: Page = {
      id: `p${i + 1}`,
      kind: "ink",
      geometry: { width: letter.width, height: Math.round(slot.height * k) },
      backdrop:
        pdfPath && slot.pdf
          ? { kind: "pdf", path: pdfPath, page: slot.pdf.page }
          : { kind: "blank" },
      strokes: [],
      images: [],
      textBoxes: [],
    };
    if (slot.bookmarked) page.bookmarked = true;
    return page;
  });
  let n = 0;
  for (const { at, item } of strokes) {
    const offset = slots[at].top * k;
    const pts = item.pts.slice();
    for (let i = 1; i < pts.length; i += 3) pts[i] = round2(pts[i] - offset);
    pages[at].strokes.push({ ...item, id: `s${++n}`, pts });
  }
  n = 0;
  for (const { at, item } of images) {
    pages[at].images.push({
      ...item,
      id: `i${++n}`,
      x: round2(item.x * k),
      y: round2((item.y - slots[at].top) * k),
      w: round2(item.w * k),
      h: round2(item.h * k),
    });
  }
  n = 0;
  for (const { at, item } of texts) {
    pages[at].textBoxes.push({
      ...item,
      id: `t${++n}`,
      x: round2(item.x * k),
      y: round2((item.y - slots[at].top) * k),
      w: round2(Math.max(8, item.w * k)),
      ...(item.h === undefined ? {} : { h: round2(Math.max(24, item.h * k)) }),
      fontSize: round2(Math.max(12, item.fontSize * k)),
    });
  }

  // --- What came over another way, or not at all ---------------------------------
  for (const { key, y } of counted) tally.add(key, slotAt(y) + 1);
  const unusedAssets = [...files.keys()].filter(
    (f) => f.startsWith(`${root}Assets/`) && !f.endsWith("/") && !usedAssets.has(f),
  ).length;
  const lines = [
    tally.line("missing", (n) => `${plural(n, "picture")} could not be found in the file.`),
    tally.line("flipped", (n) => `${plural(n, "flipped picture")} came over unflipped.`),
    tally.line(
      "canvases",
      (n) =>
        `${plural(n, "sticky canvas", "sticky canvases")} came over as a coloured box ` +
        "with its lines and ink.",
    ),
    tally.line("other", (n) => `${plural(n, "other item")} could not be brought over yet.`),
    tally.line(
      "recordingLength",
      (n) => `${plural(n, "recording's", "recordings'")} length could not be read.`,
    ),
  ];
  for (const line of lines) if (line) warnings.push(line);
  if (unusedAssets > 0) {
    warnings.push(
      `${plural(unusedAssets, "sticker or GIF", "stickers or GIFs")} could not be placed.`,
    );
  }
  if (
    strokes.length === 0 &&
    picN === 0 &&
    texts.length === 0 &&
    pdfNames.size === 0 &&
    recordings.length === 0
  ) {
    warnings.push("No handwriting was found in this note.");
  }

  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: letter.width, scale: 1 },
    pages,
  };
  if (recordings.length > 0) doc.recordings = recordings;
  return { source: "notability", title: name, doc, attachments, warnings };
}

/** The file an `assetsIdKey` (a UUID as bytes or text) names in `Assets/<id>/`, if any. */
function assetFile(
  files: ReadonlyMap<string, Uint8Array>,
  root: string,
  key: PlistValue | undefined,
): string | undefined {
  const id =
    key instanceof Uint8Array
      ? String.fromCharCode(...key)
      : typeof key === "string"
        ? key
        : isDict(key) && key["NS.bytes"] instanceof Uint8Array
          ? String.fromCharCode(...key["NS.bytes"])
          : "";
  if (!/^[0-9A-Fa-f-]{8,}$/.test(id)) return undefined;
  const prefix = `${root}Assets/${id}/`;
  return [...files.keys()].find((f) => f.startsWith(prefix) && !f.endsWith("/"));
}

/**
 * A sticky canvas's paper (an empty text box filled with its colour, as
 * tall as it) and its ruling (lines `Lines:…:<spacing in inches>`), in
 * document units except the lines, which are strokes in page px.
 */
function stickyCanvas(
  object: { [key: string]: PlistValue },
  origin: [number, number],
  size: [number, number],
  unitWidth: number,
): { paper: Omit<TextBoxElement, "id">; lines: Array<Omit<Stroke, "id">> } {
  const style = isDict(object.paperStyleObject) ? object.paperStyleObject : null;
  const attributes = isDict(object.kCanvasMediaObjectPaperAttributes)
    ? object.kCanvasMediaObjectPaperAttributes
    : null;
  const identifier =
    typeof attributes?.paperIdentifier === "string" ? attributes.paperIdentifier : "";
  const hex = /^Color:(#[0-9a-f]{6})$/i.exec(identifier)?.[1]?.toLowerCase();
  const colour = uiColor(style?.paperColor) ?? hex ?? "#fff3b0";
  const paper: Omit<TextBoxElement, "id"> = {
    x: origin[0],
    y: origin[1],
    w: size[0],
    h: size[1],
    text: "",
    color: "#000000",
    fontSize: 12,
    // Text boxes sit above the ink: a see-through fill keeps the ruling and ink visible.
    fill: `${colour}66`,
  };
  const ruling = typeof attributes?.lineStyle2 === "string" ? attributes.lineStyle2 : "";
  const inches = Number(/^Lines:[^:]*:[^:]*:([\d.]+)$/.exec(ruling)?.[1]);
  const lines: Array<Omit<Stroke, "id">> = [];
  if (Number.isFinite(inches) && inches > 0) {
    const k = PAGE_SIZE_LETTER_PX / unitWidth;
    const spacing = (inches * unitWidth) / PAGE_INCHES;
    const lineColour = shade(colour, 0.8);
    for (let y = origin[1] + spacing; y < origin[1] + size[1] - 1; y += spacing) {
      lines.push({
        color: lineColour,
        size: round2(Math.max(0.5, 0.5 * k)),
        tool: "pen",
        pts: [
          round2(origin[0] * k),
          round2(y * k),
          0.5,
          round2((origin[0] + size[0]) * k),
          round2(y * k),
          0.5,
        ],
        shape: "line",
      });
    }
  }
  return { paper, lines };
}

/** FineNotes' Letter page width in page px. */
const PAGE_SIZE_LETTER_PX = PAGE_SIZES.find((s) => s.id === "letter")?.width ?? 1053;

/** A `UIColor` archive's `#rrggbb`, or undefined when it does not have components. */
function uiColor(raw: PlistValue | undefined): string | undefined {
  if (!isDict(raw)) return undefined;
  const part = (key: string): number | undefined => {
    const v = raw[`${key}-Double`] ?? raw[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const r = part("UIRed");
  const g = part("UIGreen");
  const b = part("UIBlue");
  if (r !== undefined && g !== undefined && b !== undefined) return hexColor(r, g, b);
  const white = part("UIWhite");
  return white === undefined ? undefined : hexColor(white, white, white);
}

/** `#rrggbb` darkened (factor below 1) towards black. */
function shade(hex: string, factor: number): string {
  const v = (i: number): number => parseInt(hex.slice(i, i + 2), 16) / 255;
  return hexColor(v(1) * factor, v(3) * factor, v(5) * factor);
}

interface LayoutEntry {
  file?: string;
  page?: number;
  bookmarked: boolean;
}

/** `pageLayoutArray`, in document page order; empty for a note without one. */
function pageLayout(tree: PlistValue): LayoutEntry[] {
  const raw = valueIn(tree, "pageLayoutArray");
  if (!Array.isArray(raw)) return [];
  const entries = raw.filter(isDict).map((d, i) => {
    const page = d.kPageLayoutPDFPageNumberKey;
    const order = d.kPageLayoutDocumentPageNumberKey;
    return {
      file:
        typeof d.kPageLayoutPDFFileNameKey === "string" ? d.kPageLayoutPDFFileNameKey : undefined,
      page:
        typeof page === "number"
          ? page
          : typeof page === "bigint"
            ? Number(page > BigInt(NOT_A_PDF_PAGE) ? BigInt(NOT_A_PDF_PAGE) : page)
            : undefined,
      bookmarked: d.kPageLayoutPageIsBookmarkedKey === true,
      order: typeof order === "number" ? order : i + 1,
    };
  });
  return entries.sort((a, b) => a.order - b.order);
}

interface PlacedStroke {
  stroke: Omit<Stroke, "id">;
  /** The stroke's first y, in page px down the whole column. */
  top: number;
}

function readCurves(hash: { [key: string]: PlistValue }, k: number): PlacedStroke[] {
  const counts = int32s(hash.curvesnumpoints);
  const points = float32s(hash.curvespoints);
  const widths = float32s(hash.curveswidth);
  const colours = hash.curvescolors instanceof Uint8Array ? hash.curvescolors : new Uint8Array();
  const styles = hash.curvesstyles instanceof Uint8Array ? hash.curvesstyles : new Uint8Array();
  let fractions = float32s(hash.curvesfractionalwidths);
  const anchorsOf = (n: number): number => Math.max(Math.floor(n / 3) + 1, 2);
  if (fractions.length !== counts.reduce((sum, n) => sum + anchorsOf(n), 0))
    fractions = new Float32Array();

  const out: PlacedStroke[] = [];
  let p = 0;
  let f = 0;
  counts.forEach((n, i) => {
    const xy = points.subarray(p * 2, (p + n) * 2);
    const frac = fractions.length > 0 ? fractions.subarray(f, f + anchorsOf(n)) : null;
    p += n;
    f += anchorsOf(n);
    if (n < 1 || xy.length < n * 2) return;

    const width = (widths[i] ?? 1) * k;
    const sampled = sampleCurve(xy, n, frac, k);
    if (sampled.length === 0) return;
    const size = round2(Math.max(0.1, width * median(sampled.map((s) => s.frac))));
    const pts: number[] = [];
    for (const s of sampled)
      pts.push(round2(s.x), round2(s.y), pressureForWidth(width * s.frac, size));

    const c = colours.subarray(i * 4, i * 4 + 4);
    const [r, g, b, a] = c.length === 4 ? Array.from(c) : [0, 0, 0, 255];
    const highlighter = styles[i] === HIGHLIGHTER_STYLE || a < HIGHLIGHTER_ALPHA;
    out.push({
      stroke: {
        color: hexColor(r / 255, g / 255, b / 255),
        size,
        tool: highlighter ? "highlighter" : "pen",
        pts,
      },
      top: sampled[0].y,
    });
  });
  return out;
}

interface Sample {
  x: number;
  y: number;
  /** The width multiplier here. */
  frac: number;
}

/**
 * Points along a stroke in page px. 3m + 1 points are read as cubic Béziers
 * and sampled about every {@link SAMPLE_SPACING} px; any other count as a
 * polyline.
 */
export function sampleCurve(
  xy: Float32Array,
  n: number,
  frac: Float32Array | null,
  k: number,
): Sample[] {
  const at = (i: number): [number, number] => [xy[i * 2] * k, xy[i * 2 + 1] * k];
  const fracAt = (anchor: number): number => {
    const v = frac?.[Math.min(anchor, (frac?.length ?? 1) - 1)];
    return v !== undefined && Number.isFinite(v) && v > 0 ? v : 1;
  };
  const out: Sample[] = [];
  const push = (x: number, y: number, fr: number): void => {
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y, frac: fr });
  };
  if (n < 4 || (n - 1) % 3 !== 0) {
    for (let i = 0; i < n; i++) push(...at(i), fracAt(Math.floor(i / 3)));
    return out;
  }
  const [x0, y0] = at(0);
  push(x0, y0, fracAt(0));
  for (let seg = 0; seg * 3 + 3 < n; seg++) {
    const [ax, ay] = at(seg * 3);
    const [bx, by] = at(seg * 3 + 1);
    const [cx, cy] = at(seg * 3 + 2);
    const [dx, dy] = at(seg * 3 + 3);
    const length =
      Math.hypot(bx - ax, by - ay) + Math.hypot(cx - bx, cy - by) + Math.hypot(dx - cx, dy - cy);
    const steps = Math.max(1, Math.min(64, Math.ceil(length / SAMPLE_SPACING)));
    const f0 = fracAt(seg);
    const f1 = fracAt(seg + 1);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      const x = u * u * u * ax + 3 * u * u * t * bx + 3 * u * t * t * cx + t * t * t * dx;
      const y = u * u * u * ay + 3 * u * u * t * by + 3 * u * t * t * cy + t * t * t * dy;
      push(x, y, f0 + (f1 - f0) * t);
    }
  }
  return out;
}

/** The style of the run that covers `index` in an attributed string. */
interface RunStyle {
  size: number;
  color: string;
  family?: string;
  /** The marker a list line starts with ("☐ ", "☑ ", "1. ", "• "), indented by its level. */
  marker?: string;
}

/**
 * The marker for a line of a list: Notability's `indent-decoration-style`
 * 3 is a checklist (`checklist-checked`), 2 a numbered list
 * (`indent-decoration-number`), 1 bullets.
 */
function listMarker(other: { [key: string]: PlistValue }): string | undefined {
  const style = other["indent-decoration-style"];
  const level = typeof other["indent-level"] === "number" ? other["indent-level"] : 0;
  const indent = "  ".repeat(Math.max(0, Math.min(6, level)));
  if (style === 3) return `${indent}${other["checklist-checked"] === 1 ? "☑" : "☐"} `;
  if (style === 2) {
    const n = other["indent-decoration-number"];
    return `${indent}${typeof n === "number" ? n : 1}. `;
  }
  if (style === 1) return `${indent}• `;
  return undefined;
}

/** A Notability attributed string: its text and the style at any index. */
function attributed(store: PlistValue | undefined): {
  text: string;
  styleAt: (index: number) => RunStyle;
} {
  const dict = isDict(store) ? store : null;
  const text = typeof dict?.stringKey === "string" ? dict.stringKey : "";
  const runs = Array.isArray(dict?.subRangesKey) ? dict.subRangesKey.filter(isDict) : [];
  const styled = runs.map((run) => {
    const range = parsePoint(run.subRangeRangeKey) ?? [0, 0];
    const font = isDict(run.subRangeFontKey) ? run.subRangeFontKey : {};
    const size = typeof font.NSFontSizeAttribute === "number" ? font.NSFontSizeAttribute : 12;
    const family =
      typeof font.NSFontNameAttribute === "string" ? font.NSFontNameAttribute : undefined;
    const other = isDict(run.subRangeOtherAttributesKey) ? run.subRangeOtherAttributesKey : {};
    const style: RunStyle = { size, color: rgbaColor(run.subRangeColorCrossPlatformKey), family };
    const marker = listMarker(other);
    if (marker) style.marker = marker;
    return { from: range[0], to: range[0] + range[1], style };
  });
  const fallback: RunStyle = { size: 12, color: "#000000" };
  return {
    text,
    styleAt: (index) =>
      styled.find((r) => index >= r.from && index < r.to)?.style ?? styled[0]?.style ?? fallback,
  };
}

/**
 * The note's own typed text as text boxes: each block of lines without an
 * empty one between them, at the height the lines above put it (document
 * units). A list line keeps its marker as text ("☐ ", "1. ", "• "), and
 * an empty list item still counts as a line.
 */
function bodyText(
  richText: { [key: string]: PlistValue } | null,
  unitWidth: number,
): Array<{ y: number; box: Omit<TextBoxElement, "id"> }> {
  const { text, styleAt } = attributed(richText?.attributedString);
  const out: Array<{ y: number; box: Omit<TextBoxElement, "id"> }> = [];
  let y = 0;
  let index = 0;
  let block: { y: number; lines: string[]; style: RunStyle } | null = null;
  const flush = (): void => {
    if (!block) return;
    out.push({
      y: block.y,
      box: textBox(
        BODY_MARGIN,
        block.y,
        unitWidth - 2 * BODY_MARGIN,
        block.lines.join("\n"),
        block.style,
      ),
    });
    block = null;
  };
  for (const raw of text.split("\n")) {
    const style = styleAt(index);
    const line = style.marker ? `${style.marker}${raw.trim()}` : raw;
    if (line.trim() === "") flush();
    else if (block) block.lines.push(line);
    else block = { y, lines: [line], style };
    y += style.size * BODY_LINE_HEIGHT;
    index += raw.length + 1;
  }
  flush();
  return out;
}

/** A Notability text box, in document units; null when it holds no text. */
function textBlock(
  object: { [key: string]: PlistValue },
  origin: [number, number],
  size: [number, number],
): Omit<TextBoxElement, "id"> | null {
  const store = isDict(object.textStore) ? object.textStore.attributedString : undefined;
  const { text, styleAt } = attributed(store);
  if (text.trim() === "") return null;
  return textBox(
    origin[0] + TEXT_BLOCK_INSET.x,
    origin[1] + TEXT_BLOCK_INSET.y,
    size[0] - 2 * TEXT_BLOCK_INSET.x,
    text.replace(/\s+$/, ""),
    styleAt(0),
  );
}

function textBox(
  x: number,
  y: number,
  w: number,
  text: string,
  style: RunStyle,
): Omit<TextBoxElement, "id"> {
  const box: Omit<TextBoxElement, "id"> = {
    x,
    y,
    w: Math.max(8, w),
    text,
    color: style.color,
    fontSize: style.size,
  };
  const font = fontFor(style.family);
  if (font !== "sans") box.font = font;
  return box;
}

/**
 * A crop as fractions of the picture, from `FigureCropRectKey` (pixels), or
 * undefined for the whole picture or when the picture's size is unknown.
 */
function cropOf(raw: PlistValue | undefined, bytes: Uint8Array): ImageElement["crop"] {
  const numbers = typeof raw === "string" ? raw.match(/-?[\d.]+(?:e-?\d+)?/gi)?.map(Number) : null;
  const size = imageSize(bytes);
  if (!numbers || numbers.length !== 4 || !size || size.width <= 0 || size.height <= 0) return;
  const [cx, cy, cw, ch] = numbers;
  const x = Math.max(0, cx / size.width);
  const y = Math.max(0, cy / size.height);
  const w = Math.min(1 - x, cw / size.width);
  const h = Math.min(1 - y, ch / size.height);
  if (!(w > 0 && h > 0)) return;
  if (x < 0.001 && y < 0.001 && w > 0.999 && h > 0.999) return;
  const r = (v: number): number => Math.round(v * 10000) / 10000;
  return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

/** `"{x, y}"` (an NSStringFromCGPoint or CGSize) as two numbers. */
function parsePoint(raw: PlistValue | undefined): [number, number] | null {
  if (typeof raw !== "string") return null;
  const m = /^\{\s*(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)\s*\}$/i.exec(raw);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

/** `"r,g,b,a"` in 0..1 as `#rrggbb`; black when it does not parse. */
function rgbaColor(raw: PlistValue | undefined): string {
  const parts = typeof raw === "string" ? raw.split(",").map(Number) : [];
  return parts.length >= 3 && parts.every(Number.isFinite)
    ? hexColor(parts[0], parts[1], parts[2])
    : "#000000";
}

function float32s(v: PlistValue | undefined): Float32Array {
  if (!(v instanceof Uint8Array)) return new Float32Array();
  const view = new DataView(v.buffer, v.byteOffset, v.byteLength);
  const out = new Float32Array(v.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

function int32s(v: PlistValue | undefined): number[] {
  if (!(v instanceof Uint8Array)) return [];
  const view = new DataView(v.buffer, v.byteOffset, v.byteLength);
  return Array.from({ length: v.length >> 2 }, (_, i) => view.getInt32(i * 4, true));
}

type Dict = { [key: string]: PlistValue };

/** The first dictionary in the tree, depth first, that `test` accepts. */
function findDict(
  tree: PlistValue,
  test: (d: Dict) => boolean,
  seen = new Set<object>(),
): Dict | null {
  if (Array.isArray(tree)) {
    if (seen.has(tree)) return null;
    seen.add(tree);
    for (const v of tree) {
      const hit = findDict(v, test, seen);
      if (hit) return hit;
    }
    return null;
  }
  if (!isDict(tree) || seen.has(tree)) return null;
  seen.add(tree);
  if (test(tree)) return tree;
  for (const v of Object.values(tree)) {
    const hit = findDict(v, test, seen);
    if (hit) return hit;
  }
  return null;
}

function valueIn(tree: PlistValue, key: string): PlistValue | undefined {
  return findDict(tree, (d) => key in d)?.[key];
}

function numberIn(tree: PlistValue, key: string): number | undefined {
  const v = valueIn(tree, key);
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}
