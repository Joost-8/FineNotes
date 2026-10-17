/**
 * The built-in sticker pack (`src/model/stickers.ts`): every sticker a
 * well-formed SVG in the colour asked for, a soft tint mixed from it, and
 * the stickers folder setting read forgivingly.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_STICKER_FOLDER,
  STICKERS,
  STICKER_CATEGORIES,
  stickerById,
  stickerFileName,
  stickerFolderOf,
  stickerInk,
  stickerSvg,
} from "../../src/model/stickers";

/** Tags opened and closed in order, self-closing ones aside: a cheap well-formedness check. */
function balanced(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0;
}

describe("the built-in pack", () => {
  it("has unique ids, and stickers in every category", () => {
    const ids = STICKERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id } of STICKER_CATEGORIES) {
      expect(STICKERS.some((s) => s.category === id)).toBe(true);
    }
    expect(stickerById("icon-star")?.name).toBe("Star");
    expect(stickerById("nope")).toBeUndefined();
  });

  it("draws every sticker as a well-formed SVG of its size, in the colour asked for", () => {
    for (const sticker of STICKERS) {
      const svg = stickerSvg(sticker, "#1971c2");
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), sticker.id).toBe(true);
      expect(svg, sticker.id).toContain(`viewBox="0 0 ${sticker.w} ${sticker.h}"`);
      expect(balanced(svg), sticker.id).toBe(true);
      expect(svg, sticker.id).not.toMatch(/NaN|undefined|Infinity/);
      expect(svg.includes("#1971c2") || svg.includes(stickerInk("#1971c2").tint), sticker.id).toBe(
        true,
      );
    }
  });

  it("recolours: the same sticker in another colour is another drawing", () => {
    const star = stickerById("icon-star");
    if (!star) throw new Error("no star");
    expect(stickerSvg(star, "#e03131")).not.toBe(stickerSvg(star, "#2f9e44"));
  });
});

describe("stickerInk", () => {
  it("keeps the colour, and mixes a light tint of it with white", () => {
    expect(stickerInk("#000000")).toEqual({ ink: "#000000", tint: "#b3b3b3" });
    expect(stickerInk("#FF0000", 0.5)).toEqual({ ink: "#ff0000", tint: "#ff8080" });
  });

  it("falls back on near-black for a colour it cannot read", () => {
    expect(stickerInk("red").ink).toBe("#1a1a1a");
  });
});

describe("names and folders", () => {
  it("names a placed sticker after itself and its colour", () => {
    const star = stickerById("icon-star");
    if (!star) throw new Error("no star");
    expect(stickerFileName(star, "#E03131")).toBe("Sticker Star e03131");
  });

  it("reads the stickers folder forgivingly", () => {
    expect(stickerFolderOf("Art/Stickers/")).toBe("Art/Stickers");
    expect(stickerFolderOf("  /Stickers ")).toBe("Stickers");
    expect(stickerFolderOf("")).toBe(DEFAULT_STICKER_FOLDER);
    expect(stickerFolderOf(42)).toBe(DEFAULT_STICKER_FOLDER);
  });
});
