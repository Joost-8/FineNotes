import { PEN_ICON_BOX, inkNeedsRim, penIconParts, sampleStroke } from "./pen-glyphs";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A pen's sample stroke as an SVG element `width` × `height` px: a wave in
 * the pen's own character (`sampleStroke`, as the width popover's preview
 * draws it), `thickness` px at its fullest, in `color`. A highlighter is
 * drawn at `highlighterOpacity`. The paper under it is the caller's.
 */
export function penSample(
  pen: string,
  color: string,
  thickness: number,
  width: number,
  height: number,
  highlighterOpacity: number,
  doc: Document = activeDocument,
): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("aria-hidden", "true");
  const shape = sampleStroke(pen, thickness, width, height);
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", shape.d);
  path.setAttribute("stroke-linejoin", "round");
  if (shape.strokeWidth === undefined) {
    path.setAttribute("fill", color);
  } else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", shape.strokeWidth.toFixed(2));
    path.setAttribute("stroke-linecap", shape.cap ?? "round");
  }
  if (pen === "highlighter") path.setAttribute("opacity", String(highlighterOpacity));
  svg.append(path);
  return svg;
}

/**
 * A pen type's icon as an SVG element: an outline of the pen, its tip in the
 * ink it writes with (pen-glyphs.ts). Ink that would vanish into the surface
 * gets a rim in the icon's colour; its lines are drawn in the icon's colour
 * outright. The toolbar and the settings' saved pens share it.
 */
export function penGlyph(pen: string, color: string, doc: Document = activeDocument): SVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${PEN_ICON_BOX} ${PEN_ICON_BOX}`);
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const rim = inkNeedsRim(color, doc.body.hasClass("theme-dark"));
  for (const part of penIconParts(pen)) {
    const el = doc.createElementNS(SVG_NS, part.tag);
    for (const [key, value] of Object.entries(part.attrs)) el.setAttribute(key, value);
    const paint = part.ink && !(rim && !part.fill) ? color : "currentColor";
    if (part.fill) el.setAttribute("fill", paint);
    if ((part.fill || part.ink) && part.attrs.stroke === undefined)
      el.setAttribute("stroke", paint);
    if (rim && part.ink && part.fill) {
      el.setAttribute("stroke", "currentColor");
      el.setAttribute("stroke-width", "1");
    }
    svg.append(el);
  }
  return svg;
}
