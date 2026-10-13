/**
 * How FineNotes' whole-notebook work grows with the notebook: open, save,
 * edit, the on-device reading pass, search, handwriting reading and PDF
 * export, measured under Node on stress notebooks (scale-fixtures.ts).
 *
 *   npm run bench:scale                      # quick: 50 and 200 typical pages
 *   npm run bench:scale -- --full            # every size in research/SCALE.md
 *   npm run bench:scale -- --sizes 100,500 --density dense --json out.json
 *
 * Numbers are laptop numbers: an older iPad is several times slower, and
 * kills the web view rather than throwing when memory runs out. Compare runs
 * on one machine, before and after a change.
 *
 * Not part of `npm test`: the full run takes minutes and gigabytes.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { layoutPages } from "../../src/canvas/page-layout";
import {
  MAX_INFLATED_BYTES,
  SAVE_LEVEL,
  deflateToBase64,
  inflateFromBase64,
} from "../../src/model/compress";
import { AddPage, RemovePage } from "../../src/model/commands";
import { blankPage, type InkDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { MovePage, RemoveStrokesFromPage, nextPageId } from "../../src/model/page-commands";
import { DocumentEncoder, buildInkFile, parseInkFile } from "../../src/model/serialize";
import { nextDeviceStep } from "../../src/recognition/device-reading";
import {
  pageContentHash,
  pageKeys,
  transcriptSources,
  updatePageTranscripts,
} from "../../src/recognition/page-transcripts";
import { readTextSection, writeTextSection } from "../../src/recognition/text-layer";
import { collectPageText, searchPages } from "../../src/search/notebook-search";
import { highestIdNumber, strokeIdsOf, textBoxIdsOf } from "../../src/view/id-sequence";
import { StrokeIndex } from "../../src/view/stroke-index";
import { type Density, pointCount, stressNotebook } from "./scale-fixtures";

// --- Arguments -----------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const option = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const full = flag("full");
const sizes = (option("sizes") ?? (full ? "50,200,500,1000" : "50,200")).split(",").map(Number);
const densities = (option("density") ?? (full ? "typical,dense" : "typical")).split(
  ",",
) as Density[];
const jsonOut = option("json");
const skip = new Set((option("skip") ?? "").split(",").filter(Boolean));
/** Back every page with a PDF (`--pdf-backed`), and ink every n-th page (`--ink-every n`). */
const pdfBacked = flag("pdf-backed") ? "lecture.pdf" : undefined;
const inkEvery = Number(option("ink-every") ?? 1);

// --- Measuring -------------------------------------------------------------------

const gc = (globalThis as { gc?: () => void }).gc;
function heapMB(): number {
  gc?.();
  gc?.();
  return process.memoryUsage().heapUsed / 1e6;
}

/** Median wall time of `runs` calls, ms; one call for anything over a second. */
function time(fn: () => void, runs = 5): number {
  const t0 = performance.now();
  fn();
  const first = performance.now() - t0;
  if (first > 1000 || runs <= 1) return first;
  const all = [first];
  for (let i = 1; i < runs; i++) {
    const t = performance.now();
    fn();
    all.push(performance.now() - t);
  }
  return all.sort((a, b) => a - b)[all.length >> 1];
}

const round = (n: number, digits = 1): number => Math.round(n * 10 ** digits) / 10 ** digits;
type Row = Record<string, string | number | boolean>;
const results: Row[] = [];
function report(row: Row): void {
  results.push(row);
  console.log(
    Object.entries(row)
      .map(([k, v]) => `${k}=${typeof v === "number" ? round(v) : v}`)
      .join("  "),
  );
}

/** Try something that may run out of string length or memory, and say so. */
function attempt<T>(fn: () => T): T | string {
  try {
    return fn();
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

// --- One notebook ---------------------------------------------------------------

/** A text section with every page read, about a dozen words a line. */
function transcribedBody(doc: InkDocument): string {
  const keys = pageKeys(doc.pages);
  const words = "network packet router latency queue window lecture notes about the layer".split(
    " ",
  );
  const updates = doc.pages.map((page, i) => {
    const lines: string[] = [];
    for (let l = 0; l < 25; l++) {
      lines.push(words.map((w, k) => ((k + l + i) % 7 === 0 ? `${w}${i}` : w)).join(" "));
    }
    return { key: keys[i], text: lines.join("\n"), hash: pageContentHash(page), device: true };
  });
  return writeTextSection("", updatePageTranscripts(null, keys, updates));
}

function benchNotebook(pages: number, density: Density): void {
  const tag = { pages, density, ...(pdfBacked ? { pdfBacked: true, inkEvery } : {}) };
  const doc = stressNotebook(pages, { density, pdf: pdfBacked, inkEvery });
  const strokes = doc.pages.reduce((n, p) => n + p.strokes.length, 0);
  const points = pointCount(doc);

  // First save: stringify everything, deflate at the save level.
  const encoder = new DocumentEncoder();
  let file = "";
  const firstSave = attempt(() => time(() => (file = buildInkFile("", doc, encoder)), 1));
  if (typeof firstSave === "string") {
    report({ ...tag, strokes, points, saveError: firstSave });
    return;
  }
  const payload = file.slice(file.indexOf("\n") + 1, file.lastIndexOf("\n%%"));
  const json = inflateFromBase64(payload.slice(payload.indexOf(":") + 1), Infinity);
  const jsonMB = json.length / 1e6;

  // A save after one more stroke: what every pause in writing costs.
  const last = doc.pages[doc.pages.length - 1];
  last.strokes.push({ id: "s-extra", color: "#1a1a1a", size: 2, tool: "pen", pts: [10, 10, 0.5] });
  const editSave = time(() => buildInkFile("", doc, encoder), 1);
  last.strokes.pop();
  // How much of a save is DEFLATE (and base64), the rest being JSON.
  const deflate = time(() => deflateToBase64(json, SAVE_LEVEL), 1);

  // Open: read the file (inflate, JSON.parse, validate), then what
  // setViewData and setDocument do with it.
  const before = heapMB();
  let parsed: ReturnType<typeof parseInkFile> = { body: "", doc: null };
  const parse = time(() => (parsed = parseInkFile(file)), 1);
  const openHeap = heapMB() - before;
  const opened = parsed.doc;
  const held = opened === null;
  const fileMB = file.length / 1e6;
  if (!opened) {
    report({
      ...tag,
      strokes,
      points,
      fileMB,
      jsonMB,
      overCap: json.length > MAX_INFLATED_BYTES,
      firstSave,
      editSave,
      deflate,
      parse,
      held,
    });
    return;
  }
  const reader = new DocumentEncoder();
  const remember = time(() => reader.remember(payload, parsed.json), 1);
  const index = new StrokeIndex();
  const indexRebuild = time(() => index.rebuild(opened.pages), 3);
  const ids = time(() => highestIdNumber(strokeIdsOf(opened), "s"), 3);
  const layout = time(() => layoutPages(opened.pages), 3);

  // Page commands as InkSurface.applyCommand runs them.
  const history = new History();
  const applyCommand = (command: AddPage | RemovePage | MovePage): void => {
    history.push(opened, command);
    highestIdNumber(strokeIdsOf(opened), "s");
    highestIdNumber(textBoxIdsOf(opened), "t");
    index.rebuild(opened.pages);
    layoutPages(opened.pages);
  };
  const addPage = time(
    () => applyCommand(new AddPage(opened.pages.length, blankPage(nextPageId(opened)))),
    3,
  );
  const movePage = time(() => applyCommand(new MovePage(0, opened.pages.length - 1)), 3);
  const deletePage = time(() => applyCommand(new RemovePage(opened.pages.length - 1)), 3);
  // An erase commit: one stroke off the page in view, then that page of the
  // index again (InkSurface.eraseCommit).
  const erase = time(() => {
    const page = opened.pages[0];
    const id = page.strokes[page.strokes.length - 1]?.id ?? "";
    history.push(opened, new RemoveStrokesFromPage(page.id, new Set([id])));
    index.refreshPages(opened.pages, [page.id]);
  }, 3);
  const undo = time(() => {
    history.undo(opened);
    index.rebuild(opened.pages);
  }, 3);

  // The on-device reading pass after an edit, every page already read.
  const body = transcribedBody(opened);
  const read = new Map(pageKeys(opened.pages).map((k, i) => [k, pageContentHash(opened.pages[i])]));
  const readingPass = time(() => {
    nextDeviceStep({
      pages: opened.pages,
      keys: pageKeys(opened.pages),
      entries: transcriptSources(readTextSection(body)),
      hashOf: pageContentHash,
      read,
      current: 0,
    });
  }, 3);
  const hashAll = time(() => opened.pages.forEach(pageContentHash), 3);

  // Search: build the index from the text layer as the search opens, then
  // the query each keystroke runs (the modal searches on every input).
  let found = 0;
  let searchIndex: ReturnType<typeof collectPageText> = [];
  const search = time(
    () => (searchIndex = collectPageText(opened.pages, readTextSection(body), null)),
    3,
  );
  const keys = ["r", "ro", "rou", "rout", "route", "router", "router l", "router la"];
  let k = 0;
  const keystroke = time(() => {
    found = searchPages(searchIndex, keys[k++ % keys.length]).length;
  }, 8);

  report({
    ...tag,
    strokes,
    points,
    fileMB,
    jsonMB,
    overCap: json.length > MAX_INFLATED_BYTES,
    firstSave,
    editSave,
    deflate,
    parse,
    remember,
    openHeapMB: openHeap,
    indexRebuild,
    ids,
    layout,
    addPage,
    movePage,
    deletePage,
    erase,
    undo,
    readingPass,
    hashAll,
    search,
    keystroke,
    found,
    bodyMB: round(body.length / 1e6, 2),
  });
}

/** Past the cap: the same notebook with the read limit lifted, for its cost alone. */
function benchJsonOnly(pages: number, density: Density): void {
  const doc = stressNotebook(pages, { density });
  let json = 0;
  for (const page of doc.pages) json += JSON.stringify(page).length;
  report({ pages, density, points: pointCount(doc), approxJsonMB: json / 1e6 });
}

// --- Handwriting reading ------------------------------------------------------------

async function benchReading(): Promise<void> {
  const model = "models/grape-1.0.bin";
  if (!existsSync(model)) return;
  const { parseBundle } = await import("../../src/recognition/hwr/bundle");
  const { readPage } = await import("../../src/recognition/hwr/recognizer");
  const bundle = parseBundle(readFileSync(model));
  for (const density of ["typical", "dense"] as const) {
    const page = stressNotebook(1, { density }).pages[0];
    const ink = page.strokes.map((s) => ({
      id: s.id,
      tool: s.tool,
      shape: null,
      t0: s.t0,
      pts: s.pts,
    }));
    let lines = 0;
    const ms = time(() => (lines = readPage(bundle, ink, { useLm: true }).lines.length), 1);
    report({ reading: density, strokes: ink.length, lines, msPerPage: ms });
  }
}

// --- PDFs ---------------------------------------------------------------------------

/**
 * A PNG of `w` x `h` RGBA. Without a seed: transparent, with a few dark rows
 * (an annotation layer). With one: noise, a photo's worth of entropy.
 */
function annotationPng(w: number, h: number, seed = 0): Uint8Array {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  if (seed) {
    let a = seed;
    for (let i = 0; i < raw.length; i++) {
      a = (Math.imul(a, 1103515245) + 12345) >>> 0;
      raw[i] = i % (w * 4 + 1) === 0 ? 0 : a >>> 24;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) raw[y * (w * 4 + 1) + 1 + x * 4 + 3] = 255;
    }
  }
  for (let y = 0; y < h && !seed; y += 37) {
    for (let x = 40; x < w - 40; x++) {
      const at = y * (w * 4 + 1) + 1 + x * 4;
      if ((x * 7 + y) % 11 < 6) raw.writeUInt32BE(0x1a1a1aff, at);
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A lecture-like PDF: a title and body text on every page, a picture on every third. */
async function makePdf(pages: number): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const picture = await pdf.embedPng(annotationPng(600, 400));
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([720, 540]);
    page.drawText(`Lecture slide ${i + 1}: queues and latency`, { x: 40, y: 490, size: 24, font });
    for (let l = 0; l < 14; l++) {
      page.drawText(`Point ${l + 1} on slide ${i + 1}: packets wait in the router queue.`, {
        x: 50,
        y: 450 - l * 22,
        size: 13,
        font,
        color: rgb(0.1, 0.1, 0.2),
      });
    }
    if (i % 3 === 0) page.drawImage(picture, { x: 380, y: 60, width: 300, height: 200 });
    if (i % 3 === 1) {
      const photo = await pdf.embedPng(annotationPng(160, 120, i + 1));
      page.drawImage(photo, { x: 40, y: 40, width: 320, height: 240 });
    }
  }
  return pdf.save();
}

async function benchPdf(): Promise<void> {
  const dir = option("pdf-out") ?? "scripts/scale/out";
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const pdfSizes = full ? [100, 500, 1000, 2500] : [100];
  for (const pages of pdfSizes) {
    const path = `${dir}/lecture-${pages}.pdf`;
    let bytes: Uint8Array;
    if (existsSync(path)) bytes = readFileSync(path);
    else {
      bytes = await makePdf(pages);
      writeFileSync(path, bytes);
    }
    const { PDFDocument } = await import("pdf-lib");
    let loaded = 0;
    const t0 = performance.now();
    loaded = (await PDFDocument.load(bytes)).getPageCount();
    const load = performance.now() - t0;
    report({ pdf: pages, MB: bytes.length / 1e6, pdfLibLoadMs: load, pagesRead: loaded });
  }
  // Export of a PDF-backed notebook, light ink on every page, as pdf-export.ts
  // composes it: source pages embedded, one annotation PNG laid over each.
  const exportPages = Number(option("export") ?? (full ? 1000 : 100));
  const source = readFileSync(`${dir}/lecture-${exportPages}.pdf`);
  const { PdfComposer } = await import("../../src/export/pdf-composer");
  const doc = stressNotebook(exportPages, { density: "light", pdf: "lecture.pdf" });
  const overlay = annotationPng(2048, 1536);
  const before = heapMB();
  const t0 = performance.now();
  const composer = await PdfComposer.create("Stress", async () => source.slice().buffer);
  let peak = 0;
  for (const page of doc.pages) {
    await composer.addPdf(page, async function* () {
      yield { png: overlay };
    });
    if (page.id.endsWith("00")) peak = Math.max(peak, heapMB() - before);
  }
  const out = await composer.save();
  report({
    export: exportPages,
    kind: "pdf-backed",
    ms: performance.now() - t0,
    outMB: out.length / 1e6,
    overlayKB: overlay.length / 1e3,
    peakHeapMB: Math.max(peak, heapMB() - before),
  });
}

// --- Run --------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`node ${process.version}, gc ${gc ? "exposed" : "not exposed (pass --expose-gc)"}`);
  if (!skip.has("notebooks")) {
    for (const density of densities) {
      for (const pages of sizes) {
        if (density === "dense" && pages >= 1000 && !flag("huge")) benchJsonOnly(pages, density);
        else benchNotebook(pages, density);
      }
    }
  }
  if (!skip.has("reading")) await benchReading();
  if (!skip.has("pdf")) await benchPdf();
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
}

void main();
