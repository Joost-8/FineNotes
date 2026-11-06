/**
 * A margin's paper follows the page's spacing (`src/canvas/margin-paper.ts`,
 * FineNotes#164): its lines are level with the page's at any pitch, a PDF
 * page's margin keeps the margin paper's own, and a pitch set in the Margin
 * popover wins.
 */

import { describe, expect, it } from "vitest";
import {
  defaultMarginSpacing,
  followedSpacing,
  marginPaper,
  marginSpacing,
  storedMarginSpacing,
} from "../../src/canvas/margin-paper";
import {
  emptyDocument,
  type Backdrop,
  type InkDocument,
  type Page,
} from "../../src/model/document";
import { SetPageMargin } from "../../src/model/page-margin";
import { ruledArea } from "../../src/model/paper-extras";

function pageWith(backdrop: Backdrop): { doc: InkDocument; page: Page } {
  const doc = emptyDocument();
  const page = doc.pages[0];
  page.geometry = { width: 1000, height: 1400 };
  page.backdrop = backdrop;
  page.strokes = [];
  page.images = [];
  page.textBoxes = [];
  return { doc, page };
}

function withMargin(
  backdrop: Backdrop,
  paper: "lined" | "grid" | "dotted",
  spacing?: number,
): Page {
  const { doc, page } = pageWith(backdrop);
  new SetPageMargin([
    { page, margin: { left: 200, right: 300 }, paper, ...(spacing ? { spacing } : {}) },
  ]).apply(doc);
  return page;
}

/** The y of every rule a synthetic paper draws from its top, as `horizontalRules` steps. */
function rules(start: number, pitch: number, height: number): number[] {
  const ys: number[] = [];
  for (let y = start + pitch; y < height; y += pitch) ys.push(Math.round(y));
  return ys;
}

describe("the margin's pitch", () => {
  it("is the page's spacing on an evenly ruled page, at every preset", () => {
    for (const spacing of [32, 40, 50, 60, 34.13]) {
      const page = withMargin({ kind: "ruled-wide", spacing }, "lined");
      expect(marginSpacing(page)).toBe(spacing);
      expect(marginPaper(page)).toEqual({ kind: "ruled-wide", spacing });
    }
    // A template's own pitch when it stores none: narrow rules are 28 apart.
    expect(marginSpacing(withMargin({ kind: "ruled-narrow" }, "lined"))).toBe(28);
    // Grid and dots in the margin of a lined page sit on its lines too.
    expect(marginSpacing(withMargin({ kind: "ruled-wide" }, "grid"))).toBe(40);
  });

  it("keeps the margin paper's own on a PDF page and on papers with a layout of their own", () => {
    const pdf: Backdrop = { kind: "pdf", path: "Slides.pdf", page: 0 };
    expect(marginSpacing(withMargin(pdf, "lined"))).toBe(40);
    expect(marginSpacing(withMargin(pdf, "grid"))).toBe(28);
    expect(followedSpacing(withMargin(pdf, "grid"))).toBeNull();
    expect(marginSpacing(withMargin({ kind: "music" }, "lined"))).toBe(40);
    expect(marginSpacing(withMargin({ kind: "todos", spacing: 60 }, "dotted"))).toBe(40);
  });

  it("is the one set in the popover when there is one", () => {
    const page = withMargin({ kind: "ruled-wide", spacing: 50 }, "lined", 30);
    expect(marginSpacing(page)).toBe(30);
    expect(marginPaper(page)).toEqual({ kind: "ruled-wide", spacing: 30 });
  });

  it("is nothing on plain paper, or without a margin", () => {
    const { page } = pageWith({ kind: "ruled-wide", spacing: 50 });
    expect(marginSpacing(page)).toBeNull();
    expect(marginPaper(page)).toBeNull();
    expect(defaultMarginSpacing(page, "plain")).toBeNull();
  });
});

describe("storedMarginSpacing", () => {
  it("stores nothing for the pitch the margin draws anyway, else the pitch to a hundredth", () => {
    const page = withMargin({ kind: "ruled-wide", spacing: 50 }, "lined");
    expect(storedMarginSpacing(page, "lined", 50)).toBeNull();
    expect(storedMarginSpacing(page, "grid", 50.001)).toBeNull();
    expect(storedMarginSpacing(page, "lined", 34.13333)).toBe(34.13);
    const pdf = withMargin({ kind: "pdf", path: "Slides.pdf", page: 0 }, "grid");
    expect(storedMarginSpacing(pdf, "grid", 28)).toBeNull();
    expect(storedMarginSpacing(pdf, "lined", 28)).toBe(28);
  });
});

describe("the margin's lines are level with the page's", () => {
  it("on a designed paper whose ruling starts below a top margin", () => {
    const backdrop: Backdrop = { kind: "ruled-wide", spacing: 34.13, margins: { top: 97.52 } };
    const page = withMargin(backdrop, "lined");
    const paper = marginPaper(page);
    if (!paper) throw new Error("no margin paper");
    const pageArea = ruledArea(backdrop, { width: 500, height: 1400 });
    const marginArea = ruledArea(paper, { width: 300, height: 1400 });
    const pageRules = rules(pageArea?.y ?? 0, 34.13, 1400);
    const marginRules = rules(marginArea?.y ?? 0, 34.13, 1400);
    // Every rule on the page has its twin in the margin, within the rounding of a page px.
    for (const y of pageRules) {
      expect(marginRules.some((m) => Math.abs(m - y) <= 1)).toBe(true);
    }
    // And the margin is ruled above it too, at the same pitch.
    expect(marginRules[0]).toBeLessThan(pageRules[0]);
  });

  it("from the top on an ordinary page: nothing to shift", () => {
    expect(
      marginPaper(withMargin({ kind: "squared", spacing: 35 }, "grid"))?.margins,
    ).toBeUndefined();
  });
});
