/**
 * Where "Handwrite here" keeps a new block (Joost, 2026-11-26): one notebook
 * per note (the default), the picker each time, or one notebook for
 * everything. The setting, its first-use choice, and the fixed notebook
 * followed through renames.
 *
 * Pure: no DOM, no Obsidian.
 */

export type HandwriteBlocks = "note" | "ask" | "one";

/** The choices, in the order the setting and the first-use dialog list them. */
export const HANDWRITE_BLOCKS: readonly HandwriteBlocks[] = ["note", "ask", "one"];

/** A stored choice, with anything unknown read as the default, one notebook per note. */
export function handwriteBlocksOf(value: unknown): HandwriteBlocks {
  return value === "ask" || value === "one" ? value : "note";
}

export interface HandwriteSettings {
  handwriteBlocks: HandwriteBlocks;
  /** The first-use dialog has been answered (or the setting changed): it never shows again. */
  handwriteBlocksChosen: boolean;
  /** The notebook of "One notebook for everything"; "" for none chosen. */
  handwriteNotebook: string;
}

/** The three values as `data.json` may hold them, made sound. */
export function cleanHandwriteSettings(
  stored: Partial<Record<keyof HandwriteSettings, unknown>>,
): HandwriteSettings {
  return {
    handwriteBlocks: handwriteBlocksOf(stored.handwriteBlocks),
    handwriteBlocksChosen: stored.handwriteBlocksChosen === true,
    handwriteNotebook: typeof stored.handwriteNotebook === "string" ? stored.handwriteNotebook : "",
  };
}

/** Where the next block goes. */
export type BlockTarget =
  /** Ask first, once: the first-use dialog. */
  | { kind: "first-use" }
  /** The notebook picker. */
  | { kind: "pick" }
  /** This notebook. */
  | { kind: "notebook"; path: string }
  /** The notebook named after the note (found or made). */
  | { kind: "note" }
  /**
   * "One notebook for everything", whose notebook is gone (or was never
   * chosen): said so, the setting goes back to one per note, and this block
   * goes to the note's own.
   */
  | { kind: "fixed-missing" };

export function blockTarget(
  settings: HandwriteSettings,
  facts: {
    /** "Handwrite here (choose notebook…)": the picker, whatever the setting. */
    choose: boolean;
    /** The notebook the note's blocks already use, if any. */
    linked: string | null;
    /** Whether a file is at a path. */
    exists: (path: string) => boolean;
  },
): BlockTarget {
  if (!settings.handwriteBlocksChosen) return { kind: "first-use" };
  if (facts.choose || settings.handwriteBlocks === "ask") return { kind: "pick" };
  if (settings.handwriteBlocks === "one") {
    const path = settings.handwriteNotebook;
    return path && facts.exists(path) ? { kind: "notebook", path } : { kind: "fixed-missing" };
  }
  return facts.linked ? { kind: "notebook", path: facts.linked } : { kind: "note" };
}

/** A file moved: the fixed notebook's path follows it. True when it changed. */
export function followHandwriteNotebook(
  settings: HandwriteSettings,
  oldPath: string,
  newPath: string,
): boolean {
  if (!settings.handwriteNotebook || settings.handwriteNotebook !== oldPath) return false;
  settings.handwriteNotebook = newPath;
  return true;
}
