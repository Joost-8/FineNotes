/**
 * Cover tape on the surface: the tape tool lays a strip as one undo step; a
 * tap shows a tape through or covers it again, in the view only (the
 * document never changes); the pill's eye shows or covers the page's tapes.
 */

import { describe, expect, it, vi } from "vitest";
import type { InkDocument, Page, Stroke } from "../../src/model/document";
import type { Command } from "../../src/model/commands";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

type Fake = Record<string, unknown> & {
  revealedTapes: ReadonlySet<string>;
  renderer: Record<string, ReturnType<typeof vi.fn>>;
  callbacks: { onTapesToggled: ReturnType<typeof vi.fn> };
};

const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...a: unknown[]) => unknown).apply(obj, args);

function tape(id: string, y: number, extra: Partial<Stroke> = {}): Stroke {
  return {
    id,
    color: "#e6d3a3",
    size: 40,
    tool: "tape",
    pts: [100, y, 0.5, 300, y, 0.5],
    ...extra,
  };
}

function page(...strokes: Stroke[]): Page {
  return {
    id: "p1",
    kind: "page",
    geometry: { width: 1024, height: 1448 },
    backdrop: { kind: "blank" },
    strokes,
    images: [],
    textBoxes: [],
  } as unknown as Page;
}

function surface(pages: Page[]): Fake & { doc: InkDocument; pushed: Command[] } {
  const doc = { pages } as unknown as InkDocument;
  const pushed: Command[] = [];
  const s = Object.assign(Object.create(InkSurface.prototype), {
    doc,
    pushed,
    pageIndex: 0,
    revealedTapes: new Set<string>(),
    tapeDrag: null,
    toolState: { tool: "tape", tapeColor: "#8fc9e8", tapeHeight: 72 },
    renderer: {
      setRevealedTapes: vi.fn(),
      invalidateRegion: vi.fn(),
      clearWet: vi.fn(),
      renderWetStrokes: vi.fn(),
      appendCommittedStroke: vi.fn(),
    },
    callbacks: { onTapesToggled: vi.fn() },
    renderDry: vi.fn(),
    requestZoomPaint: vi.fn(),
    inkChanged: vi.fn(),
    strokeIndex: { add: vi.fn() },
    strokeIds: { next: () => "s9" },
    history: {
      push: (d: InkDocument, command: Command) => {
        command.apply(d);
        pushed.push(command);
      },
    },
    penDownAt: 0,
    strokeInBox: false,
    baseScale: 1,
    userZoom: 1,
  }) as Fake & { doc: InkDocument; pushed: Command[] };
  Object.defineProperty(s, "gestureZoom", { value: 1 });
  return s;
}

const BOX = { index: 0, id: "p1", x: 0, y: 0, width: 1024, height: 1448 };

describe("a tap on a cover tape", () => {
  it("shows it through, then covers it again, and never changes the document", () => {
    const p = page(tape("a", 100), tape("b", 400));
    const s = surface([p]);
    const before = JSON.stringify(p);
    expect(run(s, "toggleTapeAt", p, { x: 200, y: 110 }, 0)).toBe(true);
    expect([...s.revealedTapes]).toEqual(["a"]);
    expect(s.renderer.setRevealedTapes).toHaveBeenCalledWith(s.revealedTapes);
    expect(s.renderer.invalidateRegion).toHaveBeenCalledOnce();
    expect(s.callbacks.onTapesToggled).toHaveBeenCalledOnce();
    run(s, "toggleTapeAt", p, { x: 200, y: 110 }, 0);
    expect([...s.revealedTapes]).toEqual([]);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("does nothing where there is no tape", () => {
    const s = surface([page(tape("a", 100))]);
    expect(run(s, "toggleTapeAt", s.doc.pages[0], { x: 200, y: 300 }, 0)).toBe(false);
    expect(s.renderer.setRevealedTapes).not.toHaveBeenCalled();
  });

  it("shows a mirror over a join with its owner", () => {
    const mirror = tape("p0/a@p1", 100, { join: "p0/a" });
    const s = surface([page(mirror)]);
    run(s, "toggleTapeAt", s.doc.pages[0], { x: 200, y: 100 }, 0);
    expect([...s.revealedTapes]).toEqual(["a"]);
  });

  it("from the pen, is a tap only while the pen stayed put", () => {
    const p = page(tape("a", 100));
    const s = surface([p]);
    expect(run(s, "penTapsTape", p, [200, 100, 0.5, 260, 100, 0.5])).toBe(false);
    expect(run(s, "penTapsTape", p, [200, 100, 0.5, 201, 101, 0.5])).toBe(true);
    expect([...s.revealedTapes]).toEqual(["a"]);
    expect(run(s, "penTapsTape", page(), [200, 100, 0.5])).toBe(false);
  });
});

describe("the eye in the tape's pill", () => {
  it("shows every tape on the page in view, and covers them again", () => {
    const s = surface([page(tape("a", 100), tape("b", 400))]);
    expect(run(s, "tapesShown")).toBe(false);
    run(s, "showTapes", true);
    expect([...s.revealedTapes].sort()).toEqual(["a", "b"]);
    expect(run(s, "tapesShown")).toBe(true);
    run(s, "showTapes", false);
    expect(run(s, "tapesShown")).toBe(false);
  });

  it("has nothing to show on a page without tape", () => {
    expect(run(surface([page()]), "tapesShown")).toBeNull();
  });
});

describe("the Cover tape tool", () => {
  it("lays a strip from where the drag started to where it lifted, as one undo step", () => {
    const p = page();
    const s = surface([p]);
    run(s, "finishTape", BOX, null);
    s.tapeDrag = { from: { x: 100, y: 200 }, to: { x: 100, y: 200 } };
    run(s, "finishTape", BOX, { x: 500, y: 202 });
    expect(s.pushed).toHaveLength(1);
    expect(p.strokes).toHaveLength(1);
    expect(p.strokes[0]).toMatchObject({ id: "s9", tool: "tape", color: "#8fc9e8", size: 72 });
    // Nearly level comes out level.
    expect(p.strokes[0].pts[4]).toBe(200);
    expect(p.strokes[0].onSticky).toBeUndefined();
  });

  it("toggles the tape under a tap instead of laying one", () => {
    const p = page(tape("a", 100));
    const s = surface([p]);
    s.tapeDrag = { from: { x: 200, y: 100 }, to: { x: 200, y: 100 } };
    run(s, "finishTape", BOX, { x: 201, y: 100 });
    expect(s.pushed).toHaveLength(0);
    expect([...s.revealedTapes]).toEqual(["a"]);
  });
});
