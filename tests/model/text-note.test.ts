import { describe, expect, it } from "vitest";
import type { Stroke } from "../../src/model/document";
import {
  BOLD,
  INK_DEFAULT_HEIGHT,
  INK_GROW_ROOM,
  INK_MAX_HEIGHT,
  INK_MIN_HEIGHT,
  INK_TRIM_ROOM,
  INK_WIDTH,
  ITALIC,
  backspaceAtStart,
  foldPlan,
  headingRank,
  blockText,
  clampInkHeight,
  clampPoint,
  deleteAtEnd,
  deleteRange,
  emptyNote,
  grownHeight,
  hasMark,
  imageShare,
  imageWidthFor,
  indentBlocks,
  indexOfBlock,
  inkBottom,
  inkTop,
  insertBlock,
  insertBlocksAt,
  insertText,
  isBlankNote,
  kindIn,
  marksBefore,
  moveBlock,
  normalizeRuns,
  notePreview,
  noteTitle,
  orderedRange,
  removeBlock,
  replaceBlock,
  setKind,
  shiftStrokes,
  shortcutKind,
  sliceRuns,
  splitBlock,
  textBlock,
  toggleChecked,
  toggleMark,
  trimmedHeight,
  withTypingLine,
  type ImageBlock,
  type InkBlock,
  type NoteBlock,
  type TextBlock,
  type TextKind,
  type TextNote,
} from "../../src/model/text-note";

function ids(prefix = "n"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const t = (id: string, text: string, kind: TextKind = "body", indent = 0): TextBlock =>
  textBlock(id, kind, text ? [{ text, marks: 0 }] : [], { indent });
const ink = (id: string, strokes: Stroke[] = [], height = INK_DEFAULT_HEIGHT): InkBlock => ({
  type: "ink",
  id,
  height,
  strokes,
});
const image = (id: string, width?: number): ImageBlock => ({
  type: "image",
  id,
  path: `${id}.png`,
  ...(width !== undefined ? { width } : {}),
});
const note = (...blocks: NoteBlock[]): TextNote => ({ blocks });
const texts = (n: TextNote): string[] =>
  n.blocks.map((b) => (b.type === "text" ? `${b.kind}:${blockText(b)}` : b.type));
const stroke = (pts: number[], size = 4): Stroke => ({
  id: "s",
  color: "#000",
  size,
  tool: "pen",
  pts,
});
const at = (block: number, offset: number) => ({ block, offset });
const span = (b0: number, o0: number, b1: number, o1: number) => ({
  start: at(b0, o0),
  end: at(b1, o1),
});

describe("runs", () => {
  it("joins equal neighbours and drops empty runs", () => {
    expect(
      normalizeRuns([
        { text: "a", marks: BOLD },
        { text: "", marks: 0 },
        { text: "b", marks: BOLD },
        { text: "c", marks: 0 },
      ]),
    ).toEqual([
      { text: "ab", marks: BOLD },
      { text: "c", marks: 0 },
    ]);
  });

  it("slices across runs", () => {
    const runs = [
      { text: "abc", marks: 0 },
      { text: "def", marks: BOLD },
    ];
    expect(sliceRuns(runs, 2, 4)).toEqual([
      { text: "c", marks: 0 },
      { text: "d", marks: BOLD },
    ]);
    expect(sliceRuns(runs, 4)).toEqual([{ text: "ef", marks: BOLD }]);
    expect(marksBefore(runs, 3)).toBe(0);
    expect(marksBefore(runs, 4)).toBe(BOLD);
    expect(marksBefore([], 0)).toBe(0);
  });

  it("drops what a kind cannot carry", () => {
    expect(textBlock("a", "heading", [], { indent: 2, checked: true })).toEqual({
      type: "text",
      id: "a",
      kind: "heading",
      runs: [],
    });
    expect(textBlock("a", "check", [], { indent: 9, checked: true })).toMatchObject({
      indent: 3,
      checked: true,
    });
  });
});

describe("Return", () => {
  it("splits a paragraph at the caret", () => {
    const edit = splitBlock(note(t("a", "hello world")), at(0, 5), ids());
    expect(texts(edit.note)).toEqual(["body:hello", "body: world"]);
    expect(edit.caret).toEqual(at(1, 0));
    expect(edit.note.blocks[0].id).toBe("a");
  });

  it("follows a title or heading with body text", () => {
    for (const kind of ["title", "heading", "subheading"] as TextKind[]) {
      expect(texts(splitBlock(note(t("a", "Head", kind)), at(0, 4), ids()).note)).toEqual([
        `${kind}:Head`,
        "body:",
      ]);
    }
  });

  it("puts a line above a heading when pressed at its start", () => {
    const edit = splitBlock(note(t("a", "Head", "heading")), at(0, 0), ids());
    expect(texts(edit.note)).toEqual(["body:", "heading:Head"]);
    expect(edit.caret).toEqual(at(1, 0));
  });

  it("goes on with a list, unticked and at the same depth", () => {
    const item = textBlock("a", "check", [{ text: "one", marks: 0 }], { indent: 1, checked: true });
    const edit = splitBlock(note(item), at(0, 3), ids());
    expect(edit.note.blocks[1]).toMatchObject({ kind: "check", indent: 1 });
    expect((edit.note.blocks[1] as TextBlock).checked).toBeUndefined();
    expect((edit.note.blocks[0] as TextBlock).checked).toBe(true);
  });

  it("ends a list on an empty item, stepping out first when indented", () => {
    const first = splitBlock(note(t("a", "", "bullet", 1)), at(0, 0), ids());
    expect(first.note.blocks[0]).toMatchObject({ kind: "bullet" });
    expect((first.note.blocks[0] as TextBlock).indent).toBeUndefined();
    const second = splitBlock(first.note, at(0, 0), ids());
    expect(texts(second.note)).toEqual(["body:"]);
    expect(texts(splitBlock(note(t("a", "", "quote")), at(0, 0), ids()).note)).toEqual(["body:"]);
  });

  it("opens a line under a section", () => {
    const edit = splitBlock(note(ink("i"), t("a", "x")), at(0, 0), ids());
    expect(texts(edit.note)).toEqual(["ink", "body:", "body:x"]);
    expect(edit.caret).toEqual(at(1, 0));
  });
});

describe("Backspace at the start of a line", () => {
  it("joins the paragraph before", () => {
    const result = backspaceAtStart(note(t("a", "one", "heading"), t("b", "two")), 1);
    expect(result.kind).toBe("edited");
    if (result.kind !== "edited") return;
    expect(texts(result.note)).toEqual(["heading:onetwo"]);
    expect(result.caret).toEqual(at(0, 3));
  });

  it("steps out, then unstyles, before joining", () => {
    let current = note(t("a", "x"), t("b", "item", "bullet", 2));
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = backspaceAtStart(current, current.blocks.length - 1);
      if (result.kind !== "edited") break;
      current = result.note;
      const last = current.blocks[current.blocks.length - 1] as TextBlock;
      seen.push(`${last.kind}/${last.indent ?? 0}`);
    }
    expect(seen).toEqual(["bullet/1", "bullet/0", "body/0", "body/0"]);
    expect(texts(current)).toEqual(["body:xitem"]);
  });

  it("selects the section before instead of deleting it", () => {
    expect(backspaceAtStart(note(image("i"), t("a", "text")), 1)).toEqual({
      kind: "select",
      block: 0,
    });
    // The note's last empty line stays: there must be a line to type on.
    expect(backspaceAtStart(note(image("i"), t("a", "")), 1)).toEqual({ kind: "select", block: 0 });
  });

  it("removes an empty line between a section and what follows", () => {
    const result = backspaceAtStart(note(image("i"), t("a", ""), t("b", "x")), 1);
    expect(result.kind === "edited" && texts(result.note)).toEqual(["image", "body:x"]);
  });

  it("does nothing at the very top", () => {
    expect(backspaceAtStart(note(t("a", "T", "title")), 0)).toEqual({ kind: "nothing" });
    expect(backspaceAtStart(note(t("a", "x")), 0)).toEqual({ kind: "nothing" });
    expect(backspaceAtStart(note(ink("i")), 0)).toEqual({ kind: "nothing" });
    const unstyled = backspaceAtStart(note(t("a", "h", "heading")), 0);
    expect(unstyled.kind === "edited" && texts(unstyled.note)).toEqual(["body:h"]);
  });

  it("Delete at the end pulls the next paragraph up", () => {
    const edit = deleteAtEnd(note(t("a", "one"), t("b", "two", "bullet")), 0);
    expect(edit && texts(edit.note)).toEqual(["body:onetwo"]);
    expect(edit?.caret).toEqual(at(0, 3));
    expect(deleteAtEnd(note(t("a", "one"), ink("i")), 0)).toBeNull();
    expect(deleteAtEnd(note(t("a", "one")), 0)).toBeNull();
  });
});

describe("deleting a range", () => {
  it("joins the two ends and removes what is between", () => {
    const edit = deleteRange(
      note(t("a", "hello", "heading"), ink("i"), t("b", "middle"), t("c", "world")),
      span(0, 2, 3, 3),
      ids(),
    );
    expect(texts(edit.note)).toEqual(["heading:held"]);
    expect(edit.caret).toEqual(at(0, 2));
  });

  it("works inside one paragraph, and backwards", () => {
    const edit = deleteRange(note(t("a", "hello")), orderedRange(at(0, 4), at(0, 1)), ids());
    expect(texts(edit.note)).toEqual(["body:ho"]);
  });

  it("takes sections at its ends with it and never leaves the note empty", () => {
    const tail = deleteRange(note(ink("i"), t("a", "text")), span(0, 0, 1, 2), ids());
    expect(texts(tail.note)).toEqual(["body:xt"]);
    const all = deleteRange(note(ink("i"), image("p")), span(0, 0, 1, 0), ids());
    expect(texts(all.note)).toEqual(["body:"]);
    const none = note(t("a", "x"));
    expect(deleteRange(none, span(0, 1, 0, 1), ids()).note).toBe(none);
  });
});

describe("inserting", () => {
  it("types with marks, and never a line break", () => {
    const edit = insertText(note(t("a", "ac")), at(0, 1), "b\nB", BOLD);
    expect((edit.note.blocks[0] as TextBlock).runs).toEqual([
      { text: "a", marks: 0 },
      { text: "b B", marks: BOLD },
      { text: "c", marks: 0 },
    ]);
    expect(edit.caret).toEqual(at(0, 4));
    const mono = insertText(note(t("a", "", "mono")), at(0, 0), "x", BOLD | ITALIC);
    expect((mono.note.blocks[0] as TextBlock).runs).toEqual([{ text: "x", marks: 0 }]);
    const section = note(ink("i"));
    expect(insertText(section, at(0, 0), "x", 0).note).toBe(section);
  });

  it("flows one pasted paragraph into the line", () => {
    const edit = insertBlocksAt(
      note(t("a", "ad", "bullet")),
      at(0, 1),
      [t("p", "bc", "heading")],
      ids(),
    );
    expect(texts(edit.note)).toEqual(["bullet:abcd"]);
    expect(edit.caret).toEqual(at(0, 3));
  });

  it("gives an empty line the pasted paragraph's kind", () => {
    const edit = insertBlocksAt(note(t("a", "")), at(0, 0), [t("p", "Head", "heading")], ids());
    expect(texts(edit.note)).toEqual(["heading:Head"]);
  });

  it("splits the line round several pasted blocks", () => {
    const edit = insertBlocksAt(
      note(t("a", "start end")),
      at(0, 6),
      [t("p", "one"), t("q", "two", "bullet"), t("r", "three", "number")],
      ids(),
    );
    expect(texts(edit.note)).toEqual(["body:start one", "bullet:two", "number:threeend"]);
    expect(edit.caret).toEqual(at(2, 5));
  });

  it("puts a picture on a line of its own, the rest of the line under it", () => {
    const middle = insertBlocksAt(note(t("a", "before after")), at(0, 7), [image("p")], ids());
    expect(texts(middle.note)).toEqual(["body:before", "image", "body:after"]);
    const spaced = insertBlocksAt(note(t("a", "one  two")), at(0, 4), [image("p")], ids());
    expect(texts(spaced.note)).toEqual(["body:one", "image", "body:two"]);
    expect(middle.caret).toEqual(at(2, 0));
    const start = insertBlocksAt(note(t("a", "text")), at(0, 0), [image("p")], ids());
    expect(texts(start.note)).toEqual(["image", "body:text"]);
    expect(start.note.blocks[1].id).toBe("a");
    const empty = insertBlocksAt(note(t("a", "")), at(0, 0), [image("p")], ids());
    expect(texts(empty.note)).toEqual(["image", "body:"]);
  });

  it("goes under a section the caret is on", () => {
    const edit = insertBlocksAt(note(ink("i")), at(0, 0), [t("p", "x")], ids());
    expect(texts(edit.note)).toEqual(["ink", "body:x"]);
    expect(edit.caret).toEqual(at(1, 1));
    const same = note(t("a", "x"));
    expect(insertBlocksAt(same, at(0, 0), [], ids()).note).toBe(same);
  });
});

describe("styles", () => {
  it("sets a kind on every paragraph in the range, and switches it off again", () => {
    const start = note(t("a", "one"), ink("i"), t("b", "two", "bullet"));
    const all = span(0, 0, 2, 0);
    expect(kindIn(start, all)).toBeNull();
    const listed = setKind(start, all, "bullet");
    expect(texts(listed)).toEqual(["bullet:one", "ink", "bullet:two"]);
    expect(kindIn(listed, all)).toBe("bullet");
    expect(texts(setKind(listed, all, "bullet"))).toEqual(["body:one", "ink", "body:two"]);
    expect(kindIn(note(ink("i")), span(0, 0, 0, 0))).toBeNull();
  });

  it("strips marks from monostyled text", () => {
    const bold = note(textBlock("a", "body", [{ text: "x", marks: BOLD }]));
    expect((setKind(bold, span(0, 0, 0, 0), "mono").blocks[0] as TextBlock).runs).toEqual([
      { text: "x", marks: 0 },
    ]);
  });

  it("toggles a mark over a range across paragraphs", () => {
    const start = note(t("a", "hello"), t("b", "world"));
    const range = span(0, 3, 1, 2);
    expect(hasMark(start, range, BOLD)).toBe(false);
    const bold = toggleMark(start, range, BOLD);
    expect((bold.blocks[0] as TextBlock).runs).toEqual([
      { text: "hel", marks: 0 },
      { text: "lo", marks: BOLD },
    ]);
    expect((bold.blocks[1] as TextBlock).runs[0]).toEqual({ text: "wo", marks: BOLD });
    expect(hasMark(bold, range, BOLD)).toBe(true);
    // Part bold, part not: the switch turns it all on.
    const wider = span(0, 0, 1, 5);
    expect(hasMark(bold, wider, BOLD)).toBe(false);
    expect(hasMark(toggleMark(bold, wider, BOLD), wider, BOLD)).toBe(true);
    expect(toggleMark(bold, range, BOLD)).toEqual(start);
    expect(toggleMark(start, span(0, 1, 0, 1), BOLD)).toBe(start);
  });

  it("reads the marks typing would continue at a caret", () => {
    const bold = toggleMark(note(t("a", "hello")), span(0, 0, 0, 2), BOLD);
    expect(hasMark(bold, span(0, 2, 0, 2), BOLD)).toBe(true);
    expect(hasMark(bold, span(0, 3, 0, 3), BOLD)).toBe(false);
    expect(hasMark(note(ink("i")), span(0, 0, 0, 0), BOLD)).toBe(false);
  });

  it("indents list items and body text, not headings, within bounds", () => {
    const start = note(t("a", "x", "heading"), t("b", "y", "bullet"), t("c", "z"));
    const range = span(0, 0, 2, 0);
    let current = start;
    for (let i = 0; i < 5; i++) current = indentBlocks(current, range, 1);
    expect((current.blocks[0] as TextBlock).indent).toBeUndefined();
    expect((current.blocks[1] as TextBlock).indent).toBe(3);
    expect((current.blocks[2] as TextBlock).indent).toBe(3);
    expect(indentBlocks(current, range, 1)).toBe(current);
    for (let i = 0; i < 5; i++) current = indentBlocks(current, range, -1);
    expect(current).toEqual(start);
  });

  it("ticks checklist items", () => {
    const start = note(t("a", "x", "check"), t("b", "y"));
    const ticked = toggleChecked(start, 0);
    expect((ticked.blocks[0] as TextBlock).checked).toBe(true);
    expect((toggleChecked(ticked, 0).blocks[0] as TextBlock).checked).toBeUndefined();
    expect(toggleChecked(start, 1)).toBe(start);
  });

  it("turns typed Markdown markers into kinds on body text only", () => {
    expect(shortcutKind("body", "-")).toBe("dash");
    expect(shortcutKind("body", "*")).toBe("bullet");
    expect(shortcutKind("body", "1.")).toBe("number");
    expect(shortcutKind("body", "1)")).toBe("number");
    expect(shortcutKind("body", "[]")).toBe("check");
    expect(shortcutKind("body", "[ ]")).toBe("check");
    expect(shortcutKind("body", ">")).toBe("quote");
    expect(shortcutKind("body", "#")).toBe("title");
    expect(shortcutKind("body", "##")).toBe("heading");
    expect(shortcutKind("body", "###")).toBe("subheading");
    expect(shortcutKind("body", "x")).toBeNull();
    expect(shortcutKind("bullet", "-")).toBeNull();
  });
});

describe("blocks", () => {
  it("moves a block before another", () => {
    const start = note(t("a", "a"), t("b", "b"), t("c", "c"));
    const order = (n: TextNote) => n.blocks.map((b) => b.id).join("");
    expect(order(moveBlock(start, 0, 3))).toBe("bca");
    expect(order(moveBlock(start, 2, 0))).toBe("cab");
    expect(order(moveBlock(start, 0, 2))).toBe("bac");
    expect(moveBlock(start, 1, 1)).toBe(start);
    expect(moveBlock(start, 1, 2)).toBe(start);
    expect(moveBlock(start, 7, 0)).toBe(start);
  });

  it("inserts, replaces, removes and finds", () => {
    const start = note(t("a", "a"));
    const two = insertBlock(start, 99, t("b", "b"));
    expect(indexOfBlock(two, "b")).toBe(1);
    expect(texts(replaceBlock(two, 1, ink("i")))).toEqual(["body:a", "ink"]);
    expect(replaceBlock(two, 5, ink("i"))).toBe(two);
    expect(removeBlock(two, 0).blocks).toHaveLength(1);
    expect(removeBlock(two, 5)).toBe(two);
  });

  it("always leaves a line to type on", () => {
    const start = note(t("a", "a"), ink("i"));
    expect(texts(withTypingLine(start, ids()))).toEqual(["body:a", "ink", "body:"]);
    const fine = note(t("a", "a"));
    expect(withTypingLine(fine, ids())).toBe(fine);
    expect(texts(withTypingLine(note(), ids()))).toEqual(["title:"]);
    expect(texts(emptyNote(ids()))).toEqual(["title:"]);
  });

  it("clamps a point onto the note", () => {
    const n = note(t("a", "abc"), ink("i"));
    expect(clampPoint(n, at(9, 9))).toEqual(at(1, 0));
    expect(clampPoint(n, at(0, 9))).toEqual(at(0, 3));
    expect(clampPoint(n, at(-1, -1))).toEqual(at(0, 0));
    expect(clampPoint(note(), at(3, 3))).toEqual(at(0, 0));
  });
});

describe("handwriting sections", () => {
  it("measures where the ink ends", () => {
    expect(inkBottom([])).toBe(0);
    expect(inkBottom([stroke([0, 10, 0.5, 0, 100, 0.5], 4)])).toBe(102);
    expect(inkTop([stroke([0, 10, 0.5, 0, 100, 0.5], 4)])).toBe(8);
    expect(inkTop([])).toBe(0);
  });

  it("grows when ink nears the foot, and not otherwise", () => {
    expect(grownHeight(260, 100)).toBe(260);
    expect(grownHeight(260, 250)).toBe(250 + INK_GROW_ROOM);
    expect(grownHeight(260, 1e9)).toBe(INK_MAX_HEIGHT);
  });

  it("trims to what it holds, never growing", () => {
    const some = ink("i", [stroke([0, 0, 0.5, 0, 100, 0.5], 4)], 400);
    expect(trimmedHeight(some)).toBe(102 + INK_TRIM_ROOM);
    expect(trimmedHeight({ ...some, height: 110 })).toBe(110);
    expect(trimmedHeight(ink("i", [], 300))).toBe(300);
    const low = ink("i", [stroke([0, 0, 0.5, 0, 5, 0.5], 2)], 400);
    expect(trimmedHeight(low)).toBe(INK_MIN_HEIGHT);
  });

  it("clamps heights", () => {
    expect(clampInkHeight(NaN)).toBe(INK_DEFAULT_HEIGHT);
    expect(clampInkHeight(1)).toBe(INK_MIN_HEIGHT);
    expect(clampInkHeight(1e9)).toBe(INK_MAX_HEIGHT);
  });

  it("shifts strokes without touching the originals", () => {
    const original = stroke([1, 2, 0.5, 3, 4, 0.5]);
    const [moved] = shiftStrokes([original], 10);
    expect(moved.pts).toEqual([1, 12, 0.5, 3, 14, 0.5]);
    expect(original.pts).toEqual([1, 2, 0.5, 3, 4, 0.5]);
    expect(shiftStrokes([original], 0)[0]).toBe(original);
  });
});

describe("pictures", () => {
  it("shows a picture at its share of the column", () => {
    expect(imageShare(image("p"))).toBe(1);
    expect(imageShare(image("p", INK_WIDTH / 2))).toBe(0.5);
    expect(imageShare(image("p", 1))).toBe(0.15);
    expect(imageShare(image("p", 9999))).toBe(1);
  });

  it("stores a width only below the full column", () => {
    expect(imageWidthFor(1)).toBeUndefined();
    expect(imageWidthFor(0.98)).toBeUndefined();
    expect(imageWidthFor(0.5)).toBe(INK_WIDTH / 2);
    expect(imageWidthFor(0.01)).toBe(Math.round(0.15 * INK_WIDTH));
    expect(imageWidthFor(NaN)).toBeUndefined();
  });
});

describe("reading a note", () => {
  it("finds the title and a preview", () => {
    const n = note(
      t("a", ""),
      ink("i"),
      t("b", " Groceries ", "title"),
      t("c", ""),
      t("d", "milk"),
      t("e", "eggs"),
    );
    expect(noteTitle(n)).toBe("Groceries");
    expect(notePreview(n, 1)).toEqual(["milk"]);
    expect(notePreview(n)).toEqual(["milk", "eggs"]);
    expect(noteTitle(note(ink("i")))).toBe("");
  });

  it("knows a blank note", () => {
    expect(isBlankNote(note(t("a", ""), ink("i")))).toBe(true);
    expect(isBlankNote(note(t("a", "x")))).toBe(false);
    expect(isBlankNote(note(image("p")))).toBe(false);
    expect(isBlankNote(note(ink("i", [stroke([0, 0, 0.5])])))).toBe(false);
  });
});

describe("folding headings", () => {
  const h = (id: string, kind: TextKind): TextBlock =>
    textBlock(id, kind, [{ text: id, marks: 0 }]);
  const b = (id: string): TextBlock => textBlock(id, "body", [{ text: id, marks: 0 }]);

  it("hides what a folded heading holds, up to the next heading of its rank or higher", () => {
    const blocks = [
      h("T", "title"),
      h("A", "heading"),
      b("a1"),
      h("A1", "subheading"),
      b("a2"),
      h("B", "heading"),
      b("b1"),
    ];
    const plan = foldPlan(blocks, new Set(["A"]));
    expect(plan.map((p) => p.hidden)).toEqual([false, false, true, true, true, false, false]);
    expect(plan.map((p) => p.foldable)).toEqual([false, true, false, true, false, true, false]);
    expect(plan[1].folded).toBe(true);
  });

  it("never folds the title, a heading with nothing under it, or one already hidden", () => {
    const blocks = [h("T", "title"), b("x"), h("A", "heading"), h("B", "heading"), b("y")];
    const plan = foldPlan(blocks, new Set(["T", "A"]));
    expect(plan.map((p) => p.hidden)).toEqual([false, false, false, false, false]);
    const nested = [h("T", "title"), h("A", "heading"), h("S", "subheading"), b("z")];
    const inner = foldPlan(nested, new Set(["A", "S"]));
    expect(inner.map((p) => p.hidden)).toEqual([false, false, true, true]);
    expect(inner[2].folded).toBe(false);
  });

  it("ranks headings", () => {
    expect(
      [h("a", "title"), h("b", "heading"), h("c", "subheading"), b("d")].map(headingRank),
    ).toEqual([1, 2, 3, 0]);
  });
});
