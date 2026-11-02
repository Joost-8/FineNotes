/**
 * `src/view/pen-cursor.ts`: the ink-coloured cursor over the page on a
 * computer (FineNotes#27).
 */

import { describe, expect, it } from "vitest";
import {
  DRAWING_DOT_PX,
  MAX_CURSOR_PX,
  MIN_CURSOR_PX,
  cursorCss,
  cursorFor,
  cursorSize,
  cursorToolOf,
  escapeSvg,
  penCursorStyleOf,
} from "../../src/view/pen-cursor";

const PREFIX = "data:image/svg+xml,";

/** The SVG a cursor's data URL holds. */
function svgOf(url: string): string {
  expect(url.startsWith(PREFIX)).toBe(true);
  return decodeURIComponent(url.slice(PREFIX.length));
}

/** The image's width and height, from its root element. */
function sizeOf(svg: string): { w: number; h: number } {
  const m = /<svg [^>]*width='([\d.]+)' height='([\d.]+)'/.exec(svg);
  if (!m) throw new Error(`no size in ${svg}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

describe("penCursorStyleOf", () => {
  it("carries the old crosshair toggle over: on is the ink dot, off the arrow", () => {
    expect(penCursorStyleOf(true)).toBe("ink");
    expect(penCursorStyleOf(false)).toBe("arrow");
  });

  it("keeps each style, and reads anything else as the ink dot", () => {
    expect(penCursorStyleOf("ink")).toBe("ink");
    expect(penCursorStyleOf("crosshair")).toBe("crosshair");
    expect(penCursorStyleOf("arrow")).toBe("arrow");
    expect(penCursorStyleOf("none")).toBe("none");
    expect(penCursorStyleOf(undefined)).toBe("ink");
    expect(penCursorStyleOf("dot")).toBe("ink");
    expect(penCursorStyleOf(1)).toBe("ink");
  });
});

describe("cursorToolOf", () => {
  it("gives the pens and the laser a cursor, and leaves the other tools theirs", () => {
    for (const tool of ["pen", "highlighter", "shape", "laser"])
      expect(cursorToolOf(tool)).toBe(tool);
    for (const tool of ["eraser", "select", "text", ""]) expect(cursorToolOf(tool)).toBeNull();
  });
});

describe("cursorSize", () => {
  it("is the nib's width in whole px", () => {
    expect(cursorSize(12)).toBe(12);
    expect(cursorSize(12.4)).toBe(12);
    expect(cursorSize(12.6)).toBe(13);
  });

  it("is clamped: never a speck, never a disc that hides the page", () => {
    expect(cursorSize(1)).toBe(MIN_CURSOR_PX);
    expect(cursorSize(0)).toBe(MIN_CURSOR_PX);
    expect(cursorSize(-5)).toBe(MIN_CURSOR_PX);
    expect(cursorSize(500)).toBe(MAX_CURSOR_PX);
    expect(cursorSize(Number.NaN)).toBe(MIN_CURSOR_PX);
    expect(cursorSize(Number.POSITIVE_INFINITY)).toBe(MIN_CURSOR_PX);
  });
});

describe("cursorFor: the pen and the Shape tool", () => {
  it("is a dot filled with the ink colour, rimmed in white and ringed in faint dark", () => {
    const svg = svgOf(cursorFor("pen", "#2563eb", 10).url);
    expect(svg).toContain("fill='#2563eb'");
    expect(svg).toContain("stroke='#fff'");
    expect(svg).toContain("stroke='rgba(0,0,0,0.35)'");
    expect(svg).toContain("r='5'");
  });

  it("is as wide as the nib on screen, plus its rims", () => {
    expect(sizeOf(svgOf(cursorFor("pen", "#000", 10).url))).toEqual({ w: 15, h: 15 });
    expect(sizeOf(svgOf(cursorFor("pen", "#000", 1).url)).w).toBe(MIN_CURSOR_PX + 5);
    expect(sizeOf(svgOf(cursorFor("pen", "#000", 999).url)).w).toBe(MAX_CURSOR_PX + 5);
  });

  it("has its hotspot at the centre", () => {
    for (const width of [3, 10, 11, 40, 200]) {
      const cursor = cursorFor("pen", "#000", width);
      const { w, h } = sizeOf(svgOf(cursor.url));
      expect(cursor.hotX).toBe(Math.floor(w / 2));
      expect(cursor.hotY).toBe(Math.floor(h / 2));
    }
  });

  it("draws white ink too: the dark ring keeps it on white paper", () => {
    const svg = svgOf(cursorFor("pen", "#ffffff", 8).url);
    expect(svg).toContain("fill='#ffffff'");
    expect(svg).toContain("rgba(0,0,0,0.35)");
  });

  it("reads short hex, rgb() and rgba(), keeping an ink's own opacity", () => {
    expect(svgOf(cursorFor("pen", "#f00", 8).url)).toContain("fill='#ff0000'");
    expect(svgOf(cursorFor("pen", "rgb(16, 32, 48)", 8).url)).toContain("fill='#102030'");
    const see = svgOf(cursorFor("pen", "rgba(16, 32, 48, 0.5)", 8).url);
    expect(see).toContain("fill='#102030' fill-opacity='0.5'");
    expect(svgOf(cursorFor("pen", "#10203080", 8).url)).toContain("fill-opacity='0.5'");
  });

  it("falls back to the default soft black for a colour it cannot read", () => {
    const svg = svgOf(cursorFor("pen", "red'/><script>", 8).url);
    expect(svg).toContain("fill='#1a1a1a'");
    expect(svg).not.toContain("script");
  });

  it("is the same dot for the Shape tool", () => {
    expect(cursorFor("shape", "#123456", 9)).toEqual(cursorFor("pen", "#123456", 9));
  });

  it("shrinks to a 2 px dot in the ink colour while the pen is down", () => {
    const cursor = cursorFor("pen", "#2563eb", 30, { drawing: true });
    const svg = svgOf(cursor.url);
    expect(svg).toContain(`r='${DRAWING_DOT_PX / 2}'`);
    expect(svg).toContain("fill='#2563eb'");
    expect(svg).not.toContain("#fff'");
    expect(sizeOf(svg)).toEqual({ w: 4, h: 4 });
    expect([cursor.hotX, cursor.hotY]).toEqual([2, 2]);
    expect(cursorFor("shape", "#2563eb", 30, { drawing: true })).toEqual(cursor);
  });
});

describe("cursorFor: the highlighter", () => {
  it("is a slim upright bar, see-through in the highlighter's colour, rimmed in white", () => {
    const cursor = cursorFor("highlighter", "#facc15", 24, { highlighterAlpha: 0.4 });
    const svg = svgOf(cursor.url);
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<circle");
    expect(svg).toContain("fill='#facc15' fill-opacity='0.4'");
    expect(svg).toContain("stroke='#fff'");
    const { w, h } = sizeOf(svg);
    expect(h).toBeGreaterThan(w * 2);
    expect(h).toBe(24 + 5);
    expect([cursor.hotX, cursor.hotY]).toEqual([Math.floor(w / 2), Math.floor(h / 2)]);
  });

  it("multiplies its own alpha into an ink's opacity, and defaults to 0.4", () => {
    const svg = svgOf(cursorFor("highlighter", "rgba(250, 204, 21, 0.5)", 24).url);
    expect(svg).toContain("fill-opacity='0.2'");
    const clamped = svgOf(cursorFor("highlighter", "#facc15", 24, { highlighterAlpha: 7 }).url);
    expect(clamped).toContain("fill='#facc15' stroke");
  });

  it("is at least 10 px tall, and never wider than 10 px", () => {
    expect(sizeOf(svgOf(cursorFor("highlighter", "#ff0", 2).url)).h).toBe(10 + 5);
    const big = sizeOf(svgOf(cursorFor("highlighter", "#ff0", 300).url));
    expect(big.h).toBe(MAX_CURSOR_PX + 5);
    expect(big.w).toBe(10 + 5);
  });

  it("shrinks to the dot while drawing, as the pen does", () => {
    const svg = svgOf(cursorFor("highlighter", "#facc15", 24, { drawing: true }).url);
    expect(svg).toContain(`r='${DRAWING_DOT_PX / 2}'`);
    expect(svg).toContain("fill='#facc15'");
  });
});

describe("cursorFor: the laser", () => {
  it("is a glowing red point, whatever the pen's colour and width", () => {
    const cursor = cursorFor("laser", "#2563eb", 40);
    const svg = svgOf(cursor.url);
    expect(svg).toContain("radialGradient");
    expect(svg).toContain("fill='url(#g)'");
    expect(svg).toContain("fill='#ff3b30'");
    expect(svg).not.toContain("#2563eb");
    expect(sizeOf(svg)).toEqual({ w: 24, h: 24 });
    expect([cursor.hotX, cursor.hotY]).toEqual([12, 12]);
    expect(cursorFor("laser", "#000", 2)).toEqual(cursor);
  });

  it("stays as it is while the pen is down", () => {
    expect(cursorFor("laser", "#000", 2, { drawing: true })).toEqual(cursorFor("laser", "#000", 2));
  });
});

describe("escaping for a CSS url()", () => {
  it("leaves nothing that ends the CSS string or starts a URL fragment", () => {
    for (const tool of ["pen", "highlighter", "laser"] as const) {
      const { url } = cursorFor(tool, "#abcdef", 12);
      const body = url.slice(PREFIX.length);
      expect(body).not.toMatch(/["#<>\n\r\\]/);
    }
  });

  it("percent-encodes #, quotes, angle brackets and % itself", () => {
    expect(escapeSvg(`<a b="#1">50%</a>`)).toBe("%3Ca b=%22%231%22%3E50%25%3C/a%3E");
    expect(decodeURIComponent(escapeSvg("{x}\\\n\r"))).toBe("{x}\\\n\r");
  });

  it("writes a CSS cursor value with the hotspot and a fallback", () => {
    const cursor = cursorFor("pen", "#000", 10);
    expect(cursorCss(cursor, "crosshair")).toBe(`url("${cursor.url}") 7 7, crosshair`);
  });
});
