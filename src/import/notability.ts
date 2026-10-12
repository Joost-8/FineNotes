/**
 * Notability notes (`.note`) as FineNotes documents. Pure.
 *
 * The format is undocumented. A `.note` file is a zip holding a folder with
 * `Session.plist` (a binary NSKeyedArchiver graph), `Images/`, `PDFs/` and
 * `Recordings/`. The ink is one "spatial hash" of byte arrays, all
 * little-endian:
 *
 * - `curvesnumpoints`: int32 per stroke, its number of points;
 * - `curvespoints`: float32 x, y per point. A stroke of 3m + 1 points is m
 *   cubic Béziers (anchor, control, control, anchor, …);
 * - `curveswidth`: float32 per stroke, its width;
 * - `curvesfractionalwidths`: float32 per anchor, a multiplier of that width
 *   (max(⌊n / 3⌋ + 1, 2) of them per stroke);
 * - `curvescolors`: RGBA bytes per stroke.
 *
 * The note is one long column of pages `pageWidthInDocumentCoordsKey` wide.
 * Where it was checked: Julia Evans' reverse engineering (2018) and a note of
 * that era. Pictures, PDFs and recordings are not read yet: they are counted
 * and reported, so nothing is lost silently.
 */

import type { InkDocument, Page, Stroke } from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { PAGE_SIZES } from "../model/templates";
import { isDict, parseBinaryPlist, unarchive, type PlistValue } from "./bplist";
import {
  hexColor,
  median,
  packageRoot,
  pressureForWidth,
  round2,
  type ImportResult,
} from "./import-types";

export class NotabilityError extends Error {}

/** Below this opacity a stroke is taken for the highlighter. */
const HIGHLIGHTER_ALPHA = 0.95 * 255;

/** Page width in Notability's units when the note does not say. */
const DEFAULT_PAGE_WIDTH = 574;

/** Page px between the points a Bézier is sampled at. */
const SAMPLE_SPACING = 2;

/** Whether a set of zip entries is a Notability note. */
export function isNotability(files: ReadonlyMap<string, Uint8Array>): boolean {
  return findSession(files) !== null;
}

function findSession(files: ReadonlyMap<string, Uint8Array>): string | null {
  const root = packageRoot(files, "Session.plist");
  return root === null ? null : `${root}Session.plist`;
}

export function readNotability(
  files: ReadonlyMap<string, Uint8Array>,
  fallbackTitle: string,
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
  const hash = findDict(tree, (d) => d.curvespoints instanceof Uint8Array);
  const name =
    (isDict(session) && typeof session.name === "string" && session.name) || fallbackTitle;

  // The note is drawn on a column of Letter pages (Notability's default paper).
  const unitWidth = numberIn(tree, "pageWidthInDocumentCoordsKey") ?? DEFAULT_PAGE_WIDTH;
  const letter = PAGE_SIZES.find((s) => s.id === "letter") ?? { width: 1053, height: 1362 };
  const k = letter.width / unitWidth;

  const strokes = hash ? readCurves(hash, k) : [];
  const pageCount = Math.max(1, ...strokes.map((s) => Math.floor(s.top / letter.height) + 1));
  const pages: Page[] = Array.from({ length: pageCount }, (_, i) => ({
    id: `p${i + 1}`,
    kind: "ink",
    geometry: { width: letter.width, height: letter.height },
    backdrop: { kind: "blank" },
    strokes: [],
    images: [],
    textBoxes: [],
  }));
  let n = 0;
  for (const s of strokes) {
    const index = Math.min(pageCount - 1, Math.max(0, Math.floor(s.top / letter.height)));
    const offset = index * letter.height;
    const pts = s.pts.slice();
    for (let i = 1; i < pts.length; i += 3) pts[i] = round2(pts[i] - offset);
    pages[index].strokes.push({ ...s.stroke, id: `s${++n}`, pts });
  }

  const warnings: string[] = [];
  const count = (key: string): number => {
    const v = valueIn(tree, key);
    return Array.isArray(v) ? v.length : 0;
  };
  const pictures = count("mediaObjects");
  const pdfs = count("pdfFiles");
  const recordings = [...files.keys()].filter(
    (f) => f.startsWith(`${root}Recordings/`) && !f.endsWith(".plist") && !f.endsWith("/"),
  ).length;
  const typed =
    typeof stringIn(tree, "stringKey") === "string" &&
    (stringIn(tree, "stringKey") ?? "").trim() !== "";
  if (pictures > 0)
    warnings.push(`${pictures} picture${pictures === 1 ? "" : "s"} could not be brought over yet.`);
  if (pdfs > 0) warnings.push(`${pdfs} PDF${pdfs === 1 ? "" : "s"} could not be brought over yet.`);
  if (recordings > 0) {
    warnings.push(
      `${recordings} recording${recordings === 1 ? "" : "s"} could not be brought over yet.`,
    );
  }
  if (typed) warnings.push("Typed text could not be brought over yet.");
  if (!hash) warnings.push("No handwriting was found in this note.");

  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: letter.width, scale: 1 },
    pages,
  };
  return { source: "notability", title: name, doc, attachments: [], warnings };
}

interface PlacedStroke {
  stroke: Omit<Stroke, "id">;
  pts: number[];
  /** The stroke's first y, in page px down the whole column. */
  top: number;
}

function readCurves(hash: { [key: string]: PlistValue }, k: number): PlacedStroke[] {
  const counts = int32s(hash.curvesnumpoints);
  const points = float32s(hash.curvespoints);
  const widths = float32s(hash.curveswidth);
  const colours = hash.curvescolors instanceof Uint8Array ? hash.curvescolors : new Uint8Array();
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
    out.push({
      stroke: {
        color: hexColor(r / 255, g / 255, b / 255),
        size,
        tool: a < HIGHLIGHTER_ALPHA ? "highlighter" : "pen",
        pts: [],
      },
      pts,
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

function stringIn(tree: PlistValue, key: string): string | undefined {
  const v = valueIn(tree, key);
  return typeof v === "string" ? v : undefined;
}
