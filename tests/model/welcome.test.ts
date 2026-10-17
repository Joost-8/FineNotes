/**
 * `src/model/welcome.ts` — when a new user is greeted, and the welcome
 * notebook they are offered: a cover, a contents page of links, the tour,
 * and a page left free, all made of ordinary FineNotes elements.
 */

import { describe, expect, it } from "vitest";
import { strokeBounds } from "../../src/model/document";
import { newNoteBody } from "../../src/model/new-notebook";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import { isExternalTarget, textLinkTargets } from "../../src/model/text-links";
import { pageInThisNotebook } from "../../src/search/notebook-search";
import {
  WELCOME_COVER,
  WELCOME_PAGE_TITLES,
  WELCOME_TITLE,
  buildWelcomeNotebook,
  estimateLines,
  shouldShowWelcome,
} from "../../src/model/welcome";

describe("shouldShowWelcome", () => {
  it("greets only a first install in a vault without notebooks", () => {
    expect(shouldShowWelcome(true, false)).toBe(true);
    expect(shouldShowWelcome(true, true)).toBe(false);
    expect(shouldShowWelcome(false, false)).toBe(false);
    expect(shouldShowWelcome(false, true)).toBe(false);
  });
});

describe("estimateLines", () => {
  it("wraps by words and counts each paragraph", () => {
    expect(estimateLines("short", 400, 20)).toBe(1);
    expect(estimateLines("a\nb\nc", 400, 20)).toBe(3);
    expect(estimateLines("word ".repeat(40).trim(), 200, 20)).toBeGreaterThan(5);
  });

  it("counts a link as its shown text", () => {
    const long = `[[#page=3|Go]]`;
    expect(estimateLines(long, 40, 20)).toBe(1);
  });

  it("measures by Arial's widths: narrow letters fit more to a line than wide ones", () => {
    // Thirty "i" (0.222 em each) are one 15 em line; thirty spaced "m" (0.833 em) take three.
    expect(estimateLines("i".repeat(30), 300, 20)).toBe(1);
    expect(estimateLines("m ".repeat(30).trim(), 300, 20)).toBeGreaterThanOrEqual(3);
    expect(estimateLines("m ".repeat(30).trim(), 300, 20, true)).toBeGreaterThanOrEqual(
      estimateLines("m ".repeat(30).trim(), 300, 20),
    );
  });

  it("wraps a little early, never late", () => {
    // Four "abcd" and three spaces are 4 × 2.168 + 3 × 0.278 = 9.506 em: in
    // 9.6 em they would just fit, but the estimate keeps a margin and wraps.
    const text = "abcd abcd abcd abcd";
    expect(estimateLines(text, 9.6 * 20, 20)).toBe(2);
    expect(estimateLines(text, 9.8 * 20, 20)).toBe(1);
  });
});

describe("buildWelcomeNotebook", () => {
  const doc = buildWelcomeNotebook();
  /** A page's index for a link target, as a tap in the notebook resolves it. */
  const resolve = (target: string): number | null =>
    pageInThisNotebook(target, doc.pages.length, () => false);

  it("starts with a cover in the chosen design, titled", () => {
    const cover = doc.pages[0];
    expect(cover.backdrop.kind).toBe(WELCOME_COVER.cover);
    expect(cover.textBoxes.some((box) => box.text === WELCOME_TITLE)).toBe(true);
  });

  it("has a cover, a bookmarked contents page, then the tour", () => {
    expect(doc.pages).toHaveLength(WELCOME_PAGE_TITLES.length + 2);
    expect(doc.pages[1].title).toBe("Contents");
    expect(doc.pages[1].bookmarked).toBe(true);
    expect(doc.pages.slice(2).map((page) => page.title)).toEqual(WELCOME_PAGE_TITLES);
  });

  it("lists every tour page on the contents page, linked to it", () => {
    const targets = doc.pages[1].textBoxes.flatMap((box) => textLinkTargets(box.text));
    const linked = targets.map(resolve);
    for (let i = 2; i < doc.pages.length - 1; i++) expect(linked).toContain(i);
  });

  it("links only to pages that exist, or to the web", () => {
    for (const page of doc.pages) {
      for (const box of page.textBoxes) {
        for (const target of textLinkTargets(box.text)) {
          if (isExternalTarget(target)) continue;
          const index = resolve(target);
          expect(index, `${page.title}: ${target}`).not.toBeNull();
          expect(index).toBeLessThan(doc.pages.length);
        }
      }
    }
  });

  it("ends each tour page with a link back to the contents and on to the next page", () => {
    doc.pages.slice(2).forEach((page, i) => {
      const index = i + 2;
      const targets = page.textBoxes.flatMap((box) => textLinkTargets(box.text));
      expect(targets.map(resolve)).toContain(1);
      const next = page.textBoxes.find((box) => box.text.includes("|Next: "));
      if (index === doc.pages.length - 1) expect(next).toBeUndefined();
      else expect(resolve(textLinkTargets(next?.text ?? "")[0])).toBe(index + 1);
    });
  });

  it("gives every page, stroke and text box its own id", () => {
    const pages = doc.pages.map((page) => page.id);
    const strokes = doc.pages.flatMap((page) => page.strokes.map((s) => s.id));
    const boxes = doc.pages.flatMap((page) => page.textBoxes.map((b) => b.id));
    for (const ids of [pages, strokes, boxes]) expect(new Set(ids).size).toBe(ids.length);
    expect(strokes.every((id) => /^s\d+$/.test(id))).toBe(true);
    expect(boxes.every((id) => /^t\d+$/.test(id))).toBe(true);
  });

  it("keeps every stroke and text box on its page", () => {
    for (const page of doc.pages) {
      const { width, height } = page.geometry;
      for (const stroke of page.strokes) {
        expect(stroke.pts.length % 3).toBe(0);
        const b = strokeBounds(stroke);
        expect(b, page.title).not.toBeNull();
        if (!b) continue;
        expect(b.minX).toBeGreaterThanOrEqual(0);
        expect(b.minY).toBeGreaterThanOrEqual(0);
        expect(b.maxX).toBeLessThanOrEqual(width);
        expect(b.maxY).toBeLessThanOrEqual(height);
      }
      for (const box of page.textBoxes) {
        expect(box.x, `${page.title}: ${box.text}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w, `${page.title}: ${box.text}`).toBeLessThanOrEqual(width);
        expect(box.y, `${page.title}: ${box.text}`).toBeLessThan(height - 40);
      }
    }
  });

  it("fits each tour page's content above the links at its foot", () => {
    for (const page of doc.pages.slice(1)) {
      const foot = Math.min(
        ...page.textBoxes.filter((b) => b.text.includes("‹ Contents")).map((b) => b.y),
        page.geometry.height,
      );
      for (const box of page.textBoxes) {
        if (box.y >= foot) continue;
        const lines = estimateLines(
          box.text,
          box.w - 8 - 2 * (box.border?.width ?? 0),
          box.fontSize,
          box.bold,
        );
        const bottom = box.y + lines * box.fontSize * (box.lineHeight ?? 1.25);
        expect(bottom, `${page.title}: ${box.text.slice(0, 40)}`).toBeLessThan(foot - 10);
      }
    }
  });

  it("explains how to bring notebooks over from Goodnotes and Notability", () => {
    const text = doc.pages.flatMap((page) => page.textBoxes.map((b) => b.text)).join("\n");
    expect(text).toContain("Goodnotes format");
    expect(text).toContain("Note format");
    expect(text).toContain("Import from another app");
  });

  it("shows a heading in the contents, a table, shapes and a highlight", () => {
    expect(doc.pages.some((page) => (page.sections?.length ?? 0) > 0)).toBe(true);
    const strokes = doc.pages.flatMap((page) => page.strokes);
    const kinds = new Set(strokes.map((s) => s.shape).filter(Boolean));
    for (const kind of [
      "line",
      "arrow",
      "rect",
      "circle",
      "ellipse",
      "triangle",
      "diamond",
      "star",
      "cloud",
    ]) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
    expect(strokes.some((s) => s.tool === "highlighter")).toBe(true);
  });

  it("draws its cards as filled, rounded shapes with plain text on them", () => {
    const tour = doc.pages.slice(1);
    // No text box pads itself with a thick border, and only the Text boxes
    // page's own example of a styled box has a fill.
    const boxes = tour.flatMap((page) => page.textBoxes.map((box) => ({ page, box })));
    expect(boxes.filter(({ box }) => (box.border?.width ?? 0) > 4)).toEqual([]);
    expect(boxes.filter(({ box }) => box.fill).map(({ page }) => page.title)).toEqual([
      "Text boxes",
    ]);
    // Every card (a filled, rounded, solid-lined rectangle) carries a text
    // box inside it, whose estimated lines end inside it too.
    const cards = tour.flatMap((page) =>
      page.strokes
        .filter((s) => s.shape === "rect" && s.fill && (s.radius ?? 0) > 0 && !s.dash)
        .map((s) => ({ page, stroke: s })),
    );
    expect(cards.length).toBeGreaterThan(40);
    for (const { page, stroke } of cards) {
      const b = strokeBounds(stroke);
      if (!b) throw new Error("a card without bounds");
      const on = page.textBoxes.find(
        (box) => box.x > b.minX && box.x + box.w < b.maxX && box.y > b.minY && box.y < b.maxY,
      );
      expect(on, `${page.title}: card at y ${b.minY}`).toBeDefined();
      if (!on) continue;
      const lines = estimateLines(on.text, on.w - 8, on.fontSize, on.bold);
      expect(on.y + lines * on.fontSize * (on.lineHeight ?? 1.25)).toBeLessThan(b.maxY);
    }
  });

  it("marks practice areas as dashed, softly filled frames", () => {
    const zones = doc.pages.flatMap((page) =>
      page.strokes.filter((s) => s.shape === "rect" && s.dash === "dash"),
    );
    expect(zones.length).toBeGreaterThanOrEqual(10);
    for (const zone of zones) expect(zone.fill).toMatch(/^#[0-9a-f]{8}$/);
  });

  it("draws sync as arrows with a filled head at both ends", () => {
    const both = doc.pages
      .flatMap((page) => page.strokes)
      .filter((s) => s.shape === "line" && s.heads?.start === "filled" && s.heads.end === "filled");
    expect(both).toHaveLength(2);
  });

  it("is the same notebook every time", () => {
    expect(buildWelcomeNotebook()).toEqual(doc);
  });

  it("comes back the same from a saved file", () => {
    const file = buildInkFile(newNoteBody(WELCOME_TITLE, "2026-10-16T00:00:00.000Z"), doc);
    const back = parseInkFile(file).doc;
    expect(back?.pages).toEqual(doc.pages);
  });

  it("carries the notebook's own folders, as a new notebook does", () => {
    const withFolders = buildWelcomeNotebook("Welcome", { images: "Welcome/Images" });
    expect(withFolders.folders).toEqual({ images: "Welcome/Images" });
  });
});
