/**
 * A paper's style (`src/canvas/paper-style.ts`): any paper colour, the rule
 * colour and the spacing, set on the template's backdrop and read back.
 */

import { describe, expect, it } from "vitest";
import { resolveSpacing } from "../../src/canvas/backdrop";
import {
  PAPER_SWATCHES,
  RULE_SWATCHES,
  SPACING_STEPS,
  isDarkPaper,
  paperStyleOf,
  styledBackdrop,
} from "../../src/canvas/paper-style";
import { templateBackdrop } from "../../src/model/templates";

describe("styledBackdrop", () => {
  it("is the plain template with no style", () => {
    expect(styledBackdrop("ruled-wide", "white")).toEqual(templateBackdrop("ruled-wide", "white"));
    expect(styledBackdrop("squared", "yellow", {})).toEqual(templateBackdrop("squared", "yellow"));
  });

  it("puts the page on any paper colour; white stores nothing", () => {
    expect(styledBackdrop("ruled-wide", "white", { paper: "#EEF7F1" }).paperColor).toBe("#eef7f1");
    expect(styledBackdrop("ruled-wide", "yellow", { paper: "#ffffff" }).paperColor).toBeUndefined();
    expect(styledBackdrop("ruled-wide", "white", { paper: "mint" }).paperColor).toBeUndefined();
  });

  it("gives a dark paper rules that show on it, and a light one back its template's", () => {
    expect(styledBackdrop("ruled-wide", "white", { paper: "#26272b" }).color).toBe("#4a4d56");
    expect(styledBackdrop("ruled-wide", "dark", { paper: "#ffffff" }).color).toBeUndefined();
    expect(styledBackdrop("ruled-wide", "white", { paper: "#26272b", rule: "#9aa0ab" }).color).toBe(
      "#9aa0ab",
    );
  });

  it("scales the template's own spacing, in whole page px", () => {
    const own = resolveSpacing(undefined, "ruled-wide");
    expect(styledBackdrop("ruled-wide", "white", { spacing: 1.25 }).spacing).toBe(
      Math.round(own * 1.25),
    );
    expect(styledBackdrop("ruled-wide", "white", { spacing: 1 }).spacing).toBeUndefined();
    expect(styledBackdrop("squared", "white", { spacing: 0.01 }).spacing).toBe(8);
    expect(styledBackdrop("squared", "white", { spacing: Number.NaN }).spacing).toBeUndefined();
  });
});

describe("paperStyleOf", () => {
  it("reads back each style the picker can set", () => {
    for (const step of SPACING_STEPS) {
      const style = { paper: "#f3f0fb", rule: "#b8cde8", spacing: step.k };
      const back = paperStyleOf(styledBackdrop("ruled-narrow", "white", style));
      expect(back).toEqual(step.k === 1 ? { paper: "#f3f0fb", rule: "#b8cde8" } : style);
    }
  });

  it("does not mistake a template's own rule colour for a picked one", () => {
    expect(paperStyleOf(templateBackdrop("ruled-wide", "dark")).rule).toBeUndefined();
  });
});

describe("the swatches", () => {
  it("offer readable, distinct colours, and dark papers are known as dark", () => {
    expect(new Set(PAPER_SWATCHES.map((s) => s.color)).size).toBe(PAPER_SWATCHES.length);
    expect(RULE_SWATCHES[0].color).toBeNull();
    expect(isDarkPaper("#26272b")).toBe(true);
    expect(isDarkPaper("#fbf8ed")).toBe(false);
    expect(isDarkPaper("nonsense")).toBe(false);
  });
});
