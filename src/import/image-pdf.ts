/**
 * A picture as a one-page PDF, so a picture imported as paper is a PDF
 * like every other paper in the library: drawn, thumbnailed and exported by
 * the same PDF backdrop code, with nothing new for a page to know about.
 *
 * The picture fills the page edge to edge. A JPEG goes in as it is
 * (`DCTDecode`, no re-encoding); anything else arrives as raw RGB from a
 * canvas and is deflated (`FlateDecode`).
 *
 * Pure: no DOM, no Obsidian.
 */

import { zlibSync } from "fflate";

export interface PdfPicture {
  /** Pixels across and down. */
  width: number;
  height: number;
  /** A JPEG file's bytes, or raw RGB rows (3 bytes a pixel, top row first). */
  data: Uint8Array;
  format: "jpeg" | "rgb";
}

/** The page's width in PDF points (A4's); its height follows the picture. */
export const PICTURE_PAGE_WIDTH = 595.28;

function points(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A one-page PDF showing `picture` over the whole page. */
export function picturePdf(picture: PdfPicture): Uint8Array {
  const { width, height } = picture;
  if (!(width > 0) || !(height > 0) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("A picture needs a whole, positive width and height.");
  }
  if (picture.format === "rgb" && picture.data.length !== width * height * 3) {
    throw new Error("Raw RGB must hold three bytes for every pixel.");
  }
  const pageW = PICTURE_PAGE_WIDTH;
  const pageH = (PICTURE_PAGE_WIDTH * height) / width;
  const image = picture.format === "jpeg" ? picture.data : zlibSync(picture.data, { level: 6 });
  const filter = picture.format === "jpeg" ? "DCTDecode" : "FlateDecode";
  const content = `q ${points(pageW)} 0 0 ${points(pageH)} 0 0 cm /Im0 Do Q`;

  const text = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (part: string | Uint8Array): void => {
    const bytes = typeof part === "string" ? text.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const offsets: number[] = [];
  const object = (body: string | Array<string | Uint8Array>): void => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n`);
    for (const part of typeof body === "string" ? [body] : body) push(part);
    push("\nendobj\n");
  };

  // The header's second line marks the file as binary, as the spec advises.
  push("%PDF-1.4\n%");
  push(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]));
  push("\n");
  object("<< /Type /Catalog /Pages 2 0 R >>");
  object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${points(pageW)} ${points(pageH)}] ` +
      "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
  );
  object([`<< /Length ${text.encode(content).length} >>\nstream\n`, content, "\nendstream"]);
  object([
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${image.length} >>\nstream\n`,
    image,
    "\nendstream",
  ]);

  const xref = length;
  push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Raw RGB from RGBA pixels (a canvas's `getImageData`), laid on white where see-through. */
export function rgbFromRgba(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const pixels = Math.floor(rgba.length / 4);
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + 255 * (1 - a));
    }
  }
  return out;
}
