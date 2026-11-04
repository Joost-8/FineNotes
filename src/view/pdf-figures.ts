/**
 * The thin pdf.js side of figure finding: a page's operator list in, the
 * pictures on it out. Everything that decides anything is pure and tested
 * (recognition/ocr/figures.ts).
 */

import { type FigureScan, type OpCodes, gfxOpsFrom, scanFigures } from "../recognition/ocr/figures";

/** The slice of a pdf.js page used here. */
export interface OperatorPageLike {
  getOperatorList(): Promise<{ fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }>;
}

/** The names in pdf.js's `OPS` that this reads. */
const NAMES = [
  "save",
  "restore",
  "transform",
  "paintFormXObjectBegin",
  "paintFormXObjectEnd",
  "paintImageXObject",
  "paintInlineImageXObject",
  "paintImageXObjectRepeat",
  "paintImageMaskXObject",
  "paintImageMaskXObjectGroup",
  "paintImageMaskXObjectRepeat",
  "paintInlineImageXObjectGroup",
  "paintJpegXObject",
] as const;

/** pdf.js's `OPS` as {@link OpCodes}. */
export function opCodes(ops: Record<string, unknown> | undefined): OpCodes {
  const codes: OpCodes = {};
  for (const name of NAMES) {
    const value = ops?.[name];
    if (typeof value === "number") codes[name] = value;
  }
  return codes;
}

/**
 * The pictures on `page`, or null when its operators cannot be read (the
 * page is then not classified by its pictures).
 */
export async function readFigures(
  page: OperatorPageLike,
  ops: Record<string, unknown> | undefined,
  viewport: readonly [number, number, number, number, number, number],
  size: { width: number; height: number },
): Promise<FigureScan | null> {
  const codes = opCodes(ops);
  // Without the image operators' numbers nothing can be told: not "no pictures".
  if (codes.paintImageXObject === undefined || codes.save === undefined) return null;
  try {
    const list = await page.getOperatorList();
    return scanFigures(gfxOpsFrom(list.fnArray, list.argsArray, codes), viewport, size);
  } catch {
    return null;
  }
}
