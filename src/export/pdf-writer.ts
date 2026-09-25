/**
 * A minimal PDF writer: one JPEG per page, each filling its page. Enough for
 * "Export as PDF" without a dependency — every page is rasterised through the
 * same painter the reader sees, so paper, PDF slides, pictures, text boxes
 * and ink all arrive exactly as drawn.
 *
 * Output is PDF 1.4: a catalog, a page tree, and per page a `/Page`, its
 * content stream and a `/DCTDecode` image XObject, then a classic xref table.
 * JPEG bytes pass through untouched (PDF decodes DCT natively), so the writer
 * never needs to understand the image.
 *
 * PURE: no DOM, no Obsidian.
 */

/** One page of the output. */
export interface PdfImagePage {
  /** Baseline or progressive JPEG, three components (RGB). */
  jpeg: Uint8Array;
  /** The JPEG's pixel size. */
  pixelWidth: number;
  pixelHeight: number;
  /** The page's size in PDF points (1/72 in). */
  widthPt: number;
  heightPt: number;
}

export interface PdfMetadata {
  title?: string;
  /** Written as the PDF's CreationDate. */
  created?: Date;
}

/** Page px to PDF points: A4's 210 mm is 1024 page px (`src/model/templates.ts`). */
export const POINTS_PER_PAGE_PX = ((210 / 25.4) * 72) / 1024;

const PRODUCER = "FineNotes";

/**
 * Device px per page px an export rasterises at: 2, which puts an A4 page at
 * 2048 × 2896 (about 250 dpi, print quality for handwriting).
 */
export const EXPORT_PIXEL_SCALE = 2;
/** Longest raster edge. */
export const EXPORT_MAX_EDGE = 4096;
/** Raster area cap, under iOS's 16.7 MP limit on a single canvas. */
export const EXPORT_MAX_PIXELS = 12_000_000;

/**
 * The scale to rasterise a page of this size at: {@link EXPORT_PIXEL_SCALE},
 * lowered for a page so large that it would pass either cap. 0 for a page
 * without a size.
 */
export function exportPixelScale(width: number, height: number): number {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width * height)) return 0;
  const byEdge = EXPORT_MAX_EDGE / Math.max(width, height);
  const byArea = Math.sqrt(EXPORT_MAX_PIXELS / (width * height));
  return Math.min(EXPORT_PIXEL_SCALE, byEdge, byArea);
}

/**
 * Build a PDF with one full-bleed image per page. Throws on an empty page
 * list or a page whose size is not a positive finite number — either would
 * produce a file readers reject.
 */
export function buildImagePdf(pages: readonly PdfImagePage[], meta: PdfMetadata = {}): Uint8Array {
  if (pages.length === 0) throw new Error("A PDF needs at least one page");
  for (const [i, page] of pages.entries()) {
    const sizes = [page.pixelWidth, page.pixelHeight, page.widthPt, page.heightPt];
    if (!sizes.every((n) => Number.isFinite(n) && n > 0)) {
      throw new Error(`Page ${i + 1} has no size`);
    }
  }

  const out = new ByteSink();
  // The binary comment line tells transfer tools the file is not text.
  out.bytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])); // %PDF-1.4\n
  out.bytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Object numbers: 1 catalog, 2 page tree, 3 info, then three per page.
  const pageObj = (i: number): number => 4 + i * 3;
  const offsets: number[] = [];
  const begin = (n: number): void => {
    offsets[n] = out.length;
    out.text(`${n} 0 obj\n`);
  };
  const end = (): void => out.text("endobj\n");

  begin(1);
  out.text("<< /Type /Catalog /Pages 2 0 R >>\n");
  end();

  begin(2);
  const kids = pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ");
  out.text(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\n`);
  end();

  begin(3);
  const info = [`/Producer ${pdfString(PRODUCER)}`];
  if (meta.title) info.push(`/Title ${pdfString(meta.title)}`);
  if (meta.created) info.push(`/CreationDate ${pdfString(pdfDate(meta.created))}`);
  out.text(`<< ${info.join(" ")} >>\n`);
  end();

  pages.forEach((page, i) => {
    const n = pageObj(i);
    const w = num(page.widthPt);
    const h = num(page.heightPt);

    begin(n);
    out.text(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>\n`,
    );
    end();

    // Scale the unit square the image occupies up to the whole page.
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
    begin(n + 1);
    out.text(`<< /Length ${content.length} >>\nstream\n${content}endstream\n`);
    end();

    begin(n + 2);
    out.text(
      `<< /Type /XObject /Subtype /Image /Width ${Math.round(page.pixelWidth)} ` +
        `/Height ${Math.round(page.pixelHeight)} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    out.bytes(page.jpeg);
    out.text("\nendstream\n");
    end();
  });

  const count = pageObj(pages.length);
  const xref = out.length;
  out.text(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) {
    out.text(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  }
  out.text(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return out.finish();
}

/**
 * A PDF text string. Printable ASCII is written literally with `\`, `(` and
 * `)` escaped; anything else as UTF-16BE hex with a byte-order mark, which
 * every reader shows correctly in the title bar.
 */
export function pdfString(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return `(${value.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  }
  let hex = "FEFF";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

/** `D:YYYYMMDDHHmmSSZ`, in UTC. */
export function pdfDate(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

/** A number as PDF writes it: at most two decimals, no exponent, no trailing zeros. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Appends text (ASCII only) and bytes, tracking the byte offset for the xref. */
class ByteSink {
  private readonly chunks: Uint8Array[] = [];
  length = 0;

  text(value: string): void {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
    this.bytes(bytes);
  }

  bytes(value: Uint8Array): void {
    this.chunks.push(value);
    this.length += value.length;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}
