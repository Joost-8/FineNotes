/**
 * `src/model/clipboard.ts` — what the in-plugin clipboard holds, the fresh
 * copies a paste makes, and where a paste lands.
 */

import { describe, expect, it } from "vitest";
import {
  InkClipboard,
  PASTE_MAX_STEPS,
  PASTE_OFFSET,
  pasteCopies,
  pastePlacement,
  sameSpotTaken,
} from "../../src/model/clipboard";
import type { Bounds, ImageElement, Page, Stroke, TextBoxElement } from "../../src/model/document";
import { blankPage } from "../../src/model/document";
import type { IdSource, PageElements } from "../../src/model/selection-commands";

function stroke(id: string, x = 10, extra: Partial<Stroke> = {}): Stroke {
  return {
    id,
    color: "#000000",
    size: 2,
    tool: "pen",
    pts: [x, 20, 0.5, x + 30, 40, 0.5],
    t0: 1234,
    ...extra,
  };
}

function image(id: string, extra: Partial<ImageElement> = {}): ImageElement {
  return { id, path: "pic.png", x: 100, y: 100, w: 200, h: 100, ...extra };
}

function textBox(id: string, extra: Partial<TextBoxElement> = {}): TextBoxElement {
  return { id, x: 50, y: 300, w: 200, text: "hello", color: "#111111", fontSize: 18, ...extra };
}

function ids(): IdSource {
  let n = 100;
  return { stroke: () => `s${++n}`, image: () => `i${++n}`, textBox: () => `t${++n}` };
}

const BOUNDS: Bounds = { minX: 100, minY: 100, maxX: 300, maxY: 200 };
const PAGE = { width: 1000, height: 1400 };

describe("InkClipboard", () => {
  it("holds deep copies, untouched by later edits to the originals", () => {
    const clip = new InkClipboard();
    const s = stroke("s1");
    const i = image("i1", { crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    clip.put({ strokes: [s], images: [i], textBoxes: [] }, BOUNDS);
    s.pts[0] = 999;
    i.x = 999;
    if (i.crop) i.crop.x = 0.4;
    const held = clip.content?.elements;
    expect(held?.strokes[0].pts[0]).toBe(10);
    expect(held?.images[0].x).toBe(100);
    expect(held?.images[0].crop?.x).toBe(0);
    expect(held?.strokes[0]).not.toBe(s);
  });

  it("says what can be pasted where", () => {
    const clip = new InkClipboard();
    expect(clip.canPaste()).toBe(false);
    clip.put({ strokes: [], images: [image("i1")], textBoxes: [] }, BOUNDS);
    expect(clip.canPaste()).toBe(true);
    // A surface that shows no pictures has nothing to paste from pictures alone.
    expect(clip.canPaste(false)).toBe(false);
    clip.put({ strokes: [], images: [image("i1")], textBoxes: [textBox("t1")] }, BOUNDS);
    expect(clip.canPaste(false)).toBe(true);
  });

  it("counts versions, and an empty copy clears it", () => {
    const clip = new InkClipboard();
    const v0 = clip.version;
    clip.put({ strokes: [stroke("s1")], images: [], textBoxes: [] }, BOUNDS);
    expect(clip.version).toBe(v0 + 1);
    clip.put({ strokes: [], images: [], textBoxes: [] }, BOUNDS);
    expect(clip.content).toBeNull();
    clip.put({ strokes: [stroke("s1")], images: [], textBoxes: [] }, BOUNDS);
    clip.clear();
    expect(clip.content).toBeNull();
    expect(clip.version).toBe(v0 + 4);
  });

  it("remembers the window was left since the copy, until the next copy", () => {
    const clip = new InkClipboard();
    clip.noteWindowLeft();
    // Nothing held: nothing to be stale.
    expect(clip.leftSinceCopy).toBe(false);
    clip.put({ strokes: [stroke("s1")], images: [], textBoxes: [] }, BOUNDS);
    expect(clip.leftSinceCopy).toBe(false);
    clip.noteWindowLeft();
    expect(clip.leftSinceCopy).toBe(true);
    clip.put({ strokes: [stroke("s1")], images: [], textBoxes: [] }, BOUNDS);
    expect(clip.leftSinceCopy).toBe(false);
  });
});

describe("pasteCopies", () => {
  it("mints fresh ids, moves the copies and drops t0", () => {
    const clip = new InkClipboard();
    clip.put(
      { strokes: [stroke("s1")], images: [image("i1")], textBoxes: [textBox("t1")] },
      BOUNDS,
    );
    const entry = clip.content;
    if (!entry) throw new Error("empty");
    const copies = pasteCopies(entry, ids(), 5, 7);
    expect(copies.strokes[0].id).toBe("s101");
    expect(copies.strokes[0].pts.slice(0, 2)).toEqual([15, 27]);
    expect("t0" in copies.strokes[0]).toBe(false);
    expect(copies.images[0]).toMatchObject({ id: "i102", x: 105, y: 107, path: "pic.png" });
    expect(copies.textBoxes[0]).toMatchObject({ id: "t103", x: 55, y: 307 });
    // Two pastes are two sets of objects.
    const again = pasteCopies(entry, ids(), 0, 0);
    expect(again.images[0]).not.toBe(copies.images[0]);
    expect(entry.elements.images[0].x).toBe(100);
  });

  it("never pastes a lock", () => {
    const clip = new InkClipboard();
    clip.put({ strokes: [], images: [image("i1", { locked: true })], textBoxes: [] }, BOUNDS);
    const entry = clip.content;
    if (!entry) throw new Error("empty");
    expect("locked" in pasteCopies(entry, ids(), 0, 0).images[0]).toBe(false);
  });

  it("leaves pictures out for a surface that cannot show them", () => {
    const clip = new InkClipboard();
    clip.put({ strokes: [stroke("s1")], images: [image("i1")], textBoxes: [] }, BOUNDS);
    const entry = clip.content;
    if (!entry) throw new Error("empty");
    const copies = pasteCopies(entry, ids(), 0, 0, false);
    expect(copies.images).toEqual([]);
    expect(copies.strokes).toHaveLength(1);
  });
});

describe("sameSpotTaken", () => {
  function pageWith(elements: Partial<PageElements>): PageElements {
    return { strokes: [], images: [], textBoxes: [], ...elements };
  }

  it("finds the same picture, text or stroke already in the very same place", () => {
    const copies: PageElements = {
      strokes: [stroke("s1")],
      images: [image("i1")],
      textBoxes: [textBox("t1")],
    };
    expect(sameSpotTaken(pageWith({ images: [image("x")] }), copies, 0, 0)).toBe(true);
    expect(sameSpotTaken(pageWith({ images: [image("x")] }), copies, 24, 24)).toBe(false);
    expect(sameSpotTaken(pageWith({ images: [image("x", { path: "b.png" })] }), copies, 0, 0)).toBe(
      false,
    );
    expect(sameSpotTaken(pageWith({ textBoxes: [textBox("x")] }), copies, 0, 0)).toBe(true);
    expect(
      sameSpotTaken(pageWith({ textBoxes: [textBox("x", { text: "other" })] }), copies, 0, 0),
    ).toBe(false);
    expect(sameSpotTaken(pageWith({ strokes: [stroke("x")] }), copies, 0, 0)).toBe(true);
    expect(sameSpotTaken(pageWith({ strokes: [stroke("x", 11)] }), copies, 0, 0)).toBe(false);
    expect(sameSpotTaken(pageWith({ strokes: [stroke("x", 34)] }), copies, 24, 0)).toBe(true);
    expect(sameSpotTaken(pageWith({}), copies, 0, 0)).toBe(false);
  });

  it("never matches a stroke with no whole point", () => {
    const empty = stroke("s1", 0, { pts: [1, 2] });
    const page = pageWith({ strokes: [stroke("x", 0, { pts: [1, 2] })] });
    expect(sameSpotTaken(page, { strokes: [empty], images: [], textBoxes: [] }, 0, 0)).toBe(false);
  });
});

describe("pastePlacement", () => {
  const visible: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  const free = (): boolean => false;

  it("keeps the place it was copied from when that is on screen and free (a Cut)", () => {
    expect(pastePlacement({ bounds: BOUNDS, page: PAGE, visible, taken: free })).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  it("steps down and right past copies that are already there (a Copy)", () => {
    const taken = new Set(["0,0", `${PASTE_OFFSET},${PASTE_OFFSET}`]);
    const d = pastePlacement({
      bounds: BOUNDS,
      page: PAGE,
      visible,
      taken: (dx, dy) => taken.has(`${dx},${dy}`),
    });
    expect(d).toEqual({ dx: 2 * PASTE_OFFSET, dy: 2 * PASTE_OFFSET });
  });

  it("centres the paste in view when its old place is scrolled away", () => {
    const below: Bounds = { minX: 0, minY: 900, maxX: 1000, maxY: 1300 };
    expect(pastePlacement({ bounds: BOUNDS, page: PAGE, visible: below, taken: free })).toEqual({
      dx: 500 - 200,
      dy: 1100 - 150,
    });
  });

  it("centres the paste on a pressed point", () => {
    expect(
      pastePlacement({ bounds: BOUNDS, page: PAGE, visible, at: { x: 600, y: 700 }, taken: free }),
    ).toEqual({ dx: 400, dy: 550 });
  });

  it("keeps the group's centre on the page", () => {
    const d = pastePlacement({
      bounds: BOUNDS,
      page: { width: 250, height: 140 },
      visible: null,
      taken: free,
    });
    expect(d).toEqual({ dx: 0, dy: -10 });
    const pressed = pastePlacement({
      bounds: BOUNDS,
      page: PAGE,
      visible,
      at: { x: -50, y: 2000 },
      taken: free,
    });
    expect(pressed).toEqual({ dx: -200, dy: 1400 - 150 });
  });

  it("gives up cascading after a bounded number of steps", () => {
    let calls = 0;
    const d = pastePlacement({
      bounds: BOUNDS,
      page: PAGE,
      visible,
      step: 1,
      taken: () => {
        calls++;
        return true;
      },
    });
    expect(calls).toBe(PASTE_MAX_STEPS);
    expect(d).toEqual({ dx: PASTE_MAX_STEPS, dy: PASTE_MAX_STEPS });
  });

  it("uses the real page elements as the taken test in practice", () => {
    const page: Page = blankPage("p1", PAGE);
    const original = image("i1");
    page.images.push(original);
    const copies: PageElements = {
      strokes: [],
      images: [structuredClone(original)],
      textBoxes: [],
    };
    const d = pastePlacement({
      bounds: BOUNDS,
      page: PAGE,
      visible,
      taken: (dx, dy) => sameSpotTaken(page, copies, dx, dy),
    });
    expect(d).toEqual({ dx: PASTE_OFFSET, dy: PASTE_OFFSET });
  });
});
