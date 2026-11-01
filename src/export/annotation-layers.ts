/** Annotation layers in paint order, keeping highlighter multiplication above live PDF content. */
import type { Page } from "../model/document";
import { isNoteInk, noteIdsOf } from "../model/sticky-notes";
import { tapesLast } from "../model/cover-tape";

export interface AnnotationLayer {
  page: Page;
  multiply: boolean;
}

export function* annotationLayers(page: Page): Generator<AnnotationLayer> {
  // A sticky note's ink is drawn with its note, so it goes in the notes' layer.
  const notes = noteIdsOf(page.images);
  const noteInk = notes ? page.strokes.filter((stroke) => isNoteInk(stroke, notes)) : [];
  // Cover tapes last, so the layer that holds them lies over all the ink.
  const ink = tapesLast(
    notes ? page.strokes.filter((stroke) => !isNoteInk(stroke, notes)) : page.strokes,
  );
  // Pictures, tables, graphs and text boxes in one layer under the ink; the
  // ink's layers carry none of them, so none is painted twice or over the ink.
  if (page.images.length || page.textBoxes.length || page.tables?.length || page.graphs?.length) {
    yield { page: { ...page, strokes: noteInk }, multiply: false };
  }
  let start = 0;
  while (start < ink.length) {
    const multiply = ink[start].tool === "highlighter";
    let end = start + 1;
    while (end < ink.length && (ink[end].tool === "highlighter") === multiply) end++;
    yield {
      page: {
        ...page,
        images: [],
        textBoxes: [],
        ...(page.tables ? { tables: [] } : {}),
        ...(page.graphs ? { graphs: [] } : {}),
        strokes: ink.slice(start, end),
      },
      multiply,
    };
    start = end;
  }
}
