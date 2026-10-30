/**
 * Dark pages in the renderer (`src/canvas/renderer.ts`): what a page is
 * painted with when the paper theme is dark, and what is never touched.
 *
 * - Ink, text and text box fills are shown through `nightColor`, the
 *   highlighter through `nightHighlighter` and a screen blend.
 * - A page whose paper is already dark is painted exactly as by day.
 * - Pictures are handed to their painter as they are.
 * - The document is never changed: dark pages are a view, not an edit.
 * - The stroke outlines (`Path2D`) hold no colour, so switching the theme
 *   re-uses them; the tiles, which hold colour, are emptied.
 *
 * `draw-log.ts` records every draw with the style it was made in.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DARK_PAPER, LIGHT_PAPER, paperTheme } from "../../src/canvas/backdrop";
import { NIGHT_PAPER, nightColor, nightHighlighter } from "../../src/canvas/night";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import {
  type BackdropPainter,
  type ImagePainter,
  Renderer,
  paperColorOf,
  renderPageThumbnail,
  styleOf,
} from "../../src/canvas/renderer";
import { type InkDocument, type Page, blankPage, emptyDocument } from "../../src/model/document";
import { DrawLog, LoggedPath2D } from "./draw-log";

const globals = globalThis as unknown as Record<string, unknown>;
let log: DrawLog;
let paths = 0;

beforeEach(() => {
  log = new DrawLog();
  paths = 0;
  globals.Path2D = class extends LoggedPath2D {
    constructor() {
      super();
      paths++;
    }
  };
  globals.createEl = () => log.canvas();
});

afterEach(() => {
  delete globals.Path2D;
  delete globals.createEl;
});

const INK = "#1a1a1a";
const RED = "#e03131";
const HIGHLIGHT = "#fff3bf";
const NAVY = "#1f3a5f";

function line(y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 30; i++) out.push(60 + i * 10, y + 4 * Math.sin(i / 3), 0.5);
  return out;
}

function page(id: string, paperColor?: string): Page {
  return {
    ...blankPage(id, { width: 400, height: 500 }),
    backdrop: { kind: "ruled-wide", ...(paperColor ? { paperColor } : {}) },
    strokes: [
      { id: `${id}-ink`, color: INK, size: 3, tool: "pen", pts: line(100) },
      { id: `${id}-red`, color: RED, size: 3, tool: "pen", pts: line(160) },
      { id: `${id}-hl`, color: HIGHLIGHT, size: 12, tool: "highlighter", pts: line(100) },
    ],
    images: [{ id: `${id}-pic`, path: "photo.png", x: 40, y: 300, w: 120, h: 90 }],
    textBoxes: [
      {
        id: `${id}-t`,
        x: 40,
        y: 220,
        w: 200,
        text: "Night",
        color: RED,
        fill: "#d0ebff",
        fontSize: 18,
      },
    ],
  };
}

function painters(): { backdrop: BackdropPainter; images: ImagePainter } {
  return {
    backdrop: {
      paint: (ctx, backdrop, _geometry, _weight, target) =>
        log.write(`${log.nameOf(ctx)} painter ${backdrop.kind} night=${!!target?.paper?.night}`),
    },
    images: {
      paintImage: (ctx, image) => log.write(`${log.nameOf(ctx)} image ${image.id} untouched`),
    },
  };
}

function thumbnail(p: Page, paper: typeof LIGHT_PAPER): string[] {
  const { backdrop, images } = painters();
  renderPageThumbnail(log.canvas("thumb"), p, backdrop, 100, 1, {
    usePressure: false,
    paper,
    images,
  });
  return log.lines.filter((l) => l.startsWith("thumb "));
}

const styles = (lines: string[], key: string): string[] =>
  lines.flatMap((l) => {
    const m = new RegExp(`${key}=([^ }]+(?: [^ }=]+\\))?)`).exec(l);
    return m ? [m[1]] : [];
  });

describe("a page painted on dark pages", () => {
  it("shows ink, text and fills through nightColor, the highlighter screened", () => {
    const lines = thumbnail(page("a"), DARK_PAPER);
    const fills = styles(lines, "fillStyle");
    expect(fills[0]).toBe(NIGHT_PAPER);
    expect(fills).toContain(nightColor(INK));
    expect(fills).toContain(nightColor(RED));
    expect(fills).toContain(nightHighlighter(HIGHLIGHT));
    expect(fills).toContain(nightColor("#d0ebff"));
    expect(fills).not.toContain(INK);
    expect(fills).not.toContain(RED);
    expect(lines.join("\n")).toContain("globalCompositeOperation=screen");
    expect(lines.join("\n")).not.toContain("globalCompositeOperation=multiply");
    expect(log.lines).toContain("thumb painter ruled-wide night=true");
    expect(log.lines).toContain("thumb image a-pic untouched");
  });

  it("by day paints every colour as stored, the highlighter multiplied", () => {
    const lines = thumbnail(page("a"), LIGHT_PAPER);
    const fills = styles(lines, "fillStyle");
    expect(fills[0]).toBe("#ffffff");
    expect(fills).toContain(INK);
    expect(fills).toContain(RED);
    expect(fills).toContain(HIGHLIGHT);
    expect(lines.join("\n")).toContain("globalCompositeOperation=multiply");
    expect(lines.join("\n")).not.toContain("globalCompositeOperation=screen");
  });

  it("leaves a page whose paper is already dark exactly as by day", () => {
    const navy = page("n", NAVY);
    const day = thumbnail(navy, LIGHT_PAPER);
    log.lines.length = 0;
    const night = thumbnail(navy, DARK_PAPER);
    expect(night.filter((l) => !l.includes("painter"))).toEqual(
      day.filter((l) => !l.includes("painter")),
    );
    expect(paperColorOf(navy, DARK_PAPER)).toBe(NAVY);
  });

  it("darkens a coloured paper, keeping its hue", () => {
    expect(paperColorOf(page("c", "#fdf6d8"), DARK_PAPER)).toBe(nightColor("#fdf6d8"));
  });

  it("never changes the document", () => {
    const p = page("a");
    const before = JSON.stringify(p);
    thumbnail(p, DARK_PAPER);
    thumbnail(p, paperTheme(true, true));
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("the renderer switching theme", () => {
  const LAYOUT: DocumentLayout = {
    boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 400, height: 500 }],
    width: 400,
    height: 500,
    direction: "vertical",
    fitWidth: 400,
  };

  function setUp(): { renderer: Renderer; doc: InkDocument } {
    const doc = emptyDocument(400);
    doc.pages = [page("a")];
    const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
    renderer.resize(400, 500, 1);
    renderer.setLayout(LAYOUT);
    renderer.setPainter(painters().backdrop);
    renderer.setViewport({ scrollY: 0, scale: 1, width: 400 }, 0);
    return { renderer, doc };
  }

  it("re-uses every stroke outline, and paints the tiles again in the new colours", () => {
    const { renderer, doc } = setUp();
    renderer.renderDocument(doc, false);
    const traced = paths;
    expect(traced).toBeGreaterThan(0);
    renderer.paper = DARK_PAPER;
    renderer.invalidateAll();
    log.lines.length = 0;
    renderer.renderDocument(doc, false);
    expect(paths).toBe(traced);
    expect(styles(log.lines, "strokeStyle")).toContain(nightColor(INK));
  });

  it("shows the stroke being written in its night colour on a night page", () => {
    const { renderer, doc } = setUp();
    renderer.paper = DARK_PAPER;
    renderer.renderBackdrops(doc);
    log.lines.length = 0;
    renderer.renderWet(0, line(300), styleOf(doc.pages[0].strokes[1], false));
    expect(styles(log.lines, "fillStyle")).toContain(nightColor(RED));
    expect(styles(log.lines, "fillStyle")).not.toContain(RED);
  });

  it("shows a lassoed selection being dragged in its night colours", () => {
    const { renderer, doc } = setUp();
    renderer.paper = DARK_PAPER;
    renderer.renderBackdrops(doc);
    log.lines.length = 0;
    renderer.renderSelectionDraft(0, doc.pages[0].strokes, [], 10, 10, false);
    const strokes = styles(log.lines, "strokeStyle");
    expect(strokes).toContain(nightColor(INK));
    expect(strokes).toContain(nightHighlighter(HIGHLIGHT));
    expect(strokes).not.toContain(INK);
  });

  it("paints the desk and the page on it in the dark theme's colours", () => {
    const { renderer, doc } = setUp();
    renderer.paper = DARK_PAPER;
    // The backdrop layer holds the desk; the page lies on the dry layer.
    renderer.renderBackdrops(doc);
    expect(styles(log.lines, "fillStyle")).toEqual([DARK_PAPER.desk]);
    log.lines.length = 0;
    renderer.renderDocument(doc, false);
    const fills = styles(log.lines, "fillStyle");
    expect(fills).toContain(DARK_PAPER.desk);
    expect(fills).toContain(NIGHT_PAPER);
  });

  it("paints the backdrop layer again only when the desk changes", () => {
    const { renderer, doc } = setUp();
    renderer.renderBackdrops(doc);
    log.lines.length = 0;
    // A scroll frame: nothing changed under the pages.
    renderer.renderBackdrops(doc);
    expect(log.lines).toEqual([]);
    renderer.paper = DARK_PAPER;
    renderer.renderBackdrops(doc);
    expect(styles(log.lines, "fillStyle")).toEqual([DARK_PAPER.desk]);
  });
});

describe("the eyedropper's sample", () => {
  const LAYOUT: DocumentLayout = {
    boxes: [{ index: 0, id: "a", x: 0, y: 0, width: 400, height: 500 }],
    width: 400,
    height: 500,
    direction: "vertical",
    fitWidth: 400,
  };

  function sample(paper: typeof LIGHT_PAPER): { data: Uint8ClampedArray | null; theme: unknown } {
    const renderer = new Renderer(log.canvas("bd"), log.canvas("dry"), log.canvas("wet"), false);
    renderer.setLayout(LAYOUT);
    renderer.setPainter(painters().backdrop);
    renderer.setImagePainter(painters().images);
    renderer.paper = paper;
    log.lines.length = 0;
    // Device px (110, 196)-(115, 201) at 2 device px a page px: on the black ink at y = 100.
    const data = renderer.samplePage(
      page("a"),
      LAYOUT.boxes[0],
      { x: 110, y: 196, size: 5 },
      2,
      false,
    );
    return { data, theme: renderer.paper };
  }

  it("paints the square on the day's paper even with dark pages, and leaves the view dark", () => {
    const { data, theme } = sample(DARK_PAPER);
    expect(theme).toBe(DARK_PAPER);
    expect(data).toHaveLength(5 * 5 * 4);
    const lines = log.lines.filter((l) => l.startsWith("el"));
    const fills = styles(lines, "fillStyle");
    expect(fills[0]).toBe("#ffffff");
    expect(styles(lines, "strokeStyle")).toContain(INK);
    expect(styles(lines, "strokeStyle")).not.toContain(nightColor(INK));
    expect(log.lines.some((l) => l.endsWith("painter ruled-wide night=false"))).toBe(true);
    expect(log.lines.some((l) => /el\d+ getImageData 0,0 5x5/.test(l))).toBe(true);
  });

  it("draws only what is near the square, in device px", () => {
    sample(LIGHT_PAPER);
    expect(log.lines.some((l) => l.includes("el1.width = 5"))).toBe(true);
    // The picture at y 300-390 is far from the square: not drawn.
    expect(log.lines.some((l) => l.includes("image a-pic"))).toBe(false);
  });
});
