/**
 * The three independent appearance layers: the workspace desk, the page paper
 * and how PDF pages are shown. Pure resolution from stored settings and
 * Obsidian's theme; no DOM, no Obsidian.
 */

import { type PaperTheme, paperTheme } from "../canvas/backdrop";
import { parseHexColor } from "./colors";

export type WorkspaceBackground = "auto" | "light" | "dark" | "custom";
export type PdfTheme = "auto" | "as-is" | "dark";
/** The top-level Theme row: a uniform preset, or Custom once the three differ. */
export type ThemePreset = "auto" | "light" | "dark" | "custom";

export const WORKSPACE_BACKGROUNDS: readonly WorkspaceBackground[] = [
  "auto",
  "light",
  "dark",
  "custom",
];
export const PDF_THEMES: readonly PdfTheme[] = ["auto", "as-is", "dark"];

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

export function isWorkspaceBackground(value: unknown): value is WorkspaceBackground {
  return WORKSPACE_BACKGROUNDS.includes(value as WorkspaceBackground);
}

export function isPdfTheme(value: unknown): value is PdfTheme {
  return PDF_THEMES.includes(value as PdfTheme);
}

/**
 * The desk colour behind the pages. Auto follows Obsidian's light/dark
 * theme; Custom is the picked colour.
 */
export function workspaceBackgroundOf(settings: AppearanceSettings, obsidianDark: boolean): string {
  const choice = isWorkspaceBackground(settings.workspaceBackground)
    ? settings.workspaceBackground
    : "auto";
  if (choice === "custom") {
    return (
      (typeof settings.workspaceBackgroundColor === "string"
        ? parseHexColor(settings.workspaceBackgroundColor)
        : null) ?? DEFAULT_CUSTOM_WORKSPACE
    );
  }
  if (choice === "light") return LIGHT_WORKSPACE;
  if (choice === "dark") return DARK_WORKSPACE;
  return obsidianDark ? DARK_WORKSPACE : LIGHT_WORKSPACE;
}

/** Whether pages are shown dark, from the Page theme and Obsidian's theme. */
export function pagesAreDark(appearance: unknown, obsidianDark: boolean): boolean {
  if (appearance === "dark") return true;
  return appearance === "system" && obsidianDark;
}

/** Whether PDF pages are drawn dark: Auto follows Obsidian's theme. */
export function pdfIsDark(theme: PdfTheme, obsidianDark: boolean): boolean {
  return theme === "dark" || (theme === "auto" && obsidianDark);
}

/** The Theme row's value for the three settings: a uniform preset or Custom. */
export function themePresetOf(
  settings: Pick<AppearanceSettings, "workspaceBackground" | "pageAppearance" | "pdfTheme">,
): ThemePreset {
  const { workspaceBackground: bg, pageAppearance: page, pdfTheme: pdf } = settings;
  if (bg === "auto" && page === "system" && pdf === "auto") return "auto";
  if (bg === "light" && page === "light" && pdf === "as-is") return "light";
  if (bg === "dark" && page === "dark" && pdf === "dark") return "dark";
  return "custom";
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
  return paperTheme(dark, dark && !pdfIsDark(pdfThemeOf(settings), obsidianDark));
}
