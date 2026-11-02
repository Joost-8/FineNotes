/**
 * A shape's style (`src/model/shape-style.ts`): which kinds take a fill,
 * rounded corners or heads; reading it from disk; applying it, and undoing
 * that; and what the commands that move, resize and erase shapes do with it.
 */

import { describe, expect, it } from "vitest";
import { strokeFillHit } from "../../src/canvas/hit-test";
import { eraseCircleFromStroke } from "../../src/ink/stroke-eraser";
import {
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { deflateToBase64, inflateFromBase64 } from "../../src/model/compress";
import { RestyleShapes, ScaleElements, copyElements } from "../../src/model/selection-commands";
import {
  ROUND_RADIUS,
  applyShapeStyle,
  canFill,
  canHaveHeads,
  canRound,
  commonShapeStyle,
  fillOf,
  headsOf,
  isClosedLoop,
  readDash,
  readFill,
  readHeads,
  readRadius,
  readShapeToolStyle,
  splitFill,
  styleNewShape,
  withAlpha,
} from "../../src/model/shape-style";

const flat = (points: Array<[number, number]>): number[] => points.flatMap(([x, y]) => [x, y, 0.5]);

function rect(id = "r", extra: Partial<Stroke> = {}): Stroke {
  return {
    id,
    color: "#1971c2",
    size: 2,
    tool: "pen",
    shape: "rect",
    pts: flat([
      [10, 10],
      [110, 10],
      [110, 60],
      [10, 60],
      [10, 10],
    ]),
    ...extra,
  };
}

function arrow(id = "a"): Stroke {
  return {
    id,
    color: "#000000",
    size: 2,
    tool: "pen",
    shape: "arrow",
    pts: flat([
      [0, 0],
      [100, 0],
      [100, 0],
      [80, -10],
      [100, 0],
      [80, 10],
    ]),
  };
}

function docWith(strokes: Stroke[]): { doc: InkDocument; page: Page } {
  const doc = emptyDocument();
  const page = { ...blankPage("p1", { width: 400, height: 400 }), strokes };
  doc.pages = [page];
  return { doc, page };
}

describe("which kinds take what", () => {
  it("fills closed kinds, rounds straight-edged ones, puts heads on connectors", () => {
    expect(canFill("rect")).toBe(true);
    expect(canFill("ellipse")).toBe(true);
    expect(canFill("line")).toBe(false);
    expect(canFill(undefined)).toBe(false);
    expect(canRound("star")).toBe(true);
    expect(canRound("ellipse")).toBe(false);
    expect(canRound("roundrect")).toBe(false);
    expect(canHaveHeads("line")).toBe(true);
    expect(canHaveHeads("arrow")).toBe(true);
    expect(canHaveHeads("rect")).toBe(false);
  });
});

describe("reading a style", () => {
  it("keeps only what it can read", () => {
    expect(readFill("#AABBCC")).toBe("#aabbcc");
    expect(readFill("#aabbcc80")).toBe("#aabbcc80");
    expect(readFill("#abc")).toBeUndefined();
    expect(readFill("red")).toBeUndefined();
    expect(readDash("dot")).toBe("dot");
    expect(readDash("wavy")).toBeUndefined();
    expect(readRadius(12)).toBe(12);
    expect(readRadius(0)).toBeUndefined();
    expect(readRadius(-3)).toBeUndefined();
    expect(readRadius(Number.NaN)).toBeUndefined();
    expect(readRadius(9e9)).toBe(500);
    expect(readHeads({ start: "filled", end: "spiky" })).toEqual({ start: "filled" });
    expect(readHeads({})).toBeUndefined();
    expect(readHeads(null)).toBeUndefined();
  });

  it("reads the Shape tool's remembered style field by field", () => {
    expect(
      readShapeToolStyle({ fill: "soft", dash: "dash", round: true, heads: { end: "filled" } }),
    ).toEqual({ fill: "soft", dash: "dash", round: true, heads: { end: "filled" } });
    expect(readShapeToolStyle({ fill: "glitter", round: "yes", heads: { end: "x" } })).toEqual({
      heads: {},
    });
    expect(readShapeToolStyle(undefined)).toEqual({});
  });

  it("splits and joins a fill's alpha", () => {
    expect(withAlpha("#123456", 0.3)).toBe("#1234564d");
    expect(withAlpha("#123456", 1)).toBe("#123456");
    expect(splitFill("#1234564d")).toEqual({ color: "#123456", alpha: 77 / 255 });
    expect(splitFill("#123456")).toEqual({ color: "#123456", alpha: 1 });
    expect(fillOf("#ff0000", "soft")).toBe("#ff00004d");
    expect(fillOf("#ff0000", "solid")).toBe("#ff0000");
  });

  it("tells a closed outline from an open one", () => {
    expect(isClosedLoop(rect().pts)).toBe(true);
    expect(isClosedLoop(arrow().pts)).toBe(false);
    expect(
      isClosedLoop(
        flat([
          [0, 0],
          [0, 0],
        ]),
      ),
    ).toBe(false);
  });
});

describe("applyShapeStyle", () => {
  it("gives a shape the parts its kind takes, and says whether it changed", () => {
    const s = rect();
    expect(
      applyShapeStyle(s, { fill: "#ffd43b", dash: "dash", radius: 8, heads: { end: "open" } }),
    ).toBe(true);
    expect(s).toMatchObject({ fill: "#ffd43b", dash: "dash", radius: 8 });
    expect(s.heads).toBeUndefined();
    expect(applyShapeStyle(s, { fill: "#ffd43b" })).toBe(false);
  });

  it("clears with null", () => {
    const s = rect("r", { fill: "#ffd43b", dash: "dot", radius: 8 });
    applyShapeStyle(s, { fill: null, dash: null, radius: null });
    expect(s).toEqual(rect());
  });

  it("fills each shape with its own colour", () => {
    const s = rect();
    applyShapeStyle(s, { fillFrom: "soft" });
    expect(s.fill).toBe("#1971c24d");
  });

  it("leaves freehand ink alone", () => {
    const ink: Stroke = { id: "i", color: "#000000", size: 2, tool: "pen", pts: [0, 0, 0.5] };
    expect(applyShapeStyle(ink, { dash: "dash" })).toBe(false);
    expect(ink.dash).toBeUndefined();
  });

  it("turns an arrow given heads into a line from its tail to its tip", () => {
    const s = arrow();
    applyShapeStyle(s, { heads: { start: "filled", end: "filled" } });
    expect(s.shape).toBe("line");
    expect(s.pts).toEqual(
      flat([
        [0, 0],
        [100, 0],
      ]),
    );
    expect(s.heads).toEqual({ start: "filled", end: "filled" });
    expect(headsOf(arrow())).toEqual({ end: "open" });
  });
});

describe("styleNewShape: what the Shape tool places", () => {
  it("tints, dashes and rounds a closed shape", () => {
    const s = rect();
    styleNewShape(s, { fill: "soft", dash: "dot", round: true });
    expect(s).toMatchObject({ fill: "#1971c24d", dash: "dot", radius: ROUND_RADIUS });
  });

  it("keeps a default arrow as it always was", () => {
    const s = arrow();
    styleNewShape(s, {});
    expect(s).toEqual(arrow());
    styleNewShape(s, { heads: { end: "open" } });
    expect(s).toEqual(arrow());
  });

  it("makes any other arrow a line with those heads, or none", () => {
    const both = arrow();
    styleNewShape(both, { heads: { start: "open", end: "filled" } });
    expect(both).toMatchObject({ shape: "line", heads: { start: "open", end: "filled" } });
    const none = arrow();
    styleNewShape(none, { heads: {} });
    expect(none.shape).toBe("line");
    expect(none.heads).toBeUndefined();
  });

  it("does nothing to freehand ink", () => {
    const ink: Stroke = { id: "i", color: "#000000", size: 2, tool: "pen", pts: [0, 0, 0.5] };
    styleNewShape(ink, { fill: "solid", dash: "dash" });
    expect(ink).toEqual({ id: "i", color: "#000000", size: 2, tool: "pen", pts: [0, 0, 0.5] });
  });
});

describe("commonShapeStyle", () => {
  it("reports what every shape agrees on, and leaves out what differs", () => {
    const a = rect("a", { fill: "#ff0000", dash: "dash" });
    const b = rect("b", { fill: "#ff0000" });
    const c = arrow("c");
    const common = commonShapeStyle([a, b, c]);
    expect(common.style).toEqual({ fill: "#ff0000", radius: null, heads: { end: "open" } });
    expect(common).toMatchObject({ fillable: true, roundable: true, headed: true, shapes: 3 });
  });

  it("has nothing to say about freehand ink", () => {
    const ink: Stroke = { id: "i", color: "#000000", size: 2, tool: "pen", pts: [0, 0, 0.5] };
    expect(commonShapeStyle([ink]).shapes).toBe(0);
  });
});

describe("RestyleShapes", () => {
  it("applies to the shapes that take it, and undo puts each back exactly", () => {
    const a = rect("a", { dash: "dot" });
    const b = arrow("b");
    const { doc, page } = docWith([a, b]);
    const before = structuredClone(page.strokes);
    const command = new RestyleShapes("p1", [a, b], {
      fillFrom: "solid",
      dash: "dash",
      heads: { start: "open" },
    });
    command.apply(doc);
    expect(command.changed).toBe(true);
    expect(a).toMatchObject({ fill: "#1971c2", dash: "dash" });
    expect(b).toMatchObject({ shape: "line", dash: "dash", heads: { start: "open" } });
    command.invert(doc);
    expect(page.strokes).toEqual(before);
    // Keys come back in their own order, so a save is unchanged by an undo.
    expect(JSON.stringify(page.strokes)).toBe(JSON.stringify(before));
  });

  it("changes nothing when there is nothing to change", () => {
    const a = rect("a");
    const { doc } = docWith([a]);
    const command = new RestyleShapes("p1", [a], { heads: { end: "open" } });
    command.apply(doc);
    expect(command.changed).toBe(false);
  });
});

describe("shapes through the other commands", () => {
  it("grows the corners with a resize, and undo shrinks them back", () => {
    const a = rect("a", { radius: 10 });
    const { doc } = docWith([a]);
    const scale = new ScaleElements("p1", { strokes: [a], images: [], textBoxes: [] }, 0, 0, 2);
    scale.apply(doc);
    expect(a.radius).toBe(20);
    scale.invert(doc);
    expect(a.radius).toBe(10);
  });

  it("copies every style field with a duplicate", () => {
    const a = rect("a", { fill: "#ff0000", dash: "dash", radius: 5 });
    const ids = {
      stroke: () => "c",
      image: () => "ci",
      textBox: () => "ct",
      table: () => "cg",
      graph: () => "cf",
    };
    const [copy] = copyElements({ strokes: [a], images: [], textBoxes: [] }, ids, 5, 5).strokes;
    expect(copy).toMatchObject({ fill: "#ff0000", dash: "dash", radius: 5 });
  });

  it("keeps an erased piece's line and corners, but not its fill or heads", () => {
    const a = rect("a", { fill: "#ff0000", dash: "dash", radius: 5 });
    let n = 0;
    const pieces = eraseCircleFromStroke(a, 60, 10, 6, () => `e${++n}`) ?? [];
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(piece).toMatchObject({ shape: "rect", dash: "dash", radius: 5 });
      expect(piece.fill).toBeUndefined();
    }
  });

  it("is hit inside its fill, and only when it has one", () => {
    expect(strokeFillHit(rect("a", { fill: "#ff0000" }), 50, 30)).toBe(true);
    expect(strokeFillHit(rect("a", { fill: "#ff0000" }), 200, 30)).toBe(false);
    expect(strokeFillHit(rect("a"), 50, 30)).toBe(false);
    const open = {
      ...rect("a", { fill: "#ff0000" }),
      pts: flat([
        [10, 10],
        [110, 10],
        [110, 60],
      ]),
    };
    expect(strokeFillHit(open, 100, 20)).toBe(false);
  });
});

describe("saving a styled shape", () => {
  it("round-trips every style field, and drops what it cannot read", () => {
    const { doc } = docWith([
      rect("a", { fill: "#ff00004d", dash: "dot", radius: 7.5 }),
      {
        ...arrow("b"),
        shape: "line",
        pts: flat([
          [0, 0],
          [90, 0],
        ]),
        heads: { start: "filled" },
      },
    ]);
    const back = decodeDocument(encodeDocument(doc));
    // Pressure is stored in 255ths, so the points are compared apart from it.
    const styleOnly = (strokes: Stroke[]): unknown[] =>
      strokes.map(({ pts: _pts, ...rest }) => rest);
    expect(styleOnly(back.pages[0].strokes)).toEqual(styleOnly(doc.pages[0].strokes));
    // Junk in each field is simply not there on load.
    const payload = encodeDocument(doc);
    const colon = payload.indexOf(":");
    const json = JSON.parse(inflateFromBase64(payload.slice(colon + 1))) as {
      pages: Array<{ strokes: Array<Record<string, unknown>> }>;
    };
    Object.assign(json.pages[0].strokes[0], { fill: "red", dash: "wavy", radius: -4 });
    Object.assign(json.pages[0].strokes[1], { heads: { start: "spiky" } });
    const tampered = `${payload.slice(0, colon + 1)}${deflateToBase64(JSON.stringify(json))}`;
    const [r, l] = decodeDocument(tampered).pages[0].strokes;
    expect([r.fill, r.dash, r.radius, l.heads]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("saves a plain shape exactly as before", () => {
    const { doc } = docWith([rect("a")]);
    expect(encodeDocument(doc)).toBe(encodeDocument(docWith([rect("a")]).doc));
    const back = decodeDocument(encodeDocument(doc)).pages[0].strokes[0];
    expect(Object.keys(back)).toEqual(["id", "color", "size", "tool", "pts", "shape"]);
  });
});

describe("a path arrow's style (discussion #107)", () => {
  const path = (extra: Partial<Stroke> = {}): Stroke => ({
    id: "p",
    color: "#000000",
    size: 2,
    tool: "pen",
    shape: "path",
    heads: { end: "open" },
    radius: ROUND_RADIUS,
    pts: flat([
      [0, 0],
      [100, 0],
      [100, 80],
      [200, 80],
    ]),
    ...extra,
  });

  it("takes heads and corners, never a fill: it is open", () => {
    expect(canHaveHeads("path")).toBe(true);
    expect(canRound("path")).toBe(true);
    expect(canFill("path")).toBe(false);
    expect(headsOf(path())).toEqual({ end: "open" });
    expect(headsOf(path({ heads: undefined }))).toBeNull();
  });

  it("changes its heads in place, keeping every corner", () => {
    const s = path();
    expect(applyShapeStyle(s, { heads: { start: "filled", end: "filled" } })).toBe(true);
    expect(s.shape).toBe("path");
    expect(s.pts).toEqual(path().pts);
    expect(s.heads).toEqual({ start: "filled", end: "filled" });
    applyShapeStyle(s, { heads: null, radius: null });
    expect(s.heads).toBeUndefined();
    expect(s.radius).toBeUndefined();
  });

  it("drawn with the Shape tool, takes the arrow preset's heads", () => {
    const keep = path();
    styleNewShape(keep, {});
    expect(keep).toEqual(path());
    const filled = path();
    styleNewShape(filled, { heads: { end: "filled" } });
    expect(filled.heads).toEqual({ end: "filled" });
    expect(filled.shape).toBe("path");
  });

  it("saves and loads with its head and corners", () => {
    const { doc } = docWith([path()]);
    const back = decodeDocument(encodeDocument(doc)).pages[0].strokes[0];
    expect(back).toMatchObject({ shape: "path", heads: { end: "open" }, radius: ROUND_RADIUS });
    expect(back.pts.length).toBe(12);
  });
});
