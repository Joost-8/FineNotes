/**
 * The Folders sidebar's menus: the one on a folder or note (right-click,
 * long press, or the ⋯ button), and the dropdowns of the library.
 *
 * Only one of these menus is open at a time, and a tap that closes one must
 * not open another straight away (the ⋯ button that opened it would reopen
 * it); touch also fires a synthetic click and contextmenu after a tap, which
 * would reopen what was just closed. The module keeps that small state.
 */

import {
  type Component,
  Menu,
  Platform,
  type TAbstractFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import { t } from "../../i18n/translate";
import type { FolderSidebarController } from "./controller";
import { DeleteFolderModal, FolderColorModal, promptRenameFolder } from "./modals";

/** What to do instead of the built-in Rename and New subfolder (the sidebar renames in place). */
export interface FolderMenuActions {
  rename?: () => void;
  newSubfolder?: () => void;
}

/** Where a menu opens: at a mouse event, or at a point. */
export type MenuPlace = MouseEvent | { x: number; y: number };

export interface OpenMenuOptions {
  actions?: FolderMenuActions;
  /** The element that opened the menu: tapping it again closes the menu. */
  anchor?: HTMLElement;
}

/** The parts of Obsidian's Menu this module reaches into. */
interface MenuInternals {
  items?: MenuItemInternals[];
  dom?: HTMLElement;
  bgEl?: HTMLElement;
  hideCallback?: () => void;
  currentSubmenu?: MenuInternals | null;
}

interface MenuItemInternals {
  dom?: HTMLElement;
  titleEl?: HTMLElement;
}

const internals = (menu: Menu): MenuInternals => menu as unknown as MenuInternals;

/** The menu items Obsidian and other plugins add that the sidebar replaces with its own. */
const REPLACED_TITLE = /^(rename|delete)(…|\.\.\.)?$/i;

/** The menu for a folder or a note. */
function buildMenu(
  controller: FolderSidebarController,
  file: TAbstractFile,
  leaf: WorkspaceLeaf,
  actions: FolderMenuActions,
): Menu {
  const { app } = controller;
  const menu = new Menu();
  const own: unknown[] = [];
  if (file instanceof TFolder) {
    const folder = file;
    const add = (title: string, icon: string, onClick: () => void, warning = false): void => {
      menu.addItem((item) => {
        item.setTitle(title).setIcon(icon).setSection("fs").onClick(onClick);
        if (warning) item.setWarning(true);
        own.push(item);
      });
    };
    add(t("common.rename"), "pencil", actions.rename ?? (() => promptRenameFolder(app, folder)));
    add(
      t("view.folders.newSubfolder"),
      "folder-plus",
      actions.newSubfolder ?? (() => void controller.startSubfolder(folder.path)),
    );
    const pinned = controller.isPinned(folder.path);
    add(pinned ? t("view.folders.unpin") : t("view.folders.pin"), pinned ? "pin-off" : "pin", () =>
      controller.togglePinned(folder.path),
    );
    add(t("view.folders.colorMenu"), "palette", () =>
      new FolderColorModal(app, controller, folder).open(),
    );
    add(t("common.delete"), "trash-2", () => new DeleteFolderModal(app, folder).open(), true);
  }
  // Other plugins add their items (FineNotes' New notebook, for one).
  app.workspace.trigger("file-menu", menu, file, "file-explorer-context-menu", leaf);
  if (file instanceof TFolder) {
    // Rename and Delete are already there, in the sidebar's own words.
    const ownSet = new Set<unknown>(own);
    const ownDom = new Set<unknown>(
      own.map((item) => (item as MenuItemInternals).dom).filter(Boolean),
    );
    const titleOf = (el: HTMLElement | undefined): string =>
      el?.querySelector(".menu-item-title")?.textContent?.trim() ?? "";
    const items = internals(menu).items;
    if (items) {
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (ownSet.has(item) || (item.dom && ownDom.has(item.dom))) continue;
        const title = item.titleEl?.textContent?.trim() ?? titleOf(item.dom);
        if (REPLACED_TITLE.test(title)) {
          item.dom?.remove();
          items.splice(i, 1);
        }
      }
    }
    internals(menu)
      .dom?.querySelectorAll<HTMLElement>(".menu-item")
      .forEach((el) => {
        if (!ownDom.has(el) && REPLACED_TITLE.test(titleOf(el))) el.remove();
      });
  }
  return menu;
}

// --- Which menu is open ---------------------------------------------------------------

let openMenuRef: Menu | null = null;
let removeCloseListeners: (() => void) | null = null;
let openAnchor: HTMLElement | null = null;
/** The element whose menu closed last, and when: tapping it again does not reopen it. */
let lastClosed: { anchor: HTMLElement | null; at: number } = { anchor: null, at: 0 };
/** How long after closing a menu its anchor ignores a tap, ms. */
const REOPEN_GRACE_MS = 800;
const liveMenus = new Set<Menu>();
/** Until when a synthetic contextmenu after a touch is ignored. */
let touchMenuUntil = 0;
let touching = false;
/** How long after a touch ends its synthetic mouse events are ignored, ms. */
const AFTER_TOUCH_MS = 800;
let touchEndedUntil = 0;
/** Two menus opened within this many ms of each other: the second is ignored, ms. */
const DOUBLE_OPEN_MS = 400;
let lastOpenedAt = 0;

/** The open dom elements of `menu` and its submenus. */
function menuElements(menu: Menu | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  let current: MenuInternals | null | undefined = menu ? internals(menu) : null;
  for (let depth = 0; current && depth < 10; depth++) {
    if (current.dom) out.push(current.dom);
    current = current.currentSubmenu;
  }
  return out;
}

function disposeMenu(menu: Menu): void {
  liveMenus.delete(menu);
  const { dom, bgEl } = internals(menu);
  try {
    menu.hide();
  } catch {
    // Already gone.
  }
  if (dom?.isConnected) dom.remove();
  if (bgEl?.isConnected) bgEl.remove();
}

/** Remove menus left on the page, except `keep` and its submenus. */
function removeStrayMenus(doc: Document, keep: Menu | null): void {
  const kept = keep ? menuElements(keep) : [];
  doc.body.querySelectorAll(":scope > .menu").forEach((el) => {
    if (!kept.includes(el as HTMLElement)) el.remove();
  });
}

/** Close every menu of the sidebar. */
export function closeMenus(): void {
  const removeListeners = removeCloseListeners;
  if (openMenuRef) lastClosed = { anchor: openAnchor, at: Date.now() };
  openAnchor = null;
  openMenuRef = null;
  removeCloseListeners = null;
  removeListeners?.();
  for (const menu of Array.from(liveMenus)) disposeMenu(menu);
  removeStrayMenus(activeDocument, null);
  activeDocument.body.removeClass("fs-menu-open");
}

/**
 * Show `menu` (`place` says where), closing any other, and close it on a tap
 * outside or Escape. A tap on `anchor` right after its menu closed does
 * nothing, so the button that opened a menu also closes it.
 */
export function showMenu(menu: Menu, place: () => void, anchor?: HTMLElement): void {
  if (anchor && lastClosed.anchor === anchor && Date.now() - lastClosed.at < REOPEN_GRACE_MS) {
    lastClosed = { anchor: null, at: 0 };
    return;
  }
  closeMenus();
  openMenuRef = menu;
  openAnchor = anchor ?? null;
  liveMenus.add(menu);
  const doc = activeDocument;
  const win = activeWindow;
  let armTimer: number | null = null;
  const onOutside = (event: Event): void => {
    if (openMenuRef !== menu) return;
    const target = event.target as Node | null;
    if (target && menuElements(menu).some((el) => el.contains(target))) return;
    closeMenus();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && openMenuRef === menu) closeMenus();
  };
  const removeListeners = (): void => {
    if (armTimer !== null) {
      win.clearTimeout(armTimer);
      armTimer = null;
    }
    win.removeEventListener("pointerdown", onOutside, true);
    win.removeEventListener("touchstart", onOutside, true);
    win.removeEventListener("keydown", onKey, true);
  };
  removeCloseListeners = removeListeners;
  const previousHide = internals(menu).hideCallback;
  menu.onHide(() => {
    previousHide?.();
    liveMenus.delete(menu);
    if (openMenuRef === menu) {
      lastClosed = { anchor: openAnchor, at: Date.now() };
      openAnchor = null;
      openMenuRef = null;
      removeCloseListeners = null;
      doc.body.removeClass("fs-menu-open");
    }
    removeListeners();
  });
  internals(menu).dom?.addClass("fs-menu");
  doc.body.addClass("fs-menu-open");
  place();
  removeStrayMenus(doc, menu);
  armTimer = win.setTimeout(() => {
    armTimer = null;
    if (openMenuRef !== menu) return;
    win.addEventListener("pointerdown", onOutside, true);
    win.addEventListener("touchstart", onOutside, true);
    win.addEventListener("keydown", onKey, true);
  }, 0);
}

/** Track touches, so the mouse events a touch makes afterwards are not taken for a click. */
export function watchTouches(owner: Component): void {
  const begin = (): void => {
    touching = true;
  };
  const end = (): void => {
    touching = false;
    touchEndedUntil = Date.now() + AFTER_TOUCH_MS;
  };
  owner.registerDomEvent(activeDocument, "touchstart", begin, { capture: true, passive: true });
  owner.registerDomEvent(activeDocument, "touchend", end, { capture: true, passive: true });
  owner.registerDomEvent(activeDocument, "touchcancel", end, { capture: true, passive: true });
}

/** Whether a touch is on the screen, or just ended or opened a menu. */
export function touchIsActive(): boolean {
  return touching || Date.now() < touchEndedUntil || Date.now() < touchMenuUntil;
}

/** A contextmenu event: open the menu, unless it is the echo of a touch. */
export function onContextMenu(
  controller: FolderSidebarController,
  file: TAbstractFile,
  leaf: WorkspaceLeaf,
  event: MouseEvent,
  options: OpenMenuOptions = {},
): void {
  event.preventDefault();
  if (!touchIsActive()) openFileMenu(controller, file, leaf, event, options);
}

/** Open the menu of a folder or note at `place`. */
export function openFileMenu(
  controller: FolderSidebarController,
  file: TAbstractFile,
  leaf: WorkspaceLeaf,
  place: MenuPlace,
  options: OpenMenuOptions = {},
): void {
  const now = Date.now();
  if (
    options.anchor &&
    lastClosed.anchor === options.anchor &&
    now - lastClosed.at < REOPEN_GRACE_MS
  ) {
    lastClosed = { anchor: null, at: 0 };
    return;
  }
  if (openMenuRef && now - lastOpenedAt < DOUBLE_OPEN_MS) return;
  lastOpenedAt = now;
  if (Platform.isMobile || !(place instanceof MouseEvent)) touchMenuUntil = now + AFTER_TOUCH_MS;
  const menu = buildMenu(controller, file, leaf, options.actions ?? {});
  showMenu(
    menu,
    () => {
      if (place instanceof MouseEvent) menu.showAtMouseEvent(place);
      else menu.showAtPosition({ x: place.x, y: place.y });
    },
    options.anchor,
  );
}

// --- Long press ----------------------------------------------------------------------------

/** Hold this long to open the menu, ms. */
const LONG_PRESS_MS = 500;
/** Moving more than this before then cancels the hold, px. */
const LONG_PRESS_SLOP = 10;
/** The click a long press ends with is ignored for this long, ms. */
const LONG_PRESS_CLICK_MS = 600;

/** Open a menu (`onPress`) when `el` is held with one finger. */
export function onLongPress(
  el: HTMLElement,
  onPress: (at: { x: number; y: number }) => void,
): void {
  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let swallowClickUntil = 0;
  const cancel = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  el.addEventListener(
    "touchstart",
    (event) => {
      cancel();
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      timer = window.setTimeout(() => {
        timer = null;
        swallowClickUntil = Date.now() + LONG_PRESS_CLICK_MS;
        onPress({ x: startX, y: startY });
      }, LONG_PRESS_MS);
    },
    { passive: true },
  );
  el.addEventListener(
    "touchmove",
    (event) => {
      if (timer === null || event.touches.length === 0) return;
      const touch = event.touches[0];
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > LONG_PRESS_SLOP) cancel();
    },
    { passive: true },
  );
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener(
    "click",
    (event) => {
      if (Date.now() < swallowClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        swallowClickUntil = 0;
      }
    },
    true,
  );
}
