/**
 * Add space on a notebook's surface: after the page widens, and after an
 * undo takes the space back, the surface lays the pages out again
 * (`layoutStale`), so the page's box follows its size instead of keeping the
 * old one on screen (the page stayed wide after Undo on the iPad).
 */
import { describe, expect, it, vi } from "vitest";
import { emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { AddPageSpace } from "../../src/model/side-space";
import { layoutPages } from "../../src/canvas/page-layout";

vi.mock("obsidian", () => ({
  Notice: class {},
  Platform: {},
  setIcon: () => {},
}));

const { InkSurface } = await import("../../src/view/ink-surface");

function layoutStale(surface: object): boolean {
  const fn = (InkSurface.prototype as unknown as Record<string, () => boolean>)["layoutStale"];
  return fn.call(surface);
}

describe("Add space on the surface", () => {
  it("lays the page out again after Add space and after its undo", () => {
    const doc = emptyDocument();
    doc.pages[0].backdrop = { kind: "pdf", path: "Slides.pdf", page: 0 };
    const history = new History();
    const surface = Object.assign(Object.create(InkSurface.prototype) as object, {
      doc,
      history,
      board: false,
      direction: "vertical",
      joined: false,
      pageLayout: layoutPages(doc.pages),
    }) as Record<string, unknown>;
    const width = doc.pages[0].geometry.width;

    history.push(doc, new AddPageSpace(doc.pages[0], "left", { kind: "blank" }));
    expect(doc.pages[0].geometry.width).toBe(width * 2);
    expect(layoutStale(surface)).toBe(true);
    surface.pageLayout = layoutPages(doc.pages);
    expect(layoutStale(surface)).toBe(false);

    history.undo(doc);
    expect(doc.pages[0].geometry.width).toBe(width);
    // The box is still the wide one: the surface must lay it out again.
    expect(layoutStale(surface)).toBe(true);
  });
});
