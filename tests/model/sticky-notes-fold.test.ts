/**
 * Sticky notes that fold away and carry typed text (FineNotes#94): the fold
 * flag and its command, where a folded note shows and what it hides, the
 * note's own text box (found, placed, moved, copied, relinked), and both on
 * disk, read by this build and by one that knows neither.
 */

import { describe, expect, it } from "vitest";
import { inflateFromBase64 } from "../../src/model/compress";
import {
  type ImageElement,
  type Page,
  type Stroke,
  type TextBoxElement,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { ReorientElements, copyElements } from "../../src/model/selection-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import {
  DEFAULT_STICKY_COLOR,
  FOLDED_SIDE,
  MoveNoteInk,
  SetNoteFolded,
  SetStickyColor,
  applyAffine,
  copyNoteText,
  foldedAway,
  foldedFrame,
  foldedNoteAt,
  isFolded,
  newStickyNote,
  noteAt,
  noteOfText,
  noteTextFrame,
  noteTextToPage,
  readStickyPaper,
  relinkNoteInk,
  shownAt,
  textOfNote,
  withNoteText,
} from "../../src/model/sticky-notes";

function note(extra: Partial<ImageElement> = {}): ImageElement {
  return {
    ...newStickyNote("i1", { x: 100, y: 200, w: 200, h: 100 }, DEFAULT_STICKY_COLOR),
    ...extra,
  };
}

function text(id: string, onSticky?: string, extra: Partial<TextBoxElement> = {}): TextBoxElement {
  return {
    id,
    x: 112,
    y: 228,
    w: 176,
    text: "Check the sign",
    color: "#1a1a1a",
    fontSize: 16,
    ...(onSticky ? { onSticky } : {}),
    ...extra,
  };
}

function stroke(id: string, pts: number[], onSticky?: string): Stroke {
  return { id, color: "#1a1a1a", size: 2, tool: "pen", pts, ...(onSticky ? { onSticky } : {}) };
}

function pageWith(
  images: ImageElement[],
  strokes: Stroke[] = [],
  textBoxes: TextBoxElement[] = [],
): Page {
  return { ...blankPage("p1"), images, strokes, textBoxes };
}

function docWith(page: Page) {
  const doc = emptyDocument(1024);
  doc.pages[0] = { ...page, geometry: doc.pages[0].geometry };
  return doc;
}

describe("the fold flag", () => {
  it("is read only as true, beside a readable colour", () => {
    expect(readStickyPaper({ color: "#FDE68A", folded: true })).toEqual({
      color: "#fde68a",
      folded: true,
    });
    expect(readStickyPaper({ color: "#fde68a", folded: "yes" })).toEqual({ color: "#fde68a" });
    expect(readStickyPaper({ folded: true })).toBeUndefined();
    expect(isFolded(note())).toBe(false);
    expect(isFolded(note({ sticky: { color: "#fde68a", folded: true } }))).toBe(true);
  });

  it("folds and opens a note in one undoable step each", () => {
    const n = note();
    const doc = docWith(pageWith([n]));
    const page = doc.pages[0];
    const fold = new SetNoteFolded(page.id, n, true);
    fold.apply(doc);
    expect(n.sticky).toEqual({ color: DEFAULT_STICKY_COLOR, folded: true });
    expect(fold.label).toBe("Fold note");
    fold.invert(doc);
    expect(n.sticky).toEqual({ color: DEFAULT_STICKY_COLOR });

    fold.apply(doc);
    const open = new SetNoteFolded(page.id, n, false);
    open.apply(doc);
    expect(n.sticky).toEqual({ color: DEFAULT_STICKY_COLOR });
    expect("folded" in (n.sticky ?? {})).toBe(false);
    open.invert(doc);
    expect(n.sticky?.folded).toBe(true);
  });

  it("does nothing to a picture, a note not on the page, or a note already so", () => {
    const picture: ImageElement = { id: "i2", path: "a.png", x: 0, y: 0, w: 10, h: 10 };
    const n = note();
    const doc = docWith(pageWith([picture, n]));
    new SetNoteFolded("p1", picture, true).apply(doc);
    expect(picture.sticky).toBeUndefined();
    new SetNoteFolded("p1", note({ id: "elsewhere" }), true).apply(doc);
    const open = new SetNoteFolded("p1", n, false);
    open.apply(doc);
    open.invert(doc);
    expect(n.sticky).toEqual({ color: DEFAULT_STICKY_COLOR });
  });

  it("survives a change of colour", () => {
    const n = note({ sticky: { color: "#fde68a", folded: true } });
    const doc = docWith(pageWith([n]));
    const recolour = new SetStickyColor("p1", n, "#bfdbfe");
    recolour.apply(doc);
    expect(n.sticky).toEqual({ color: "#bfdbfe", folded: true });
    recolour.invert(doc);
    expect(n.sticky).toEqual({ color: "#fde68a", folded: true });
  });
});

describe("where a folded note shows", () => {
  it("is a square at its top-left corner, never larger than the note", () => {
    expect(foldedFrame(note())).toEqual({ x: 100, y: 200, w: FOLDED_SIDE, h: FOLDED_SIDE });
    const small = foldedFrame(note({ w: 30, h: 20 }));
    expect(small.w).toBe(20);
    expect(small.h).toBe(20);
  });

  it("turns with the note about the note's centre, and stays inside it", () => {
    const turned = note({ rotation: Math.PI / 2 });
    const frame = foldedFrame(turned);
    expect(frame.rotation).toBeCloseTo(Math.PI / 2);
    // The note's top-left corner, turned a quarter about (200, 250), is at (250, 150).
    const centre = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
    expect(centre.x).toBeCloseTo(250 - FOLDED_SIDE / 2);
    expect(centre.y).toBeCloseTo(150 + FOLDED_SIDE / 2);
  });

  it("is found by its icon only; an open note or picture over it hides it", () => {
    const folded = note({ sticky: { color: "#fde68a", folded: true } });
    const page = pageWith([folded]);
    expect(foldedNoteAt(page, 110, 210)).toBe(folded);
    expect(foldedNoteAt(page, 250, 250)).toBeNull();
    const over: ImageElement = {
      id: "i9",
      path: "a.png",
      x: 90,
      y: 190,
      w: 50,
      h: 50,
      front: true,
    };
    expect(foldedNoteAt(pageWith([folded, over]), 110, 210)).toBeNull();
    expect(foldedNoteAt(pageWith([note()]), 110, 210)).toBeNull();
  });

  it("is no paper to write on, and hides its ink from the eraser", () => {
    const folded = note({ sticky: { color: "#fde68a", folded: true } });
    const ink = stroke("s1", [150, 250, 0.5, 160, 260, 0.5], "i1");
    const page = pageWith([folded], [ink]);
    expect(noteAt(page, 150, 250)).toBeNull();
    expect(noteAt(page, 110, 210)).toBeNull();
    expect(shownAt(page, ink, 150, 250)).toBe(false);
    expect(shownAt(page, ink, 110, 210)).toBe(false);
    expect(foldedAway(page, ink)).toBe(true);
    expect(foldedAway(page, stroke("s2", [0, 0, 0.5]))).toBe(false);
    expect(foldedAway(pageWith([note()], [ink]), ink)).toBe(false);
  });
});

describe("a note's typed text", () => {
  it("is the text boxes that name it; a box naming no note is its own", () => {
    const n = note();
    const mine = text("t1", "i1");
    const loose = text("t2");
    const orphan = text("t3", "gone");
    const page = pageWith([n], [], [mine, loose, orphan]);
    expect(textOfNote(page, n)).toEqual([mine]);
    expect(noteOfText(page, mine)).toBe(n);
    expect(noteOfText(page, loose)).toBeNull();
    expect(noteOfText(page, orphan)).toBeNull();
  });

  it("starts inset on the paper, below its glued band, as wide as it allows", () => {
    expect(noteTextFrame(note())).toEqual({ x: 112, y: 222, w: 176 });
  });

  it("is drawn turned about the note's centre, and only turned", () => {
    expect(noteTextToPage(note())).toEqual([1, 0, 0, 1, 0, 0]);
    const m = noteTextToPage(note({ rotation: Math.PI, flipX: true }));
    const p = applyAffine(m, 100, 200);
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(300);
  });

  it("follows its note through a move, a resize and a turn, and back on undo", () => {
    const n = note();
    const box = text("t1", "i1");
    const doc = docWith(pageWith([n], [], [box]));
    const before = { x: n.x, y: n.y, w: n.w, h: n.h };
    const after = { x: 300, y: 400, w: 400, h: 200, rotation: 0.5 };
    Object.assign(n, after);
    const move = new MoveNoteInk("p1", n, before, after);
    move.apply(doc);
    expect(box.x).toBeCloseTo(300 + 12 * 2);
    expect(box.y).toBeCloseTo(400 + 28 * 2);
    expect(box.w).toBeCloseTo(352);
    expect(box.fontSize).toBe(16);
    move.invert(doc);
    expect(box).toMatchObject({ x: 112, y: 228, w: 176 });
    expect("h" in box).toBe(false);
  });

  it("stays where it is on the paper under a turn alone", () => {
    const n = note();
    const box = text("t1", "i1");
    const doc = docWith(pageWith([n], [], [box]));
    const before = { x: n.x, y: n.y, w: n.w, h: n.h };
    const move = new MoveNoteInk("p1", n, before, { ...before, rotation: 1 });
    move.apply(doc);
    expect(box).toMatchObject({ x: 112, y: 228, w: 176 });
  });

  it("comes along when its note is selected, once", () => {
    const n = note();
    const mine = text("t1", "i1");
    const loose = text("t2");
    const page = pageWith([n], [], [loose, mine]);
    expect(withNoteText(page, { textBoxes: [], images: [n] })).toEqual([mine]);
    expect(withNoteText(page, { textBoxes: [mine, loose], images: [n] })).toEqual([loose, mine]);
    expect(withNoteText(page, { textBoxes: [loose], images: [] })).toEqual([loose]);
  });

  it("is copied for a duplicate: fresh ids, the copy's, at its place on the copy", () => {
    const n = note();
    const page = pageWith([n], [], [text("t1", "i1")]);
    const copy = { ...n, id: "i2", x: 140, y: 240 };
    let next = 7;
    const copies = copyNoteText(page, n, copy, () => `t${next++}`);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ id: "t7", onSticky: "i2", x: 152, y: 268, w: 176 });
    expect(page.textBoxes[0].onSticky).toBe("i1");
  });

  it("is relinked to a copied note, and freed when its note stayed", () => {
    const boxes = [text("t1", "i1"), text("t2", "i5")];
    relinkNoteInk(boxes, new Map([["i1", "i9"]]));
    expect(boxes[0].onSticky).toBe("i9");
    expect("onSticky" in boxes[1]).toBe(false);
  });

  it("is relinked when a selection is duplicated", () => {
    const n = note();
    let i = 0;
    const ids = {
      stroke: () => `s${++i}`,
      image: () => `i${++i + 10}`,
      textBox: () => `t${++i + 10}`,
      table: () => `g${++i}`,
      graph: () => `f${++i}`,
    };
    const copied = copyElements(
      { strokes: [], images: [n], textBoxes: [text("t1", "i1")] },
      ids,
      10,
      10,
    );
    expect(copied.textBoxes[0].onSticky).toBe(copied.images[0].id);
  });

  it("keeps its place on its note when a selection turns, upright as text is", () => {
    const n = note();
    const box = text("t1", "i1");
    const doc = docWith(pageWith([n], [], [box]));
    const turn = new ReorientElements(
      "p1",
      { strokes: [], images: [n], textBoxes: [box] },
      { kind: "rotate", angle: Math.PI / 2 },
      0,
      0,
    );
    turn.apply(doc);
    expect(box.x - n.x).toBeCloseTo(12);
    expect(box.y - n.y).toBeCloseTo(28);
    turn.invert(doc);
    expect(box).toMatchObject({ x: 112, y: 228 });
  });
});

describe("on disk", () => {
  function noteDoc() {
    const doc = emptyDocument(1024);
    doc.pages[0].images.push(note({ id: "i3", sticky: { color: "#fde68a", folded: true } }));
    doc.pages[0].textBoxes.push(text("t1", "i3"), text("t2"));
    return doc;
  }

  function storedPage(payload: string): Record<string, unknown> {
    const json = JSON.parse(inflateFromBase64(payload.slice(payload.indexOf(":") + 1))) as {
      pages: Array<Record<string, unknown>>;
    };
    return json.pages[0];
  }

  it("keeps the fold and the link, under the label notes already had", () => {
    const payload = encodeDocument(noteDoc());
    expect(payload.startsWith("v2+sticky:")).toBe(true);
    const page = decodeDocument(payload).pages[0];
    expect(page.images[0].sticky).toEqual({ color: "#fde68a", folded: true });
    expect(page.textBoxes[0].onSticky).toBe("i3");
    expect("onSticky" in page.textBoxes[1]).toBe(false);
  });

  it("stores the text as a page text box, in page space, beside the note", () => {
    const page = storedPage(encodeDocument(noteDoc()));
    const boxes = page.textBoxes as Array<Record<string, unknown>>;
    expect(boxes[0]).toMatchObject({
      id: "t1",
      x: 112,
      y: 228,
      text: "Check the sign",
      onSticky: "i3",
    });
    const image = (page.images as Array<Record<string, unknown>>)[0];
    expect(image.sticky).toEqual({ color: "#fde68a", folded: true });
  });

  it("loads a notebook from before folding unchanged", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].images.push(note({ id: "i3" }));
    doc.pages[0].textBoxes.push(text("t1"));
    const page = decodeDocument(encodeDocument(doc)).pages[0];
    expect(page.images[0].sticky).toEqual({ color: DEFAULT_STICKY_COLOR });
    expect(page.textBoxes[0]).toEqual(text("t1"));
  });

  it("frees a box naming a note that is not on its page", () => {
    const doc = emptyDocument(1024);
    doc.pages[0].textBoxes.push(text("t1", "i3"));
    const page = decodeDocument(encodeDocument(doc)).pages[0];
    expect("onSticky" in page.textBoxes[0]).toBe(false);
  });

  it("reads, in a build that knows neither field, as an open note and its text beside it", () => {
    // What 2.6's reader keeps: a note's colour, and a text box's own fields.
    const page = decodeDocument(encodeDocument(noteDoc())).pages[0];
    const older = {
      paper: { color: page.images[0].sticky?.color },
      box: (({ onSticky: _link, ...rest }) => rest)(page.textBoxes[0]),
    };
    expect(older.paper).toEqual({ color: "#fde68a" });
    expect(older.box).toMatchObject({ x: 112, y: 228, w: 176, text: "Check the sign" });
  });
});
