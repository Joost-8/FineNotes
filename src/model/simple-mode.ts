/**
 * The simple look: Obsidian's own chrome tucked away so FineNotes reads as an
 * app of its own to someone new to Obsidian. It only hides; nothing of
 * Obsidian is removed, and every piece comes back with the switch (a command,
 * the settings, the welcome). Each piece is a body class styled in styles.css.
 */

export type SimplePart = "tabs" | "ribbon" | "sidebars" | "status" | "header";

/** The pieces, in the order the settings list them, with what hiding each costs. */
export const SIMPLE_PARTS: ReadonlyArray<{ id: SimplePart; name: string; cost: string }> = [
  {
    id: "header",
    name: "Title bar",
    cost: "The notebook's title, back and forward, and the ⋯ menu.",
  },
  { id: "status", name: "Status bar", cost: "Word counts, sync and the plugin's small readouts." },
  {
    id: "ribbon",
    name: "Left ribbon",
    cost: "The icons down the left edge, including the library's.",
  },
  {
    id: "sidebars",
    name: "Sidebars",
    cost: "The file explorer, search, tags and the right sidebar.",
  },
  {
    id: "tabs",
    name: "Tab bar",
    cost: "Switching between open tabs; Home and the notebook's Home button replace it.",
  },
];

export const ALL_SIMPLE_PARTS: readonly SimplePart[] = SIMPLE_PARTS.map((p) => p.id);

/** The body class a piece sets while it is hidden. */
export function simpleClass(part: SimplePart): string {
  return `goodobsidian-simple-${part}`;
}

/** The saved pieces, cleaned: known ones only, once each. */
export function simplePartsOf(raw: unknown): SimplePart[] {
  if (!Array.isArray(raw)) return [...ALL_SIMPLE_PARTS];
  return ALL_SIMPLE_PARTS.filter((id) => raw.includes(id));
}

/** The body classes to wear: none when the look is off, else one per hidden piece. */
export function simpleClasses(on: boolean, parts: readonly SimplePart[]): string[] {
  return on ? parts.map(simpleClass) : [];
}

/** Every class the look can ever set, to take off before putting the current ones on. */
export const ALL_SIMPLE_CLASSES: readonly string[] = ALL_SIMPLE_PARTS.map(simpleClass);
