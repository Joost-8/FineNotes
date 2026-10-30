/**
 * The "Insert image" menu: the popover the toolbar's image button opens,
 * after GoodNotes' — Photos, Take photo, From vault — and the vault picker
 * behind its last entry.
 *
 * ## Adding an entry (the seam later features use)
 *
 * The menu is a list, not a hard-coded layout. A feature adds a row with
 * {@link registerImageMenuEntry}, typically from the plugin's `onload`, and
 * hands the returned disposer to `plugin.register` so it goes away on unload:
 *
 * ```ts
 * this.register(
 *   registerImageMenuEntry({
 *     id: "scan",
 *     icon: "scan-line",
 *     label: "Scan document",
 *     order: 40,
 *     run: (ctx) => void scanThenInsert(ctx),
 *   }),
 * );
 * ```
 *
 * `run` receives an {@link ImageMenuContext}; `ctx.insertBytes` is the one
 * call that saves a picture and places it on the page in view (it is
 * `InkView.insertImageBytes`). Every view reads the registry when its menu
 * opens, so an entry registered late still shows up.
 */

import { type App, FuzzySuggestModal, Notice, Platform, type TFile, setIcon } from "obsidian";
import { isImagePath } from "../canvas/image-raster";
import type { ImageElement } from "../model/document";
import { pickImageFile } from "./image-import";
import { menuAnchor, menuPlace } from "./bar-dock-model";

/** Options for placing a picture; every field is optional. */
export interface InsertImageOptions {
  /** 0-based page to place it on. Default: the page in view. */
  pageIndex?: number;
  /**
   * Page-space box to place it in, instead of the default (centred in the
   * visible part of the page, fitted inside 60 % of it, aspect kept).
   */
  box?: { x: number; y: number; w: number; h: number; rotation?: number };
  /** Page-space point to centre it on (kept on the page), instead of the visible part's centre. */
  center?: { x: number; y: number };
  /** Select it once placed, as GoodNotes does. Default `true`. */
  select?: boolean;
}

/** What an entry can do. Built fresh by the view each time the menu opens. */
export interface ImageMenuContext {
  app: App;
  /** Vault path of the note the picture goes into (attachments follow it). */
  notePath: string;
  /**
   * The view's content element. A hidden `<input type=file>` or anything
   * else temporary is appended here, so it goes away with the view.
   */
  host: HTMLElement;
  /**
   * Save picture bytes as an attachment and place them on the page:
   * downscaled to 2048 px and re-encoded where that helps (see
   * `prepareImageBytes`). Resolves with the placed element, or `null` when
   * nothing was placed (the note is protected, or the bytes are not a
   * picture — the user has been told).
   */
  insertBytes: (
    bytes: ArrayBuffer,
    mime: string,
    suggestedName: string,
    options?: InsertImageOptions,
  ) => Promise<ImageElement | null>;
  /** Place a picture that is already in the vault, by path. No copy is made. */
  insertVaultFile: (path: string, options?: InsertImageOptions) => Promise<ImageElement | null>;
}

/** A colour an entry offers beside its name, as a swatch. */
export interface ImageMenuSwatch {
  /** `#rrggbb`. */
  color: string;
  /** Its name, for the tooltip. */
  label: string;
}

export interface ImageMenuEntry {
  /** Unique; registering an id again replaces the earlier entry. */
  id: string;
  /** Lucide icon name. */
  icon: string;
  label: string;
  /** Position in the menu, low first. Built-ins use 10, 20, 30. Default 100. */
  order?: number;
  /** Hide the entry where it cannot work (the camera on a desktop). */
  isAvailable?: () => boolean;
  /**
   * Colours offered beside the name: a tap on one runs the entry with it,
   * a tap on the name with the one used last (ringed), else the first.
   */
  swatches?: readonly ImageMenuSwatch[];
  /**
   * Called synchronously inside the tap that chose the entry, after the menu
   * closed. Anything that needs a user gesture — opening a file picker or the
   * camera — must start before the first `await`.
   */
  run: (ctx: ImageMenuContext, color?: string) => void;
}

const extras = new Map<string, ImageMenuEntry>();

/**
 * Add a row to every view's image menu. Returns a disposer that removes it
 * again (pass it to `plugin.register`).
 */
export function registerImageMenuEntry(entry: ImageMenuEntry): () => void {
  extras.set(entry.id, entry);
  return () => {
    if (extras.get(entry.id) === entry) extras.delete(entry.id);
  };
}

/** Photos, camera and vault — the entries every notebook has. */
export const BUILT_IN_IMAGE_ENTRIES: readonly ImageMenuEntry[] = [
  {
    id: "photos",
    icon: "image",
    label: "Photos",
    order: 10,
    run: (ctx) => void pickAndInsert(ctx, false),
  },
  {
    id: "camera",
    icon: "camera",
    label: "Take photo",
    order: 20,
    // A desktop "capture" input is just a second file dialog.
    isAvailable: () => Platform.isMobile,
    run: (ctx) => void pickAndInsert(ctx, true),
  },
  {
    id: "vault",
    icon: "folder-open",
    label: "From vault",
    order: 30,
    run: (ctx) =>
      new VaultImageSuggestModal(ctx.app, (file) => void ctx.insertVaultFile(file.path)).open(),
  },
];

/** The swatch each entry ran with last, by entry id: a tap on the name uses it again. */
const lastSwatch = new Map<string, string>();

/**
 * Every available entry, in menu order. A registered entry with a built-in's
 * id replaces that built-in.
 */
export function imageMenuEntries(): ImageMenuEntry[] {
  const builtIns = BUILT_IN_IMAGE_ENTRIES.filter((entry) => !extras.has(entry.id));
  return [...builtIns, ...extras.values()]
    .filter((entry) => entry.isAvailable?.() ?? true)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Photos / Take photo. `pickImageFile` runs before this function's first
 * `await`, i.e. still inside the tap, which is what lets the picker open.
 */
async function pickAndInsert(ctx: ImageMenuContext, capture: boolean): Promise<void> {
  const file = await pickImageFile(ctx.host, capture);
  if (!file) return;
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    new Notice("FineNotes: couldn't read that picture.");
    return;
  }
  await ctx.insertBytes(bytes, file.type, file.name);
}

const POPOVER_WIDTH = 280;

/**
 * The menu itself: a small sheet under the toolbar button, in the same style
 * as the Add Page popover. Attached to `<body>` so no view can clip it.
 */
export class ImageMenuPopover {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly anchor: HTMLElement,
    entries: readonly ImageMenuEntry[],
    private readonly context: ImageMenuContext,
    title = "Insert image",
  ) {
    this.el = document.body.createDiv({ cls: "goodobsidian-addpage goodobsidian-imagemenu" });
    this.el.setAttribute("role", "menu");
    this.el.setAttribute("aria-label", title);
    this.el.createDiv({ cls: "goodobsidian-addpage-title", text: title });
    for (const entry of entries) this.addRow(entry);
    this.place();
    this.installDismiss();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const d of this.dispose) d();
    this.el.remove();
  }

  private addRow(entry: ImageMenuEntry): void {
    const swatches = entry.swatches ?? [];
    const host =
      swatches.length > 0 ? this.el.createDiv({ cls: "goodobsidian-imagemenu-split" }) : this.el;
    // `clickable-icon`: Obsidian pads every other button 20 px on an iPad.
    const row = host.createEl("button", {
      cls: "goodobsidian-addpage-row goodobsidian-imagemenu-row clickable-icon",
    });
    row.setAttribute("role", "menuitem");
    setIcon(row.createSpan({ cls: "goodobsidian-addpage-row-icon" }), entry.icon);
    row.createSpan({ text: entry.label });
    const last = lastSwatch.get(entry.id) ?? swatches[0]?.color;
    const choose = (color?: string): void => {
      this.close();
      if (color !== undefined) lastSwatch.set(entry.id, color);
      // Synchronously, inside this tap: a file picker only opens for a
      // click() made during a user gesture.
      entry.run(this.context, color);
    };
    row.addEventListener("click", () => choose(last));
    for (const swatch of swatches) {
      const button = host.createEl("button", {
        cls: "goodobsidian-imagemenu-swatch clickable-icon",
        attr: { "aria-label": `${entry.label}: ${swatch.label}`, role: "menuitem" },
      });
      button.toggleClass("is-last", swatch.color === last);
      button.createSpan({ cls: "goodobsidian-imagemenu-swatch-dot" }).setCssStyles({
        backgroundColor: swatch.color,
      });
      button.addEventListener("click", () => choose(swatch.color));
    }
  }

  /**
   * Below the anchor, right-aligned to it, kept inside the window; toward
   * the page from a tool bar at another edge (`menuAnchor`).
   */
  private place(): void {
    const r = this.anchor.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
    const { side, box } = menuAnchor(this.anchor);
    if (side !== "down") {
      const size = { width, height: this.el.offsetHeight };
      const room = { width: window.innerWidth, height: window.innerHeight };
      const at = menuPlace(side, box, size, room, "end", 6, 8);
      this.el.setCssStyles({ left: `${at.left}px`, top: `${at.top}px`, width: `${width}px` });
      return;
    }
    let left = r.right - width;
    if (left < 8) left = Math.min(r.left, window.innerWidth - width - 8);
    left = Math.max(8, left);
    const height = this.el.offsetHeight;
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
    this.el.setCssStyles({ left: `${left}px`, top: `${top}px`, width: `${width}px` });
  }

  private installDismiss(): void {
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && (this.el.contains(target) || this.anchor.contains(target))) return;
      this.close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.close();
    };
    const onResize = (): void => {
      if (this.anchor.isConnected) this.place();
      else this.close();
    };
    // Capture: the drawing surface consumes its own pointer events.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    this.dispose.push(() => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    });
  }
}

/**
 * "From vault": a fuzzy search over every picture in the vault. The chosen
 * file is placed by its existing path — nothing is copied.
 */
export class VaultImageSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onPick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Find a picture in the vault…");
  }

  getItems(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((file) => isImagePath(file.path))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
