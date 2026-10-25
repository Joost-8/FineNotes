/**
 * The ruler popover's kind tiles, each drawn as the ruler it lays out:
 * Lucide has a ruler but no set square or protractor, so all three are
 * drawn here in Lucide's manner (24 px box, round 1.6 px strokes).
 */

import type { RulerKind } from "../canvas/ruler-geometry";

const SVG_NS = "http://www.w3.org/2000/svg";

const DRAWINGS: Record<RulerKind, Array<[string, Record<string, string>]>> = {
  straight: [
    ["rect", { x: "2.5", y: "7.5", width: "19", height: "9", rx: "1.5" }],
    ["path", { d: "M6 7.5v3M9.5 7.5v2M13 7.5v3M16.5 7.5v2" }],
  ],
  square: [
    ["path", { d: "M3.5 20.5V3.5l17 17Z" }],
    ["path", { d: "M7.5 16.5v-3.2l3.2 3.2Z" }],
  ],
  protractor: [
    ["path", { d: "M2.5 17.5a9.5 9.5 0 0 1 19 0Z" }],
    ["path", { d: "M12 8v2M6.3 10.3l1.4 1.4M17.7 10.3l-1.4 1.4" }],
    ["circle", { cx: "12", cy: "17.5", r: "0.6" }],
  ],
};

/** The tile drawing for `kind`, `size` px square. */
export function rulerGlyph(kind: RulerKind, size = 24): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-linecap", "round");
  for (const [tag, attrs] of DRAWINGS[kind]) {
    const el = activeDocument.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    svg.append(el);
  }
  return svg;
}
