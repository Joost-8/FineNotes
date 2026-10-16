import { describe, expect, it } from "vitest";
import {
  buildWelcomeNotebook,
  estimateHeight,
  WELCOME_PAGES,
  WELCOME_TITLE,
} from "../../src/model/welcome";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { newNoteBody } from "../../src/model/new-notebook";

describe("welcome notebook", () => {
  const doc = buildWelcomeNotebook();

  it("opens on a cover with the title, then one lined page per topic", () => {
    expect(doc.pages).toHaveLength(1 + WELCOME_PAGES.length);
    const [cover, ...pages] = doc.pages;
    expect(cover.textBoxes.some((t) => t.text === WELCOME_TITLE)).toBe(true);
    expect(pages.map((p) => p.backdrop.kind)).toEqual(pages.map(() => "ruled-wide"));
    expect(doc.pages.map((p) => p.id)).toEqual(doc.pages.map((_, i) => `p${i + 1}`));
    pages.forEach((page, i) => {
      expect(page.textBoxes[0]).toMatchObject({ text: WELCOME_PAGES[i].heading, bold: true });
      expect(page.textBoxes.slice(1).map((t) => t.text)).toEqual(WELCOME_PAGES[i].lines);
      expect(page.strokes).toEqual([]);
    });
  });

  it("lays its text out top to bottom inside the page, leaving room to write", () => {
    const ids = new Set<string>();
    for (const page of doc.pages.slice(1)) {
      let bottom = 0;
      for (const box of page.textBoxes) {
        expect(ids.has(box.id)).toBe(false);
        ids.add(box.id);
        expect(box.y).toBeGreaterThanOrEqual(bottom);
        expect(box.x + box.w).toBeLessThanOrEqual(page.geometry.width);
        bottom = box.y + estimateHeight(box.text, box.fontSize, box.w);
      }
      // At least a third of the page is left for trying things out.
      expect(bottom).toBeLessThan((page.geometry.height * 2) / 3);
    }
  });

  it("estimates wrapped height from the text's length", () => {
    expect(estimateHeight("short", 20, 800)).toBe(25);
    expect(estimateHeight("x".repeat(200), 20, 800)).toBe(75);
    expect(estimateHeight("", 20, 1)).toBe(25);
  });

  it("is a notebook FineNotes reads back unchanged", () => {
    const back = parseInkFile(buildInkFile(newNoteBody(WELCOME_TITLE, "2026-10-16"), doc)).doc;
    expect(back?.pages.map((p) => p.textBoxes.map((t) => t.text))).toEqual(
      doc.pages.map((p) => p.textBoxes.map((t) => t.text)),
    );
  });
});
