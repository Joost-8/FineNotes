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

export const guidesEligible = (page: Page): boolean =>
  page.geometry.width > 0 && page.geometry.height > 0;

export function guideColor(style: WritingGuideStyle, paper: string): string {
  if (style.colorMode === "custom") return style.customColor;
  const rgb = hexToRgb(paper) ?? { r: 255, g: 255, b: 255 };
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255 >= 0.5 ? "#64748b" : "#cbd5e1";
}
