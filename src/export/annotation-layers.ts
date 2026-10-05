/** Annotation layers in paint order, keeping highlighter multiplication above live PDF content. */
import type { Page } from "../model/document";

export interface AnnotationLayer {
  page: Page;
  multiply: boolean;
}

export function* annotationLayers(page: Page): Generator<AnnotationLayer> {
  if (page.images.length || page.textBoxes.length) {
    yield { page: { ...page, strokes: [] }, multiply: false };
  }
  let start = 0;
  while (start < page.strokes.length) {
    const multiply = page.strokes[start].tool === "highlighter";
    let end = start + 1;
    while (end < page.strokes.length && (page.strokes[end].tool === "highlighter") === multiply)
      end++;
    yield {
      page: { ...page, images: [], textBoxes: [], strokes: page.strokes.slice(start, end) },
      multiply,
    };
    start = end;
  }
}
