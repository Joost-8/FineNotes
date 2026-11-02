/**
 * `src/canvas/text-pick.ts` — selecting a PDF page's text as iPadOS does: a
 * hold takes the word, the handles drag a character at a time.
 */

import { describe, expect, it } from "vitest";
import {
  type Matrix,
  type PdfTextItem,
  caretAt,
  layoutText,
  pdfToPage,
} from "../../src/canvas/pdf-text";
import {
  dragPickEnd,
  handleTarget,
  isEmptyPick,
  pickBounds,
  pickHandles,
  pickWord,
} from "../../src/canvas/text-pick";

const VIEWPORT: Matrix = [1, 0, 0, -1, 0, 800];
const SOURCE = { width: 600, height: 800 };
const PAGE = pdfToPage(VIEWPORT, SOURCE, SOURCE);

/** Text at baseline `y` (y down) from `x`, every character 10 px wide (monospaced width). */
function item(str: string, x: number, y: number): PdfTextItem {
  return { str, transform: [20, 0, 0, 20, x, 800 - y], width: str.length * 10, height: 20 };
}

/** Two lines: "hello world" at y 100 and "second line" at y 140, both from x 100. */
const LAYOUT = layoutText([item("hello world", 100, 100), item("second line", 100, 140)], PAGE);
/** A point in the middle of line one or two, at `x`. */
const on1 = (x: number): { x: number; y: number } => ({ x, y: 96 });
const on2 = (x: number): { x: number; y: number } => ({ x, y: 136 });

describe("caretAt", () => {
  it("is the caret before the first character whose middle is past the point", () => {
    // The characters are not equally wide (Helvetica's advances share the
    // width out), so read the caret off the layout's own positions.
    const w = LAYOUT.chars[6];
    expect(caretAt(LAYOUT, w.x0 + 0.1, 96)).toBe(6);
    expect(caretAt(LAYOUT, w.x1 - 0.1, 96)).toBe(7);
  });

  it("goes to the nearest line, and is -1 on a page with no text", () => {
    expect(caretAt(LAYOUT, 0, 500)).toBe(LAYOUT.lines[1].start);
    expect(caretAt(layoutText([], PAGE), 10, 10)).toBe(-1);
  });
});

describe("pickWord", () => {
  it("takes the whole word under the point", () => {
    const pick = pickWord(LAYOUT, on1(LAYOUT.chars[8].x0 + 1));
    expect(pick?.text).toBe("world");
    expect(pick?.rects).toHaveLength(1);
  });

  it("is null beside the text, and allows the slop it is given", () => {
    expect(pickWord(LAYOUT, { x: 100, y: 300 })).toBeNull();
    expect(pickWord(LAYOUT, { x: 99, y: 76 })).toBeNull();
    expect(pickWord(LAYOUT, { x: 99, y: 76 }, 12)?.text).toBe("hello");
  });
});

describe("dragPickEnd", () => {
  const world = (): NonNullable<ReturnType<typeof pickWord>> => {
    const pick = pickWord(LAYOUT, on1(LAYOUT.chars[8].x0 + 1));
    if (!pick) throw new Error("no word");
    return pick;
  };

  it("moves the end handle a character at a time, onto the next line too", () => {
    const pick = world();
    const into = dragPickEnd(
      LAYOUT,
      pick,
      "end",
      on2(LAYOUT.chars[LAYOUT.lines[1].start + 2].x1 - 0.1),
    );
    expect(into.start).toBe(pick.start);
    expect(into.text).toBe("world\nsec");
    expect(into.rects).toHaveLength(2);
  });

  it("moves the start handle back, inside a word", () => {
    const pick = world();
    const back = dragPickEnd(LAYOUT, pick, "start", on1(LAYOUT.chars[3].x0 + 0.1));
    expect(back.end).toBe(pick.end);
    expect(back.text).toBe("lo world");
  });

  it("never lets the ends cross: a handle stops a character short of the other", () => {
    const pick = world();
    const start = dragPickEnd(LAYOUT, pick, "start", on2(500));
    expect(start).toMatchObject({ start: pick.end - 1, end: pick.end, text: "d" });
    const end = dragPickEnd(LAYOUT, pick, "end", on1(0));
    expect(end).toMatchObject({ start: pick.start, end: pick.start + 1, text: "w" });
  });

  it("keeps what it had when the drag would hold only a space", () => {
    // "hello" with its end handle pulled back onto the space before "world".
    const hello = pickWord(LAYOUT, on1(LAYOUT.chars[1].x0 + 1));
    if (!hello) throw new Error("no word");
    const spaceOnly = { start: 5, end: 6 };
    expect(LAYOUT.chars[5].ch).toBe(" ");
    const kept = dragPickEnd(LAYOUT, spaceOnly, "end", on1(LAYOUT.chars[5].x1 - 0.1));
    expect(kept).toMatchObject(spaceOnly);
    expect(isEmptyPick(kept)).toBe(true);
    expect(isEmptyPick(hello)).toBe(false);
  });

  it("leaves the range alone on a page with no text", () => {
    const empty = layoutText([], PAGE);
    expect(dragPickEnd(empty, { start: 0, end: 0 }, "end", { x: 1, y: 1 })).toMatchObject({
      start: 0,
      end: 0,
      text: "",
    });
  });
});

describe("pickHandles and pickBounds", () => {
  it("stand before the first character and after the last, on their own lines", () => {
    const pick = dragPickEnd(
      LAYOUT,
      { start: 6, end: 11 },
      "end",
      on2(LAYOUT.chars[LAYOUT.lines[1].start + 5].x1 - 0.1),
    );
    const handles = pickHandles(pick);
    const [one, two] = pick.rects;
    expect(handles?.start).toEqual({ x: one.x, top: one.y, bottom: one.y + one.h });
    expect(handles?.end).toEqual({ x: two.x + two.w, top: two.y, bottom: two.y + two.h });
    expect(pickBounds(pick)).toEqual({
      minX: Math.min(one.x, two.x),
      minY: one.y,
      maxX: Math.max(one.x + one.w, two.x + two.w),
      maxY: two.y + two.h,
    });
  });

  it("are null for an empty pick", () => {
    const empty = { start: 0, end: 0, rects: [], text: "" };
    expect(pickHandles(empty)).toBeNull();
    expect(pickBounds(empty)).toBeNull();
  });
});

describe("handleTarget", () => {
  it("reads the pointer offset by where it took the handle", () => {
    expect(handleTarget({ x: 10, y: 20 }, { x: -3, y: 4 })).toEqual({ x: 7, y: 24 });
  });
});
