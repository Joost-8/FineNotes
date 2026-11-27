/**
 * Writing guides (PURE): lines, a grid or dots laid over a notebook's pages
 * to write along, never saved in the notebook and never printed or exported.
 *
 * Each notebook has its own: on or off, and its look (`GuideEntry`), kept in
 * the plugin's settings by the notebook's path (`guidesOf`, `withGuides`) and
 * carried along when the notebook is moved or renamed (`moveGuidePaths`). A
 * notebook turned on for the first time takes the look last chosen anywhere
 * (the settings' `writingGuides`).
 */

import { hexToRgb, parseHexColor } from "./colors";
import type { Page } from "./document";

export const WRITING_GUIDES_ICON = "finenotes-writing-guides";

export interface WritingGuideStyle {
  style: "lines" | "grid" | "dots";
  spacing: number;
  thickness: number;
  opacity: number;
  colorMode: "auto" | "custom";
  customColor: string;
}

export const DEFAULT_WRITING_GUIDES: Readonly<WritingGuideStyle> = {
  style: "lines",
  spacing: 32,
  thickness: 1,
  opacity: 0.22,
  colorMode: "auto",
  customColor: "#64748b",
};

export function writingGuidesOf(raw: unknown): WritingGuideStyle {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bounded = (key: "spacing" | "thickness" | "opacity", min: number, max: number): number => {
    const val = o[key];
    return typeof val === "number" && Number.isFinite(val)
      ? Math.max(min, Math.min(max, val))
      : DEFAULT_WRITING_GUIDES[key];
  };
  return {
    style: o.style === "grid" || o.style === "dots" ? o.style : "lines",
    spacing: Math.round(bounded("spacing", 8, 128)),
    thickness: bounded("thickness", 0.5, 3),
    opacity: bounded("opacity", 0.05, 0.6),
    colorMode: o.colorMode === "custom" ? "custom" : "auto",
    customColor:
      typeof o.customColor === "string"
        ? (parseHexColor(o.customColor) ?? DEFAULT_WRITING_GUIDES.customColor)
        : DEFAULT_WRITING_GUIDES.customColor,
  };
}

/** One notebook's guides: whether they show, and how they look. */
export interface GuideEntry {
  on: boolean;
  style: WritingGuideStyle;
}

/** The stored map, read back: path to `{ on, ...style }`; anything else is dropped. */
export function guideMapOf(raw: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [path, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry && typeof entry === "object") out[path] = entry as Record<string, unknown>;
  }
  return out;
}

/**
 * Notebook `path`'s guides: off, in the last look chosen (`lastStyle`), until
 * it has an entry of its own. `null` (a notebook with no file) is always off.
 */
export function guidesOf(map: unknown, lastStyle: unknown, path: string | null): GuideEntry {
  const entry = path === null ? undefined : guideMapOf(map)[path];
  if (!entry) return { on: false, style: writingGuidesOf(lastStyle) };
  return { on: entry.on === true, style: writingGuidesOf(entry) };
}

/** `map` with notebook `path`'s guides set to `entry`; the map is not changed. */
export function withGuides(
  map: unknown,
  path: string,
  entry: GuideEntry,
): Record<string, Record<string, unknown>> {
  return { ...guideMapOf(map), [path]: { on: entry.on, ...entry.style } };
}

/**
 * `map` after the file or folder at `from` moved to `to` (or was deleted,
 * `to` undefined): entries at `from` and under `from/` follow it. The same
 * entries back when no entry is affected.
 */
export function moveGuidePaths(
  map: unknown,
  from: string,
  to?: string,
): Record<string, Record<string, unknown>> {
  const entries = guideMapOf(map);
  let changed = false;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [path, entry] of Object.entries(entries)) {
    const inside = path === from || path.startsWith(`${from}/`);
    if (!inside) {
      out[path] = entry;
      continue;
    }
    changed = true;
    if (to !== undefined) out[to + path.slice(from.length)] = entry;
  }
  return changed ? out : entries;
}

export const guidesEligible = (page: Page): boolean =>
  page.geometry.width > 0 && page.geometry.height > 0;

export function guideColor(style: WritingGuideStyle, paper: string): string {
  if (style.colorMode === "custom") return style.customColor;
  const rgb = hexToRgb(paper) ?? { r: 255, g: 255, b: 255 };
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255 >= 0.5 ? "#64748b" : "#cbd5e1";
}
