/**
 * The toolbar's settings button: this notebook's own settings, the ones that
 * belong to one notebook rather than to every one.
 *
 *   [cover] Name (tap to rename)          the notebook itself, first
 *           23 pages · 911 KB · edited 19 Oct
 *           folder
 *   Pages         Scroll direction · Page numbers · Header
 *   Editing       Read-only
 *   Created …                    All FineNotes settings ›
 *
 * Settings sit in rounded groups with one-line hints; scroll direction is a
 * two-way switch. Where new files are saved is in FineNotes' own settings
 * (Advanced), for every notebook without a folder of its own.
 *
 * The modal only reports choices; the host applies them as undoable commands
 * and the modal re-reads the note, so what it shows is always what is stored.
 * The text fields follow the iPad keyboard (`DialogKeyboard`).
 */

import { type App, type EventRef, Modal, Setting, setIcon } from "obsidian";
import type { ScrollDirection } from "../model/document";
import type { NotebookFurniture } from "../model/furniture";
import { formatFileSize } from "../model/notebook-info";
import { DialogKeyboard } from "./dialog-keyboard";

/** What the summary card shows. */
export interface NotebookInfo {
  /** The name it shows as (its file name without the suffix). */
  name: string;
  pages: number;
  bytes: number;
  /** ms since the epoch. */
  created: number;
  modified: number;
  /** The vault folder it is in ("" is the vault root). */
  folder: string;
  /** The cover's colour, when its first page is a cover. */
  cover?: string;
}

export interface NoteSettingsHost {
  /** A single page rather than a notebook: only the wording changes. */
  single: boolean;
  /** Which way the pages run now. */
  scrollDirection: () => ScrollDirection;
  setScrollDirection: (direction: ScrollDirection) => void;
  /** The notebook's header and page numbers, and setting them. */
  furniture?: () => NotebookFurniture;
  setFurniture?: (furniture: NotebookFurniture | undefined) => void;
  /** Whether the notebook is read-only, and setting it. */
  readOnly: () => boolean;
  setReadOnly: (on: boolean) => void;
  /** The notebook's facts now. */
  info: () => NotebookInfo;
  /** Rename the notebook (and its own folder, when it has one). */
  rename: (name: string) => Promise<void>;
  /** Open FineNotes' own tab in Obsidian's settings. */
  openPluginSettings: () => void;
  /**
   * Paint the cover page, title and all, into `canvas` at `cssWidth`.
   * Resolves `false` when there is no cover to paint.
   */
  paintCover?: (canvas: HTMLCanvasElement, cssWidth: number) => Promise<boolean>;
}

/** The summary card's cover, in CSS px. */
const COVER_WIDTH = 96;

export class NoteSettingsModal extends Modal {
  /** Keeps the field being typed in above the keyboard. */
  private readonly keyboard: DialogKeyboard;
  /** The name and folder the summary card was drawn with. */
  private shown: { name: string; folder: string } | undefined;
  private renameRef: EventRef | undefined;

  constructor(
    app: App,
    private readonly host: NoteSettingsHost,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-note-settings", "goodobsidian-dialog");
    this.titleEl.setText(this.host.single ? "Page settings" : "Notebook settings");
    this.render();
    // A rename is not done when `rename` resolves: a notebook with its own
    // folder renames the folder, and the note follows it a tick later
    // (main.ts `keepFolderNotebookPaired`). A rename from the file explorer
    // behind the dialog lands here too. Redraw once what it shows is stale.
    this.renameRef = this.app.vault.on("rename", () => {
      const info = this.host.info();
      if (info.name !== this.shown?.name || info.folder !== this.shown?.folder) this.render();
    });
  }

  override onClose(): void {
    if (this.renameRef) this.app.vault.offref(this.renameRef);
    this.renameRef = undefined;
    this.keyboard.end();
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    // Re-rendering drops the field being typed in.
    this.keyboard.end();
    contentEl.empty();
    const info = this.host.info();
    this.renderSummary(contentEl, info);
    this.renderPages(contentEl);
    this.renderEditing(contentEl);
    this.renderFooter(contentEl, info);
  }

  /** A titled group of rows: the title above, the rows in one rounded frame. */
  private group(parent: HTMLElement, title: string): HTMLElement {
    parent.createDiv({ cls: "goodobsidian-ns-group-title", text: title });
    return parent.createDiv({ cls: "goodobsidian-ns-group" });
  }

  /**
   * The notebook first: its cover colour, its name (a field that reads as a
   * title until tapped, which renames it), and its facts on two lines.
   */
  private renderSummary(parent: HTMLElement, info: NotebookInfo): void {
    this.shown = { name: info.name, folder: info.folder };
    const card = parent.createDiv({ cls: "goodobsidian-ns-summary" });
    // The cover in its colour at once; then the real page, title and all, over it.
    const swatch = card.createDiv({ cls: "goodobsidian-ns-cover" });
    if (info.cover) swatch.setCssStyles({ backgroundColor: info.cover });
    else swatch.addClass("is-plain");
    const paint = this.host.paintCover;
    if (info.cover && paint) {
      const canvas = swatch.createEl("canvas", { cls: "goodobsidian-ns-cover-page" });
      void paint(canvas, COVER_WIDTH)
        .then((painted) => swatch.toggleClass("is-painted", painted))
        .catch(() => canvas.remove());
    }

    const body = card.createDiv({ cls: "goodobsidian-ns-summary-body" });
    const nameRow = body.createEl("label", { cls: "goodobsidian-ns-name" });
    const field = nameRow.createEl("input", {
      cls: "goodobsidian-ns-name-input",
      attr: {
        type: "text",
        "aria-label": this.host.single ? "Rename the page" : "Rename the notebook",
        spellcheck: "false",
      },
    });
    field.value = info.name;
    // As wide as the name, so the pencil sits right after it.
    const fit = (): void => {
      field.size = Math.max(4, Array.from(field.value).length + 1);
    };
    fit();
    field.addEventListener("input", fit);
    setIcon(nameRow.createSpan({ cls: "goodobsidian-ns-name-icon" }), "pencil");
    // Renamed when the field is left or Enter is pressed, not on every key.
    field.addEventListener("change", () => {
      const value = field.value.trim();
      if (!value || value === info.name) {
        field.value = info.name;
        fit();
        return;
      }
      void this.host.rename(value).then(() => this.render());
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") field.blur();
    });
    this.keyboard.watch(field, card);

    const facts: string[] = [];
    if (!this.host.single) facts.push(info.pages === 1 ? "1 page" : `${info.pages} pages`);
    const size = formatFileSize(info.bytes);
    if (size) facts.push(size);
    const edited = shortDate(info.modified);
    if (edited) facts.push(`edited ${edited}`);
    body.createDiv({ cls: "goodobsidian-ns-facts", text: facts.join(" · ") });
    const folder = body.createDiv({ cls: "goodobsidian-ns-facts" });
    setIcon(folder.createSpan({ cls: "goodobsidian-ns-facts-icon" }), "folder");
    folder.createSpan({ text: info.folder || "Vault's top folder" });
  }

  private renderPages(parent: HTMLElement): void {
    const group = this.group(parent, "Pages");
    // A single page has nowhere to scroll to.
    if (!this.host.single) {
      const row = new Setting(group).setName("Scroll direction");
      const seg = row.controlEl.createDiv({
        cls: "goodobsidian-ns-segmented",
        attr: { role: "radiogroup", "aria-label": "Scroll direction" },
      });
      const current = this.host.scrollDirection();
      for (const [value, label] of [
        ["vertical", "Vertical"],
        ["horizontal", "Horizontal"],
      ] as const) {
        const button = seg.createEl("button", {
          cls: "goodobsidian-ns-segment clickable-icon",
          text: label,
          attr: { type: "button", role: "radio", "aria-checked": String(value === current) },
        });
        button.toggleClass("is-active", value === current);
        button.addEventListener("click", () => {
          if (value === this.host.scrollDirection()) return;
          this.host.setScrollDirection(value);
          this.render();
        });
      }
    }
    this.renderFurniture(group);
  }

  /** Page numbers and a header, printed on every page but the cover. */
  private renderFurniture(group: HTMLElement): void {
    const get = this.host.furniture;
    const set = this.host.setFurniture;
    if (!get || !set) return;
    const current = get();
    new Setting(group)
      .setName("Page numbers")
      .setDesc("Not on the cover; in exports too.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "None")
          .addOption("center", "Bottom centre")
          .addOption("right", "Bottom right")
          .setValue(current.numbers ?? "none")
          .onChange((value) => {
            const next = { ...get() };
            if (value === "center" || value === "right") next.numbers = value;
            else delete next.numbers;
            set(next);
          }),
      );
    const header = new Setting(group)
      .setName("Header")
      .setDesc("{title}, {page} and {pages} are filled in.")
      .addText((text) => {
        text.setPlaceholder("{title}").setValue(current.header ?? "");
        // Set when the field is left, not on every key: each change is a step of undo.
        text.inputEl.addEventListener("change", () => {
          const next = { ...get() };
          const value = text.getValue().trim();
          if (value) next.header = value;
          else delete next.header;
          set(next);
        });
      });
    const field = header.controlEl.querySelector("input");
    if (field) this.keyboard.watch(field, header.settingEl);
  }

  private renderEditing(parent: HTMLElement): void {
    const group = this.group(parent, "Editing");
    new Setting(group)
      .setName("Read-only")
      .setDesc("Scroll, zoom, search and export still work.")
      .addToggle((toggle) =>
        toggle.setValue(this.host.readOnly()).onChange((on) => {
          this.host.setReadOnly(on);
          this.render();
        }),
      );
  }

  /** When it was made, and the way to every other setting. */
  private renderFooter(parent: HTMLElement, info: NotebookInfo): void {
    const footer = parent.createDiv({ cls: "goodobsidian-ns-footer" });
    const created = shortDate(info.created, true);
    footer.createSpan({
      cls: "goodobsidian-ns-footer-text",
      text: created ? `Created ${created}` : "",
    });
    const all = footer.createEl("button", {
      cls: "goodobsidian-ns-all clickable-icon",
      attr: { type: "button" },
    });
    all.createSpan({ text: "All FineNotes settings" });
    setIcon(all.createSpan({ cls: "goodobsidian-ns-all-icon" }), "chevron-right");
    all.addEventListener("click", () => {
      this.close();
      this.host.openPluginSettings();
    });
  }
}

/** A date in the reader's own format, "19 Oct" (with the year if asked); "" when unknown. */
function shortDate(ms: number, withYear = false): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}
