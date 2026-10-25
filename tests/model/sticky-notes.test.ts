/**
 * Sticky notes: which strokes are a note's ink, how that ink follows the
 * note (move, resize, turn, mirror, copy), the commands, and how it is
 * folded into the note for storing and unfolded again.
 */

import { describe, expect, it } from "vitest";
import {
  type ImageElement,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import {
  IDENTITY,
  MoveNoteInk,
  STICKY_COLORS,
  SetStickyColor,
  applyAffine,
  compose,
  copyNoteInk,
  foldNoteInk,
  inkOfNote,
  invert,
  isIdentity,
  isNoteInk,
  isStickyNote,
  lengthScale,
  loneNote,
  mapPoints,
  newStickyNote,
  noteAt,
  noteIdsOf,
  noteMove,
  noteToPage,
  onNote,
  pageToNote,
  readStickyPaper,
  relinkNoteInk,
  shownAt,
  unfoldNoteInk,
  withNoteInk,
} from "../../src/model/sticky-notes";

const YELLOW = STICKY_COLORS[0].color;

function note(extra: Partial<ImageElement> = {}): ImageElement {
  return { ...newStickyNote("i1", { x: 100, y: 200, w: 200, h: 100 }, YELLOW), ...extra };
}

function stroke(id: string, pts: number[], onSticky?: string): Stroke {
  return { id, color: "#1a1a1a", size: 2, tool: "pen", pts, ...(onSticky ? { onSticky } : {}) };
}

function pageWith(images: ImageElement[], strokes: Stroke[]): Page {
  return { ...blankPage("p1"), images, strokes };
}

function close(a: { x: number; y: number }, b: { x: number; y: number }): void {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
}

describe("the paper", () => {
  it("reads a #rrggbb colour, lower-cased, and nothing else", () => {
    expect(readStickyPaper({ color: "#FDE68A" })).toEqual({ color: "#fde68a" });
    expect(readStickyPaper({ color: "#fff" })).toBeUndefined();
    expect(readStickyPaper({ color: 3 })).toBeUndefined();
    expect(readStickyPaper("#fde68a")).toBeUndefined();
    expect(readStickyPaper(null)).toBeUndefined();
  });

  it("makes a new note stuck on in front of the ink, with no file", () => {
    const made = newStickyNote("i7", { x: 1, y: 2, w: 3, h: 4 }, YELLOW);
    expect(made).toEqual({
      id: "i7",
      path: "",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      front: true,
      sticky: { color: YELLOW },
    });
    expect(isStickyNote(made)).toBe(true);
    expect(isStickyNote({ id: "i2", path: "a.png", x: 0, y: 0, w: 1, h: 1 })).toBe(false);
  });

  it("offers a few distinct colours", () => {
    const colours = STICKY_COLORS.map((c) => c.color);
    expect(new Set(colours).size).toBe(colours.length);
    expect(colours.length).toBeGreaterThanOrEqual(3);
    for (const c of colours) expect(readStickyPaper({ color: c })).toEqual({ color: c });
  });
});

describe("which ink is a note's", () => {
  const n = note();
  const picture: ImageElement = { id: "i2", path: "a.png", x: 0, y: 0, w: 10, h: 10 };

  it("knows the notes among the images, none in the usual case", () => {
    expect(noteIdsOf([picture])).toBeNull();
    expect([...(noteIdsOf([picture, n]) ?? [])]).toEqual(["i1"]);
  });

  it("is the strokes naming a note that is on the page", () => {
    const ids = noteIdsOf([n]);
    expect(isNoteInk(stroke("a", [], "i1"), ids)).toBe(true);
    expect(isNoteInk(stroke("b", [], "i9"), ids)).toBe(false);
    expect(isNoteInk(stroke("c", []), ids)).toBe(false);
    expect(isNoteInk(stroke("d", [], "i1"), null)).toBe(false);
  });

  it("lists a note's ink in page order, and none for a picture", () => {
    const page = pageWith(
      [n, picture],
      [stroke("a", [], "i1"), stroke("b", []), stroke("c", [], "i1")],
    );
    expect(inkOfNote(page, n).map((s) => s.id)).toEqual(["a", "c"]);
    expect(inkOfNote(page, picture)).toEqual([]);
  });
});

describe("frames", () => {
  it("maps the note's own space onto the page and back", () => {
    for (const extra of [
      {},
      { rotation: 0.7 },
      { flipX: true as const },
      { flipY: true as const, rotation: -2.1 },
      { flipX: true as const, flipY: true as const, rotation: 1 },
    ]) {
      const n = note(extra);
      const there = noteToPage(n);
      const back = pageToNote(n);
      const p = applyAffine(there, 30, 70);
      close(applyAffine(back, p.x, p.y), { x: 30, y: 70 });
      // The note's centre is its centre on the page, whatever its turn.
      close(applyAffine(there, 100, 50), { x: 200, y: 250 });
    }
  });

  it("puts the top-left corner where the picture painter does", () => {
    close(applyAffine(noteToPage(note()), 0, 0), { x: 100, y: 200 });
    // Mirrored left to right: the note's own left edge is on the page's right.
    close(applyAffine(noteToPage(note({ flipX: true })), 0, 0), { x: 300, y: 200 });
    // A quarter turn clockwise about (200, 250).
    close(applyAffine(noteToPage(note({ rotation: Math.PI / 2 })), 0, 0), { x: 250, y: 150 });
  });

  it("tells a point on the paper from one beside it, turned or not", () => {
    expect(onNote(note(), 150, 210)).toBe(true);
    expect(onNote(note(), 99, 210)).toBe(false);
    // Turned a quarter, the 200 x 100 note stands 100 wide and 200 tall.
    const turned = note({ rotation: Math.PI / 2 });
    expect(onNote(turned, 200, 160)).toBe(true);
    expect(onNote(turned, 120, 250)).toBe(false);
  });

  it("composes, inverts and measures maps", () => {
    const m = noteToPage(note({ rotation: 0.3, flipY: true }));
    const inv = invert(m);
    expect(inv).not.toBeNull();
    expect(isIdentity(compose(m, inv ?? IDENTITY))).toBe(true);
    expect(invert([0, 0, 0, 0, 1, 1])).toBeNull();
    expect(lengthScale(m)).toBeCloseTo(1, 12);
    expect(lengthScale([2, 0, 0, 8, 0, 0])).toBeCloseTo(4, 12);
    // A note with no size still has a place: its centre.
    close(applyAffine(pageToNote({ x: 5, y: 6, w: 0, h: 0 }), 5, 6), { x: 0, y: 0 });
  });

  it("moves ink with a move, a resize, a turn and a mirror of its note", () => {
    const before = note();
    const ink = { x: 120, y: 210 }; // 20 in, 10 down on the paper.
    const moved = applyAffine(noteMove(before, { ...before, x: 400 }), ink.x, ink.y);
    close(moved, { x: 420, y: 210 });
    const grown = applyAffine(noteMove(before, { ...before, w: 400, h: 200 }), ink.x, ink.y);
    close(grown, { x: 140, y: 220 });
    const mirrored = applyAffine(noteMove(before, { ...before, flipX: true }), ink.x, ink.y);
    close(mirrored, { x: 280, y: 210 });
    const turned = applyAffine(noteMove(before, { ...before, rotation: Math.PI }), ink.x, ink.y);
    close(turned, { x: 280, y: 290 });
    expect(isIdentity(noteMove(before, { ...before }))).toBe(true);
  });

  it("copies points under a map, pressure and a ragged tail as they were", () => {
    const pts = [1, 2, 0.4, 3, 4, 0.9, 7];
    expect(mapPoints(pts, [1, 0, 0, 1, 10, 20])).toEqual([11, 22, 0.4, 13, 24, 0.9, 7]);
    expect(pts).toEqual([1, 2, 0.4, 3, 4, 0.9, 7]);
  });
});

describe("noteAt: the note a stroke starts on", () => {
  it("finds a note under the point, turned as it is", () => {
    const n = note({ rotation: 0.4 });
    const page = pageWith([n], []);
    const centre = applyAffine(noteToPage(n), 100, 50);
    expect(noteAt(page, centre.x, centre.y)).toBe(n);
    expect(noteAt(page, 5, 5)).toBeNull();
  });

  it("lets the topmost element decide: a picture over the note takes the stroke", () => {
    const n = note();
    const over: ImageElement = {
      id: "i2",
      path: "a.png",
      x: 140,
      y: 220,
      w: 30,
      h: 30,
      front: true,
    };
    const page = pageWith([n, over], []);
    expect(noteAt(page, 150, 230)).toBeNull();
    expect(noteAt(page, 250, 280)).toBe(n);
  });

  it("stacks pictures in front of the ink above those under it", () => {
    const under = note({ id: "i1", front: undefined });
    const stuck = note({ id: "i2", front: true, x: 150 });
    // `under` comes later in the list, but `stuck` is in front of the ink.
    const page = pageWith([stuck, under], []);
    expect(noteAt(page, 200, 250)?.id).toBe("i2");
    const back: ImageElement = { id: "i3", path: "b.png", x: 0, y: 0, w: 1000, h: 1000 };
    expect(noteAt(pageWith([back, under], []), 120, 210)?.id).toBe("i1");
    expect(noteAt(pageWith([under, back], []), 120, 210)).toBeNull();
  });
});

describe("selections", () => {
  const n = note();
  const a = stroke("a", [], "i1");
  const b = stroke("b", []);
  const c = stroke("c", [], "i1");
  const page = pageWith([n], [a, b, c]);

  it("adds a note's ink, once and in page order", () => {
    expect(withNoteInk(page, { strokes: [c, b], images: [n] })).toEqual([a, b, c]);
    expect(withNoteInk(page, { strokes: [b], images: [] })).toEqual([b]);
  });

  it("knows a note held alone, ink aside", () => {
    expect(loneNote({ strokes: [a, c], images: [n] })).toBe(n);
    expect(loneNote({ strokes: [], images: [n] })).toBe(n);
    expect(loneNote({ strokes: [a, b], images: [n] })).toBeNull();
    expect(loneNote({ strokes: [], images: [n, note({ id: "i5" })] })).toBeNull();
    const picture: ImageElement = { id: "i2", path: "a.png", x: 0, y: 0, w: 1, h: 1 };
    expect(loneNote({ strokes: [], images: [picture] })).toBeNull();
  });

  it("relinks copied ink to the copied note, and frees ink whose note stayed", () => {
    const copies = [stroke("x", [], "i1"), stroke("y", [], "i4"), stroke("z", [])];
    relinkNoteInk(copies, new Map([["i1", "i9"]]));
    expect(copies.map((s) => s.onSticky)).toEqual(["i9", undefined, undefined]);
    expect("onSticky" in copies[1]).toBe(false);
  });

  it("copies a note's ink for a duplicate: fresh ids, the copy's, moved, no t0", () => {
    const ink = { ...stroke("a", [120, 210, 0.5, 130, 220, 0.5], "i1"), t0: 5 };
    const p = pageWith([n], [ink]);
    const copy = { ...n, id: "i2", x: 124, y: 224 };
    let seq = 0;
    const [out] = copyNoteInk(p, n, copy, () => `s${++seq + 10}`);
    expect(out.id).toBe("s11");
    expect(out.onSticky).toBe("i2");
    expect("t0" in out).toBe(false);
    expect(out.pts).toEqual([144, 234, 0.5, 154, 244, 0.5]);
    // The original is untouched.
    expect(ink.pts).toEqual([120, 210, 0.5, 130, 220, 0.5]);
    expect(ink.onSticky).toBe("i1");
  });
});

describe("MoveNoteInk", () => {
  it("moves the ink with fresh arrays, scales its width, and undoes exactly", () => {
    const doc = emptyDocument();
    const n = note();
    const ink = { ...stroke("a", [120, 210, 0.5, 140, 230, 0.5], "i1"), radius: 2 };
    const other = stroke("b", [120, 210, 0.5]);
    doc.pages[0].images.push(n);
    doc.pages[0].strokes.push(ink, other);
    const pts = ink.pts;
    const after = { ...n, w: 400, h: 200 };
    const command = new MoveNoteInk("p1", n, { ...n }, after);
    command.apply(doc);
    expect(ink.pts).not.toBe(pts);
    expect(ink.pts).toEqual([140, 220, 0.5, 180, 260, 0.5]);
    // Twice as wide and twice as tall: lines twice as thick.
    expect(ink.size).toBeCloseTo(4, 12);
    expect(ink.radius).toBeCloseTo(4, 12);
    expect(other.pts).toEqual([120, 210, 0.5]);
    command.invert(doc);
    expect(ink.pts).toBe(pts);
    expect(ink.size).toBe(2);
    expect(ink.radius).toBe(2);
  });

  it("keeps the width under a rigid move, and an absent radius absent", () => {
    const doc = emptyDocument();
    const n = note();
    const ink = stroke("a", [120, 210, 0.5], "i1");
    doc.pages[0].images.push(n);
    doc.pages[0].strokes.push(ink);
    const command = new MoveNoteInk("p1", n, { ...n }, { ...n, rotation: 1, x: 10 });
    command.apply(doc);
    expect(ink.size).toBe(2);
    command.invert(doc);
    expect("radius" in ink).toBe(false);
  });

  it("does nothing for a note not on the page, or a move that moves nothing", () => {
    const doc = emptyDocument();
    const n = note();
    const ink = stroke("a", [120, 210, 0.5], "i1");
    doc.pages[0].strokes.push(ink);
    const pts = ink.pts;
    new MoveNoteInk("p1", n, { ...n }, { ...n, x: 0 }).apply(doc);
    expect(ink.pts).toBe(pts);
    doc.pages[0].images.push(n);
    const still = new MoveNoteInk("p1", n, { ...n }, { ...n });
    still.apply(doc);
    expect(ink.pts).toBe(pts);
    still.invert(doc);
    expect(new MoveNoteInk("p9", n, n, n).pageId).toBe("p9");
  });
});

describe("SetStickyColor", () => {
  it("repaints the note and undoes to the paper it had", () => {
    const doc = emptyDocument();
    const n = note();
    doc.pages[0].images.push(n);
    const paper = n.sticky;
    const command = new SetStickyColor("p1", n, "#bfdbfe");
    command.apply(doc);
    expect(n.sticky).toEqual({ color: "#bfdbfe" });
    command.invert(doc);
    expect(n.sticky).toBe(paper);
  });

  it("leaves a picture, or a note not on the page, alone", () => {
    const doc = emptyDocument();
    const picture: ImageElement = { id: "i2", path: "a.png", x: 0, y: 0, w: 1, h: 1 };
    doc.pages[0].images.push(picture);
    const command = new SetStickyColor("p1", picture, "#bfdbfe");
    command.apply(doc);
    command.invert(doc);
    expect("sticky" in picture).toBe(false);
    new SetStickyColor("p1", note(), "#bfdbfe").apply(doc);
  });
});

describe("folding for the disk", () => {
  it("keeps a page without notes as it is", () => {
    const strokes = [stroke("a", [1, 2, 0.5])];
    const page = pageWith([], strokes);
    const folded = foldNoteInk(page);
    expect(folded.pageInk).toBe(strokes);
    expect(folded.noteInk.size).toBe(0);
  });

  it("stores a note's ink in its own space, and unfolds it back", () => {
    const n = note({ rotation: 0.5, flipX: true });
    const at = noteToPage(n);
    const p = applyAffine(at, 20, 30);
    const q = applyAffine(at, 60, 40);
    const ink = stroke("a", [p.x, p.y, 0.5, q.x, q.y, 0.7], "i1");
    const page = pageWith([n], [stroke("b", [5, 5, 0.5]), ink, stroke("c", [1, 1, 0.5], "i8")]);
    const { pageInk, noteInk } = foldNoteInk(page);
    // A stroke naming a note that is not on the page is plain ink.
    expect(pageInk.map((s) => s.id)).toEqual(["b", "c"]);
    expect("onSticky" in pageInk[1]).toBe(false);
    expect(page.strokes[2].onSticky).toBe("i8");
    const [local] = noteInk.get("i1") ?? [];
    expect("onSticky" in local).toBe(false);
    expect(local.pts[0]).toBeCloseTo(20, 9);
    expect(local.pts[1]).toBeCloseTo(30, 9);
    expect(local.pts[3]).toBeCloseTo(60, 9);
    expect(local.pts[5]).toBe(0.7);
    const [back] = unfoldNoteInk(n, [local]);
    expect(back.onSticky).toBe("i1");
    expect(back.pts[0]).toBeCloseTo(p.x, 9);
    expect(back.pts[1]).toBeCloseTo(p.y, 9);
    expect(back.pts[4]).toBeCloseTo(q.y, 9);
  });
});

describe("shownAt: what the eraser may touch", () => {
  const stuck = note({ id: "i1", front: true });
  const under = note({ id: "i2", front: undefined, x: 500 });
  const onStuck = stroke("a", [], "i1");
  const onUnder = stroke("b", [], "i2");
  const plain = stroke("c", []);
  const page = pageWith([stuck, under], [onStuck, onUnder, plain]);

  it("lets everything show on a page without notes", () => {
    expect(shownAt(pageWith([], [plain]), plain, 150, 250)).toBe(true);
  });

  it("shows a note's ink only on that note", () => {
    expect(shownAt(page, onStuck, 150, 250)).toBe(true);
    expect(shownAt(page, onStuck, 50, 50)).toBe(false);
    expect(shownAt(page, onStuck, 550, 250)).toBe(false);
  });

  it("hides page ink under a note stuck on, not under one beneath the ink", () => {
    expect(shownAt(page, plain, 150, 250)).toBe(false);
    expect(shownAt(page, plain, 550, 250)).toBe(true);
    expect(shownAt(page, plain, 50, 50)).toBe(true);
    expect(shownAt(page, onUnder, 550, 250)).toBe(true);
  });

  it("hides a note's ink under another note laid over it", () => {
    const over = note({ id: "i3", front: true, x: 120 });
    const stacked = pageWith([stuck, over], [onStuck]);
    expect(shownAt(stacked, onStuck, 110, 250)).toBe(true);
    expect(shownAt(stacked, onStuck, 200, 250)).toBe(false);
  });
});
