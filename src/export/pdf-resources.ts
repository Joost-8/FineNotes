/** Remove unreachable objects left behind when pdf-lib embeds source page contents. */
import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from "pdf-lib";

export function removeUnusedPdfObjects(document: PDFDocument): void {
  const context = document.context;
  const reachable = new Set<string>();
  const visited = new Set<PDFObject>();
  const pending: PDFObject[] = Object.values(context.trailerInfo).filter(
    (value): value is PDFObject => value !== undefined,
  );
  while (pending.length) {
    const object = pending.pop()!;
    if (visited.has(object)) continue;
    visited.add(object);
    if (object instanceof PDFRef) {
      reachable.add(object.toString());
      const value = context.lookup(object);
      if (value) pending.push(value);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) pending.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) pending.push(value);
    } else if (object instanceof PDFStream) {
      pending.push(object.dict);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) context.delete(ref);
  }
}
