/**
 * The file explorer shows a notebook's own folder as the notebook
 * (`model/folder-notebook.ts`): the notebook file is not listed inside it, a
 * tap on the folder's name opens the notebook (its arrow still opens the
 * folder), notebooks get a notebook icon, and the folders inside one get an
 * icon for what they hold.
 *
 * Read from Obsidian 1.14's `app.js`, none of it public API:
 * - the explorer view sorts each folder through
 *   `view.getSortedFolderItems(folder)` and lays out the list it returns, each
 *   item holding its `TAbstractFile` as `file` and its row as `selfEl`;
 *   `view.requestSort()` sorts again;
 * - a row's click handler does nothing for a click whose default is
 *   prevented, so a capture listener above it can take the click.
 * Each explorer is checked for both methods before anything is wrapped, and
 * one that lacks them is left as Obsidian made it. The wrapper sits on the
 * view object, so removing it brings back Obsidian's own method.
 */

import { Keymap, TFile, TFolder, setIcon } from "obsidian";
import {
  NOTEBOOK_ICON,
  type FolderEntry,
  folderNotebookName,
  ownFolderIcon,
} from "../model/folder-notebook";
import { inkFileSuffix } from "../model/new-notebook";

interface ExplorerItem {
  file?: unknown;
  selfEl?: HTMLElement;
}

interface ExplorerView {
  containerEl?: HTMLElement;
  getSortedFolderItems?: (folder: unknown) => unknown;
  requestSort?: () => void;
}

export interface FolderNotebookHost {
  /** The vault folder at `path`, or `null`. */
  folder(path: string): TFolder | null;
  /** Open the notebook `file`, in a new tab when `newTab`. */
  open(file: TFile, newTab: boolean): void;
}

const WRAPPED = Symbol("finenotes-folder-notebooks");
type Wrapped = ExplorerView & { [WRAPPED]?: () => void };

/** The icon element this added to a row, so it is made once and can be taken away. */
const ICON_CLASS = "goodobsidian-explorer-icon";
const NOTEBOOK_ROW_CLASS = "goodobsidian-folder-notebook";

export class ExplorerFolderNotebooks {
  private readonly wrapped = new Set<Wrapped>();

  constructor(private readonly host: FolderNotebookHost) {}

  /** Take over every explorer in `views` (when `on`), or give them all back. */
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
        return Array.isArray(items) ? arrange(folder, items as ExplorerItem[]) : items;
      };
      const click = (event: MouseEvent) => this.onClick(event);
      view.containerEl?.addEventListener("click", click, true);
      view.containerEl?.addEventListener("auxclick", click, true);
      view[WRAPPED] = () => {
        view.containerEl?.removeEventListener("click", click, true);
        view.containerEl?.removeEventListener("auxclick", click, true);
      };
      this.wrapped.add(view);
      sortAgain(view);
    }
  }

  /** Give every explorer back its own listing, without the icons, and sort it again. */
  destroy(): void {
    for (const view of this.wrapped) {
      view[WRAPPED]?.();
      // The wrapper is an own property; the original lives on the prototype.
      delete view.getSortedFolderItems;
      delete view[WRAPPED];
      view.containerEl?.querySelectorAll(`.${ICON_CLASS}`).forEach((el) => el.remove());
      view.containerEl
        ?.querySelectorAll(`.${NOTEBOOK_ROW_CLASS}`)
        .forEach((el) => el.removeClass(NOTEBOOK_ROW_CLASS));
      sortAgain(view);
    }
    this.wrapped.clear();
  }

  /** A click on a notebook folder's name opens the notebook; its arrow, shift and alt are Obsidian's. */
  private onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.shiftKey || event.altKey) return;
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".collapse-icon")) return;
    const row = target.closest(`.nav-folder-title.${NOTEBOOK_ROW_CLASS}`);
    const path = row instanceof HTMLElement ? row.dataset.path : undefined;
    if (!path) return;
    const note = notebookOf(this.host.folder(path));
    if (!note) return;
    event.preventDefault();
    this.host.open(note, event.button === 1 || Keymap.isModEvent(event) !== false);
  }
}

function entriesOf(folder: TFolder): FolderEntry[] {
  return folder.children.map((child) => ({ name: child.name, folder: child instanceof TFolder }));
}

/** The notebook a folder is the folder of, or `null`. */
export function notebookOf(folder: TFolder | null): TFile | null {
  if (!folder || folder.isRoot()) return null;
  const name = folderNotebookName(folder.name, entriesOf(folder));
  const note = name ? folder.children.find((child) => child.name === name) : undefined;
  return note instanceof TFile ? note : null;
}

/** One folder's sorted items, without its own notebook, each row given its icon. */
function arrange(folder: unknown, items: ExplorerItem[]): ExplorerItem[] {
  const parent = folder instanceof TFolder ? folder : null;
  const own = notebookOf(parent);
  const inNotebook = own !== null;
  const out: ExplorerItem[] = [];
  for (const item of items) {
    if (own && item.file === own) continue;
    decorate(item, inNotebook);
    out.push(item);
  }
  return out;
}

function decorate(item: ExplorerItem, inNotebook: boolean): void {
  const row = item.selfEl;
  if (!row) return;
  const file = item.file;
  let icon: string | undefined;
  let notebookFolder = false;
  if (file instanceof TFolder) {
    notebookFolder = notebookOf(file) !== null;
    icon = notebookFolder ? NOTEBOOK_ICON : inNotebook ? ownFolderIcon(file.name) : undefined;
  } else if (file instanceof TFile && inkFileSuffix(file.name)) {
    icon = NOTEBOOK_ICON;
  }
  row.toggleClass(NOTEBOOK_ROW_CLASS, notebookFolder);
  let el = row.querySelector<HTMLElement>(`:scope > .${ICON_CLASS}`);
  if (!icon) {
    el?.remove();
    return;
  }
  if (!el) {
    el = createDiv({ cls: ICON_CLASS });
    // After the arrow, before the name.
    const name = row.querySelector(":scope > .tree-item-inner");
    row.insertBefore(el, name);
  }
  if (el.dataset.icon !== icon) {
    el.dataset.icon = icon;
    el.empty();
    setIcon(el, icon);
  }
}

function sortAgain(view: ExplorerView): void {
  try {
    view.requestSort?.();
  } catch {
    // An explorer half torn down: it sorts itself when it is built again.
  }
}
