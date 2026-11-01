/**
 * Search in a PDF backdrop's printed text (#112): the page's text as one
 * string for the search index, and where a query's words sit on the page,
 * for the same soft highlight handwritten words get.
 *
 * Both read the laid-out text (`canvas/pdf-text.ts`) that the highlighter
 * snaps to, so a match lights exactly the letters it matched, line by line.
 *
 * PURE: no DOM, no Obsidian.
 */

import { type TextLayout, type TextRect, rangeRects } from "../canvas/pdf-text";
import { fold, queryTerms } from "./notebook-search";

/**
 * The layout's text, one line of the PDF to a line, and for each character
 * of it the layout character it came from (-1 for a line break).
 */
function plainText(layout: TextLayout): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  for (const line of layout.lines) {
    if (text) {
      text += "\n";
      at.push(-1);
    }
    for (let i = line.start; i < line.end; i++) {
      const ch = layout.chars[i]?.ch ?? "";
      text += ch;
      for (let k = 0; k < ch.length; k++) at.push(i);
    }
  }
  return { text, at };
}

/** The page's printed text, for the search index; empty for a scan. */
export function layoutPlainText(layout: TextLayout): string {
  return plainText(layout).text;
}

/**
 * Where every word of `query` appears in the page's printed text: one
 * rectangle per line each match covers, in page space, in reading order.
 * Matching folds case and accents, as the search does.
 */
export function pdfHitRects(query: string, layout: TextLayout): TextRect[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || layout.lines.length === 0) return [];
  const plain = plainText(layout);
  const folded = fold(plain.text);
  const byLength = [...terms].sort((a, b) => b.length - a.length);
  const rects: TextRect[] = [];
  let from = 0;
  while (from < folded.text.length) {
    let best: { start: number; end: number } | null = null;
    for (const term of byLength) {
      const i = folded.text.indexOf(term, from);
      if (i >= 0 && (best === null || i < best.start)) best = { start: i, end: i + term.length };
    }
    if (!best) break;
    from = best.end;
    // Folded → plain text → layout characters; line breaks are skipped.
    const chars = [];
    for (let i = best.start; i < best.end; i++) {
      const c = plain.at[folded.map[i]];
      if (c !== undefined && c >= 0) chars.push(c);
    }
    if (chars.length === 0) continue;
    const start = Math.min(...chars);
    const end = Math.max(...chars) + 1;
    rects.push(...rangeRects(layout, { start, end }));
  }
  return rects;
}
