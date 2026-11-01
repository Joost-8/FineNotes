/**
 * Pencil tilt on disk (`Stroke.tilt`): one altitude per point in tenths of a
 * degree, kept only on handwriting that has one per point, and the notebook
 * labelled `v2+tilt:` so an older FineNotes holds it read-only instead of
 * saving the shading back at the nib's width.
 */

import { describe, expect, it } from "vitest";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function line(extra: Partial<Stroke> = {}): Stroke {
  return {
    id: "s1",
    color: "#1a1a1a",
    size: 5.4,
    tool: "pen",
    pts: [10, 10, 0.3, 20, 12, 0.3, 30, 15, 0.3],
    ...extra,
  };
}

function docWith(...strokes: Stroke[]): InkDocument {
  const doc = emptyDocument(1024);
  doc.pages[0].strokes.push(...strokes);
  return doc;
}

function stored(payload: string): { requires?: string[]; pages: Array<{ strokes: unknown[] }> } {
  return JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as {
    requires?: string[];
    pages: Array<{ strokes: unknown[] }>;
  };
}

/** How every reader since 2.0 checked a payload's label. */
function olderReaderAccepts(payload: string): boolean {
  const colon = payload.indexOf(":");
  return payload.startsWith("v") && Number.isFinite(Number(payload.slice(1, colon)));
}

describe("a stroke's tilt, saved", () => {
  it("round-trips in tenths of a degree, and labels the notebook v2+tilt", () => {
    const payload = encodeDocument(docWith(line({ tilt: [52.04, 31.26, 18] })));
    expect(payload.startsWith("v2+tilt:")).toBe(true);
    expect(olderReaderAccepts(payload)).toBe(false);
    expect(stored(payload).requires).toEqual(["tilt"]);
    expect(stored(payload).pages[0].strokes[0]).toMatchObject({ tilt: [520, 313, 180] });
    expect(decodeDocument(payload).pages[0].strokes[0].tilt).toEqual([52, 31.3, 18]);
  });

  it("lists it after sticky when a notebook has both", () => {
    const doc = docWith(line({ tilt: [52, 31, 18] }));
    doc.pages[0].images.push({
      id: "i1",
      path: "",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      sticky: { color: "#fde68a" },
    });
    expect(encodeDocument(doc).startsWith("v2+sticky+tilt:")).toBe(true);
  });

  it("leaves a notebook without tilt exactly as before: plain v2, no key", () => {
    const payload = encodeDocument(docWith(line()));
    expect(payload.startsWith("v2:")).toBe(true);
    expect(stored(payload).requires).toBeUndefined();
    expect(Object.keys(stored(payload).pages[0].strokes[0] as object)).not.toContain("tilt");
  });

  it("drops tilt that is not one per point, and any on a shape", () => {
    const short = encodeDocument(docWith(line({ tilt: [40, 30] })));
    expect(short.startsWith("v2:")).toBe(true);
    expect(decodeDocument(short).pages[0].strokes[0].tilt).toBeUndefined();
    const shape = encodeDocument(docWith(line({ tilt: [40, 30, 20], shape: "line" })));
    expect(shape.startsWith("v2:")).toBe(true);
    expect(decodeDocument(shape).pages[0].strokes[0].tilt).toBeUndefined();
  });

  it("reads a bad entry as upright and keeps the rest in place; a wrong count as none", () => {
    const json = (tilt: unknown): string =>
      `v2+tilt:${deflateToBase64(
        JSON.stringify({
          version: 2,
          requires: ["tilt"],
          view: { pageIndex: 0, scrollY: 0, zoom: 1 },
          pages: [
            {
              id: "p1",
              kind: "page",
              geometry: { width: 1024, height: 1448 },
              backdrop: { ruling: "blank" },
              images: [],
              textBoxes: [],
              strokes: [
                {
                  id: "s1",
                  color: "#000000",
                  size: 2,
                  tool: "pen",
                  pts: [0, 0, 128, 100, 0, 128, 200, 0, 128],
                  tilt,
                },
              ],
            },
          ],
        }),
      )}`;
    expect(decodeDocument(json([300, "x", 9999])).pages[0].strokes[0].tilt).toEqual([30, 90, 90]);
    expect(decodeDocument(json([300, 200])).pages[0].strokes[0].tilt).toBeUndefined();
    expect(decodeDocument(json("300")).pages[0].strokes[0].tilt).toBeUndefined();
  });
});
