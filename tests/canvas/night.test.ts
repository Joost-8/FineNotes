/**
 * `src/canvas/night.ts` — how a stored colour is shown on dark pages.
 *
 * Dark pages are a view setting: nothing here may change a stored colour,
 * and what is shown must keep the properties a reader relies on: ink stays
 * legible against the dark paper, keeps its hue, keeps its order (what was
 * darker by day is lighter at night), and a highlighter still reads as a
 * highlighter over the ink under it.
 */

import { describe, expect, it } from "vitest";
import {
  FLIP_POINT,
  INK_BLACK_L,
  NIGHT_HIGHLIGHTER_BLEND,
  NIGHT_INK,
  NIGHT_INK_L,
  NIGHT_PAPER,
  NIGHT_PAPER_L,
  invertPdfArea,
  lightnessOf,
  nightColor,
  nightHighlighter,
  nightLightness,
  nightRule,
  oklchOf,
  paperFlips,
  parseCssColor,
} from "../../src/canvas/night";
import { DEFAULT_HIGHLIGHTER_ALPHA, PALETTE } from "../../src/constants";
import { COMMON_COLORS } from "../../src/model/colors";

/** WCAG relative luminance of an opaque colour. */
function luminance(color: string): number {
  const rgba = parseCssColor(color);
  if (!rgba) throw new Error(`unreadable ${color}`);
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(rgba.r) + 0.7152 * lin(rgba.g) + 0.0722 * lin(rgba.b);
}

/** WCAG contrast ratio, 1–21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Angle between two hues, in degrees, 0–180. */
function hueGap(a: string, b: string): number {
  const ha = oklchOf(a)?.h ?? 0;
  const hb = oklchOf(b)?.h ?? 0;
  const d = Math.abs(((ha - hb) * 180) / Math.PI) % 360;
  return d > 180 ? 360 - d : d;
}

/** One channel of `under` with `color` screened over it at `alpha`, as canvas blends. */
function screenOver(under: string, color: string, alpha: number): string {
  const u = parseCssColor(under);
  const c = parseCssColor(color);
  if (!u || !c) throw new Error("unreadable");
  const mix = (b: number, s: number): number => b + alpha * (1 - (1 - b) * (1 - s) - b);
  const hex = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(mix(u.r, c.r))}${hex(mix(u.g, c.g))}${hex(mix(u.b, c.b))}`;
}

const INKS = PALETTE.filter((c) => c !== "#ffffff");

describe("parseCssColor", () => {
  it("reads every hex form and rgb()/rgba(), with alpha", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseCssColor("#00000080")?.a).toBeCloseTo(128 / 255);
    expect(parseCssColor("#f008")?.a).toBeCloseTo(136 / 255);
    expect(parseCssColor(" #1A1A1A ")?.r).toBeCloseTo(26 / 255);
    expect(parseCssColor("rgba(16, 24, 40, 0.16)")).toEqual({
      r: 16 / 255,
      g: 24 / 255,
      b: 40 / 255,
      a: 0.16,
    });
    expect(parseCssColor("rgb(255 0 0 / 50%)")).toEqual({ r: 1, g: 0, b: 0, a: 0.5 });
  });

  it("refuses names, typos and other functions", () => {
    for (const text of ["red", "#12", "#12345", "hsl(0 0% 0%)", "rgb(1, 2)", "rgb(a, b, c)", ""]) {
      expect(parseCssColor(text)).toBeNull();
    }
  });
});

describe("nightColor", () => {
  it("shows white paper as the night paper and black ink as the night ink", () => {
    expect(nightColor("#ffffff")).toBe(NIGHT_PAPER);
    expect(nightColor("#000000")).toBe(NIGHT_INK);
    expect(lightnessOf(NIGHT_PAPER)).toBeCloseTo(NIGHT_PAPER_L, 2);
    expect(lightnessOf(NIGHT_INK)).toBeCloseTo(NIGHT_INK_L, 2);
  });

  it("shows the default pen's soft black as full night ink, not a grey", () => {
    expect(lightnessOf(PALETTE[0])).toBeLessThanOrEqual(INK_BLACK_L);
    expect(nightColor(PALETTE[0])).toBe(NIGHT_INK);
  });

  it("keeps the order of lightness: darker by day is never darker at night", () => {
    let last = Infinity;
    for (let v = 0; v <= 255; v += 5) {
      const grey = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      const shown = lightnessOf(nightColor(grey)) ?? 0;
      expect(shown).toBeLessThanOrEqual(last + 1e-9);
      last = shown;
    }
    // Strictly so above the ink black: distinct inks stay distinct.
    for (let l = INK_BLACK_L; l < 1; l += 0.05) {
      expect(nightLightness(l + 0.05)).toBeLessThan(nightLightness(l));
    }
  });

  it("keeps every pen colour legible on the dark paper", () => {
    for (const ink of INKS) expect(contrast(nightColor(ink), NIGHT_PAPER)).toBeGreaterThan(4);
  });

  it("keeps what read on white paper readable on the dark paper", () => {
    for (const color of COMMON_COLORS) {
      if (contrast(color, "#ffffff") < 3) continue;
      expect(contrast(nightColor(color), NIGHT_PAPER), color).toBeGreaterThan(3);
    }
  });

  it("keeps hue: saturated colours stay recognisable", () => {
    for (const color of [...INKS.slice(1), ...COMMON_COLORS.slice(5, 19)]) {
      expect(hueGap(color, nightColor(color)), color).toBeLessThan(12);
      // …and keep some colour: no ink turns grey.
      expect(oklchOf(nightColor(color))?.c ?? 0, color).toBeGreaterThan(0.05);
    }
  });

  it("turns dark blue light blue", () => {
    const shown = nightColor("#1a237e");
    expect(lightnessOf(shown)).toBeGreaterThan(0.7);
    expect(hueGap("#1a237e", shown)).toBeLessThan(12);
  });

  it("keeps alpha, and returns a colour it cannot read as it is", () => {
    expect(nightColor("rgba(0, 0, 0, 0.5)")).toBe("rgba(232, 232, 232, 0.5)");
    expect(nightColor("#00000080")).toMatch(/^rgba\(232, 232, 232, 0\.50\d\)$/);
    expect(nightColor("currentColor")).toBe("currentColor");
    expect(nightColor("")).toBe("");
  });

  it("is a pure function: the same colour always shows the same", () => {
    const once = INKS.map(nightColor);
    expect(INKS.map(nightColor)).toEqual(once);
    expect(INKS).toEqual([...PALETTE.filter((c) => c !== "#ffffff")]);
  });

  it("puts white ink, the paper's colour by day, at the paper's colour at night", () => {
    // The decision on white ink (CHANGELOG): it is a correction ink, the
    // colour of the paper, and stays the colour of the paper.
    expect(contrast(nightColor("#ffffff"), NIGHT_PAPER)).toBe(1);
  });
});

describe("nightRule", () => {
  it("keeps rules about as quiet against the dark paper as by day", () => {
    for (const rule of ["#ccd5e0", "#d0d7de", "#b8c4d0"]) {
      const day = contrast(rule, "#ffffff");
      const night = contrast(nightRule(rule), NIGHT_PAPER);
      expect(night, rule).toBeGreaterThan(day * 0.9);
      expect(night, rule).toBeLessThan(day * 1.4);
      expect(hueGap(rule, nightRule(rule))).toBeLessThan(25);
    }
  });

  it("returns a colour it cannot read as it is", () => {
    expect(nightRule("transparent")).toBe("transparent");
  });
});

describe("paperFlips", () => {
  it("is where the map meets the identity", () => {
    expect(nightLightness(FLIP_POINT)).toBeCloseTo(FLIP_POINT, 6);
  });

  it("inverts light papers and leaves dark ones as they are", () => {
    for (const paper of ["#ffffff", "#fbf8ed", "#fdf6d8", "#e8f1ff"]) {
      expect(paperFlips(paper), paper).toBe(true);
    }
    for (const paper of ["#1f3a5f", "#000000", "#2b2b2b", "#7a1f1f"]) {
      expect(paperFlips(paper), paper).toBe(false);
    }
  });

  it("counts an unreadable paper as white", () => {
    expect(paperFlips("paper")).toBe(true);
  });

  it("never shows a flipped paper lighter than it was", () => {
    for (let v = 0; v <= 255; v += 15) {
      const grey = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      if (!paperFlips(grey)) continue;
      expect(lightnessOf(nightColor(grey)) ?? 1).toBeLessThanOrEqual(lightnessOf(grey) ?? 0);
    }
  });
});

describe("nightHighlighter", () => {
  const HIGHLIGHTS = ["#fff3bf", "#ffc9c9", "#d3f9d8", "#d0ebff", "#fcc419", "#228be6"];

  it("screens onto the paper", () => {
    expect(NIGHT_HIGHLIGHTER_BLEND).toBe("screen");
  });

  it("shows as a band on the dark paper, and keeps light ink under it legible", () => {
    for (const color of HIGHLIGHTS) {
      const shown = nightHighlighter(color);
      const band = screenOver(NIGHT_PAPER, shown, DEFAULT_HIGHLIGHTER_ALPHA);
      const inkUnder = screenOver(NIGHT_INK, shown, DEFAULT_HIGHLIGHTER_ALPHA);
      expect(contrast(band, NIGHT_PAPER), color).toBeGreaterThan(1.5);
      expect(contrast(inkUnder, band), color).toBeGreaterThan(4.5);
    }
  });

  it("keeps its hue and the order of its lightness", () => {
    for (const color of HIGHLIGHTS) {
      expect(hueGap(color, nightHighlighter(color)), color).toBeLessThan(12);
    }
    const light = lightnessOf(nightHighlighter("#fff3bf")) ?? 0;
    const dark = lightnessOf(nightHighlighter("#5f3dc4")) ?? 0;
    expect(light).toBeGreaterThan(dark);
  });

  it("returns a colour it cannot read as it is", () => {
    expect(nightHighlighter("none")).toBe("none");
  });
});

describe("invertPdfArea", () => {
  function recorder() {
    const ops: string[] = [];
    let op = "source-over";
    let fill = "";
    let depth = 0;
    const ctx = {
      set globalCompositeOperation(v: string) {
        op = v;
      },
      get globalCompositeOperation() {
        return op;
      },
      set fillStyle(v: string) {
        fill = v;
      },
      globalAlpha: 1,
      save: () => depth++,
      restore: () => {
        depth--;
        op = "source-over";
      },
      fillRect: (x: number, y: number, w: number, h: number) =>
        ops.push(`${op} fill ${fill} ${x},${y},${w},${h}`),
      drawImage: (source: { id: string }, x: number, y: number, w: number, h: number) =>
        ops.push(`${op} draw ${source.id} ${x},${y},${w},${h}`),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, depth: () => depth };
  }

  it("inverts, takes each pixel's hue back, then squeezes black and white into the night band", () => {
    const { ctx, ops, depth } = recorder();
    const page = { id: "page" } as unknown as CanvasImageSource;
    const patch = { id: "patch" } as unknown as CanvasImageSource;
    invertPdfArea(ctx, 600, 800, [
      { source: page, x: 0, y: 10, w: 600, h: 780 },
      { source: patch, x: 100, y: 100, w: 50, h: 50 },
    ]);
    expect(ops[0]).toBe("difference fill #ffffff 0,0,600,800");
    expect(ops.slice(1, 3)).toEqual(["hue draw page 0,10,600,780", "hue draw patch 100,100,50,50"]);
    expect(ops[3]).toMatch(/^multiply fill #[0-9a-f]{6} 0,0,600,800$/);
    expect(ops[4]).toMatch(/^screen fill #[0-9a-f]{6} 0,0,600,800$/);
    expect(ops).toHaveLength(5);
    expect(depth()).toBe(0);
  });

  it("takes black to the night paper and white to the night ink", () => {
    const { ctx, ops } = recorder();
    invertPdfArea(ctx, 1, 1, []);
    const grey = (line: string): number =>
      Number.parseInt(/#([0-9a-f]{2})/.exec(line.split(" fill ")[1])?.[1] ?? "0", 16) / 255;
    const m = grey(ops[1]);
    const floor = grey(ops[2]);
    const screen = (x: number): number => 1 - (1 - x * m) * (1 - floor);
    // After `difference`, the page's white paper is black and its black text white.
    expect(Math.round(screen(0) * 255)).toBe(Math.round(grey(`x fill ${NIGHT_PAPER}`) * 255));
    expect(Math.abs(screen(1) * 255 - grey(`x fill ${NIGHT_INK}`) * 255)).toBeLessThanOrEqual(1);
  });
});
