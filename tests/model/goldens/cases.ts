/**
 * Inputs for the file-format goldens (`tests/model/goldens.test.ts`).
 *
 * The in-memory documents fed to the encoder are rebuilt here on every run
 * instead of being stored, so the golden files hold only what the serializer
 * made of them, plus a SHA-256 of each input. That makes this file part of
 * the golden:
 *
 * - it imports nothing from `src/` except types, and keeps its own copy of
 *   every list it picks from, so reordering a list in the model cannot
 *   quietly change what is being tested;
 * - all randomness comes from one seeded generator, so every machine builds
 *   the same documents;
 * - any edit here changes the inputs, and the stored hashes then fail loudly.
 *
 * The documents are deliberately not all valid. They are what a running
 * editor might hold: floats that sit on a rounding edge, pressure outside
 * 0..1, a ragged point array, a NaN that crept in, a negative `t0`, key
 * orders other than the usual one, and a stray key the encoder copies as is.
 */

import { createHash } from "node:crypto";
import type { InkDocument } from "../../../src/model/document";

/** The seed every golden document is built from. Changing it regenerates nothing: it breaks the goldens. */
export const GOLDEN_SEED = 20260925;

/** mulberry32: tiny, fast, and the same sequence on every platform. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in `lo..hi`, both included. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
}

// --- JSON that keeps NaN and Infinity --------------------------------------

const NON_FINITE = "$number";

/**
 * `JSON.stringify`, except that NaN and ±Infinity are written as
 * `{"$number":"NaN"}` rather than `null`, so a golden can tell a value that
 * decoded as Infinity from one that decoded as NaN or as a real null.
 */
export function stringifyTagged(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "number" && !Number.isFinite(v) ? { [NON_FINITE]: String(v) } : v,
  );
}

/** The inverse of {@link stringifyTagged}. */
export function parseTagged(text: string): unknown {
  return JSON.parse(text, (_key, v: unknown) => {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === NON_FINITE) {
        return Number((v as Record<string, string>)[NON_FINITE]);
      }
    }
    return v;
  });
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// --- Vocabulary (own copies, see the header) --------------------------------

const RULINGS = [
  "blank",
  "dotted",
  "ruled-narrow",
  "ruled-wide",
  "squared",
  "cornell",
  "legal",
  "single-column",
  "three-column",
  "single-column-mix",
  "todos",
  "weekly-planner",
  "monthly-planner",
  "accounting",
  "music",
  "guitar-tab",
  "title-date",
  "cover-plain",
  "cover-label",
  "cover-band",
  "cover-linen",
  "lined",
  "grid",
] as const;

const SHAPES = [
  "line",
  "circle",
  "rect",
  "arrow",
  "ellipse",
  "triangle",
  "diamond",
  "roundrect",
  "polygon",
  "star",
] as const;

const FONTS = ["sans", "serif", "times", "mono", "verdana", "trebuchet"] as const;
const ALIGNS = ["left", "center", "right", "justify"] as const;
const INKS = [
  "#1a1a1a",
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#ffffff",
  "#abc",
  "#11223344",
  "rgb(1, 2, 3)",
] as const;

const TEXTS = [
  "",
  "Hello",
  "multi\nline\ntext",
  'quotes " and \\ backslash',
  "unicode: café 漢字 🖊️",
  "%%goodobsidian\nv2:abc\n%%",
  "\u2028 line separator \u2029",
  "tab\there",
] as const;

/** Coordinates that land on a rounding edge once multiplied by 100. */
const EDGE_COORDS = [
  1.005, 2.675, 0.285, 1.115, -1.005, -0.025, 0.125, 99.995, 123.455, 1448.004999, 5e-3, 1e-7, 0,
  1024, -0.005, 0.015,
] as const;

/** Pressures that land on a rounding edge at 255 steps, and a few out of range. */
const EDGE_PRESSURES = [
  0,
  1,
  0.5,
  1 / 255,
  127.5 / 255,
  254.5 / 255,
  0.00196,
  0.998,
  0.50196078431,
  1.2,
  -0.1,
] as const;

// --- Builders ---------------------------------------------------------------

type Json = Record<string, unknown>;

/** Sometimes rebuild `obj` with its keys in a random order: the encoder must not care, or must copy it. */
function maybeShuffled(rng: Rng, obj: Json): Json {
  if (!rng.chance(0.3)) return obj;
  const entries = Object.entries(obj);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return Object.fromEntries(entries);
}

function times<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

function coord(rng: Rng): number {
  const r = rng.next();
  if (r < 0.15) return rng.pick(EDGE_COORDS);
  if (r < 0.35) return rng.next() * 1100 - 40; // full double precision
  return Math.round(rng.next() * 1_140_000) / 1000 - 40; // three decimals
}

function pressure(rng: Rng): number {
  if (rng.chance(0.15)) return rng.pick(EDGE_PRESSURES);
  return Math.round(rng.next() * 10_000) / 10_000;
}

function stroke(rng: Rng, index: number, points = rng.int(0, 6)): Json {
  const pts: number[] = [];
  for (let i = 0; i < points; i++) pts.push(coord(rng), coord(rng), pressure(rng));
  if (rng.chance(0.04)) pts.push(coord(rng)); // ragged: one number past the last whole point
  if (pts.length > 0 && rng.chance(0.03)) pts[rng.int(0, pts.length - 1)] = NaN;
  const s: Json = {
    id: rng.chance(0.85) ? `s${index + 1}` : rng.pick(["s7", "stroke", "s01", ""]),
    color: rng.pick(INKS),
    size: rng.chance(0.01) ? NaN : rng.pick([2, 3, 5, 8, 12, 1.5, 0.25]),
    tool: rng.chance(0.8) ? "pen" : "highlighter",
    pts,
  };
  const shape = rng.next();
  if (shape < 0.25) s.shape = rng.pick(SHAPES);
  else if (shape < 0.28) s.shape = rng.pick(["hexagon", ""]);
  const t0 = rng.next();
  if (t0 < 0.4) s.t0 = rng.int(0, 3_600_000);
  else if (t0 < 0.5) s.t0 = rng.pick([1234.7, 0.5, 0, 2.5, -5, NaN, Infinity]);
  return maybeShuffled(rng, s);
}

function fraction(rng: Rng): number {
  return rng.pick([0, 0.1, 0.25, 0.5, 0.8, 0.9, 1, 0.3333333333333333]);
}

function image(rng: Rng, index: number): Json {
  const img: Json = {
    id: rng.chance(0.85) ? `i${index + 1}` : rng.pick(["i9", "img", "i02"]),
    path: rng.pick(["Attachments/a.png", "b.jpg", "pics/über café.webp"]),
    x: coord(rng),
    y: coord(rng),
    w: rng.pick([100, 1, 0.5, 333.33, 1024]),
    h: rng.pick([100, 1, 0.5, 250.125, 1448]),
  };
  if (rng.chance(0.4)) img.rotation = rng.pick([0.25, -Math.PI / 2, 0, Math.PI]);
  if (rng.chance(0.3)) {
    img.crop = maybeShuffled(rng, {
      x: fraction(rng),
      y: fraction(rng),
      w: fraction(rng),
      h: fraction(rng),
    });
  }
  if (rng.chance(0.2)) img.locked = true;
  if (rng.chance(0.05)) img.note = "a key the model does not know";
  return maybeShuffled(rng, img);
}

function textBox(rng: Rng, index: number): Json {
  const box: Json = {
    id: rng.chance(0.85) ? `t${index + 1}` : rng.pick(["t5", "text", "t007"]),
    x: coord(rng),
    y: coord(rng),
    w: rng.pick([320, 8, 40, 79.5, 612.25]),
  };
  if (rng.chance(0.3)) box.h = rng.pick([140, 24, 10, 300.5]);
  if (rng.chance(0.3)) box.fit = true;
  box.text = rng.pick(TEXTS);
  box.color = rng.pick(INKS);
  box.fontSize = rng.pick([22, 12, 16, 9, 48.5]);
  if (rng.chance(0.3)) box.font = rng.pick(FONTS);
  if (rng.chance(0.2)) box.bold = true;
  if (rng.chance(0.2)) box.italic = true;
  if (rng.chance(0.15)) box.underline = true;
  if (rng.chance(0.15)) box.strike = true;
  if (rng.chance(0.25)) box.align = rng.pick(ALIGNS);
  if (rng.chance(0.2)) box.lineHeight = rng.pick([1.25, 0.8, 3, 1.5]);
  if (rng.chance(0.2)) box.fill = rng.pick(["#fff3bf", "#11223344", "#abc"]);
  return maybeShuffled(rng, box);
}

function backdrop(rng: Rng): Json {
  if (rng.chance(0.15)) {
    return maybeShuffled(rng, {
      kind: "pdf",
      path: rng.pick(["Lectures/w3.pdf", "slides.pdf"]),
      page: rng.int(0, 40),
    });
  }
  const b: Json = { kind: rng.pick(RULINGS) };
  if (rng.chance(0.3)) b.spacing = rng.pick([28, 40, 36.5, 12]);
  if (rng.chance(0.3)) b.color = rng.pick(["#e0e0e0", "#c9d7ff"]);
  if (rng.chance(0.3)) b.paperColor = rng.pick(["#ffffff", "#fbf8ed", "#fdf6d8", "#c0643f"]);
  return maybeShuffled(rng, b);
}

function page(rng: Rng, index: number): Json {
  const p: Json = {
    id: rng.chance(0.8) ? `p${index + 1}` : rng.pick(["cover", "p-001", "p9"]),
    kind: "ink",
    geometry: maybeShuffled(rng, {
      width: rng.pick([1024, 1448, 768, 1024.5]),
      height: rng.pick([1448, 1024, 2000, 1447.25]),
    }),
    backdrop: backdrop(rng),
    strokes: times(rng.int(0, 4), (i) => stroke(rng, i)),
    images: times(rng.int(0, 2), (i) => image(rng, i)),
    textBoxes: times(rng.int(0, 2), (i) => textBox(rng, i)),
  };
  const epoch = rng.next();
  if (epoch < 0.25)
    p.epoch = rng.pick([1_790_000_000_123, 1_790_000_000_123.6, 1_790_000_000_000.4]);
  else if (epoch < 0.3) p.epoch = rng.pick([0, -1, NaN]);
  const bookmark = rng.next();
  if (bookmark < 0.2) p.bookmarked = true;
  else if (bookmark < 0.24) p.bookmarked = false;
  return maybeShuffled(rng, p);
}

function recording(rng: Rng, index: number): Json {
  const r: Json = {
    id: `r${index + 1}`,
    path: rng.pick(["Recordings/lecture.m4a", "audio/über.webm"]),
    start: rng.pick([1_790_000_000_000, 1_790_000_000_000.7]),
    duration: rng.pick([0, 61_000, 1500.5]),
  };
  if (rng.chance(0.4)) r.transcript = "Transcripts/lecture.md";
  return maybeShuffled(rng, r);
}

function folders(rng: Rng): Json {
  const f: Json = {};
  const values = ["Attachments", "a/b/", "", ".hidden/x", " Media ", "Audio/2026"];
  if (rng.chance(0.6)) f.images = rng.pick(values);
  if (rng.chance(0.5)) f.audio = rng.pick(values);
  if (rng.chance(0.4)) f.exports = rng.pick(values);
  return maybeShuffled(rng, f);
}

function document(rng: Rng): Json {
  const view: Json = {
    scrollY: rng.pick([0, 120.5, 3000]),
    width: rng.pick([1024, 800, 1366.5]),
    scale: rng.pick([1, 0.75, 2.5]),
  };
  if (rng.chance(0.03)) view.zoom = 2;
  const d: Json = {
    version: rng.pick([2, 2, 2, 3, 1]),
    view: maybeShuffled(rng, view),
    pages: times(rng.int(1, 3), (i) => page(rng, i)),
  };
  if (rng.chance(0.2)) d.recognizedHash = rng.pick(["abc123", "k3j9x", ""]);
  const single = rng.next();
  if (single < 0.2) d.single = true;
  else if (single < 0.25) d.single = false;
  const recordings = rng.next();
  if (recordings < 0.2) d.recordings = times(rng.int(1, 2), (i) => recording(rng, i));
  else if (recordings < 0.25) d.recordings = [];
  if (rng.chance(0.2)) d.folders = folders(rng);
  const scroll = rng.next();
  if (scroll < 0.2) d.scroll = "horizontal";
  else if (scroll < 0.25) d.scroll = "vertical";
  return maybeShuffled(rng, d);
}

export interface GoldenDocument {
  name: string;
  doc: InkDocument;
}

/** How many seeded documents the encode goldens cover. */
export const RANDOM_DOCUMENTS = 180;

/**
 * Every in-memory document the encode goldens start from: the seeded ones,
 * one with every optional field set, and one long enough to span several
 * deflate blocks.
 */
export function goldenDocuments(): GoldenDocument[] {
  const rng = new Rng(GOLDEN_SEED);
  const out: GoldenDocument[] = times(RANDOM_DOCUMENTS, (i) => ({
    name: `random-${String(i + 1).padStart(3, "0")}`,
    doc: document(rng) as unknown as InkDocument,
  }));

  const full = document(rng);
  const fullPage = page(rng, 0);
  Object.assign(fullPage, {
    epoch: 1_790_000_000_123,
    bookmarked: true,
    strokes: [
      { ...stroke(rng, 0, 3), shape: "arrow", t0: 1500 },
      { ...stroke(rng, 1, 2), tool: "highlighter" },
    ],
    images: [
      {
        id: "i1",
        path: "a.png",
        x: 1,
        y: 2,
        w: 3,
        h: 4,
        rotation: 0.5,
        crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
        locked: true,
      },
    ],
    textBoxes: [
      {
        id: "t1",
        x: 5,
        y: 6,
        w: 200,
        h: 80,
        fit: true,
        text: "every style",
        color: "#1a1a1a",
        fontSize: 18,
        font: "serif",
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        align: "justify",
        lineHeight: 1.5,
        fill: "#fff3bf",
      },
    ],
  });
  Object.assign(full, {
    pages: [fullPage],
    recognizedHash: "abc123",
    single: true,
    recordings: [recording(rng, 0)],
    folders: { images: "Attachments", audio: "Audio", exports: "Exports" },
    scroll: "horizontal",
  });
  out.push({ name: "every-optional-field", doc: full as unknown as InkDocument });

  const large = document(rng);
  (large.pages as Json[])[0].strokes = [stroke(rng, 0, 3000)];
  out.push({ name: "large-multi-block", doc: large as unknown as InkDocument });
  return out;
}

// --- The golden files -------------------------------------------------------

/** What an input did: the decoded document (tagged JSON) and its re-encoding, or the error class. */
export type Outcome = { doc: string; reencoded: string } | { error: string };

export interface EncodeGoldens {
  commit: string;
  /** Rebuilt by {@link goldenDocuments}; the hashes are of {@link stringifyTagged} output. */
  documents: Array<{
    name: string;
    inputSha256: string;
    payload: string;
    decodedSha256: string;
  }>;
  emptyDocuments: Array<{ width: number | null; json: string; payload: string }>;
  points: Array<{ name: string; input: string; quantized: string; restored: string }>;
}

export interface DecodeGoldens {
  commit: string;
  cases: Array<{ name: string; payload: string; fallbackWidth: number | null } & Outcome>;
}

export interface FileGoldens {
  commit: string;
  build: Array<{ name: string; body: string; doc: string; file: string }>;
  parse: Array<{
    name: string;
    markdown: string;
    fallbackWidth: number | null;
    body: string;
    doc: string | null;
  }>;
  split: Array<{ body: string; frontmatter: string; prose: string }>;
}

export interface CompressGoldens {
  commit: string;
  deflate: Array<{ name: string; base64: string }>;
  inflate: Array<{ name: string; base64: string; maxBytes: number | null } & InflateOutcome>;
}

export type InflateOutcome = { text: string } | { throws: true };

/** Texts the compress goldens deflate. The long ones are built, not stored. */
export function compressTexts(): Array<{ name: string; text: string }> {
  const rng = new Rng(GOLDEN_SEED + 1);
  const numbers = times(2_000, () => rng.int(0, 99_999)).join(",");
  return [
    { name: "empty", text: "" },
    { name: "one-char", text: "a" },
    { name: "ascii", text: "the quick brown fox jumps over the lazy dog" },
    { name: "unicode", text: "handwriting ✍️ — café — 漢字 — \u0000\u001f" },
    { name: "lone-surrogate", text: "before \ud800 after \udc00" },
    { name: "bom-first", text: "\ufeff{}" },
    { name: "repetitive-100k", text: "x".repeat(100_000) },
    { name: "numbers", text: numbers },
  ];
}
