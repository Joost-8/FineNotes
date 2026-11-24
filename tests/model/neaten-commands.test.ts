import { describe, expect, it } from "vitest";

import type { InkDocument, Stroke } from "../../src/model/document";
import { neatenCommandFor, type NeatenChanges } from "../../src/model/neaten-commands";

function stroke(id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke {
  return { id, color: "#000000", size: 2, tool: "pen", pts, ...extra };
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

function ids(): () => string {
  let n = 0;
  return () => `new${++n}`;
}

describe("neatenCommandFor", () => {
  const style = [
    stroke("s0", [0, 0, 0.5], { color: "#112233", size: 3, tool: "pen", t0: 100 }),
    stroke("s1", [0, 0, 0.5], { color: "#445566", size: 5, tool: "highlighter", t0: 900 }),
  ];

  function page(): { a: Stroke; b: Stroke; c: Stroke; d: Stroke } {
    return {
      a: stroke("a", [1, 1, 0.5, 2, 2, 0.5]),
      b: stroke("b", [3, 3, 0.5]),
      c: stroke("c", [4, 4, 0.5]),
      d: stroke("d", [5, 5, 0.5, 6, 6, 0.5]),
    };
  }

  const changes = (extra: Partial<NeatenChanges> = {}): NeatenChanges => ({
    removed: ["b", "c"],
    added: [
      { pts: [10, 10, 0.5, 11, 11, 0.5], line: 0 },
      { pts: [20, 20, 0.5], line: 1 },
    ],
    moved: new Map([["d", [7, 7, 0.5, 8, 8, 0.5]]]),
    ...extra,
  });

  it("is null when a stroke to remove is no longer on the page", () => {
    const { a, d } = page();
    expect(neatenCommandFor("p1", [a, d], changes(), style, ids())).toBeNull();
  });

  it("is null when nothing is added", () => {
    const p = page();
    expect(
      neatenCommandFor("p1", Object.values(p), changes({ added: [] }), style, ids()),
    ).toBeNull();
  });

  it("removes, adds and moves in one command", () => {
    const p = page();
    const doc = docWith(Object.values(p));
    const command = neatenCommandFor("p1", doc.pages[0].strokes, changes(), style, ids());
    expect(command).not.toBeNull();
    command?.apply(doc);
    const now = doc.pages[0].strokes;
    expect(now.map((s) => s.id)).toEqual(["a", "d", "new1", "new2"]);
    // The moved stroke is the same object with new points; the others are untouched.
    expect(now[1]).toBe(p.d);
    expect(p.d.pts).toEqual([7, 7, 0.5, 8, 8, 0.5]);
    expect(p.a.pts).toEqual([1, 1, 0.5, 2, 2, 0.5]);
    // New strokes take pen, colour and size from their line's style stroke, and a time after it.
    expect(now[2]).toMatchObject({
      color: "#112233",
      size: 3,
      tool: "pen",
      t0: 100,
      pts: [10, 10, 0.5, 11, 11, 0.5],
    });
    expect(now[3]).toMatchObject({
      color: "#445566",
      size: 5,
      tool: "highlighter",
      t0: 901,
      pts: [20, 20, 0.5],
    });
  });

  it("copies the points, so the command owns them", () => {
    const p = page();
    const c = changes();
    const doc = docWith(Object.values(p));
    neatenCommandFor("p1", doc.pages[0].strokes, c, style, ids())?.apply(doc);
    expect(doc.pages[0].strokes[2].pts).not.toBe(c.added[0].pts);
  });

  it("keeps the pen's nib, tip and sticky note, and drops its own samples, tilt, mirror and shape", () => {
    const { a } = page();
    const doc = docWith([a]);
    const pen = stroke("s9", [0, 0, 0.5, 1, 1, 0.5], {
      nib: 0.6,
      tip: "chisel" as Stroke["tip"],
      onSticky: "note-1",
      samples: [1, 2],
      tilt: [0.1, 0.2],
      join: "p2/s9",
      t0: 50,
    });
    const command = neatenCommandFor(
      "p1",
      doc.pages[0].strokes,
      { removed: ["a"], added: [{ pts: [7, 7, 0.5], line: 0 }], moved: new Map() },
      [pen],
      ids(),
    );
    command?.apply(doc);
    const made = doc.pages[0].strokes.find((s) => s.id === "new1") as Stroke;
    expect(made).toMatchObject({ nib: 0.6, tip: "chisel", onSticky: "note-1", t0: 50 });
    expect(made.samples).toBeUndefined();
    expect(made.tilt).toBeUndefined();
    expect(made.join).toBeUndefined();
  });

  it("leaves t0 off when the style stroke has none", () => {
    const p = page();
    const doc = docWith(Object.values(p));
    const plain = [stroke("s0", [0, 0, 0.5]), stroke("s1", [0, 0, 0.5])];
    neatenCommandFor("p1", doc.pages[0].strokes, changes(), plain, ids())?.apply(doc);
    expect(doc.pages[0].strokes[2].t0).toBeUndefined();
  });

  it("adds nothing for a line with no style stroke, and ignores a move whose point count differs", () => {
    const p = page();
    const doc = docWith(Object.values(p));
    const c = changes({ moved: new Map([["d", [7, 7, 0.5]]]) });
    neatenCommandFor("p1", doc.pages[0].strokes, c, [style[0]], ids())?.apply(doc);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["a", "d", "new1"]);
    expect(p.d.pts).toEqual([5, 5, 0.5, 6, 6, 0.5]);
  });

  it("restores the page exactly on undo: the same strokes in the same order with the same points", () => {
    const p = page();
    const original = Object.values(p);
    const doc = docWith([...original]);
    const before = original.map((s) => [s, [...s.pts], s.pts] as const);
    const command = neatenCommandFor("p1", doc.pages[0].strokes, changes(), style, ids());
    command?.apply(doc);
    command?.invert(doc);
    const now = doc.pages[0].strokes;
    expect(now).toHaveLength(original.length);
    now.forEach((s, i) => {
      expect(s).toBe(original[i]);
      expect(s.pts).toEqual(before[i][1]);
    });
  });

  it("can be applied again after undo", () => {
    const p = page();
    const doc = docWith(Object.values(p));
    const command = neatenCommandFor("p1", doc.pages[0].strokes, changes(), style, ids());
    command?.apply(doc);
    command?.invert(doc);
    command?.apply(doc);
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual(["a", "d", "new1", "new2"]);
  });
});
