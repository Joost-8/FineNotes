import { describe, expect, it } from "vitest";

import type { InkDocument, Stroke } from "../../src/model/document";
import { SetStrokePoints } from "../../src/model/tidy-commands";

function stroke(id: string, pts: number[]): Stroke {
  return { id, color: "#000000", size: 2, tool: "pen", pts };
}

function docWith(strokes: Stroke[]): InkDocument {
  return {
    pages: [
      {
        id: "p1",
        geometry: { width: 800, height: 1000 },
        backdrop: { kind: "paper", ruling: "blank" },
        strokes,
      },
    ],
  } as unknown as InkDocument;
}

describe("SetStrokePoints", () => {
  it("gives each stroke its new points and puts the old ones back on undo", () => {
    const a = stroke("a", [1, 2, 0.5, 3, 4, 0.5]);
    const b = stroke("b", [5, 6, 0.5]);
    const doc = docWith([a, b]);
    const old = a.pts;
    const command = new SetStrokePoints("p1", [{ stroke: a, pts: [10, 20, 0.5, 30, 40, 0.5] }]);
    command.apply(doc);
    expect(a.pts).toEqual([10, 20, 0.5, 30, 40, 0.5]);
    expect(b.pts).toEqual([5, 6, 0.5]);
    // The same stroke object, so a selection that holds it still does.
    expect(doc.pages[0].strokes[0]).toBe(a);
    command.invert();
    expect(a.pts).toBe(old);
  });

  it("uses a fresh points array each time, so a cached outline of the old points is never reused", () => {
    const a = stroke("a", [1, 2, 0.5]);
    const doc = docWith([a]);
    const next = [7, 8, 0.5];
    const command = new SetStrokePoints("p1", [{ stroke: a, pts: next }]);
    command.apply(doc);
    const first = a.pts;
    expect(first).not.toBe(next);
    command.invert();
    command.apply(doc);
    expect(a.pts).toEqual(next);
    expect(a.pts).not.toBe(first);
  });

  it("leaves alone a stroke that is not on the page, or whose point count differs", () => {
    const a = stroke("a", [1, 2, 0.5]);
    const gone = stroke("gone", [0, 0, 0.5]);
    const doc = docWith([a]);
    const command = new SetStrokePoints("p1", [
      { stroke: a, pts: [1, 2, 0.5, 3, 4, 0.5] },
      { stroke: gone, pts: [9, 9, 0.5] },
    ]);
    command.apply(doc);
    expect(a.pts).toEqual([1, 2, 0.5]);
    expect(gone.pts).toEqual([0, 0, 0.5]);
    command.invert();
    expect(a.pts).toEqual([1, 2, 0.5]);
  });

  it("finds a stroke by id when the page holds a copy of it, and does nothing on an unknown page", () => {
    const onPage = stroke("a", [1, 2, 0.5]);
    const doc = docWith([onPage]);
    const command = new SetStrokePoints("p1", [
      { stroke: stroke("a", [1, 2, 0.5]), pts: [4, 5, 0.5] },
    ]);
    command.apply(doc);
    expect(onPage.pts).toEqual([4, 5, 0.5]);
    const other = new SetStrokePoints("nope", [{ stroke: onPage, pts: [0, 0, 0] }]);
    other.apply(doc);
    expect(onPage.pts).toEqual([4, 5, 0.5]);
  });
});
