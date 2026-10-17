/**
 * The sticker picker: the built-in pack (`model/stickers`), recoloured from
 * one row of swatches, and the user's own collections — the subfolders of
 * the stickers folder in the vault, each a set of pictures.
 *
 *   Stickers
 *   (Arrows) (Labels) (Tape) (Icons) (Doodles) (My stickers) (Travel) …
 *   ● ● ● ● ● ● ●                       ← colour, built-in pack only
 *   ┌───┐ ┌───┐ ┌───┐ ┌───┐
 *   │ ↗ │ │ ⟳ │ │ → │ │ ↔ │             ← tap one to place it
 *   └───┘ └───┘ └───┘ └───┘
 *
 * A tap closes the picker and hands the choice to the host, which saves it
 * beside the notebook and places it: a built-in sticker as its SVG, one of
 * the user's as a copy of its file, so the notebook never depends on the
 * plugin or on the stickers folder staying as it is.
 */

import { type App, Modal, TFile, TFolder } from "obsidian";
import { PALETTE } from "../constants";
import { isImagePath } from "../canvas/image-raster";
import {
  STICKERS,
  STICKER_CATEGORIES,
  type Sticker,
  type StickerCategory,
  stickerSvg,
} from "../model/stickers";

/** What the user picked: a built-in sticker in a colour, or a file of theirs. */
export type StickerChoice =
  { kind: "builtin"; sticker: Sticker; color: string } | { kind: "file"; file: TFile };

/** The collection stickers saved from a selection go into. */
export const SAVED_STICKERS_COLLECTION = "My stickers";

/** The colour the picker opens with, remembered for the session. */
let lastColor: string = PALETTE[3];
/** The tab it opens on, remembered for the session. */
let lastTab = "arrows";

export class StickerModal extends Modal {
  private tab = lastTab;
  private color = lastColor;

  constructor(
    app: App,
    /** Vault folder of the user's collections; may not exist yet. */
    private readonly folder: string,
    private readonly pick: (choice: StickerChoice) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-sticker-modal");
    this.titleEl.setText("Stickers");
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  /** The user's collections: one per subfolder, then loose files as "My stickers". */
  private collections(): Array<{ name: string; files: TFile[] }> {
    const root = this.app.vault.getFolderByPath(this.folder);
    if (!(root instanceof TFolder)) return [];
    const images = (folder: TFolder): TFile[] =>
      folder.children
        .filter((c): c is TFile => c instanceof TFile && isImagePath(c.path))
        .sort((a, b) => a.basename.localeCompare(b.basename));
    const out: Array<{ name: string; files: TFile[] }> = [];
    const loose = images(root);
    for (const child of root.children) {
      if (child instanceof TFolder) out.push({ name: child.name, files: images(child) });
    }
    if (loose.length > 0 && !out.some((c) => c.name === SAVED_STICKERS_COLLECTION)) {
      out.push({ name: SAVED_STICKERS_COLLECTION, files: loose });
    }
    return out.filter((c) => c.files.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  }

  private render(): void {
    const body = this.contentEl;
    body.empty();
    const collections = this.collections();
    const tabs: Array<{ id: string; label: string }> = [
      ...STICKER_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
      ...collections.map((c) => ({ id: `mine:${c.name}`, label: c.name })),
    ];
    if (!tabs.some((t) => t.id === this.tab)) this.tab = "arrows";

    const chips = body.createDiv({ cls: "goodobsidian-sticker-tabs", attr: { role: "tablist" } });
    for (const t of tabs) {
      const chip = chips.createEl("button", {
        cls: "goodobsidian-sticker-tab clickable-icon",
        text: t.label,
        attr: { role: "tab", "aria-selected": String(t.id === this.tab) },
      });
      chip.toggleClass("is-active", t.id === this.tab);
      chip.addEventListener("click", () => {
        this.tab = t.id;
        lastTab = t.id;
        this.render();
      });
    }

    const mine = collections.find((c) => `mine:${c.name}` === this.tab);
    if (!mine) this.renderColors(body);
    const grid = body.createDiv({ cls: "goodobsidian-sticker-grid" });
    if (mine) {
      for (const file of mine.files) {
        this.cell(grid, file.basename, this.app.vault.getResourcePath(file), () =>
          this.choose({ kind: "file", file }),
        );
      }
    } else {
      for (const sticker of STICKERS.filter((s) => s.category === (this.tab as StickerCategory))) {
        const svg = stickerSvg(sticker, this.color);
        this.cell(
          grid,
          sticker.name,
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          () => this.choose({ kind: "builtin", sticker, color: this.color }),
        );
      }
    }
    body.createDiv({
      cls: "goodobsidian-sticker-hint",
      text: collections.length
        ? `Your own stickers live in “${this.folder}”: one folder per collection.`
        : `Lasso anything and choose “Save as sticker” to start your own collection in “${this.folder}”.`,
    });
  }

  private renderColors(body: HTMLElement): void {
    const row = body.createDiv({ cls: "goodobsidian-sticker-colors" });
    for (const color of PALETTE) {
      if (color === "#ffffff") continue;
      const swatch = row.createEl("button", {
        cls: "goodobsidian-sticker-swatch clickable-icon",
        attr: { "aria-label": `Colour ${color}`, "aria-pressed": String(color === this.color) },
      });
      swatch
        .createSpan({ cls: "goodobsidian-sticker-swatch-disc" })
        .setCssStyles({ backgroundColor: color });
      swatch.toggleClass("is-active", color === this.color);
      swatch.addEventListener("click", () => {
        this.color = color;
        lastColor = color;
        this.render();
      });
    }
  }

  private cell(grid: HTMLElement, label: string, src: string, onPick: () => void): void {
    const button = grid.createEl("button", {
      cls: "goodobsidian-sticker-cell clickable-icon",
      attr: { "aria-label": label, title: label },
    });
    button.createEl("img", { attr: { src, alt: "", draggable: "false" } });
    button.addEventListener("click", onPick);
  }

  private choose(choice: StickerChoice): void {
    this.close();
    this.pick(choice);
  }
}
