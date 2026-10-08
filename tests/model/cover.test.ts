/**
 * `src/model/cover.ts` — the colours a cover derives from its one stored
 * colour, where each design puts its plate and title, and the title box.
 */

import { describe, expect, it } from "vitest";
import {
  TITLE_MIN_CONTRAST,
  contrastRatio,
  coverHasPlate,
  coverLayout,
  coverMonogramBox,
  coverMonogramColor,
  coverPalette,
  coverTitleBox,
  coverTitleColor,
  coverTitleFontSize,
  coverTitleFrame,
  darken,
  isClassicCover,
  isDarkColor,
  lighten,
  mixColors,
  parseHexColor,
  readableOn,
  relativeLuminance,
  toHexColor,
  withAlpha,
} from "../../src/model/cover";
import { COVER_RULINGS, type PageGeometry } from "../../src/model/document";
import { COVER_COLORS, PAGE_SIZES, sizeGeometry } from "../../src/model/templates";

const A4: PageGeometry = { width: 1024, height: 1448 };

describe("hex colours", () => {
  it("parses the four hex forms and ignores alpha", () => {
    expect(parseHexColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColor("#0f08")).toEqual({ r: 0, g: 255, b: 0 });
    expect(parseHexColor("#1F3A5F")).toEqual({ r: 31, g: 58, b: 95 });
    expect(parseHexColor(" #1f3a5f80 ")).toEqual({ r: 31, g: 58, b: 95 });
  });

  it("refuses anything that is not hex rather than guessing", () => {
    for (const bad of ["red", "rgb(0,0,0)", "#12", "#12345", "1f3a5f", "", undefined]) {
      expect(parseHexColor(bad)).toBeNull();
    }
  });

  it("writes #rrggbb, rounding and clamping each channel", () => {
    expect(toHexColor({ r: 31.4, g: 300, b: -2 })).toBe("#1fff00");
  });

  it("mixes linearly and clamps the amount", () => {
    expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixColors("#000000", "#ffffff", 2)).toBe("#ffffff");
    expect(mixColors("#000000", "#ffffff", Number.NaN)).toBe("#000000");
    expect(lighten("#000000", 1)).toBe("#ffffff");
    expect(darken("#ffffff", 1)).toBe("#000000");
  });

  it("formats rgba for a gradient stop", () => {
    expect(withAlpha("#1f3a5f", 0.32)).toBe("rgba(31, 58, 95, 0.32)");
    expect(withAlpha("#1f3a5f", 5)).toBe("rgba(31, 58, 95, 1)");
  });
});

describe("luminance and contrast", () => {
  it("follows WCAG 2 at the ends and in between", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
    expect(contrastRatio("#1f3a5f", "#ffffff")).toBe(contrastRatio("#ffffff", "#1f3a5f"));
  });

  it("calls a colour dark when white reads better on it than black", () => {
    expect(isDarkColor("#1f3a5f")).toBe(true);
    expect(isDarkColor("#d9a93a")).toBe(false);
    expect(isDarkColor("#000000")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
  });

  it("finds a readable ink on anything, tinted where it can be", () => {
    const greys = Array.from({ length: 17 }, (_, i) =>
      toHexColor({ r: i * 16, g: i * 16, b: i * 16 }),
    );
    for (const bg of [...greys, ...COVER_COLORS.map((c) => c.color)]) {
      expect(contrastRatio(readableOn(bg), bg), bg).toBeGreaterThanOrEqual(
        TITLE_MIN_CONTRAST - 1e-9,
      );
    }
    // A deep green title on a sage cover, not a generic black.
    const onSage = readableOn("#9db59a");
    expect(onSage).not.toBe("#1a1a1a");
    const { r, g, b } = parseHexColor(onSage) ?? { r: 0, g: 0, b: 0 };
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});

describe("coverPalette", () => {
  it("keeps every title readable on every offered colour", () => {
    for (const { id, color } of COVER_COLORS) {
      const p = coverPalette(color);
      expect(contrastRatio(p.title, p.base), id).toBeGreaterThanOrEqual(TITLE_MIN_CONTRAST);
      expect(contrastRatio(p.labelTitle, p.label), id).toBeGreaterThanOrEqual(TITLE_MIN_CONTRAST);
    }
  });

  it("makes the label lighter and the band darker than the cloth (lighter on near-black)", () => {
    for (const { id, color } of COVER_COLORS) {
      const p = coverPalette(color);
      const base = relativeLuminance(p.base);
      expect(relativeLuminance(p.label), id).toBeGreaterThan(base);
      if (base < 0.02) expect(relativeLuminance(p.band), id).toBeGreaterThan(base);
      else expect(relativeLuminance(p.band), id).toBeLessThan(base);
    }
  });

  it("lightens the band instead on near-black cloth, where darker is invisible", () => {
    const p = coverPalette("#050505");
    expect(relativeLuminance(p.band)).toBeGreaterThan(relativeLuminance(p.base));
  });

  it("keeps linen threads low-contrast against the cloth", () => {
    for (const { id, color } of COVER_COLORS) {
      const p = coverPalette(color);
      expect(contrastRatio(p.threadLight, p.base), id).toBeLessThan(1.5);
      expect(contrastRatio(p.threadDark, p.base), id).toBeLessThan(1.5);
    }
  });

  it("derives everything from the one colour, so the same colour gives the same cover", () => {
    expect(coverPalette("#7A2537")).toEqual(coverPalette("#7a2537"));
    expect(coverPalette("#7a2537").base).toBe("#7a2537");
  });

  it("falls back to white for a missing or unreadable colour instead of throwing", () => {
    expect(coverPalette(undefined).base).toBe("#ffffff");
    expect(coverPalette("tomato").base).toBe("#ffffff");
  });
});

describe("coverLayout", () => {
  const geometries: PageGeometry[] = PAGE_SIZES.flatMap((s) => [
    sizeGeometry(s.id, false),
    sizeGeometry(s.id, true),
  ]);

  it("keeps plate, band and title inside the page at every size and orientation", () => {
    for (const kind of COVER_RULINGS) {
      for (const g of geometries) {
        const layout = coverLayout(kind, g);
        const { title } = layout;
        expect(title.x, kind).toBeGreaterThanOrEqual(layout.band);
        expect(title.x + title.w, kind).toBeLessThanOrEqual(g.width);
        expect(title.cy, kind).toBeGreaterThan(0);
        expect(title.cy, kind).toBeLessThan(g.height * 0.9);
        if (layout.plate) {
          expect(layout.plate.x).toBeGreaterThan(0);
          expect(layout.plate.x + layout.plate.w).toBeLessThan(g.width);
          expect(layout.plate.y + layout.plate.h).toBeLessThan(g.height);
          // The title sits inside the plate.
          expect(title.x).toBeGreaterThan(layout.plate.x);
          expect(title.x + title.w).toBeLessThan(layout.plate.x + layout.plate.w);
          expect(title.cy).toBeGreaterThan(layout.plate.y);
          expect(title.cy).toBeLessThan(layout.plate.y + layout.plate.h);
        }
      }
    }
  });

  it("gives a band only to the spine design, and a plate only to the label and glass designs", () => {
    for (const kind of COVER_RULINGS) {
      const layout = coverLayout(kind, A4);
      expect(layout.band > 0, kind).toBe(kind === "cover-band");
      expect(layout.plate !== null, kind).toBe(coverHasPlate(kind));
    }
  });

  it("keeps the label plate's place: 60% wide, centred", () => {
    const label = coverLayout("cover-label", A4).plate;
    expect(label?.w).toBeCloseTo(1024 * 0.6);
    expect(label ? label.x + label.w / 2 : 0).toBeCloseTo(512);
  });

  it("puts the title at the same height on every classic design, so a change never makes it jump", () => {
    const heights = COVER_RULINGS.filter(isClassicCover).map((k) => coverLayout(k, A4).title.cy);
    expect(new Set(heights).size).toBe(1);
  });

  it("sets the current designs' title bottom left, clear of the spine; on the seam; on the glass", () => {
    for (const kind of [
      "cover-gradient",
      "cover-orb",
      "cover-contour",
      "cover-monogram",
      "cover-accent",
    ] as const) {
      const { title, titleStyle } = coverLayout(kind, A4);
      expect(title.cy / 1448, kind).toBeCloseTo(0.835);
      expect(title.x, kind).toBeGreaterThan(1024 * 0.036);
      expect(titleStyle, kind).toEqual({ font: "sans", align: "left" });
    }
    expect(coverLayout("cover-split", A4).titleStyle.align).toBe("left");
    expect(coverLayout("cover-glass", A4).titleStyle).toEqual({ font: "sans", align: "center" });
    expect(coverLayout("cover-label", A4).titleStyle).toEqual({ font: "serif", align: "center" });
  });

  it("centres the band design's title in the cloth right of the band", () => {
    const { band, title } = coverLayout("cover-band", A4);
    expect(title.x - band).toBeCloseTo(1024 - (title.x + title.w));
  });
});

describe("the cover title", () => {
  it("is large for a short title and shrinks, down to a floor, for a long one", () => {
    const area = coverLayout("cover-label", A4).title.w;
    const short = coverTitleFontSize("Maths", area, A4);
    const mid = coverTitleFontSize("Advanced Linear Algebra", area, A4);
    const huge = coverTitleFontSize("x".repeat(400), area, A4);
    expect(short).toBe(Math.round(1024 * 0.062));
    expect(mid).toBeLessThan(short);
    expect(mid).toBeGreaterThan(huge);
    expect(huge).toBe(Math.round(1024 * 0.034));
    // Shrunk just enough to stay on one line.
    expect(mid * 0.56 * 23).toBeLessThanOrEqual(area + 1);
  });

  it("is a text box: bold serif, centred, readable ink, first line on the title line", () => {
    const box = coverTitleBox("cover-label", A4, "#1f3a5f", "Analysis", "t1");
    expect(box).toMatchObject({
      id: "t1",
      text: "Analysis",
      font: "serif",
      bold: true,
      align: "center",
      color: coverPalette("#1f3a5f").labelTitle,
    });
    expect("h" in box).toBe(false);
    const { title } = coverLayout("cover-label", A4);
    expect(box.y + (box.fontSize * 1.25) / 2).toBeCloseTo(title.cy, 0);
    expect(Number.isInteger(box.x) && Number.isInteger(box.y) && Number.isInteger(box.w)).toBe(
      true,
    );
  });

  it("is bold sans, set left, on the current designs", () => {
    const box = coverTitleBox("cover-gradient", A4, "#1f3a5f", "Biology", "t1");
    expect(box).toMatchObject({ font: "sans", bold: true, align: "left" });
    expect(box.color).toBe(coverPalette("#1f3a5f").title);
  });

  it("uses the label plate's ink on the label design and the cloth's elsewhere", () => {
    const p = coverPalette("#d9a93a");
    expect(coverTitleColor({ kind: "cover-label", paperColor: "#d9a93a" })).toBe(p.labelTitle);
    // The glass plate is translucent: the cloth's ink reads through it.
    expect(coverTitleColor({ kind: "cover-glass", paperColor: "#d9a93a" })).toBe(p.title);
    expect(coverTitleColor({ kind: "cover-linen", paperColor: "#d9a93a" })).toBe(p.title);
    expect(coverTitleColor({ kind: "cover-orb", paperColor: "#d9a93a" })).toBe(p.title);
  });

  it("frames the same font size identically wherever the title line is", () => {
    const frame = coverTitleFrame("cover-plain", A4, 40);
    expect(frame.y).toBe(Math.round(coverLayout("cover-plain", A4).title.cy - 25));
  });
});

describe("the big-type letter", () => {
  it("is the title's first letter, upper case, large, behind the title, in the monogram tint", () => {
    const box = coverMonogramBox("cover-monogram", A4, "#1f3a5f", "biology", "t0");
    expect(box).toMatchObject({
      id: "t0",
      text: "B",
      font: "sans",
      bold: true,
      color: coverMonogramColor({ kind: "cover-monogram", paperColor: "#1f3a5f" }),
    });
    expect(box?.fontSize).toBeGreaterThan(800);
  });

  it("exists only on the big-type design, and only for a title with a letter", () => {
    expect(coverMonogramBox("cover-gradient", A4, "#1f3a5f", "Biology", "t0")).toBeNull();
    expect(coverMonogramBox("cover-monogram", A4, "#1f3a5f", "   ", "t0")).toBeNull();
  });
});
