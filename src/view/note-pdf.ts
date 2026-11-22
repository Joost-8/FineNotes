/**
 * A text note as a PDF: its A4 pages as Home lays them out
 * (`note-page-render.ts`, `model/note-pages.ts`), every page written in
 * vectors where it can be. The text is real PDF text in the standard fonts
 * every reader has (Helvetica, Courier: so it can be selected, searched and
 * copied), laid out with those fonts' own widths; handwriting is the
 * notebook export's vector ink (`export/vector-ink`); tables, list marks,
 * graphs and the paper's rulings are paths; pictures are embedded once each.
 *
 * A page that holds something the PDF fonts cannot show (a script outside
 * Latin-1, an emoji) or a painter step the recorder cannot write is drawn
 * as a picture instead, by the caller's `rasterPage`: never wrong, only
 * bigger (the ledger's "A PDF of handwriting was mostly a picture of the
 * paper").
 *
 * No DOM of its own: the caller supplies the pictures' bytes and the
 * fallback, so this runs under Node too.
 */

import {
  PDFDocument,
  PDFName,
  type PDFFont,
  type PDFPage,
  type PDFRef,
  StandardFonts,
} from "pdf-lib";
import { drawSyntheticRules, paperTheme } from "../canvas/backdrop";
import { type PdfFace, type PdfFontBook, PdfPageRecorder } from "../export/pdf-page-canvas";
import { vectorInk } from "../export/vector-ink";
import { NOTE_PAGE_HEIGHT, NOTE_PAGE_WIDTH } from "../model/note-pages";
import { INK_WIDTH, type ImageBlock, type InkBlock, type TextNote } from "../model/text-note";
import {
  type NoteFonts,
  type NoteLayout,
  type NotePagePalette,
  type NotePicture,
  layoutNote,
  paintNotePage,
} from "./note-page-render";

/** The families the layout names, which the recorder reads as Helvetica and Courier. */
export const PDF_NOTE_FONTS: NoteFonts = {
  text: "Helvetica, Arial, sans-serif",
  mono: '"Courier New", Courier, monospace',
};

/** PDF points a note page px: the page is A4, 595 pt wide. */
const POINTS = ((210 / 25.4) * 72) / NOTE_PAGE_WIDTH;

const FACES: Readonly<Record<PdfFace, StandardFonts>> = {
  sans: StandardFonts.Helvetica,
  "sans-bold": StandardFonts.HelveticaBold,
  "sans-italic": StandardFonts.HelveticaOblique,
  "sans-bold-italic": StandardFonts.HelveticaBoldOblique,
  mono: StandardFonts.Courier,
  "mono-bold": StandardFonts.CourierBold,
  "mono-italic": StandardFonts.CourierOblique,
  "mono-bold-italic": StandardFonts.CourierBoldOblique,
};

export interface NotePdfSources {
  palette?: NotePagePalette;
  usePressure: boolean;
  highlighterAlpha: number;
  /** A picture's size on the page and what to draw; null: a placeholder. */
  picture: (block: ImageBlock) => NotePicture | null;
  /** A picture's pixels as JPEG (opaque) or PNG bytes, for the PDF. */
  encodePicture: (source: unknown) => Promise<{ jpeg: Uint8Array } | { png: Uint8Array } | null>;
  /**
   * The width of text the PDF fonts cannot show (`font` a canvas
   * shorthand), so a page that falls back to a picture is laid out as it
   * draws; absent: an estimate.
   */
  measureFallback?: (font: string, text: string) => number;
  /** Page `index` of `layout` as a JPEG, for a page that cannot be vectors; absent: such a page fails. */
  rasterPage?: (layout: NoteLayout, index: number) => Promise<Uint8Array>;
}

export interface NotePdf {
  bytes: Uint8Array;
  pages: number;
  /** The pages drawn as pictures, 0-based, and why. */
  rastered: Array<{ page: number; why: string }>;
}

/** The standard fonts as a {@link PdfFontBook}: widths and WinAnsi encoding from pdf-lib. */
function fontBook(
  fonts: ReadonlyMap<PdfFace, PDFFont>,
  fallback: NotePdfSources["measureFallback"],
): PdfFontBook {
  // Each character's advance at size 1. Character by character, never a string at a time:
  // pdf-lib's widths add the font's kerning, which `Tj` does not apply.
  const advances = new Map<string, number>();
  const advance = (face: PdfFace, char: string): number => {
    const key = `${face}:${char}`;
    let width = advances.get(key);
    if (width === undefined) {
      try {
        width = fonts.get(face)?.widthOfTextAtSize(char, 1) ?? 0.6;
      } catch {
        // Not in the font: the page it is on is drawn as a picture, measured as drawn there.
        width = fallback
          ? fallback(`100px ${face.startsWith("mono") ? "monospace" : "sans-serif"}`, char) / 100
          : 1;
      }
      advances.set(key, width);
    }
    return width;
  };
  return {
    measure(face, text, size) {
      let width = 0;
      for (const char of Array.from(text)) width += advance(face, char);
      return width * size;
    },
    encode(face, text) {
      try {
        return fonts.get(face)?.encodeText(text).toString() ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** A handwriting section in its own units, written as the notebook writes ink. */
function inkPainter(sources: NotePdfSources) {
  return (ctx: CanvasRenderingContext2D, block: InkBlock, recorder: PdfPageRecorder): void => {
    if (block.paper && block.paper !== "blank") {
      drawSyntheticRules(
        ctx,
        { kind: block.paper },
        { width: INK_WIDTH, height: block.height },
        paperTheme(false),
      );
    }
    // Highlights first: they sit under the writing, as in the note.
    const strokes = [
      ...block.strokes.filter((s) => s.tool === "highlighter"),
      ...block.strokes.filter((s) => s.tool !== "highlighter"),
    ];
    recorder.drawVectorInk(
      vectorInk(strokes, {
        usePressure: sources.usePressure,
        highlighterAlpha: sources.highlighterAlpha,
        shade: "day",
      }),
    );
  };
}

/** Every standard face embedded in `doc`: a standard font is only a name in the file. */
async function embedFaces(doc: PDFDocument): Promise<Map<PdfFace, PDFFont>> {
  const fonts = new Map<PdfFace, PDFFont>();
  for (const face of Object.keys(FACES) as PdfFace[]) {
    fonts.set(face, await doc.embedFont(FACES[face]));
  }
  return fonts;
}

function layoutWith(
  note: TextNote,
  book: PdfFontBook,
  sources: Pick<NotePdfSources, "picture">,
): NoteLayout {
  const measuring = new PdfPageRecorder(1, 1, book).asContext();
  return layoutNote(note, measuring, sources.picture, PDF_NOTE_FONTS);
}

/**
 * `note` laid out on pages exactly as {@link exportNoteToPdf} lays it out
 * (the same font widths), for a preview of the pages before exporting.
 */
export async function layoutNoteForPdf(
  note: TextNote,
  sources: Pick<NotePdfSources, "picture" | "measureFallback">,
): Promise<NoteLayout> {
  const fonts = await embedFaces(await PDFDocument.create());
  return layoutWith(note, fontBook(fonts, sources.measureFallback), sources);
}

export interface NotePdfOptions {
  /** The pages to write, 0-based, in the note's order; absent: all of them. */
  pages?: readonly number[];
  /** Counts finished pages. */
  onProgress?: (done: number, total: number) => void;
  /** Checked between pages; when it returns true the export stops with an `AbortError`. */
  cancelled?: () => boolean;
}

/** `note` as a PDF titled `title`: every page, or those `options.pages` names. */
export async function exportNoteToPdf(
  note: TextNote,
  title: string,
  sources: NotePdfSources,
  options: NotePdfOptions = {},
): Promise<NotePdf> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("FineNotes");
  doc.setCreationDate(new Date());
  // Every face up front: the layout measures with them before any page is written.
  const fonts = await embedFaces(doc);
  const book = fontBook(fonts, sources.measureFallback);
  const layout = layoutWith(note, book, sources);

  const width = NOTE_PAGE_WIDTH * POINTS;
  const height = NOTE_PAGE_HEIGHT * POINTS;
  const pictures = new Map<unknown, Promise<PDFRef | null>>();
  const rastered: NotePdf["rastered"] = [];
  const paintInk = inkPainter(sources);
  const wanted = (options.pages ?? layout.pages.map((_, i) => i))
    .filter((i) => Number.isInteger(i) && i >= 0 && i < layout.pages.length)
    .sort((a, b) => a - b);
  if (wanted.length === 0) throw new Error("No page to export");

  for (const [done, index] of wanted.entries()) {
    if (options.cancelled?.()) throw new DOMException("Export cancelled", "AbortError");
    options.onProgress?.(done, wanted.length);
    const recorder = new PdfPageRecorder(NOTE_PAGE_WIDTH, NOTE_PAGE_HEIGHT, book);
    const ctx = recorder.asContext();
    paintNotePage(ctx, layout, index, 1, {
      ...(sources.palette ? { palette: sources.palette } : {}),
      usePressure: sources.usePressure,
      highlighterAlpha: sources.highlighterAlpha,
      ink: (c, block) => paintInk(c, block, recorder),
    });
    const page = doc.addPage([width, height]);
    if (recorder.unsupported !== null) {
      if (!sources.rasterPage) throw new Error(`Page ${index + 1}: ${recorder.unsupported}`);
      const jpeg = await doc.embedJpg(await sources.rasterPage(layout, index));
      page.drawImage(jpeg, { width, height });
      rastered.push({ page: index, why: recorder.unsupported });
      continue;
    }
    await writePage(doc, page, recorder, fonts, (source) => {
      let embedded = pictures.get(source);
      if (!embedded) {
        embedded = sources.encodePicture(source).then(async (bytes) => {
          if (!bytes) return null;
          const image =
            "jpeg" in bytes ? await doc.embedJpg(bytes.jpeg) : await doc.embedPng(bytes.png);
          return image.ref;
        });
        pictures.set(source, embedded);
      }
      return embedded;
    });
  }
  options.onProgress?.(wanted.length, wanted.length);
  return { bytes: await doc.save(), pages: wanted.length, rastered };
}

/** A recorded page's operators and resources onto `page`, page px with y down mapped to points. */
async function writePage(
  doc: PDFDocument,
  page: PDFPage,
  recorder: PdfPageRecorder,
  fonts: ReadonlyMap<PdfFace, PDFFont>,
  picture: (source: unknown) => Promise<PDFRef | null>,
): Promise<void> {
  const { ops, states, groups, fonts: faces, pictures } = recorder.page();
  if (!ops) return;
  const context = doc.context;
  for (const [name, state] of states) {
    page.node.setExtGState(
      PDFName.of(name),
      context.register(
        context.obj({ Type: "ExtGState", CA: state.alpha, ca: state.alpha, BM: state.blend }),
      ),
    );
  }
  for (const [name, group] of groups) {
    const form = context.flateStream(group.ops, {
      Type: "XObject",
      Subtype: "Form",
      BBox: group.bbox,
      Group: { Type: "Group", S: "Transparency" },
    });
    page.node.setXObject(PDFName.of(name), context.register(form));
  }
  for (const [name, face] of faces) {
    const font = fonts.get(face);
    if (font) page.node.setFontDictionary(PDFName.of(name), font.ref);
  }
  let body = ops;
  for (const { name, source } of pictures) {
    const ref = await picture(source);
    if (ref) page.node.setXObject(PDFName.of(name), ref);
    // A picture that would not encode leaves its place empty rather than breaking the page.
    else body = body.split(`/${name} Do`).join("");
  }
  const { height } = page.getSize();
  const stream = `q ${POINTS} 0 0 ${-POINTS} 0 ${height} cm\n${body}\nQ`;
  page.node.addContentStream(context.register(context.flateStream(stream)));
}
