/**
 * Which view a note opens in: the notebook view for ink notes, Markdown for
 * everything else, and Markdown for an ink note the user switched over by
 * hand, until they switch it back.
 *
 * The plugin applies these decisions where Obsidian sets a leaf's view state
 * (see `main.ts`), so an ink note never passes through the Markdown view on
 * its way in. That matters for navigation history: a Markdown state that was
 * swapped out afterwards would sit in the history, and Back would land on it
 * only to be swapped forward again.
 *
 * No DOM, no Obsidian.
 */

import { FRONTMATTER_FLAG, LEGACY_FRONTMATTER_FLAG, VIEW_TYPE_INK } from "../constants";
import { inkFileSuffix } from "../model/new-notebook";

/** Obsidian's own type id for its Markdown view. */
export const MARKDOWN_VIEW_TYPE = "markdown";

/**
 * Whether a vault file is an ink note: a Markdown file named like one
 * (`.notebook.md`, `.page.md`, or the older `.ink.md`), or one whose
 * frontmatter claims it with `goodobsidian: true` (`inkedmark: true` before
 * 0.2.0). Only a literal `true` counts. The frontmatter is asked for only
 * when the name does not decide it.
 */
export function isInkNote(
  extension: string,
  fileName: string,
  frontmatter: () => Record<string, unknown> | null | undefined,
): boolean {
  if (extension !== "md") return false;
  if (inkFileSuffix(fileName) !== undefined) return true;
  const claims = frontmatter();
  if (!claims) return false;
  return claims[FRONTMATTER_FLAG] === true || claims[LEGACY_FRONTMATTER_FLAG] === true;
}

/** The part of Obsidian's `ViewState` the routing reads and writes. */
export interface LeafState {
  type: string;
  state?: Record<string, unknown>;
}

/**
 * The state that shows `path` as `type` in a leaf now in `current`. Scroll
 * position, pinning and the rest are kept; Markdown comes up in source mode.
 */
export function showAs<S extends LeafState>(current: S, type: string, path: string): S {
  return { ...current, type, state: { ...current.state, file: path, mode: "source" } };
}

export class ViewRouter {
  /** Ink notes shown as Markdown at the user's request, by path; not persisted. */
  private readonly keptAsMarkdown = new Set<string>();

  /**
   * Whether the note at `path` belongs in the notebook view. `isInk` is
   * asked only for a path the user has not switched to Markdown.
   */
  wantsNotebook(path: string, isInk: () => boolean): boolean {
    return !this.keptAsMarkdown.has(path) && isInk();
  }

  /**
   * The view type a leaf should open when asked for `type` on `file` (a
   * view state's `state.file`, which may be anything). Only a request for
   * the Markdown view of an ink note is changed.
   */
  typeToOpen(type: string, file: unknown, isInk: (path: string) => boolean): string {
    if (type !== MARKDOWN_VIEW_TYPE || typeof file !== "string") return type;
    return this.wantsNotebook(file, () => isInk(file)) ? VIEW_TYPE_INK : type;
  }

  /**
   * The user switched `path` to the other view. Returns the type it goes to,
   * and remembers the choice so the routing above does not undo it.
   */
  toggle(path: string, showingNotebook: boolean): string {
    if (showingNotebook) {
      this.keptAsMarkdown.add(path);
      return MARKDOWN_VIEW_TYPE;
    }
    this.keptAsMarkdown.delete(path);
    return VIEW_TYPE_INK;
  }
}
