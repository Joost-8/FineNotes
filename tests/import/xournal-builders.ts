/**
 * Writers for Xournal and Xournal++ files, so tests can build notebooks
 * from scratch: plain XML, gzipped (`.xoj`, `.xopp`) or a zip container.
 */

import { gzipSync, strToU8, zipSync } from "fflate";

export interface XoPage {
  width?: number;
  height?: number;
  /** The `<background>` element, written as is; a plain white page when absent. */
  background?: string;
  /** Each layer's elements, as XML. */
  layers?: string[][];
}

export function xoXml(pages: XoPage[], title?: string, head = '<?xml version="1.0"?>\n'): string {
  const body = pages
    .map((p) => {
      const bg = p.background ?? '<background type="solid" color="white" style="plain"/>';
      const layers = (p.layers ?? [[]]).map((l) => `<layer>\n${l.join("\n")}\n</layer>`).join("\n");
      return `<page width="${p.width ?? 612}" height="${p.height ?? 792}">\n${bg}\n${layers}\n</page>`;
    })
    .join("\n");
  const titleEl = title === undefined ? "" : `<title>${title}</title>\n`;
  return `${head}<xournal creator="test" fileversion="4">\n${titleEl}<preview>AAAA</preview>\n${body}\n</xournal>\n`;
}

/** A gzipped notebook, as Xournal and Xournal++ save it. */
export function xopp(pages: XoPage[], title?: string): Uint8Array {
  return gzipSync(strToU8(xoXml(pages, title)), { mtime: 0 });
}

/** A zip container: `content.xml` and the files it names. */
export function xoZip(pages: XoPage[], files: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    mimetype: strToU8("application/x-xopp"),
    "content.xml": strToU8(xoXml(pages)),
    ...files,
  });
}

export function stroke(
  coords: number[],
  width: string,
  attrs: { tool?: string; color?: string } = {},
): string {
  return (
    `<stroke tool="${attrs.tool ?? "pen"}" color="${attrs.color ?? "black"}" width="${width}">` +
    `${coords.join(" ")}</stroke>`
  );
}

export function base64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
