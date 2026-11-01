/**
 * Cover tape on disk: a stroke with `tool: "tape"`, round-tripped as one,
 * and the notebook labelled `v2+tape:` so an older FineNotes, which would
 * read it as a thick pen line, holds it read-only instead.
 */

import { describe, expect, it } from "vitest";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { type InkDocument, type Stroke, emptyDocument } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function stroke(extra: Partial<Stroke> = {}): Stroke {
  return {
    id: "t1",
    color: "#e6d3a3",
    size: 40,
    tool: "tape",
    pts: [100, 200, 0.5, 400, 200, 0.5],
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

describe("a cover tape, saved", () => {
  it("round-trips as a tape, and labels the notebook v2+tape", () => {
    const payload = encodeDocument(docWith(stroke()));
    expect(payload.startsWith("v2+tape:")).toBe(true);
    expect(stored(payload).requires).toEqual(["tape"]);
    const back = decodeDocument(payload).pages[0].strokes[0];
    expect(back).toMatchObject({ id: "t1", tool: "tape", size: 40, color: "#e6d3a3" });
    expect(back.pts.filter((_, i) => i % 3 !== 2)).toEqual([100, 200, 400, 200]);
  });

  it("leaves a notebook without tape on the plain label", () => {
    const payload = encodeDocument(docWith(stroke({ tool: "pen" })));
    expect(payload.startsWith("v2:")).toBe(true);
  });

  it("reads a tool it does not know as pen ink, as before", () => {
    const json = JSON.stringify({
      version: 2,
      pages: [
        {
          id: "p1",
          kind: "page",
          geometry: { width: 1024, height: 1448 },
          backdrop: { kind: "blank" },
          strokes: [{ id: "s1", color: "#000000", size: 2, tool: "glue", pts: [0, 0, 128] }],
        },
      ],
    });
    const doc = decodeDocument(`v2:${deflateToBase64(json)}`);
    expect(doc.pages[0].strokes[0].tool).toBe("pen");
  });
});
