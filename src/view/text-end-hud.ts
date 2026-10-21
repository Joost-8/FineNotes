/**
 * The text-box line of the diagnostics HUD: why the box being typed in
 * stopped being edited. There is no console on iPadOS, so when a new box
 * vanishes there (2026-10-21: the keyboard came for a second, then the box
 * was gone) a screenshot of this line says which path blurred it — one of
 * the surface's own, or the browser — and what the screen looked like.
 *
 * Pure: no DOM, no Obsidian.
 */

/** What the HUD reads of an element: its tag and classes. */
export interface ElementLike {
  tagName: string;
  className: unknown;
}

/** What happened when a text box blurred. */
export interface TextEndRecord {
  /**
   * The surface's path that blurred it (`tool:pen`, `out-of-sight`, …), or
   * "" when none did: the browser took the focus away by itself.
   */
  by: string;
  /** How long the box had been typed in, ms. */
  ms: number;
  /** The element the focus went to, as the blur reported it. */
  to: ElementLike | null;
  /** The keyboard's height, CSS px (`--keyboard-height`). */
  keyboard: number;
  /** The surface's height on screen, CSS px: 0 is the collapse of 2026-09-21. */
  surfaceH: number;
  /** The box's top and bottom, CSS px from the surface's top. */
  boxTop: number;
  boxBottom: number;
  /** The tool in hand. */
  tool: string;
  /** Whether the page was hidden (`document.visibilityState`). */
  hidden: boolean;
  /** Whether the box went with it, empty. */
  removed: boolean;
}

/** An element as `tag.class`, its first class without the plugin's prefix; "-" for none. */
export function describeElement(el: ElementLike | null): string {
  if (!el) return "-";
  const tag = el.tagName.toLowerCase();
  const classes = typeof el.className === "string" ? el.className.trim() : "";
  const first = classes.split(/\s+/)[0] ?? "";
  return first ? `${tag}.${first.replace(/^goodobsidian-/, "")}` : tag;
}

/** The HUD line for a text box's end; `active` is where the focus is a frame later. */
export function textEndLine(record: TextEndRecord, active: ElementLike | null): string {
  const r = Math.round;
  return (
    `text end: by=${record.by || "browser"} after=${r(record.ms)}ms` +
    `${record.removed ? " removed" : ""} to=${describeElement(record.to)} ` +
    `active=${describeElement(active)}${record.hidden ? " hidden" : ""}\n` +
    `  kb=${r(record.keyboard)} surf=${r(record.surfaceH)} ` +
    `box=${r(record.boxTop)}..${r(record.boxBottom)} tool=${record.tool}`
  );
}
