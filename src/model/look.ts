/**
 * Looks (Settings → Look): the chrome's style and
 * colour palette, worn as body classes that `styles.css`'s Looks section
 * reads. Paper, ink and Obsidian's own chrome do not change.
 */
import { t } from "../i18n/translate";

export const LOOK_STYLES = [
  "default",
  "glass",
  "material",
  "fluent",
  "paper",
  "brutalist",
  "soft",
  "retro",
  "compact",
] as const;

export const LOOK_PALETTES = [
  "obsidian",
  "nord",
  "catppuccin",
  "dracula",
  "rose-pine",
  "gruvbox",
  "solarized",
  "tokyo-night",
  "everforest",
  "high-contrast",
] as const;

/** Obsidian's variables a palette sets (`styles.css`, Looks); Match Obsidian's preview copies them from the theme. */
export const PALETTE_VARIABLES = [
  "--background-primary",
  "--background-primary-alt",
  "--background-secondary",
  "--background-secondary-alt",
  "--background-modifier-border",
  "--background-modifier-border-hover",
  "--background-modifier-border-focus",
  "--background-modifier-hover",
  "--background-modifier-active-hover",
  "--background-modifier-form-field",
  "--modal-background",
  "--modal-border-color",
  "--background-modifier-cover",
  "--interactive-normal",
  "--interactive-hover",
  "--interactive-accent",
  "--interactive-accent-hover",
  "--interactive-accent-hsl",
  "--color-accent",
  "--text-normal",
  "--text-muted",
  "--text-faint",
  "--text-accent",
  "--text-on-accent",
  "--text-error",
  "--color-red",
  "--icon-color",
  "--icon-color-hover",
  "--icon-color-active",
  "--mono-rgb-100",
  "--mono-rgb-0",
  "--color-base-35",
] as const;

export type LookStyle = (typeof LOOK_STYLES)[number];
export type LookPalette = (typeof LOOK_PALETTES)[number];

/** The styles' names, in the interface language. */
export function lookStyleNames(): Record<LookStyle, string> {
  return {
    default: t("settings.look.style.default"),
    glass: t("settings.look.style.glass"),
    material: t("settings.look.style.material"),
    fluent: t("settings.look.style.fluent"),
    paper: t("settings.look.style.paper"),
    brutalist: t("settings.look.style.brutalist"),
    soft: t("settings.look.style.soft"),
    retro: t("settings.look.style.retro"),
    compact: t("settings.look.style.compact"),
  };
}

/** The palettes' names, in the interface language; most are the palette's own name. */
export function lookPaletteNames(): Record<LookPalette, string> {
  return {
    obsidian: t("settings.pageAppearance.system"),
    nord: t("settings.look.palette.nord"),
    catppuccin: t("settings.look.palette.catppuccin"),
    dracula: t("settings.look.palette.dracula"),
    "rose-pine": t("settings.look.palette.rosePine"),
    gruvbox: t("settings.look.palette.gruvbox"),
    solarized: t("settings.look.palette.solarized"),
    "tokyo-night": t("settings.look.palette.tokyoNight"),
    everforest: t("settings.look.palette.everforest"),
    "high-contrast": t("settings.look.palette.highContrast"),
  };
}

const isOne = <T extends string>(ids: readonly T[], id: unknown): id is T =>
  typeof id === "string" && (ids as readonly string[]).includes(id);

/** A stored style, or the default for anything else. */
export function lookStyleOf(id: unknown): LookStyle {
  return isOne(LOOK_STYLES, id) ? id : "default";
}

/** A stored palette, or Obsidian's own for anything else. */
export function lookPaletteOf(id: unknown): LookPalette {
  return isOne(LOOK_PALETTES, id) ? id : "obsidian";
}

/** The body classes for a style and palette; the defaults wear none. */
export function lookClasses(style: unknown, palette: unknown): string[] {
  const out: string[] = [];
  const s = lookStyleOf(style);
  const p = lookPaletteOf(palette);
  if (s !== "default") out.push(`finenotes-style-${s}`);
  if (p !== "obsidian") out.push(`finenotes-palette-${p}`);
  return out;
}

/** The id after `id` in `ids`, wrapping round; the first for an unknown id. */
export function nextLook<T extends string>(ids: readonly T[], id: unknown): T {
  const at = isOne(ids, id) ? ids.indexOf(id) : -1;
  return ids[(at + 1) % ids.length];
}
