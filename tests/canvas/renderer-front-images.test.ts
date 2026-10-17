/**
 * Pictures in front of the ink (`ImageElement.front`): painted after the
 * strokes on the page's tiles and in thumbnails, kept through a save, and
 * undone exactly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentLayout } from "../../src/canvas/page-layout";
import { type ImagePainter, Renderer, renderPageThumbnail } from "../../src/canvas/renderer";
import { type Page, blankPage, emptyDocument } from "../../src/model/document";
import { SetImageFront } from "../../src/model/image-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
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

const INK = "#1a1a1a";

function page(): Page {
  const pts: number[] = [];
  for (let i = 0; i < 20; i++) pts.push(40 + i * 10, 100, 0.5);
  return {
    ...blankPage("a", { width: 400, height: 400 }),
    strokes: [{ id: "ink", color: INK, size: 3, tool: "pen", pts }],
    images: [
      { id: "under", path: "a.png", x: 30, y: 60, w: 100, h: 80 },
      { id: "over", path: "b.png", x: 150, y: 60, w: 100, h: 80, front: true },
    ],
  };
}

const painter: ImagePainter = {
  paintImage: (ctx, image) => log.write(`${log.nameOf(ctx)} image ${image.id}`),
};

/** The order of pictures and ink strokes in `lines` drawn on `canvas`. */
function order(lines: readonly string[], canvas: string): string[] {
  return lines
    .filter((l) => l.startsWith(`${canvas} `))
    .flatMap((l) => {
      if (l.includes(" image ")) return [l.split(" image ")[1]];
      if (l.includes(" stroke ") && l.includes(`strokeStyle=${INK}`)) return ["ink"];
      return [];
    })
    .filter((v, i, all) => all.indexOf(v) === i);
}

describe("a picture in front of the ink", () => {
  it("is painted after the strokes in a thumbnail, the other one before", () => {
    renderPageThumbnail(log.canvas("thumb"), page(), { paint: () => undefined }, 400, 1, {
      usePressure: false,
      images: painter,
    });
    expect(order(log.lines, "thumb")).toEqual(["under", "ink", "over"]);
  });

  it("is painted after the strokes on the page's tiles", () => {
    const doc = emptyDocument(400);
    doc.pages = [page()];
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
    renderer.setImagePainter(painter);
    renderer.setViewport({ scrollY: 0, scale: 1, width: 400 }, 0);
    renderer.renderDocument(doc, false);
    // Each tile is its own canvas: in every one that shows them, the order holds.
    const canvases = new Set(
      log.lines.map((l) => l.split(" ")[0]).filter((n) => /^el\d+$/.test(n)),
    );
    let checked = 0;
    for (const name of canvases) {
      const seen = order(log.lines, name);
      if (seen.includes("over") && seen.includes("ink")) {
        expect(seen.indexOf("over")).toBeGreaterThan(seen.indexOf("ink"));
        checked++;
      }
      if (seen.includes("under") && seen.includes("ink")) {
        expect(seen.indexOf("under")).toBeLessThan(seen.indexOf("ink"));
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("survives a save, and an opaque one stays without the key", () => {
    const doc = emptyDocument(400);
    doc.pages = [page()];
    const [under, over] = decodeDocument(encodeDocument(doc)).pages[0].images;
    expect(over.front).toBe(true);
    expect("front" in under).toBe(false);
  });

  it("goes back under the ink, and undo puts it in front again exactly", () => {
    const doc = emptyDocument(400);
    doc.pages = [page()];
    const over = doc.pages[0].images[1];
    const before = JSON.stringify(over);
    const back = new SetImageFront("a", over, false);
    back.apply(doc);
    expect("front" in over).toBe(false);
    back.invert(doc);
    expect(JSON.stringify(over)).toBe(before);
  });
});
