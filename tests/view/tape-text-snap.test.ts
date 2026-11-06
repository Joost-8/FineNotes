/**
 * Cover tape dragged along a PDF page's text (`tapeTextAt`, `tapeDrafts`,
 * FineNotes#164): with Snap to PDF text on, it covers the lines it runs
 * over; off, or off the text, it is laid where it is dragged, as before.
 */
import { describe, expect, it, vi } from "vitest";
import { layoutText, pdfToPage, type TextLayout } from "../../src/canvas/pdf-text";
import { blankPage, type Stroke } from "../../src/model/document";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

const geometry = { width: 600, height: 800 };
/** Two lines of 20 pt text, baselines 100 and 130 pt from the top, from x 50. */
const layout: TextLayout = layoutText(
  [
    { str: "Insulin resistance", transform: [20, 0, 0, 20, 50, 700], width: 180, height: 20 },
    { str: "Type two diabetes", transform: [20, 0, 0, 20, 50, 670], width: 170, height: 20 },
  ],
  pdfToPage([1, 0, 0, -1, 0, 800], geometry, geometry),
);

type Pt = { x: number; y: number };
type Surface = Record<string, unknown> & {
  tapeTextAt(box: { index: number }, at: Pt): TextLayout | null;
  tapeDrafts(
    drag: { from: Pt; to: Pt; path: Pt[] | null; text: TextLayout | null },
    final?: boolean,
  ): Stroke[];
};

function surface(snap: boolean | undefined, read: TextLayout | null = layout) {
  const page = blankPage("p1", geometry);
  page.backdrop = { kind: "pdf", path: "Handout.pdf", page: 0 } as never;
  const source = { peek: vi.fn(() => read), request: vi.fn() };
  const s = Object.assign(Object.create(InkSurface.prototype) as object, {
    toolState: { tool: "tape", color: "#000000", tapeSnapText: snap },
    practice: null,
    doc: { pages: [page] },
    textSource: source,
    userZoom: 1,
  }) as unknown as Surface;
  return { s, source };
}

describe("a cover tape on a PDF page's text", () => {
  it("is laid where it is dragged while Snap to PDF text is off (the default)", () => {
    for (const snap of [undefined, false]) {
      const { s, source } = surface(snap);
      expect(s.tapeTextAt({ index: 0 }, { x: 60, y: 95 })).toBeNull();
      expect(source.peek).not.toHaveBeenCalled();
    }
    const { s } = surface(undefined);
    const drafts = s.tapeDrafts({
      from: { x: 60, y: 95 },
      to: { x: 140, y: 97 },
      path: null,
      text: null,
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].pts[0]).toBe(60);
  });

  it("covers the line it is dragged along, from its first letter to its last", () => {
    const { s } = surface(true);
    const text = s.tapeTextAt({ index: 0 }, { x: 60, y: 95 });
    expect(text).toBe(layout);
    const drafts = s.tapeDrafts({
      from: { x: 60, y: 95 },
      to: { x: 225, y: 96 },
      path: null,
      text: text,
    });
    expect(drafts).toHaveLength(1);
    const [tape] = drafts;
    expect(tape.tool).toBe("tape");
    const line = layout.lines[0];
    // Level, centred on the line, taller than it and past both its ends.
    expect(tape.pts[1]).toBe(tape.pts[4]);
    expect(tape.pts[1]).toBeCloseTo((line.top + line.bottom) / 2, 1);
    expect(tape.size).toBeGreaterThan(line.bottom - line.top);
    expect(tape.pts[0]).toBeLessThan(50);
    expect(tape.pts[3]).toBeGreaterThanOrEqual(225);
  });

  it("covers each line a drag runs down over, one tape a line", () => {
    const { s } = surface(true);
    const text = s.tapeTextAt({ index: 0 }, { x: 60, y: 95 });
    const drafts = s.tapeDrafts({
      from: { x: 60, y: 95 },
      to: { x: 150, y: 125 },
      path: null,
      text: text,
    });
    expect(drafts).toHaveLength(2);
    expect(drafts[1].pts[1]).toBeGreaterThan(drafts[0].pts[1]);
  });

  it("is laid as dragged beside the text, and while the text is still being read", () => {
    const beside = surface(true);
    expect(beside.s.tapeTextAt({ index: 0 }, { x: 60, y: 600 })).toBeNull();
    const unread = surface(true, null);
    expect(unread.s.tapeTextAt({ index: 0 }, { x: 60, y: 95 })).toBeNull();
    expect(unread.source.request).toHaveBeenCalledOnce();
  });

  it("is still a tap that shows a tape through when the pen hardly moves", () => {
    const { s } = surface(true);
    const text = s.tapeTextAt({ index: 0 }, { x: 60, y: 95 });
    expect(
      s.tapeDrafts({ from: { x: 60, y: 95 }, to: { x: 61, y: 95 }, path: null, text: text }),
    ).toEqual([]);
  });
});
