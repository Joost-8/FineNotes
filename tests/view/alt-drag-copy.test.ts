/**
 * Alt (Option) dragging a lasso selection drags a copy and leaves the
 * original where it was (`InkSurface.copyInPlace`, `recordDrag`,
 * `dropCopy`): one undo takes back both the copy and its move, and an Alt
 * press that never moved leaves no copy.
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");
const { History } = await import("../../src/model/history");
const { emptyDocument } = await import("../../src/model/document");
const { TranslateElements } = await import("../../src/model/selection-commands");

type Fake = Record<string, unknown>;
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

function surface() {
  const doc = emptyDocument();
  const page = doc.pages[0];
  page.strokes.push({
    id: "s1",
    pts: [10, 10, 0.5, 40, 10, 0.5],
    color: "#000",
    width: 2,
  } as never);
  const history = new History();
  let n = 1;
  const s: Fake = Object.create(InkSurface.prototype) as Fake;
  Object.assign(s, {
    doc,
    history,
    callbacks: {},
    selection: null,
    strokeIndex: { refreshPages: vi.fn() },
    syncTextBoxes: vi.fn(),
    withShapeContent: (sel: unknown) => sel,
    strokeIds: { next: () => `s${++n}` },
    textBoxIds: { next: () => `t${++n}` },
  });
  const original = { pageId: page.id, strokes: [page.strokes[0]], images: [], textBoxes: [] };
  return { s, doc, page, history, original };
}

describe("Alt-drag to duplicate", () => {
  it("copies in place, selects the copy, and one undo takes back copy and move", () => {
    const { s, doc, page, history, original } = surface();
    const copy = run(s, "copyInPlace", original) as {
      command: unknown;
      own: { strokes: Array<{ id: string; pts: number[] }> };
    };
    expect(page.strokes).toHaveLength(2);
    expect(copy.own.strokes[0].id).not.toBe("s1");
    expect((s.selection as typeof copy.own).strokes[0]).toBe(copy.own.strokes[0]);

    const drag = { copied: { command: copy.command, original } };
    run(s, "recordDrag", drag, new TranslateElements(page.id, copy.own as never, 30, 0));
    expect(page.strokes[0].pts[0]).toBe(10);
    expect(page.strokes[1].pts[0]).toBe(40);

    history.undo(doc);
    expect(page.strokes.map((stroke) => stroke.id)).toEqual(["s1"]);
    expect(page.strokes[0].pts[0]).toBe(10);
    expect(history.canUndo()).toBe(false);
  });

  it("an Alt press that never moved leaves no copy and the original selected", () => {
    const { s, page, history, original } = surface();
    const copy = run(s, "copyInPlace", original) as { command: unknown };
    run(s, "dropCopy", { command: copy.command, original });
    expect(page.strokes.map((stroke) => stroke.id)).toEqual(["s1"]);
    expect(s.selection).toBe(original);
    expect(history.canUndo()).toBe(false);
  });
});
