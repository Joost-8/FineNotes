/**
 * The three independent appearance layers: the workspace desk, the page paper
 * and how PDF pages are shown. Pure resolution from stored settings and
 * Obsidian's theme; no DOM, no Obsidian.
 */

import { type PaperTheme, paperTheme } from "../canvas/backdrop";
import { parseHexColor } from "./colors";

export type WorkspaceBackground = "auto" | "light" | "dark" | "custom" | "blur";
export type PdfTheme = "as-is" | "dark";

export const WORKSPACE_BACKGROUNDS: readonly WorkspaceBackground[] = [
  "auto",
  "light",
  "dark",
  "custom",
  "blur",
];
export const PDF_THEMES: readonly PdfTheme[] = ["as-is", "dark"];

/** The light and dark desks, independent of the page theme. */
export const LIGHT_WORKSPACE = "#e6e7ea";
export const DARK_WORKSPACE = "#0e0f11";
/** What the colour picker starts from when Custom color is first chosen. */
export const DEFAULT_CUSTOM_WORKSPACE = "#3b3e45";

export interface AppearanceSettings {
  workspaceBackground?: unknown;
  workspaceBackgroundColor?: unknown;
  pageAppearance?: unknown;
  pdfTheme?: unknown;
  /** The legacy folded switch, read when `pdfTheme` was never saved. */
  invertPdfPages?: unknown;
}

/** A desk colour, and whether the GPU blur/tint layer sits over it. */
export interface WorkspaceLook {
  color: string;
  blur: boolean;
}

export function isWorkspaceBackground(value: unknown): value is WorkspaceBackground {
  return WORKSPACE_BACKGROUNDS.includes(value as WorkspaceBackground);
}

export function isPdfTheme(value: unknown): value is PdfTheme {
  return PDF_THEMES.includes(value as PdfTheme);
}

/**
 * The desk behind the pages. Auto follows Obsidian's light/dark theme; Blur
 * uses that desk and adds the GPU blur layer; Custom is the picked colour.
 */
export function workspaceBackgroundOf(
  settings: AppearanceSettings,
  obsidianDark: boolean,
): WorkspaceLook {
  const choice = isWorkspaceBackground(settings.workspaceBackground)
    ? settings.workspaceBackground
    : "auto";
  if (choice === "custom") {
    return {
      color:
        (typeof settings.workspaceBackgroundColor === "string"
          ? parseHexColor(settings.workspaceBackgroundColor)
          : null) ?? DEFAULT_CUSTOM_WORKSPACE,
      blur: false,
    };
  }
  const auto = obsidianDark ? DARK_WORKSPACE : LIGHT_WORKSPACE;
  if (choice === "light") return { color: LIGHT_WORKSPACE, blur: false };
  if (choice === "dark") return { color: DARK_WORKSPACE, blur: false };
  return { color: auto, blur: choice === "blur" };
}

/** Whether pages are shown dark, from the Page theme and Obsidian's theme. */
export function pagesAreDark(appearance: unknown, obsidianDark: boolean): boolean {
  if (appearance === "dark") return true;
  return appearance === "system" && obsidianDark;
}

/** How PDF pages are shown, including the legacy folded switch. */
export function pdfThemeOf(
  settings: Pick<AppearanceSettings, "pdfTheme" | "invertPdfPages">,
): PdfTheme {
  if (isPdfTheme(settings.pdfTheme)) return settings.pdfTheme;
  return settings.invertPdfPages === false ? "as-is" : "dark";
}

/**
 * The paper theme a notebook is shown in. The PDF choice is independent of
 * the page theme: as-is keeps a PDF's true colours even on dark paper.
 */
export function shownPaperTheme(
  settings: Pick<AppearanceSettings, "pageAppearance" | "pdfTheme" | "invertPdfPages">,
  obsidianDark: boolean,
): PaperTheme {
  const dark = pagesAreDark(settings.pageAppearance, obsidianDark);
  return paperTheme(dark, dark && pdfThemeOf(settings) === "as-is");
}
