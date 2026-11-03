/**
 * Text that lies over a sticky note belongs to it (the dark-page session,
 * 2026-11-03): a box that was not made on the note folds away with it, and
 * one dropped on it becomes its text. Undo puts every box back.
 */

import { describe, expect, it } from "vitest";
import { type ImageElement, type TextBoxElement, emptyDocument } from "../../src/model/document";
import { SetTextBoxFrame } from "../../src/model/page-commands";
import { TranslateElements } from "../../src/model/selection-commands";
import {
  DEFAULT_STICKY_COLOR,
  SetNoteFolded,
  adoptText,
  foldedAway,
  newStickyNote,
  noteOfText,
  noteTextToPage,
  applyAffine,
} from "../../src/model/sticky-notes";

function note(extra: Partial<ImageElement> = {}): ImageElement {
  return {
    ...newStickyNote("n1", { x: 100, y: 200, w: 200, h: 100 }, DEFAULT_STICKY_COLOR),
    ...extra,
  };
}

function box(id: string, x: number, y: number, extra: Partial<TextBoxElement> = {}) {
  return { id, x, y, w: 80, h: 20, text: "hi", color: "#1a1a1a", fontSize: 16, ...extra };
}

function setup(boxes: TextBoxElement[], n: ImageElement = note()) {
  const doc = emptyDocument(1024);
  doc.pages[0] = { ...doc.pages[0], images: [n], textBoxes: boxes };
  return { doc, page: doc.pages[0], n };
}

describe("a box over a note when it folds", () => {
  it("folds away with it, and comes back when it opens", () => {
    const over = box("over", 140, 230);
    const beside = box("beside", 400, 230);
    const { doc, page, n } = setup([over, beside]);
    const fold = new SetNoteFolded(page.id, n, true);
    fold.apply(doc);
    expect(over.onSticky).toBe("n1");
    expect(foldedAway(page, over)).toBe(true);
    expect(beside.onSticky).toBeUndefined();
    new SetNoteFolded(page.id, n, false).apply(doc);
    expect(foldedAway(page, over)).toBe(false);
    expect(noteOfText(page, over)).toBe(n);
  });

  it("is put back by undo", () => {
    const over = box("over", 140, 230);
    const { doc, page, n } = setup([over]);
    const fold = new SetNoteFolded(page.id, n, true);
    fold.apply(doc);
    fold.invert(doc);
    expect("onSticky" in over).toBe(false);
    expect([over.x, over.y]).toEqual([140, 230]);
  });

  it("leaves a box under a picture in front of the note, a mirror, and another note's text", () => {
    const cover: ImageElement = {
      id: "pic",
      path: "a.png",
      x: 100,
      y: 200,
      w: 200,
      h: 100,
      front: true,
    };
    const hidden = box("hidden", 140, 230);
    const mirror = box("mirror", 140, 260, { join: "p0/x" });
    const other = box("other", 140, 270, { onSticky: "n2" });
    const { doc, page, n } = setup([hidden, mirror, other]);
    page.images.push(cover);
    new SetNoteFolded(page.id, n, true).apply(doc);
    expect(hidden.onSticky).toBeUndefined();
    expect(mirror.onSticky).toBeUndefined();
    expect(other.onSticky).toBe("n2");
  });
});

describe("a box dropped on a note", () => {
  it("becomes its text when moved there, and undo lets it go", () => {
    const free = box("free", 400, 230);
    const { doc, page } = setup([free]);
    const move = new TranslateElements(
      page.id,
      { strokes: [], images: [], textBoxes: [free] },
      -300,
      0,
    );
    move.apply(doc);
    expect(free.onSticky).toBe("n1");
    expect(free.x).toBe(100);
    move.invert(doc);
    expect(free.onSticky).toBeUndefined();
    expect(free.x).toBe(400);
  });

  it("becomes its text when its frame is set over it", () => {
    const free = box("free", 400, 230);
    const { doc, page } = setup([free]);
    const set = new SetTextBoxFrame(page.id, "free", { x: 150, y: 230, w: 80, h: 20 });
    set.apply(doc);
    expect(free.onSticky).toBe("n1");
    set.invert(doc);
    expect(free.onSticky).toBeUndefined();
  });

  it("is not taken when it only touches the edge, or the note is folded", () => {
    const edge = box("edge", 290, 230);
    const { doc, page, n } = setup([edge]);
    new SetTextBoxFrame(page.id, "edge", { x: 290, y: 230, w: 80, h: 20 }).apply(doc);
    expect(edge.onSticky).toBeUndefined();
    n.sticky = { color: DEFAULT_STICKY_COLOR, folded: true };
    expect(adoptText(page, box("in", 140, 230))).toBeNull();
  });

  it("keeps its place on a turned note", () => {
    const turned = note({ rotation: Math.PI / 2 });
    const free = box("free", 150, 230);
    const { page } = setup([free], turned);
    const centre = { x: 150 + 40, y: 230 + 10 };
    expect(adoptText(page, free)).not.toBeNull();
    const seen = applyAffine(noteTextToPage(turned), free.x + 40, free.y + 10);
    expect(seen.x).toBeCloseTo(centre.x);
    expect(seen.y).toBeCloseTo(centre.y);
  });

  it("does not take text of a note that moves with it", () => {
    const own = box("own", 140, 230, { onSticky: "n1" });
    const { doc, page } = setup([own]);
    new TranslateElements(page.id, { strokes: [], images: [], textBoxes: [own] }, 5, 5).apply(doc);
    expect(own.onSticky).toBe("n1");
  });
});
