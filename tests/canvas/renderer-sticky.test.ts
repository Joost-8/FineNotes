/**
 * Sticky notes on canvas: the paper is painted (no image painter needed),
 * and a note's ink is drawn with its note, clipped to it, in the tiles, the
 * thumbnails (and so the PDF export and the AI's page render), the lasso's
 * drag preview and a picture drag's draft. It keeps its colours on dark
 * pages, as its paper does.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DARK_PAPER } from "../../src/canvas/backdrop";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import { paintStickyPaper, traceNote, withinNote } from "../../src/canvas/sticky-paper";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type Stroke,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import { newStickyNote } from "../../src/model/sticky-notes";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;

beforeEach(() => {
  log = new DrawLog();
  globals.Path2D = LoggedPath2D;
  globals.createEl = () => log.canvas();
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

const PAPER = "#fde68a";
const ON_NOTE = "#c0392b";
const ON_PAGE = "#225588";

function line(id: string, color: string, y: number, onSticky?: string): Stroke {
  const pts: number[] = [];
  for (let i = 0; i < 12; i++) pts.push(110 + i * 10, y, 0.5);
  return { id, color, size: 3, tool: "pen", pts, ...(onSticky ? { onSticky } : {}) };
}

function note(front: boolean): ImageElement {
  return {
    ...newStickyNote("n1", { x: 100, y: 100, w: 150, h: 150 }, PAPER),
    ...(front ? {} : { front: undefined }),
  };
}

function page(front: boolean): Page {
  return {
    ...blankPage("a", { width: 400, height: 400 }),
    images: [note(front)],
    strokes: [line("on", ON_NOTE, 150, "n1"), line("off", ON_PAGE, 200)],
  };
}

/** Where in `lines` (of `canvas`) the paper, the clip, the note's ink and the page's ink are drawn. */
function marks(lines: readonly string[], canvas: string) {
  const own = lines.filter((l) => l.startsWith(`${canvas} `));
  const first = (test: (l: string) => boolean): number => own.findIndex(test);
  return {
    paper: first((l) => l.includes("fillRect") && l.includes(`fillStyle=${PAPER}`)),
    // The note's outline, not the page's rectangle.
    clip: first((l) => l.includes(" clip nonzero [M")),
    noteInk: first((l) => l.includes(" stroke ") && l.includes(`strokeStyle=${ON_NOTE}`)),
    pageInk: first((l) => l.includes(" stroke ") && l.includes("strokeStyle=")),
    count: (color: string) =>
      own.filter((l) => l.includes(" stroke ") && l.includes(`strokeStyle=${color}`)).length,
  };
}

describe("a thumbnail (sidebar, PDF export, AI render)", () => {
  it("paints a note under the ink with its ink over it, clipped, then the page's ink", () => {
    renderPageThumbnail(log.canvas("t"), page(false), { paint: () => undefined }, 400, 1, {
      usePressure: false,
    });
    const m = marks(log.lines, "t");
    expect(m.paper).toBeGreaterThanOrEqual(0);
    expect(m.paper).toBeLessThan(m.clip);
    expect(m.clip).toBeLessThan(m.noteInk);
    expect(m.count(ON_NOTE)).toBe(1);
    expect(m.count(ON_PAGE)).toBe(1);
    const pageInk = log.lines.findIndex((l) => l.includes(`strokeStyle=${ON_PAGE}`));
    const noteInk = log.lines.findIndex((l) => l.includes(`strokeStyle=${ON_NOTE}`));
    expect(noteInk).toBeLessThan(pageInk);
  });

  it("paints a note stuck in front of the ink over the page's ink, its own ink on top", () => {
    renderPageThumbnail(log.canvas("t"), page(true), { paint: () => undefined }, 400, 1, {
      usePressure: false,
    });
    const at = (s: string) => log.lines.findIndex((l) => l.includes(s));
    expect(at(`strokeStyle=${ON_PAGE}`)).toBeLessThan(at(`fillStyle=${PAPER}`));
    expect(at(`fillStyle=${PAPER}`)).toBeLessThan(at(`strokeStyle=${ON_NOTE}`));
  });

  it("keeps a note's ink in its own colour on a dark page, as the note keeps its paper", () => {
    renderPageThumbnail(log.canvas("t"), page(false), { paint: () => undefined }, 400, 1, {
      usePressure: false,
      paper: DARK_PAPER,
    });
    const m = marks(log.lines, "t");
    expect(m.count(ON_NOTE)).toBe(1);
    // The page's own ink is shown for the dark page.
    expect(m.count(ON_PAGE)).toBe(0);
  });

  it("draws ink whose note is gone as page ink", () => {
    const p = page(false);
    p.images = [];
    renderPageThumbnail(log.canvas("t"), p, { paint: () => undefined }, 400, 1, {
      usePressure: false,
    });
    expect(marks(log.lines, "t").clip).toBe(-1);
    expect(marks(log.lines, "t").count(ON_NOTE)).toBe(1);
  });
});

function setup(front = false): { renderer: Renderer; doc: InkDocument } {
  const doc = emptyDocument(400);
  doc.pages = [page(front)];
  const layout: DocumentLayout = {
    boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 400, height: 400 }],
    width: 400,
    height: 400,
    direction: "vertical",
    fitWidth: 400,
  };
  const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
  renderer.resize(400, 400, 1);
  renderer.setLayout(layout);
  renderer.setPainter({ paint: () => undefined });
  renderer.setViewport({ scrollY: 0, scale: 1, width: 400 }, 0);
  return { renderer, doc };
}

/** The tile canvases logged so far. */
function tiles(): string[] {
  return [...new Set(log.lines.map((l) => l.split(" ")[0]).filter((n) => /^el\d+$/.test(n)))];
}

describe("the page's tiles", () => {
  it("draw a note's ink once, after its paper and inside its clip, with no image painter", () => {
    const { renderer, doc } = setup();
    renderer.renderDocument(doc, false);
    let seen = 0;
    for (const name of tiles()) {
      const m = marks(log.lines, name);
      if (m.count(ON_NOTE) === 0) continue;
      seen++;
      expect(m.count(ON_NOTE)).toBe(1);
      expect(m.paper).toBeLessThan(m.clip);
      expect(m.clip).toBeLessThan(m.noteInk);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("leave a hidden note's ink out with it (a note being dragged)", () => {
    const { renderer, doc } = setup();
    renderer.setHiddenImages(new Set([doc.pages[0].images[0]]));
    renderer.renderDocument(doc, false);
    for (const name of tiles()) {
      expect(marks(log.lines, name).count(ON_NOTE)).toBe(0);
      expect(marks(log.lines, name).paper).toBe(-1);
    }
  });

  it("leave out note ink the eraser is taking away, and draw the pieces it leaves", () => {
    const { renderer, doc } = setup();
    const piece = {
      ...line("on-piece", "#00aa00", 150, "n1"),
      pts: [110, 150, 0.5, 130, 150, 0.5],
    };
    renderer.renderDocument(doc, false, new Set(), null, new Map([["on", [piece]]]));
    const all = tiles().map((name) => marks(log.lines, name));
    expect(all.reduce((n, m) => n + m.count(ON_NOTE), 0)).toBe(0);
    expect(all.reduce((n, m) => n + m.count("#00aa00"), 0)).toBeGreaterThan(0);
  });

  it("redraw a new stroke on a note with the note instead of painting it on top", () => {
    const { renderer, doc } = setup();
    renderer.renderDocument(doc, false);
    const before = log.lines.length;
    const fresh = line("new", "#7700ff", 170, "n1");
    doc.pages[0].strokes.push(fresh);
    renderer.appendCommittedStroke(0, fresh, false);
    expect(log.lines.slice(before).some((l) => l.includes("strokeStyle=#7700ff"))).toBe(false);
    renderer.renderDocument(doc, false);
    expect(log.lines.slice(before).some((l) => l.includes("strokeStyle=#7700ff"))).toBe(true);
  });
});

describe("the wet layer", () => {
  it("drags a note's ink with its draft, moved as the draft is", () => {
    const { renderer, doc } = setup();
    renderer.renderDocument(doc, false);
    const n = doc.pages[0].images[0];
    const inkAt = (): string => {
      const found = log.lines.filter((l) => l.startsWith("wet ") && l.includes(ON_NOTE)).pop();
      return found?.split(" at ")[1]?.split(" ")[0] ?? "";
    };
    renderer.renderImageDraft(0, { ...n });
    const still = inkAt().split(",").map(Number);
    renderer.renderImageDraft(0, { ...n, x: n.x + 100 });
    const moved = inkAt().split(",").map(Number);
    expect(still).toHaveLength(6);
    expect(moved[4] - still[4]).toBeCloseTo(100, 6);
    expect(moved[5]).toBeCloseTo(still[5], 6);
  });

  it("draws a dragged lasso selection's note with its ink, over the page's ink when stuck on", () => {
    const { renderer, doc } = setup(true);
    renderer.renderDocument(doc, false);
    const p = doc.pages[0];
    const from = log.lines.length;
    renderer.renderSelectionDraft(0, p.strokes, p.images, 10, 0, false);
    const wet = log.lines.slice(from).filter((l) => l.startsWith("wet "));
    const at = (s: string) => wet.findIndex((l) => l.includes(s));
    expect(at(`strokeStyle=${ON_PAGE}`)).toBeLessThan(at(`fillStyle=${PAPER}`));
    expect(at(`fillStyle=${PAPER}`)).toBeLessThan(at(" clip nonzero [M"));
    expect(at(" clip nonzero [M")).toBeLessThan(at(`strokeStyle=${ON_NOTE}`));
  });
});

describe("the paper", () => {
  it("is the colour, a darker glued band, and an edge inside the box", () => {
    const ctx = log.canvas("p").getContext("2d") as CanvasRenderingContext2D;
    paintStickyPaper(ctx, 200, 100, PAPER);
    const own = log.lines.filter((l) => l.startsWith("p "));
    expect(own[0]).toContain("fillRect 0,0 200,0 200,100 0,100");
    expect(own[0]).toContain(`fillStyle=${PAPER}`);
    expect(own[1]).toContain("fillRect 0,0 200,0 200,16 0,16");
    expect(own[2]).toContain("strokeRect 0.5,0.5 199.5,0.5 199.5,99.5 0.5,99.5");
  });

  it("paints nothing for a note with no size", () => {
    const ctx = log.canvas("p").getContext("2d") as CanvasRenderingContext2D;
    paintStickyPaper(ctx, 0, 100, PAPER);
    expect(log.lines.filter((l) => l.startsWith("p ")).length).toBe(0);
  });

  it("traces a turned note's outline and clips what is drawn on it", () => {
    const ctx = log.canvas("p").getContext("2d") as CanvasRenderingContext2D;
    const turned = { ...note(true), rotation: Math.PI / 2 };
    ctx.beginPath();
    traceNote(ctx, turned);
    ctx.fill();
    expect(log.lines.at(-1)).toContain("[M250,100 L250,250 L100,250 L100,100 Z]");
    let drew = false;
    withinNote(ctx, turned, () => {
      drew = true;
    });
    expect(drew).toBe(true);
    expect(log.lines.at(-1)).toContain(" clip nonzero [M250,100");
  });
});

describe("a note's typed text, and a folded note (FineNotes#94)", () => {
  function withText(folded = false, rotation?: number): Page {
    const p = page(true);
    p.images = [
      {
        ...note(true),
        ...(rotation !== undefined ? { rotation } : {}),
        sticky: folded ? { color: PAPER, folded: true } : { color: PAPER },
      },
    ];
    p.textBoxes = [
      {
        id: "nt",
        x: 112,
        y: 124,
        w: 126,
        text: "On the note",
        color: "#1f2430",
        fontSize: 16,
        onSticky: "n1",
      },
      { id: "pt", x: 20, y: 300, w: 200, text: "On the page", color: "#1f2430", fontSize: 16 },
    ];
    return p;
  }
  const thumb = (p: Page): string[] => {
    renderPageThumbnail(log.canvas("t"), p, { paint: () => undefined }, 400, 1, {
      usePressure: false,
    });
    return log.lines;
  };
  const at = (lines: readonly string[], s: string) => lines.findIndex((l) => l.includes(s));

  it("draws the note's text with the note, clipped and over its ink, once", () => {
    const lines = thumb(withText());
    const text = at(lines, 'fillText "On the note"');
    expect(text).toBeGreaterThan(at(lines, " clip nonzero [M"));
    expect(text).toBeGreaterThan(at(lines, `strokeStyle=${ON_NOTE}`));
    expect(lines.filter((l) => l.includes('fillText "On the note"'))).toHaveLength(1);
    expect(at(lines, 'fillText "On the page"')).toBeGreaterThan(text);
  });

  it("turns the note's text with the note", () => {
    const upright = thumb(withText()).find((l) => l.includes('fillText "On the note"'));
    log = new DrawLog();
    globals.createEl = () => log.canvas();
    const turned = thumb(withText(false, Math.PI / 2)).find((l) =>
      l.includes('fillText "On the note"'),
    );
    expect(turned).toBeDefined();
    expect(turned).not.toEqual(upright);
  });

  it("paints a folded note as its icon alone: no paper, no ink, no text", () => {
    const lines = thumb(withText(true));
    expect(at(lines, 'fillText "On the note"')).toBe(-1);
    expect(at(lines, `strokeStyle=${ON_NOTE}`)).toBe(-1);
    expect(lines.some((l) => l.includes("fillRect") && l.includes(`fillStyle=${PAPER}`))).toBe(
      false,
    );
    // The icon: a path filled in the paper's colour.
    expect(lines.some((l) => l.includes(" fill ") && l.includes(`fillStyle=${PAPER}`))).toBe(true);
    expect(at(lines, 'fillText "On the page"')).toBeGreaterThanOrEqual(0);
  });
});
