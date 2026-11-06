/** Annotation layers in paint order, keeping highlighter multiplication above live PDF content. */
import type { Page } from "../model/document";
import { isNoteInk, noteIdsOf } from "../model/sticky-notes";
import { tapesLast } from "../model/cover-tape";
import { marginBackdrop } from "../model/page-margin";

export interface AnnotationLayer {
  page: Page;
  multiply: boolean;
  /**
   * The margin's paper (`model/page-margin`) and nothing else: the bottom
   * layer, so every other layer lies over it and no layer's paper covers
   * another's ink. Only this layer draws it.
   */
  paper?: true;
}

export function* annotationLayers(page: Page): Generator<AnnotationLayer> {
  // A sticky note's ink is drawn with its note, so it goes in the notes' layer.
  const notes = noteIdsOf(page.images);
  const noteInk = notes ? page.strokes.filter((stroke) => isNoteInk(stroke, notes)) : [];
  // Cover tapes last, so the layer that holds them lies over all the ink.
  const ink = tapesLast(
    notes ? page.strokes.filter((stroke) => !isNoteInk(stroke, notes)) : page.strokes,
  );
  if (marginBackdrop(page)) {
    yield {
      page: {
        ...page,
        strokes: [],
        images: [],
        textBoxes: [],
        ...(page.tables ? { tables: [] } : {}),
        ...(page.graphs ? { graphs: [] } : {}),
        ...(page.equations ? { equations: [] } : {}),
      },
      multiply: false,
      paper: true,
    };
  }
  // Pictures, tables, graphs and text boxes in one layer under the ink; the
  // ink's layers carry none of them, so none is painted twice or over the ink.
  if (
    page.images.length ||
    page.textBoxes.length ||
    page.tables?.length ||
    page.graphs?.length ||
    page.equations?.length
  ) {
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
        ...(page.equations ? { equations: [] } : {}),
        strokes: ink.slice(start, end),
      },
      multiply,
    };
    start = end;
  }
}
