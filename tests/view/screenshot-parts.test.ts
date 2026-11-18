/**
 * What a lasso screenshot includes (`src/view/screenshot-parts.ts`,
 * FineNotes#211): the page on its own leaves every stroke out and keeps
 * everything else, without touching the document.
 */

import { describe, expect, it } from "vitest";
import { blankPage, type Page } from "../../src/model/document";
import {
  SCREENSHOT_PARTS,
  SCREENSHOT_PART_ICONS,
  pageWithoutInk,
} from "../../src/view/screenshot-parts";

function inkedPage(): Page {
  const page = blankPage("q7");
  page.strokes.push(
    { id: "a", tool: "pen", color: "#112233", size: 3, pts: [1, 2, 0.5, 30, 40, 0.5] },
    { id: "b", tool: "highlighter", color: "#ffee00", size: 9, pts: [5, 5, 0.5, 90, 5, 0.5] },
  );
  page.images.push({ id: "i1", path: "cat.png", x: 10, y: 10, w: 50, h: 40 });
  page.connectors = [{ id: "c1", from: { shape: "a" }, to: { shape: "b" } }] as never;
  return page;
}

describe("pageWithoutInk", () => {
  it("drops strokes and the arrows joining them, keeps pictures and paper", () => {
    const page = inkedPage();
    const bare = pageWithoutInk(page);
    expect(bare.strokes).toEqual([]);
    expect(bare.connectors).toBeUndefined();
    expect(bare.images).toBe(page.images);
    expect(bare.backdrop).toBe(page.backdrop);
    expect(bare.geometry).toBe(page.geometry);
  });

  it("leaves the page it was given alone", () => {
    const page = inkedPage();
    pageWithoutInk(page);
    expect(page.strokes.map((s) => s.id)).toEqual(["a", "b"]);
    expect(page.connectors).toHaveLength(1);
  });
});

describe("SCREENSHOT_PARTS", () => {
  it("offers everything first, each with its own icon", () => {
    expect(SCREENSHOT_PARTS[0]).toBe("all");
    const icons = SCREENSHOT_PARTS.map((part) => SCREENSHOT_PART_ICONS[part]);
    expect(new Set(icons).size).toBe(SCREENSHOT_PARTS.length);
  });
});
