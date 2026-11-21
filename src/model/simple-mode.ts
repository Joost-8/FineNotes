/**
 * The simple look: Obsidian's own chrome tucked away so FineNotes reads as an
 * app of its own to someone new to Obsidian. It hides the title bar, the
 * status bar, the left ribbon and the sidebars, and keeps the tabs. It only
 * hides: nothing of Obsidian is removed, and one switch brings it all back.
 * Parts of it can be brought back one by one (a calendar or a timer lives in
 * a sidebar); all stay hidden by default. The pieces are styled under body
 * classes in styles.css.
 */

import type { TextKey } from "../i18n/translate";

/** The body class worn while the look is on. */
export const SIMPLE_CLASS = "goodobsidian-simple";

/** The parts of Obsidian the look can show again, in the order they are offered. */
export const SIMPLE_PARTS = ["leftSidebar", "rightSidebar", "ribbon", "statusBar"] as const;

export type SimplePart = (typeof SIMPLE_PARTS)[number];

/** Each part's name, as Obsidian names it. */
export const SIMPLE_PART_NAMES: Readonly<Record<SimplePart, TextKey>> = {
  leftSidebar: "settings.simpleLook.leftSidebar",
  rightSidebar: "settings.simpleLook.rightSidebar",
  ribbon: "settings.simpleLook.ribbon",
  statusBar: "settings.simpleLook.statusBar",
};

/** Each part's icon (Lucide, as Obsidian draws its own sidebar buttons). */
export const SIMPLE_PART_ICONS: Readonly<Record<SimplePart, string>> = {
  leftSidebar: "panel-left",
  rightSidebar: "panel-right",
  ribbon: "panel-left-dashed",
  statusBar: "panel-bottom",
};

/** The body class that shows `part` again while the look is on. */
export function simplePartClass(part: SimplePart): string {
  return `${SIMPLE_CLASS}-show-${part}`;
}

/** The saved parts, cleaned: known ones only, each once, in the offered order. */
export function simplePartsOf(raw: unknown): SimplePart[] {
  if (!Array.isArray(raw)) return [];
  return SIMPLE_PARTS.filter((part) => raw.includes(part));
}

/** `shown` with `part` shown, or hidden again if it was. */
export function toggleSimplePart(shown: readonly SimplePart[], part: SimplePart): SimplePart[] {
  return shown.includes(part) ? shown.filter((p) => p !== part) : simplePartsOf([...shown, part]);
}

/** The classes to wear: the look's and those of the parts it shows; none when it is off. */
export function simpleClasses(on: boolean, shown: readonly SimplePart[] = []): string[] {
  return on ? [SIMPLE_CLASS, ...simplePartsOf(shown).map(simplePartClass)] : [];
}

/** Every class the look can put on the body: what to take off before wearing it anew. */
export function allSimpleClasses(): string[] {
  return [SIMPLE_CLASS, ...SIMPLE_PARTS.map(simplePartClass)];
}
