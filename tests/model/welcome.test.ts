/**
 * `src/model/welcome.ts` — when a new user is greeted, and the welcome
 * notebook they are offered: a cover, the tour pages and a page to try on.
 */

import { describe, expect, it } from "vitest";
import { isCoverRuling } from "../../src/model/document";
import {
  buildNewDocument,
  DEFAULT_NOTEBOOK_CHOICES,
  newNoteBody,
} from "../../src/model/new-notebook";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";
import {
  TRY_IT_TEXT,
  WELCOME_PAGES,
  WELCOME_TITLE,
  buildWelcomeNotebook,
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

describe("buildWelcomeNotebook", () => {
  const doc = buildWelcomeNotebook();

  it("starts with the default notebook's cover, titled", () => {
    const plain = buildNewDocument({ ...DEFAULT_NOTEBOOK_CHOICES }, WELCOME_TITLE);
    expect(doc.pages[0]).toEqual(plain.pages[0]);
    const cover = doc.pages[0];
    expect(cover.backdrop.kind !== "pdf" && isCoverRuling(cover.backdrop.kind)).toBe(true);
    expect(cover.textBoxes.some((box) => box.text === WELCOME_TITLE)).toBe(true);
  });

  it("has the tour pages, then a ruled page to try the pen on", () => {
    expect(doc.pages).toHaveLength(WELCOME_PAGES.length + 2);
    WELCOME_PAGES.forEach((tour, i) => {
      const page = doc.pages[i + 1];
      expect(page.backdrop.kind).toBe("blank");
      const printed = page.backdrop.kind === "pdf" ? [] : (page.backdrop.printed ?? []);
      expect(printed[0]).toMatchObject({ text: tour.title, bold: true });
    });
    const last = doc.pages[doc.pages.length - 1];
    expect(last.backdrop.kind).toBe("ruled-wide");
    const words =
      last.backdrop.kind === "pdf"
        ? ""
        : (last.backdrop.printed ?? []).map((p) => p.text).join(" ");
    expect(words).toBe(TRY_IT_TEXT);
  });

  it("gives every page its own id, and leaves the ink empty", () => {
    const ids = doc.pages.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of doc.pages) {
      expect(page.strokes).toEqual([]);
      expect(page.images).toEqual([]);
    }
  });

  it("keeps every printed line on its page", () => {
    for (const page of doc.pages) {
      if (page.backdrop.kind === "pdf") continue;
      for (const line of page.backdrop.printed ?? []) {
        expect(line.x).toBeGreaterThanOrEqual(0);
        expect(line.y - line.size).toBeGreaterThanOrEqual(0);
        // A line's bottom margin at least as wide as its side margin.
        expect(line.y).toBeLessThanOrEqual(page.geometry.height - 60);
        // wrapPrinted's own measure: half an em a character.
        expect(line.x + line.text.length * line.size * 0.5).toBeLessThanOrEqual(
          page.geometry.width - 40,
        );
      }
    }
  });

  it("names the importer steps for Goodnotes and Notability", () => {
    const text = JSON.stringify(WELCOME_PAGES);
    expect(text).toContain("Goodnotes format");
    expect(text).toContain("Note format");
    expect(text).toContain("Import from another app");
  });

  it("comes back the same from a saved file", () => {
    const file = buildInkFile(newNoteBody(WELCOME_TITLE, "2026-10-16T00:00:00.000Z"), doc);
    const back = parseInkFile(file).doc;
    expect(back?.pages.map((page) => page.backdrop)).toEqual(
      doc.pages.map((page) => page.backdrop),
    );
  });

  it("carries the notebook's own folders, as a new notebook does", () => {
    const withFolders = buildWelcomeNotebook("Welcome", { images: "Welcome/Images" });
    expect(withFolders.folders).toEqual({ images: "Welcome/Images" });
  });
});
