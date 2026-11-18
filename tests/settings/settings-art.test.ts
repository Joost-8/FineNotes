/**
 * The drawings on the settings rows, as data: which part shows for which
 * value, and the colours they take from the settings. No DOM here; the tab
 * test draws one.
 */

import { describe, expect, it } from "vitest";
import { DARK_PAPER, LIGHT_PAPER } from "../../src/canvas/backdrop";
import { nightColor } from "../../src/canvas/night";
import { DEFAULT_SETTINGS, type GoodObsidianSettings } from "../../src/settings-data";
import {
  ART,
  type ArtShape,
  artPartOn,
  artStateOf,
  paletteClass,
} from "../../src/view/settings-art";

const settings = (over: Partial<GoodObsidianSettings> = {}): GoodObsidianSettings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  ...over,
});
const state = (over: Partial<GoodObsidianSettings> = {}, dark = false) =>
  artStateOf(settings(over), { dark, reader: "grape", updates: "remind" });

function parts(shapes: readonly ArtShape[]): ArtShape[] {
  return shapes.flatMap((shape) => [shape, ...parts(shape.kids ?? [])]);
}

describe("the drawings", () => {
  it("say when a part applies only about values the settings have", () => {
    const on = state().on;
    for (const [id, shapes] of Object.entries(ART)) {
      for (const part of parts(shapes)) {
        if (part.when === undefined) continue;
        const key = part.when.slice(0, part.when.indexOf("="));
        expect(on, `${id}: ${part.when}`).toHaveProperty(key);
      }
    }
  });

  it("draw Colours inside the Looks preview, so the chosen palette reaches Obsidian's settings window", () => {
    const [outer] = ART.palette;
    expect(outer?.tag).toBe("g");
    expect(outer?.cls?.split(" ")).toEqual(
      expect.arrayContaining(["ga-palette", "goodobsidian-look-preview"]),
    );
    expect(parts(ART.palette).length).toBeGreaterThan(1);
    expect(paletteClass(state({ lookPalette: "nord" }).on.palette ?? "")).toBe("is-palette-nord");
    expect(paletteClass(state({ lookPalette: "no such palette" }).on.palette ?? "")).toBe(
      "is-palette-obsidian",
    );
  });

  it("hold no text: the tab is in 42 languages", () => {
    const tags = new Set(Object.values(ART).flatMap((shapes) => parts(shapes).map((p) => p.tag)));
    expect(tags.has("text" as ArtShape["tag"])).toBe(false);
  });
});

describe("artPartOn", () => {
  it("matches one value or several, and nothing without a value", () => {
    expect(artPartOn("tool=pen|highlighter", { tool: "pen" })).toBe(true);
    expect(artPartOn("tool=pen|highlighter", { tool: "eraser" })).toBe(false);
    expect(artPartOn("undo=on", {})).toBe(false);
    expect(artPartOn("broken", { broken: "broken" })).toBe(false);
  });
});

describe("artStateOf", () => {
  it("names switches on or off", () => {
    expect(state({ lassoTouches: false }).on.lasso).toBe("off");
    expect(state({ lassoTouches: true }).on.lasso).toBe("on");
  });

  it("draws a light page by day and a dark one at night, with its ink", () => {
    const color = "#1971c2";
    const day = state({ defaultColor: color, pageAppearance: "light" });
    expect(day.vars["--art-paper"]).toBe(LIGHT_PAPER.paper);
    expect(day.vars["--art-start-ink"]).toBe(color);
    const night = state({ defaultColor: color, pageAppearance: "dark" });
    expect(night.vars["--art-paper"]).toBe(DARK_PAPER.paper);
    expect(night.vars["--art-start-ink"]).toBe(nightColor(color));
  });

  it("follows Obsidian's theme for Match Obsidian", () => {
    expect(state({ pageAppearance: "system" }, true).vars["--art-paper"]).toBe(DARK_PAPER.paper);
    expect(state({ pageAppearance: "system" }, false).vars["--art-paper"]).toBe(LIGHT_PAPER.paper);
  });

  it("widens the sample with the size, and more for the highlighter", () => {
    const px = (s: ReturnType<typeof state>): number => parseFloat(s.vars["--art-start-width"]);
    expect(px(state({ defaultTool: "pen", defaultSize: 12 }))).toBeGreaterThan(
      px(state({ defaultTool: "pen", defaultSize: 2 })),
    );
    const marker = state({ defaultTool: "highlighter", defaultSize: 2 });
    expect(px(marker)).toBeGreaterThan(px(state({ defaultTool: "pen", defaultSize: 12 })));
    expect(marker.vars["--art-start-opacity"]).toBe("0.45");
  });

  it("scales the paper with its width, within what the drawing can show", () => {
    expect(state({ paperWidth: 1024 }).vars["--art-paper-scale"]).toBe("1");
    expect(Number(state({ paperWidth: 320 }).vars["--art-paper-scale"])).toBe(0.55);
    expect(Number(state({ paperWidth: 4096 }).vars["--art-paper-scale"])).toBe(1.35);
  });

  it("colours the custom-colour swatches, empty ones left open", () => {
    const vars = state({ customColors: ["#ff8800"] }).vars;
    expect(vars["--art-swatch-1"]).toBe("#ff8800");
    expect(vars["--art-swatch-2"]).toBe("transparent");
  });
});
