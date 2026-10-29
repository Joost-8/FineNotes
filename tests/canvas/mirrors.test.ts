/**
 * `src/canvas/mirrors.ts` — what a notebook with joined pages stores so an
 * element reaching over a join shows on the page beside it: one owner,
 * mirrors derived from it, and a command that brings the mirrors in line,
 * undoing to an identical document (contracts/api.md §3).
 */

import { describe, expect, it } from "vitest";
import {
  MirrorSync,
  MoveToPage,
  elementBounds,
  findOwner,
  isMirror,
  mirrorId,
  ownerKey,
  ownerOf,
  planMirrors,
  sameElement,
} from "../../src/canvas/mirrors";
import { layoutPages } from "../../src/canvas/page-layout";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type Stroke,
  type TextBoxElement,
  blankPage,
} from "../../src/model/document";
import { History } from "../../src/model/history";
import { MoveElementsToPage } from "../../src/model/selection-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

function doc(...count: number[]): InkDocument {
  const pages: Page[] = count.map((_, i) => {
    const page = blankPage(`p${i + 1}`);
    page.geometry = { width: 1000, height: 1400 };
    return page;
  });
  return { version: 3, view: { scrollY: 0, width: 1000, scale: 1 }, pages, joined: true };
}

const stroke = (id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke => ({
  id,
  color: "#000000",
  size: 2,
  tool: "pen",
  pts,
  ...extra,
});

const picture = (id: string, x: number, y: number, w = 200, h = 200): ImageElement => ({
  id,
  path: "a.png",
  x,
  y,
  w,
  h,
});

/** Plan and apply, as the surface does after an edit; returns the command. */
function sync(d: InkDocument): MirrorSync | null {
  const layout = layoutPages(d.pages, { joined: d.joined === true });
  const ops = planMirrors(d, layout);
  if (ops.length === 0) return null;
  const command = new MirrorSync(ops);
  command.apply(d);
  return command;
}

describe("names", () => {
  it("a mirror names its owner by page and id, and is named after both", () => {
    const key = ownerKey("p2", "s7");
    expect(key).toBe("p2/s7");
    expect(mirrorId(key, "p3")).toBe("p2/s7@p3");
    expect(ownerOf(key)).toEqual({ pageId: "p2", id: "s7" });
    expect(ownerOf("p2/i1/x")).toEqual({ pageId: "p2", id: "i1/x" });
    expect(ownerOf("nonsense")).toBeNull();
    expect(ownerOf("/s1")).toBeNull();
    expect(isMirror({ join: key })).toBe(true);
    expect(isMirror({})).toBe(false);
    expect(isMirror({ join: "" })).toBe(false);
  });
});

describe("planMirrors", () => {
  it("mirrors ink over the join on the page below, moved into its space", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]));
    sync(d);
    const [mirror] = d.pages[1].strokes;
    expect(mirror).toMatchObject({
      id: "p1/s1@p2",
      join: "p1/s1",
      pts: [100, -50, 0.5, 120, 50, 0.5],
    });
    expect(d.pages[0].strokes[0].join).toBeUndefined();
  });

  it("is idempotent: once in place, nothing to do", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]));
    sync(d);
    expect(planMirrors(d, layoutPages(d.pages, { joined: true }))).toEqual([]);
  });

  it("follows the owner: moved, the mirror is rebuilt; back inside, it goes", () => {
    const d = doc(1, 1);
    const owner = stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]);
    d.pages[0].strokes.push(owner);
    sync(d);
    owner.pts = [300, 1380, 0.5, 300, 1420, 0.5];
    sync(d);
    expect(d.pages[1].strokes[0].pts).toEqual([300, -20, 0.5, 300, 20, 0.5]);
    owner.pts = [300, 100, 0.5, 300, 200, 0.5];
    sync(d);
    expect(d.pages[1].strokes).toEqual([]);
  });

  it("removes a mirror whose owner is gone", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]));
    sync(d);
    d.pages[0].strokes = [];
    sync(d);
    expect(d.pages[1].strokes).toEqual([]);
  });

  it("an owner wholly on the next page's paper is shown there by its mirror", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100, 1500, 0.5, 120, 1600, 0.5]));
    sync(d);
    expect(d.pages[1].strokes[0].pts).toEqual([100, 100, 0.5, 120, 200, 0.5]);
  });

  it("mirrors pictures, text boxes, tables and graphs that reach over", () => {
    const d = doc(1, 1);
    const [a, b] = d.pages;
    a.images.push(picture("i1", 400, 1300));
    a.textBoxes.push({
      id: "t1",
      x: 50,
      y: 1380,
      w: 300,
      h: 60,
      text: "x",
      color: "#000",
      fontSize: 20,
    });
    a.tables = [
      {
        id: "g1",
        x: 600,
        y: 1350,
        cols: [100],
        rows: [40, 40],
        cells: [[""], [""]],
        color: "#000",
        size: 1,
        textColor: "#000",
        fontSize: 16,
      },
    ];
    sync(d);
    expect(b.images[0]).toMatchObject({ id: "p1/i1@p2", join: "p1/i1", x: 400, y: -100 });
    expect(b.textBoxes[0]).toMatchObject({ id: "p1/t1@p2", y: -20 });
    expect(b.tables?.[0]).toMatchObject({ id: "p1/g1@p2", y: -50 });
  });

  it("mirrors a sticky note's ink only where the note is, on the note's mirror", () => {
    const d = doc(1, 1);
    const [a, b] = d.pages;
    a.images.push({ ...picture("i1", 400, 1300), path: "", sticky: { color: "#ffeb3b" } });
    a.strokes.push(stroke("s1", [450, 1380, 0.5, 460, 1440, 0.5], { onSticky: "i1" }));
    sync(d);
    expect(b.strokes[0]).toMatchObject({ join: "p1/s1", onSticky: "p1/i1@p2" });
  });

  it("does nothing when the pages are not joined, and leaves mirrors standing", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]));
    sync(d);
    d.joined = undefined;
    expect(planMirrors(d, layoutPages(d.pages))).toEqual([]);
  });

  it("a long line reaches every page it crosses; a diagonal off the side reaches none", () => {
    const d = doc(1, 1, 1);
    d.pages[0].strokes.push(stroke("s1", [500, 1000, 0.5, 500, 3500, 0.5]));
    d.pages[0].strokes.push(stroke("s2", [1050, 1300, 0.5, 1400, 1600, 0.5]));
    sync(d);
    expect(d.pages[1].strokes.map((s) => s.id)).toEqual(["p1/s1@p2"]);
    expect(d.pages[2].strokes.map((s) => s.id)).toEqual(["p1/s1@p3"]);
  });

  it("uses the bounds the caller keeps for strokes", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]));
    const layout = layoutPages(d.pages, { joined: true });
    expect(planMirrors(d, layout, { strokeBounds: () => null })).toEqual([]);
  });
});

describe("MirrorSync", () => {
  it("undo gives back the same document, lists it created removed again", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]));
    d.pages[0].tables = [
      {
        id: "g1",
        x: 600,
        y: 1350,
        cols: [100],
        rows: [80],
        cells: [[""]],
        color: "#000",
        size: 1,
        textColor: "#000",
        fontSize: 16,
      },
    ];
    const before = JSON.stringify(d);
    const command = sync(d);
    expect(command).not.toBeNull();
    expect("tables" in d.pages[1]).toBe(true);
    command?.invert(d);
    expect(JSON.stringify(d)).toBe(before);
    command?.apply(d);
    expect(d.pages[1].strokes).toHaveLength(1);
  });

  it("a replaced mirror keeps its place in the list", () => {
    const d = doc(1, 1);
    const owner = stroke("s1", [100, 1350, 0.5, 120, 1450, 0.5]);
    d.pages[0].strokes.push(owner);
    d.pages[1].strokes.push(stroke("s9", [10, 10, 0.5]));
    sync(d);
    d.pages[1].strokes.push(stroke("s10", [10, 10, 0.5]));
    owner.pts = [100, 1350, 0.5, 130, 1460, 0.5];
    const before = JSON.stringify(d);
    const command = sync(d);
    expect(d.pages[1].strokes.map((s) => s.id)).toEqual(["s9", "p1/s1@p2", "s10"]);
    command?.invert(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("mirrors survive the file, and a reloaded notebook needs no changes", () => {
    const d = doc(1, 1);
    d.pages[0].strokes.push(stroke("s1", [100.123, 1350.456, 0.5, 120, 1450, 0.7]));
    d.pages[0].images.push(picture("i1", 400, 1300));
    sync(d);
    const back = decodeDocument(encodeDocument(d));
    expect(back.pages[1].strokes[0].join).toBe("p1/s1");
    expect(back.pages[1].images[0].join).toBe("p1/i1");
    expect(planMirrors(back, layoutPages(back.pages, { joined: true }))).toEqual([]);
  });
});

describe("sameElement and elementBounds", () => {
  it("compares numbers within rounding, ignoring the clock and the raw samples", () => {
    expect(sameElement({ a: [1, 2.001] }, { a: [1, 2] })).toBe(true);
    expect(sameElement({ a: 1 }, { a: 1.5 })).toBe(false);
    expect(sameElement({ t0: 5, samples: [1] }, {})).toBe(true);
    expect(sameElement({ a: undefined }, {})).toBe(true);
    expect(sameElement([1], { 0: 1 })).toBe(false);
    expect(sameElement(null, {})).toBe(false);
  });

  it("covers a turned picture and a text box that grows with its text", () => {
    const turned = elementBounds("images", { ...picture("i1", 0, 0, 200, 100), rotation: 90 });
    expect(turned?.minY).toBeCloseTo(-50);
    expect(turned?.maxY).toBeCloseTo(150);
    const box: TextBoxElement = {
      id: "t1",
      x: 0,
      y: 0,
      w: 100,
      text: "a\nb\nc",
      color: "#000",
      fontSize: 20,
    };
    expect(elementBounds("textBoxes", box)?.maxY).toBeGreaterThan(3 * 20);
    expect(elementBounds("strokes", stroke("s", [Number.NaN, 1, 0.5]))).toBeNull();
    expect(elementBounds("graphs", { id: "f1", x: 1, y: 2, w: 3, h: 4 } as never)).toEqual({
      minX: 1,
      minY: 2,
      maxX: 4,
      maxY: 6,
    });
  });
});

describe("findOwner", () => {
  it("finds the owner a mirror names, and nothing for a mirror whose owner is gone", () => {
    const d = doc(1, 1);
    d.pages[0].images.push(picture("i1", 400, 1300));
    sync(d);
    const layout = layoutPages(d.pages, { joined: true });
    const mirror = d.pages[1].images[0];
    expect(findOwner(d, layout, "images", mirror)?.element).toBe(d.pages[0].images[0]);
    expect(findOwner(d, layout, "images", d.pages[0].images[0])).toBeNull();
    d.pages[0].images = [];
    expect(findOwner(d, layout, "images", mirror)).toBeNull();
    expect(findOwner(d, layout, "images", { ...mirror, join: "bad" })).toBeNull();
  });
});

describe("MoveToPage", () => {
  it("moves owners onto the lasso's page, into its space, and undo puts them back", () => {
    const d = doc(1, 1);
    const [a, b] = d.pages;
    b.strokes.push(stroke("s5", [10, 20, 0.5, 30, 40, 0.5]));
    b.images.push(picture("i1", 50, 60));
    a.images.push(picture("i1", 0, 0));
    const before = JSON.stringify(d);
    const layout = layoutPages(d.pages, { joined: true });
    const move = new MoveToPage("p2", "p1", layout.boxes[1], layout.boxes[0], {
      strokes: ["s5"],
      images: ["i1"],
    });
    move.apply(d);
    expect(b.strokes).toEqual([]);
    expect(b.images).toEqual([]);
    expect(a.strokes[0].pts).toEqual([10, 1420, 0.5, 30, 1440, 0.5]);
    // The id p1 already uses is replaced by a free one.
    expect(a.images.map((i) => [i.id, i.y])).toEqual([
      ["i1", 0],
      ["i2", 1460],
    ]);
    expect(move.movedOf("images").map((i) => i.id)).toEqual(["i2"]);
    move.invert(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("takes a moved sticky note's ink with it, under the note's new id", () => {
    const d = doc(1, 1);
    const [a, b] = d.pages;
    a.images.push(picture("i1", 0, 0));
    b.images.push({ ...picture("i1", 50, 60), path: "", sticky: { color: "#ffeb3b" } });
    b.strokes.push(stroke("s5", [60, 70, 0.5], { onSticky: "i1" }));
    const layout = layoutPages(d.pages, { joined: true });
    const move = new MoveToPage("p2", "p1", layout.boxes[1], layout.boxes[0], { images: ["i1"] });
    move.apply(d);
    expect(a.strokes[0]).toMatchObject({ id: "s5", onSticky: "i2" });
    expect(b.strokes).toEqual([]);
  });

  it("leaves mirrors and a page onto itself alone", () => {
    const d = doc(1, 1);
    d.pages[1].strokes.push(stroke("m", [1, 1, 0.5], { join: "p1/s1" }));
    const layout = layoutPages(d.pages, { joined: true });
    new MoveToPage("p2", "p1", layout.boxes[1], layout.boxes[0], { strokes: ["m"] }).apply(d);
    new MoveToPage("p1", "p1", layout.boxes[0], layout.boxes[0], { strokes: ["m"] }).apply(d);
    expect(d.pages[1].strokes.map((s) => s.id)).toEqual(["m"]);
    expect(d.pages[0].strokes).toEqual([]);
  });
});

describe("History joins a step that makes way to the next", () => {
  it("one undo takes back both, under the next one's name", () => {
    const d = doc(1, 1);
    d.pages[1].strokes.push(stroke("s5", [10, 20, 0.5]));
    const before = JSON.stringify(d);
    const layout = layoutPages(d.pages, { joined: true });
    const history = new History();
    history.push(
      d,
      new MoveToPage("p2", "p1", layout.boxes[1], layout.boxes[0], { strokes: ["s5"] }),
    );
    const recolour = {
      label: "Change colour",
      apply: (x: InkDocument) => {
        x.pages[0].strokes[0].color = "#ff0000";
      },
      invert: (x: InkDocument) => {
        x.pages[0].strokes[0].color = "#000000";
      },
    };
    history.push(d, recolour);
    expect(history.latest?.label).toBe("Change colour");
    expect(history.isLatest(recolour)).toBe(true);
    history.undo(d);
    expect(JSON.stringify(d)).toBe(before);
    expect(history.canUndo()).toBe(false);
    history.redo(d);
    expect(d.pages[0].strokes[0].color).toBe("#ff0000");
  });
});

describe("a lasso selection moved onto the page beside (MoveElementsToPage)", () => {
  it("leaves no mirror of it on its new page, mirrors it back over the join, and undoes as one", () => {
    const d = doc(1, 1);
    // On p1, running 100 px over the join onto p2.
    const s1 = stroke("s1", [500, 1300, 0.5, 500, 1500, 0.5]);
    d.pages[0].strokes.push(s1);
    sync(d);
    expect(d.pages[1].strokes.map((s) => s.join)).toEqual(["p1/s1"]);
    const before = JSON.stringify(d);
    const layout = layoutPages(d.pages, { joined: true });
    const [p1, p2] = layout.boxes;
    const history = new History();
    // Dropped 50 px lower, into p2's space: the drag's delta plus p1 - p2.
    history.push(
      d,
      new MoveElementsToPage(
        "p1",
        "p2",
        { strokes: [s1], images: [], textBoxes: [] },
        0,
        50 + p1.y - p2.y,
      ),
    );
    const plan = planMirrors(d, layout);
    history.attach(d, new MirrorSync(plan));
    // p2 owns it now, in its own space, and holds no mirror of it.
    expect(d.pages[1].strokes.map((s) => s.id)).toEqual(["s1"]);
    expect(d.pages[1].strokes[0].pts).toEqual([500, -50, 0.5, 500, 150, 0.5]);
    // It still starts 50 px above the join: p1 shows that part as a mirror.
    expect(d.pages[0].strokes.map((s) => s.join)).toEqual(["p2/s1"]);
    expect(planMirrors(d, layout)).toEqual([]);
    history.undo(d);
    expect(JSON.stringify(d)).toBe(before);
    history.redo(d);
    expect(d.pages[1].strokes.map((s) => s.id)).toEqual(["s1"]);
    expect(d.pages[0].strokes.map((s) => s.join)).toEqual(["p2/s1"]);
  });
});
