/**
 * Shows each notebook's `<Title> files` folder straight under the notebook in
 * Obsidian's file explorer, instead of at the top with the other folders
 * (`pairFilesFolders` says why that is where Obsidian puts it).
 *
 * Read from Obsidian 1.14's `app.js`: the explorer view sorts every folder
 * through `view.getSortedFolderItems(folder)`, each item having its
 * `TAbstractFile` as `file`, and lays the list out as returned;
 * `view.requestSort()` sorts again. Neither is public API, so each explorer
 * is checked for both before anything is wrapped, and an explorer that has
 * neither is left as it is. The wrapper sits on the view object itself, so
 * removing it brings back Obsidian's own method unchanged.
 */

import { TFolder } from "obsidian";
import { pairFilesFolders } from "../model/files-folder-order";

interface ExplorerItem {
  file?: { name?: unknown };
}

interface ExplorerView {
  getSortedFolderItems?: (folder: unknown) => unknown;
  requestSort?: () => void;
}

/** The wrapper's mark, so an explorer is wrapped once. */
const WRAPPED = Symbol("finenotes-files-order");

type Wrapped = ExplorerView & { [WRAPPED]?: true };

export class ExplorerFilesOrder {
  private readonly wrapped = new Set<Wrapped>();

  /** Wrap every explorer in `views` (when `on`), or unwrap them all. */
  sync(views: readonly unknown[], on: boolean): void {
    if (!on) {
      this.destroy();
      return;
    }
    for (const value of views) {
      const view = value as Wrapped;
      if (!view || view[WRAPPED]) continue;
      const original = view.getSortedFolderItems;
      if (typeof original !== "function" || typeof view.requestSort !== "function") continue;
      view.getSortedFolderItems = function (this: unknown, folder: unknown): unknown {
        const items: unknown = original.call(this, folder);
        return Array.isArray(items) ? pairFilesFolders(items as ExplorerItem[], entryOf) : items;
      };
      view[WRAPPED] = true;
      this.wrapped.add(view);
      sortAgain(view);
    }
  }

  /** Give every wrapped explorer back its own sorting, and sort it again. */
  destroy(): void {
    for (const view of this.wrapped) {
      // The wrapper is an own property; the original lives on the prototype.
      delete view.getSortedFolderItems;
      delete view[WRAPPED];
      sortAgain(view);
    }
    this.wrapped.clear();
  }
}

function entryOf(item: ExplorerItem): { name: string; folder: boolean } {
  const file = item?.file;
  const name = typeof file?.name === "string" ? file.name : "";
  return { name, folder: file instanceof TFolder };
}

function sortAgain(view: ExplorerView): void {
  try {
    view.requestSort?.();
  } catch {
    // An explorer half torn down: it sorts itself when it is built again.
  }
}
