/**
 * `src/view/page-sidebar.ts` — the thumbnails' canvas memory. Scrolling the
 * sidebar through a long notebook used to leave every thumbnail painted:
 * 325 MB of canvases after 1,000 pages at an iPad's pixel ratio
 * (research/SCALE.md). Those out of view now give their pixels back beyond a
 * budget, the least recently seen first.
 *
 * No DOM here: the sidebar is built from its prototype with only the state
 * its painting reads, and canvases are plain objects whose `getContext`
 * returns null, so painting sizes them and draws nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { type InkDocument, type Page, blankPage } from "../../src/model/document";

vi.mock("obsidian", () => ({
  Menu: class {},
  setIcon: () => {},
  normalizePath: (path: string) => path,
}));

const { KEEP_PAINTED_OFFSCREEN, PageSidebar } = await import("../../src/view/page-sidebar");

interface FakeView {
  root: object;
  canvas: { width: number; height: number; getContext: () => null };
  painted: string;
  held: boolean;
  visible: boolean;
  seen: number;
}

function notebook(pages: number): InkDocument {
  return {
    version: 3,
    view: { scrollY: 0, width: 1024, scale: 1 },
    pages: Array.from({ length: pages }, (_, i): Page => blankPage(`p${i + 1}`)),
  };
}

function sidebarOf(doc: InkDocument) {
  const thumbs: FakeView[] = doc.pages.map(() => ({
    root: {},
    canvas: { width: 300, height: 150, getContext: () => null },
    painted: "",
    held: false,
    visible: false,
    seen: 0,
  }));
  const sidebar = Object.assign(Object.create(PageSidebar.prototype) as object, {
    doc,
    thumbs,
    paints: 0,
    render: { painter: { paint: () => {} }, usePressure: false, highlighterAlpha: 0.35 },
  }) as Record<string, unknown>;
  const paint = (): void =>
    (PageSidebar.prototype as unknown as { paintVisible: () => void }).paintVisible.call(sidebar);
  /** Show thumbnails `from` to `to` (exclusive) and paint, as a scroll does. */
  const show = (from: number, to: number): void => {
    thumbs.forEach((view, i) => (view.visible = i >= from && i < to));
    paint();
  };
  const holding = (): number => thumbs.filter((v) => v.canvas.width > 0).length;
  const painted = (i: number): boolean => thumbs[i].canvas.width > 0 && thumbs[i].painted !== "";
  return { sidebar, thumbs, show, holding, painted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("thumbnail canvases", () => {
  it("hold no more than a screen plus the budget after a scroll through 1,000 pages", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const { show, holding, painted } = sidebarOf(notebook(1000));
    for (let top = 0; top + 12 <= 1000; top += 4) show(top, top + 12);
    expect(holding()).toBe(12 + KEEP_PAINTED_OFFSCREEN);
    // The screen in view is painted, and so are the pages just scrolled past.
    for (let i = 988; i < 1000; i++) expect(painted(i)).toBe(true);
    expect(painted(988 - KEEP_PAINTED_OFFSCREEN)).toBe(true);
    expect(painted(988 - KEEP_PAINTED_OFFSCREEN - 1)).toBe(false);
  });

  it("paints a thumbnail again when it comes back into view", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const { show, painted, thumbs } = sidebarOf(notebook(200));
    show(0, 10);
    for (let top = 10; top + 10 <= 200; top += 10) show(top, top + 10);
    expect(painted(0)).toBe(false);
    expect(thumbs[0].canvas.width).toBe(0);
    show(0, 10);
    expect(painted(0)).toBe(true);
    expect(thumbs[0].canvas.width).toBe(240);
  });

  it("keeps everything painted in a notebook that fits the budget", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const { show, holding } = sidebarOf(notebook(30));
    for (let top = 0; top + 10 <= 30; top += 5) show(top, top + 10);
    expect(holding()).toBe(30);
  });

  it("paints the overview's larger thumbnails, and keeps fewer of them out of view", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const { sidebar, show, holding, thumbs } = sidebarOf(notebook(200));
    sidebar.overview = true;
    for (let top = 0; top + 20 <= 200; top += 20) show(top, top + 20);
    // 240 CSS px at 2x: four times the pixels of a sidebar thumbnail.
    expect(thumbs[199].canvas.width).toBe(480);
    expect(holding()).toBeLessThan(20 + KEEP_PAINTED_OFFSCREEN / 2);
    expect(holding()).toBeGreaterThan(20);
  });

  it("counts a thumbnail marked for repaint as still holding its pixels", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const { sidebar, show, holding } = sidebarOf(notebook(300));
    for (let top = 0; top + 10 <= 300; top += 10) show(top, top + 10);
    // A new paper theme marks every thumbnail stale, painted or not.
    sidebar.open = false;
    (PageSidebar.prototype as unknown as { invalidate: () => void }).invalidate.call(sidebar);
    show(0, 10);
    expect(holding()).toBeLessThanOrEqual(10 + KEEP_PAINTED_OFFSCREEN);
  });
});
