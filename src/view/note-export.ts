/**
 * The text note's Share button (Apple Notes' share icon, in the bar's right
 * group): one control, its choices in its menu.
 *
 * - Export as PDF: the note's A4 pages (`note-pdf.ts`: real text, vector
 *   handwriting), saved in the note's Exports folder.
 * - Export as Markdown: a plain `.md` copy that reads anywhere
 *   (`model/note-export.ts`), its handwriting and graphs as PNGs and its
 *   pictures copied into a folder beside it.
 * - Copy as text: the note's plain text on the clipboard.
 *
 * Both exports first show the note's pages in the notebook's own export
 * dialog (`export-modal.ts`, one pattern everywhere): every page ticked, a
 * tap unticks one, Select all / None, and Export. Only ticked pages are
 * exported; for Markdown, the blocks those pages show (`noteOnPages`: a
 * block split over pages comes along when any of its pages is ticked). The
 * dialog's done screen offers Share… (the system's share sheet) and Open.
 */

import { type App, Menu, Notice, type TFile, normalizePath } from "obsidian";
import { t } from "../i18n/translate";
import { exportBaseName } from "../export/page-range";
import { makeGraph } from "../model/graph-element";
import { uniqueFileName } from "../model/new-notebook";
import {
  graphPictureName,
  inkPictureName,
  markdownTarget,
  noteMarkdown,
  notePlainText,
  relativePath,
} from "../model/note-export";
import { NOTE_PAGE_HEIGHT, NOTE_PAGE_WIDTH, noteOnPages } from "../model/note-pages";
import { stripTextNoteSuffix } from "../model/text-note-file";
import { INK_WIDTH, imageShare, type ImageBlock, type TextNote } from "../model/text-note";
import { paintGraph } from "../canvas/graph-paint";
import { errorMessage } from "../util/errors";
import { type ExportedFiles, ExportPdfModal } from "./export-modal";
import { inkSectionImages } from "./note-ask";
import { noteGraphHeight } from "./note-graph";
import { type NoteLayout, type NotePicture, drawNotePage } from "./note-page-render";
import { type NotePdfSources, exportNoteToPdf, layoutNoteForPdf } from "./note-pdf";

export interface NoteExportHost {
  readonly app: App;
  file(): TFile | null;
  /** The note as it is now. */
  note(): TextNote;
  /** Where exports are saved, without making the folder; undefined: the vault's root. */
  exportsPath(): string | undefined;
  /** The note's Exports folder, made if missing; undefined: the vault's root. */
  exportsFolder(): Promise<string | undefined>;
  pressure(): boolean;
  highlighterAlpha(): number;
}

type NoteFormat = "pdf" | "md";

/** The longest side a picture is put in a PDF at, px: print quality for a picture a page wide. */
const PICTURE_PX = 2400;
/** A page drawn as a picture (text the PDF fonts lack): 2 px a page px, as a notebook's print export. */
const RASTER_SCALE = 2;
/** Graphs in the Markdown copy: 2 px a page px. */
const GRAPH_SCALE = 2;

/** The Share button's menu, under `anchor`. Call inside the tap. */
export function shareMenu(anchor: HTMLElement, host: NoteExportHost): void {
  const menu = new Menu();
  menu.addItem((item) =>
    item
      .setTitle(t("notebooks.note.exportPdf"))
      .setIcon("file-text")
      .onClick(() => void openExport(host, "pdf")),
  );
  menu.addItem((item) =>
    item
      .setTitle(t("notebooks.note.exportMarkdown"))
      .setIcon("file-code-2")
      .onClick(() => void openExport(host, "md")),
  );
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle(t("notebooks.note.copyText"))
      .setIcon("copy")
      .onClick(() => void copyText(host)),
  );
  const at = anchor.getBoundingClientRect();
  // Right-aligned under the button: it sits at the bar's right end, as Apple Notes' share menu does.
  menu.showAtPosition({ x: at.right, y: at.bottom + 6, left: true });
}

/** One dialog being prepared at a time. */
let opening = false;

/** The note's pages, as they will export, in the export dialog. */
async function openExport(host: NoteExportHost, format: NoteFormat): Promise<void> {
  const file = host.file();
  if (!file || opening) return;
  opening = true;
  const { app } = host;
  const note = host.note();
  const title = stripTextNoteSuffix(file.name);
  let pictures = new Map<string, NotePicture>();
  try {
    pictures = await decodePictures(app, note, file.path);
    const sources = pdfSources(host, pictures);
    // The PDF's own layout (its fonts' widths), so the preview is the file's pages.
    const layout = await layoutNoteForPdf(note, sources);
    const total = layout.pages.length;
    const look = { usePressure: host.pressure(), highlighterAlpha: host.highlighterAlpha() };
    const folder = host.exportsPath();
    const names = (): Set<string> => namesIn(app, folder);
    const modal = new ExportPdfModal(app, {
      noun: "notebook",
      pageCount: total,
      currentPage: 0,
      pageSize: () => ({ width: NOTE_PAGE_WIDTH, height: NOTE_PAGE_HEIGHT }),
      folder: folder ?? null,
      scopes: false,
      ordered: false,
      formats: false,
      title: t(format === "pdf" ? "notebooks.note.exportPdf" : "notebooks.note.exportMarkdown"),
      paintPreview: (canvas, index, cssWidth) => {
        const dpr = canvas.win.devicePixelRatio || 1;
        drawNotePage(canvas, layout, index, cssWidth, dpr, look);
        return Promise.resolve();
      },
      targetFor: (pages) => {
        const base = exportBaseName(title, pages, total);
        const name =
          format === "pdf"
            ? uniqueFileName(base, ".pdf", names())
            : markdownTarget(base, names()).file;
        return { kind: "file", name };
      },
      export: (pages, _format, onProgress, cancelled) =>
        format === "pdf"
          ? exportPdf(host, note, title, sources, { pages, total, onProgress, cancelled })
          : exportMarkdown(host, noteOnPages(note, layout.pages, pages), title, pages, total),
      open: (path) => void app.workspace.openLinkText(path, "", true),
    });
    // The pictures are needed until the dialog closes: its previews and the PDF draw them.
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {
      close();
      releasePictures(pictures);
    };
    modal.open();
  } catch (error) {
    releasePictures(pictures);
    console.error("FineNotes: note export failed", error);
    new Notice(t("notebooks.note.exportFailed", { error: errorMessage(error) }));
  } finally {
    opening = false;
  }
}

function releasePictures(pictures: Map<string, NotePicture>): void {
  for (const picture of pictures.values()) {
    if (picture.source instanceof HTMLCanvasElement) {
      picture.source.width = 0;
      picture.source.height = 0;
    }
  }
  pictures.clear();
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function inFolder(folder: string | undefined, name: string): string {
  return normalizePath(folder ? `${folder}/${name}` : name);
}

/** The names in `folder` now ("" or undefined: the vault's root). */
function namesIn(app: App, folder: string | undefined): Set<string> {
  const dir = folder ? app.vault.getFolderByPath(folder) : app.vault.getRoot();
  return new Set((dir?.children ?? []).map((child) => child.name));
}

/** The vault file a picture block names, if it is there. */
function pictureFile(app: App, block: ImageBlock, from: string): TFile | null {
  return (
    app.metadataCache.getFirstLinkpathDest(block.path, from) ?? app.vault.getFileByPath(block.path)
  );
}

async function canvasBytes(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error("A picture could not be made");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Each picture decoded once, at print size, on white (a PDF picture is opaque). */
async function decodePictures(
  app: App,
  note: TextNote,
  from: string,
): Promise<Map<string, NotePicture>> {
  const pictures = new Map<string, NotePicture>();
  for (const block of note.blocks) {
    if (block.type !== "image") continue;
    const target = pictureFile(app, block, from);
    if (!target) continue;
    const image = new Image();
    image.src = app.vault.getResourcePath(target);
    try {
      await image.decode();
    } catch {
      continue;
    }
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    if (!(w > 0 && h > 0)) continue;
    const fit = Math.min(1, PICTURE_PX / Math.max(w, h));
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.round(w * fit));
    canvas.height = Math.max(1, Math.round(h * fit));
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = "";
    const width = INK_WIDTH * imageShare(block);
    pictures.set(block.id, { width, height: (width * h) / w, source: canvas });
  }
  return pictures;
}

/** What the PDF writer needs from the page: pictures, their bytes, and a picture of a page it cannot write. */
function pdfSources(host: NoteExportHost, pictures: Map<string, NotePicture>): NotePdfSources {
  const measuring = createEl("canvas").getContext("2d");
  return {
    usePressure: host.pressure(),
    highlighterAlpha: host.highlighterAlpha(),
    picture: (block) => pictures.get(block.id) ?? null,
    encodePicture: async (source) => {
      if (!(source instanceof HTMLCanvasElement)) return null;
      // Our pictures are opaque photos; anything else drawn (a graph's shading) keeps its alpha.
      const ours = [...pictures.values()].some((p) => p.source === source);
      return ours
        ? { jpeg: await canvasBytes(source, "image/jpeg", 0.9) }
        : { png: await canvasBytes(source, "image/png") };
    },
    ...(measuring
      ? {
          measureFallback: (font: string, text: string) => {
            measuring.font = font;
            return measuring.measureText(text).width;
          },
        }
      : {}),
    rasterPage: async (layout: NoteLayout, index: number) => {
      const canvas = createEl("canvas");
      drawNotePage(canvas, layout, index, NOTE_PAGE_WIDTH * RASTER_SCALE, 1, {
        usePressure: host.pressure(),
        highlighterAlpha: host.highlighterAlpha(),
      });
      const bytes = await canvasBytes(canvas, "image/jpeg", 0.9);
      canvas.width = 0;
      canvas.height = 0;
      return bytes;
    },
  };
}

// --- PDF -----------------------------------------------------------------------------

async function exportPdf(
  host: NoteExportHost,
  note: TextNote,
  title: string,
  sources: NotePdfSources,
  choice: {
    pages: readonly number[];
    total: number;
    onProgress: (done: number, total: number) => void;
    cancelled: () => boolean;
  },
): Promise<ExportedFiles> {
  const { app } = host;
  const pdf = await exportNoteToPdf(note, title, sources, choice);
  const folder = await host.exportsFolder();
  // Named at save time: another export may have taken the name since the dialog opened.
  const base = exportBaseName(title, choice.pages, choice.total);
  const name = uniqueFileName(base, ".pdf", namesIn(app, folder));
  const path = inFolder(folder, name);
  const buffer = bufferOf(pdf.bytes);
  await app.vault.createBinary(path, buffer);
  return {
    paths: [path],
    where: path,
    files: [new File([buffer], name, { type: "application/pdf" })],
  };
}

// --- Markdown ------------------------------------------------------------------------

async function exportMarkdown(
  host: NoteExportHost,
  note: TextNote,
  title: string,
  pages: readonly number[],
  total: number,
): Promise<ExportedFiles> {
  const file = host.file();
  if (!file) throw new Error("The note is closed");
  const { app } = host;
  const folder = await host.exportsFolder();
  const target = markdownTarget(exportBaseName(title, pages, total), namesIn(app, folder));
  const mdPath = inFolder(folder, target.file);
  const assets = inFolder(folder, target.assets);
  const here = folder ?? "";
  const written: Array<{ path: string; bytes: ArrayBuffer; type: string }> = [];
  const save = async (name: string, bytes: ArrayBuffer, type: string): Promise<string> => {
    if (!app.vault.getFolderByPath(assets)) await app.vault.createFolder(assets);
    const dot = name.lastIndexOf(".");
    const free = uniqueFileName(
      dot > 0 ? name.slice(0, dot) : name,
      dot > 0 ? name.slice(dot) : "",
      namesIn(app, assets),
    );
    const path = inFolder(assets, free);
    await app.vault.createBinary(path, bytes);
    written.push({ path, bytes, type });
    return path;
  };

  // Handwriting, as Ask AI sees it: each section with ink a PNG on white, in order.
  const inks = inkSectionImages(note, {
    pressure: host.pressure(),
    highlighterAlpha: host.highlighterAlpha(),
  });
  const inkPaths: string[] = [];
  for (let n = 0; n < inks.length; n++) {
    const bytes = Uint8Array.from(atob(inks[n].base64), (c) => c.charCodeAt(0));
    inkPaths.push(await save(inkPictureName(n + 1), bufferOf(bytes), "image/png"));
  }
  const graphPaths: string[] = [];
  let graphs = 0;
  for (const block of note.blocks) {
    if (block.type !== "graph") continue;
    graphs++;
    const height = noteGraphHeight(block, INK_WIDTH);
    const canvas = createEl("canvas");
    canvas.width = INK_WIDTH * GRAPH_SCALE;
    canvas.height = Math.round(height * GRAPH_SCALE);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.scale(GRAPH_SCALE, GRAPH_SCALE);
    const graph = makeGraph({
      id: block.id,
      x: 0,
      y: 0,
      w: INK_WIDTH,
      h: height,
      spec: block.spec,
    });
    paintGraph(ctx, graph, { level: GRAPH_SCALE, night: false, paper: "#ffffff" });
    const bytes = await canvasBytes(canvas, "image/png");
    canvas.width = 0;
    canvas.height = 0;
    graphPaths[graphs] = await save(graphPictureName(graphs), bufferOf(bytes), "image/png");
  }
  // Pictures copied in, so the copy carries them wherever it goes.
  const picturePaths = new Map<string, string>();
  for (const block of note.blocks) {
    if (block.type !== "image") continue;
    const source = pictureFile(app, block, file.path);
    if (!source || picturePaths.has(source.path)) continue;
    const bytes = await app.vault.readBinary(source);
    picturePaths.set(source.path, await save(source.name, bytes, `image/${source.extension}`));
  }

  const markdown = noteMarkdown(note, {
    ink: (_block, n) => (inkPaths[n - 1] ? relativePath(here, inkPaths[n - 1]) : null),
    graph: (_block, n) => (graphPaths[n] ? relativePath(here, graphPaths[n]) : null),
    image: (block) => {
      const source = pictureFile(app, block, file.path);
      const copy = source ? picturePaths.get(source.path) : undefined;
      return copy ? relativePath(here, copy) : null;
    },
    // Recordings stay where they are: linked, not copied.
    audio: (block) => {
      const source = app.metadataCache.getFirstLinkpathDest(block.path, file.path);
      return source ? relativePath(here, source.path) : null;
    },
  });
  await app.vault.create(mdPath, markdown);
  const files = [
    new File([markdown], target.file, { type: "text/markdown" }),
    ...written.map(
      (w) => new File([w.bytes], w.path.slice(w.path.lastIndexOf("/") + 1), { type: w.type }),
    ),
  ];
  return { paths: [mdPath], where: mdPath, files };
}

// --- Text ----------------------------------------------------------------------------

async function copyText(host: NoteExportHost): Promise<void> {
  try {
    await navigator.clipboard.writeText(notePlainText(host.note()));
    new Notice(t("notebooks.note.copied"));
  } catch (error) {
    new Notice(t("notebooks.note.exportFailed", { error: errorMessage(error) }));
  }
}
