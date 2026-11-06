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
  spacingMm,
  spacingOf,
  styledBackdrop,
  typedSpacing,
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

  it("keeps a pitch no step gives exactly, instead of snapping it to the nearest step", () => {
    // 52 on Ruled Wide is near Roomy (50): reopening on Roomy would be a silent lie.
    expect(paperStyleOf({ kind: "ruled-wide", spacing: 52 })).toEqual({ pitch: 52 });
    expect(paperStyleOf({ kind: "ruled-wide", spacing: 50 })).toEqual({ spacing: 1.25 });
    expect(paperStyleOf({ kind: "ruled-wide", spacing: 40 })).toEqual({});
  });

  it("does not mistake a template's own rule colour for a picked one", () => {
    expect(paperStyleOf(templateBackdrop("ruled-wide", "dark")).rule).toBeUndefined();
  });
});

describe("a spacing typed in mm", () => {
  it("names a step when it reads as one, on the template chosen", () => {
    // Ruled Wide: 40 px is 8.2 mm, Tight (32) 6.6, Roomy (50) 10.3.
    expect(spacingMm(spacingOf("ruled-wide", {}))).toBe(8.2);
    expect(typedSpacing("ruled-wide", 8.2)).toEqual({ spacing: undefined, pitch: undefined });
    expect(typedSpacing("ruled-wide", 6.6)).toEqual({ spacing: 0.8, pitch: undefined });
    expect(typedSpacing("ruled-narrow", 5.7)).toEqual({ spacing: undefined, pitch: undefined });
  });

  it("is kept exactly otherwise, saved and read back to the mm shown", () => {
    for (const mm of [2, 5, 7, 7.5, 12, 30]) {
      const patch = typedSpacing("ruled-wide", mm);
      expect(patch?.pitch).toBeDefined();
      const backdrop = styledBackdrop("ruled-wide", "white", { ...patch });
      const back = paperStyleOf(backdrop);
      expect(spacingMm(spacingOf("ruled-wide", back))).toBe(mm);
      // The same pitch on every template.
      expect(spacingMm(spacingOf("squared", back))).toBe(mm);
    }
  });

  it("is held to the designer's range, and no number is no change", () => {
    expect(spacingMm(typedSpacing("ruled-wide", 0.5)?.pitch ?? 0)).toBe(2);
    expect(spacingMm(typedSpacing("ruled-wide", 99)?.pitch ?? 0)).toBe(30);
    expect(typedSpacing("ruled-wide", Number.NaN)).toBeNull();
  });

  it("wins over a step, and a pitch equal to the template's own stores nothing", () => {
    expect(styledBackdrop("ruled-wide", "white", { spacing: 1.5, pitch: 30 }).spacing).toBe(30);
    expect(styledBackdrop("ruled-wide", "white", { pitch: 40 }).spacing).toBeUndefined();
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
