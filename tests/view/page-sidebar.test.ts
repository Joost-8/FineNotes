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

const { KEEP_PAINTED_OFFSCREEN, PageSidebar, pagePassesFilter, thumbnailTitleOf } =
  await import("../../src/view/page-sidebar");

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

describe("page filter", () => {
  const plain = blankPage("a");
  const marked: Page = { ...blankPage("b"), bookmarked: true };
  const titled: Page = { ...blankPage("c"), title: "Week 3" };
  const headed: Page = {
    ...blankPage("d"),
    sections: [{ id: "c1", title: "Fourier", x: 10, y: 40 }],
  };

  it("shows every page under All pages", () => {
    for (const page of [plain, marked, titled, headed])
      expect(pagePassesFilter(page, "all")).toBe(true);
  });

  it("shows only bookmarked pages under Bookmarks only", () => {
    expect([plain, marked, titled, headed].map((p) => pagePassesFilter(p, "bookmarks"))).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("shows pages with a title or a heading inside under In the contents", () => {
    expect([plain, marked, titled, headed].map((p) => pagePassesFilter(p, "contents"))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(pagePassesFilter({ ...blankPage("e"), sections: [] }, "contents")).toBe(false);
  });
});

describe("thumbnail title", () => {
  it("is the page's title in the contents", () => {
    expect(thumbnailTitleOf({ ...blankPage("a"), title: "Week 3" })).toBe("Week 3");
  });

  it("is the topmost heading on a page without a title", () => {
    // Sections are stored top to bottom (sortSections).
    const page: Page = {
      ...blankPage("b"),
      sections: [
        { id: "c1", title: "Fermat's little theorem", x: 10, y: 40 },
        { id: "c2", title: "Exercise", x: 10, y: 400 },
      ],
    };
    expect(thumbnailTitleOf(page)).toBe("Fermat's little theorem");
    expect(thumbnailTitleOf({ ...page, title: "Lecture 5" })).toBe("Lecture 5");
  });

  it("is empty for a page in neither, and for no page", () => {
    expect(thumbnailTitleOf(blankPage("c"))).toBe("");
    expect(thumbnailTitleOf({ ...blankPage("d"), sections: [] })).toBe("");
    expect(thumbnailTitleOf(undefined)).toBe("");
  });
});

describe("select mode in the docked panel", () => {
  type Priv = Record<string, (...args: never[]) => unknown>;
  const proto = PageSidebar.prototype as unknown as Priv;

  /** A panel (not the overview) with the chrome stubbed out. */
  function panel(extra: Record<string, unknown> = {}) {
    return Object.assign(Object.create(PageSidebar.prototype) as object, {
      doc: notebook(5),
      thumbs: [],
      open: true,
      single: false,
      fixed: false,
      overview: false,
      selecting: false,
      selected: new Set<Page>(),
      anchor: null,
      callbacks: {},
      syncChrome: () => {},
      syncSelection: () => {},
      ...extra,
    }) as Record<string, unknown> & { selected: Set<Page>; selecting: boolean; doc: InkDocument };
  }
  const call = (sidebar: object, name: string, ...args: unknown[]): unknown =>
    (proto[name] as (...a: unknown[]) => unknown).apply(sidebar, args);

  it("starts without the overview, and only on a notebook that can be edited", () => {
    const sidebar = panel();
    call(sidebar, "setSelecting", true);
    expect(sidebar.selecting).toBe(true);
    for (const state of [{ single: true }, { fixed: true }, { open: false }]) {
      const refused = panel(state);
      call(refused, "setSelecting", true);
      expect(refused.selecting).toBe(false);
    }
  });

  it("ticks a page on a Ctrl-click and ends with its selection when turned off", () => {
    const sidebar = panel();
    call(sidebar, "tapThumb", 1, {}, { ctrlKey: true });
    call(sidebar, "tapThumb", 3, {}, { metaKey: true });
    expect(sidebar.selecting).toBe(true);
    expect([...sidebar.selected].map((p) => p.id)).toEqual(["p2", "p4"]);
    call(sidebar, "tapThumb", 1, {}, {});
    expect([...sidebar.selected].map((p) => p.id)).toEqual(["p4"]);
    call(sidebar, "setSelecting", false);
    expect(sidebar.selected.size).toBe(0);
  });

  it("drags every ticked page with the one grabbed, and a loose page alone", () => {
    const sidebar = panel();
    call(sidebar, "tapThumb", 0, {}, { ctrlKey: true });
    call(sidebar, "tapThumb", 2, {}, { ctrlKey: true });
    expect(call(sidebar, "movingWith", 2)).toEqual([0, 2]);
    expect(call(sidebar, "movingWith", 4)).toEqual([4]);
  });

  it("is left by switching to another tab", () => {
    const sidebar = panel({
      tabButtons: new Map(),
      pagesEl: { toggleClass: () => {} },
      contentsEl: { toggleClass: () => {} },
      filesEl: { toggleClass: () => {} },
      el: { setAttribute: () => {} },
      titleEl: { setText: () => {} },
    });
    call(sidebar, "setSelecting", true);
    sidebar.open = false;
    call(sidebar, "showTab", "contents");
    expect(sidebar.selecting).toBe(false);
  });
});
