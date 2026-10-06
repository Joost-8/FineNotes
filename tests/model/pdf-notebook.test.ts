/**
 * `buildPdfNotebook` — "New notebook from PDF" (#14): a notebook whose pages
 * are a vault PDF's pages, pointing at the PDF where it is.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_NOTEBOOK_CHOICES, buildPdfNotebook } from "../../src/model/new-notebook";
import { sizeGeometry } from "../../src/model/templates";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const A4 = { width: 595, height: 842 };
const SLIDE = { width: 960, height: 540 };

describe("buildPdfNotebook", () => {
  it("has one page per PDF page, in order, and nothing else", () => {
    const doc = buildPdfNotebook(
      { ...DEFAULT_NOTEBOOK_CHOICES, cover: "cover-label" },
      "Week 1",
      undefined,
      "Courses/Week 1.pdf",
      [A4, SLIDE, A4],
    );
    expect(doc.pages.map((page) => page.id)).toEqual(["p1", "p2", "p3"]);
    expect(doc.pages.map((page) => page.backdrop)).toEqual(
      [0, 1, 2].map((page) => ({
        kind: "pdf",
        path: "Courses/Week 1.pdf",
        page,
      })),
    );
    expect(doc.pages.every((page) => page.textBoxes.length === 0)).toBe(true);
    expect(doc.single).toBeUndefined();
  });

  it("sizes pages from the chosen paper, turned to each PDF page", () => {
    const base = sizeGeometry(DEFAULT_NOTEBOOK_CHOICES.size, false);
    const short = Math.min(base.width, base.height);
    const doc = buildPdfNotebook(DEFAULT_NOTEBOOK_CHOICES, "", undefined, "a.pdf", [A4, SLIDE]);
    expect(doc.pages[0].geometry).toEqual({
      width: short,
      height: Math.round((short * 842) / 595),
    });
    expect(doc.pages[1].geometry).toEqual({
      width: Math.round((short * 960) / 540),
      height: short,
    });
    expect(doc.view.width).toBe(short);
  });

  it("is a notebook even when the last choice was a single page", () => {
    const doc = buildPdfNotebook(
      { ...DEFAULT_NOTEBOOK_CHOICES, type: "single" },
      "",
      undefined,
      "a.pdf",
      [A4],
    );
    expect(doc.single).toBeUndefined();
  });

  it("keeps the notebook's own folders", () => {
    const folders = { images: "Week 1/Images" };
    const doc = buildPdfNotebook(DEFAULT_NOTEBOOK_CHOICES, "", folders, "a.pdf", [A4]);
    expect(doc.folders).toEqual(folders);
  });

  it("falls back to an ordinary notebook for a PDF without pages", () => {
    const doc = buildPdfNotebook(DEFAULT_NOTEBOOK_CHOICES, "", undefined, "a.pdf", []);
    expect(doc.pages.length).toBeGreaterThan(0);
    expect(doc.pages.every((page) => page.backdrop.kind !== "pdf")).toBe(true);
  });

  it("survives a save and a load unchanged", () => {
    const doc = buildPdfNotebook(DEFAULT_NOTEBOOK_CHOICES, "", undefined, "a.pdf", [A4, SLIDE]);
    expect(decodeDocument(encodeDocument(doc))).toEqual(doc);
  });
});
