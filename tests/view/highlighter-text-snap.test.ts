/**
 * The highlighter coming down on a PDF page's text (`startTextMark`): it
 * snaps to the text once the page's text is read, says on the debug overlay
 * why when it does not, and stays freehand everywhere else. Joost found it
 * drawing freehand on his iPad (2026-10-30); this pins the surface's side.
 */
import { describe, expect, it, vi } from "vitest";
import { layoutText, pdfToPage, type TextLayout } from "../../src/canvas/pdf-text";
import { blankPage } from "../../src/model/document";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

const geometry = { width: 600, height: 800 };
/** One line of 20 pt text, its baseline 100 pt from the top, from x 50. */
const layout: TextLayout = layoutText(
  [{ str: "Insulin resistance", transform: [20, 0, 0, 20, 50, 700], width: 180, height: 20 }],
  pdfToPage([1, 0, 0, -1, 0, 800], geometry, geometry),
);

type Surface = Record<string, unknown> & {
  startTextMark(box: { index: number }, at: { x: number; y: number }): boolean;
  hudTextMark: string;
  textMark: unknown;
};

function surface(read: TextLayout | null, tool = "highlighter", backdrop?: object) {
  const page = blankPage("p1", geometry);
  page.backdrop = (backdrop ?? { kind: "pdf", path: "Handout.pdf", page: 0 }) as never;
  const source = { peek: vi.fn(() => read), request: vi.fn() };
  const wet = vi.fn();
  const s = Object.assign(Object.create(InkSurface.prototype) as object, {
    toolState: { tool, color: "#ffd60a" },
    practice: null,
    doc: { pages: [page] },
    textSource: source,
    userZoom: 1,
    debug: true,
    hudTextMark: "",
    textMark: null,
    lastLift: null,
    renderer: { renderWetStrokes: wet },
    scheduleHud: vi.fn(),
  }) as unknown as Surface;
  return { s, source, wet };
}

describe("the highlighter on a PDF page's text", () => {
  it("snaps to the text under it, drawn wet as it will be kept", () => {
    const { s, wet } = surface(layout);
    expect(s.startTextMark({ index: 0 }, { x: 60, y: 95 })).toBe(true);
    expect(s.textMark).not.toBeNull();
    expect(wet).toHaveBeenCalledOnce();
    expect(s.hudTextMark).toBe('snapped "Insulin"');
  });

  it("draws freehand while the page's text is being read, having asked for it", () => {
    const { s, source } = surface(null);
    expect(s.startTextMark({ index: 0 }, { x: 60, y: 95 })).toBe(false);
    expect(source.request).toHaveBeenCalledOnce();
    expect(s.hudTextMark).toBe("text not read yet");
  });

  it("draws freehand beside the text, and on a page that is not a PDF's", () => {
    const beside = surface(layout);
    expect(beside.s.startTextMark({ index: 0 }, { x: 60, y: 600 })).toBe(false);
    expect(beside.s.hudTextMark).toBe("off the text (1 lines)");
    const plain = surface(layout, "highlighter", { kind: "blank" });
    expect(plain.s.startTextMark({ index: 0 }, { x: 60, y: 95 })).toBe(false);
    expect(plain.s.hudTextMark).toBe("not a PDF page");
  });

  it("is the highlighter's alone", () => {
    const { s, source } = surface(layout, "pen");
    expect(s.startTextMark({ index: 0 }, { x: 60, y: 95 })).toBe(false);
    expect(source.peek).not.toHaveBeenCalled();
  });
});
