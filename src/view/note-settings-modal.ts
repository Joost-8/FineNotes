/**
 * The toolbar's settings button: this notebook's own settings, the ones that
 * belong to one notebook rather than to every one.
 *
 *   Pages         Scroll direction · Page numbers · Header
 *   Editing       Read-only
 *   Notebook      Name (renames it) · pages · size · created · edited · folder
 *                 All FineNotes settings  [Open]
 *
 * Where new files are saved is in FineNotes' own settings (Advanced), for
 * every notebook without a folder of its own.
 *
 * The modal only reports choices; the host applies them as undoable commands
 * and the modal re-reads the note, so what it shows is always what is stored.
 * The text fields follow the iPad keyboard (`DialogKeyboard`).
 */

import { type App, Modal, Setting } from "obsidian";
import type { ScrollDirection } from "../model/document";
import type { NotebookFurniture } from "../model/furniture";
import { formatFileSize } from "../model/notebook-info";
import { DialogKeyboard } from "./dialog-keyboard";

/** What the Notebook section shows. */
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
}

export class NoteSettingsModal extends Modal {
  /** Keeps the field being typed in above the keyboard. */
  private readonly keyboard: DialogKeyboard;

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
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    // Re-rendering drops the field being typed in.
    this.keyboard.end();
    contentEl.empty();
    this.renderPages(contentEl);
    this.renderEditing(contentEl);
    this.renderInfo(contentEl);
  }

  private renderPages(parent: HTMLElement): void {
    new Setting(parent).setName("Pages").setHeading();
    // A single page has nowhere to scroll to.
    if (!this.host.single) {
      new Setting(parent)
        .setName("Scroll direction")
        .setDesc(
          "Vertical scrolls through the pages; horizontal turns them one at a time. " +
            "Either way, pull past the last page to add one.",
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOption("vertical", "Vertical")
            .addOption("horizontal", "Horizontal")
            .setValue(this.host.scrollDirection())
            .onChange((value) => {
              this.host.setScrollDirection(value === "horizontal" ? "horizontal" : "vertical");
            }),
        );
    }
    this.renderFurniture(parent);
  }

  /** Page numbers and a header, printed on every page but the cover. */
  private renderFurniture(parent: HTMLElement): void {
    const get = this.host.furniture;
    const set = this.host.setFurniture;
    if (!get || !set) return;
    const current = get();
    new Setting(parent)
      .setName("Page numbers")
      .setDesc("Printed at the foot of every page but the cover, in exports too.")
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
    const header = new Setting(parent)
      .setName("Header")
      .setDesc(
        "Printed at the top of every page but the cover. {title}, {page} and {pages} are filled in.",
      )
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
    new Setting(parent).setName("Editing").setHeading();
    new Setting(parent)
      .setName("Read-only")
      .setDesc(
        "Nothing can write, erase or change the pages, so a stray Pencil or palm leaves " +
          "them alone. You can still scroll, zoom, search and export.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.host.readOnly()).onChange((on) => {
          this.host.setReadOnly(on);
          this.render();
        }),
      );
  }

  private renderInfo(parent: HTMLElement): void {
    const info = this.host.info();
    new Setting(parent).setName(this.host.single ? "Page" : "Notebook").setHeading();
    const name = new Setting(parent)
      .setName("Name")
      .setDesc("Renames the notebook, and its folder when it has one of its own.")
      .addText((text) => {
        text.setValue(info.name);
        text.inputEl.addEventListener("change", () => {
          const value = text.getValue().trim();
          if (!value || value === info.name) return;
          void this.host.rename(value).then(() => this.render());
        });
      });
    const field = name.controlEl.querySelector("input");
    if (field) this.keyboard.watch(field, name.settingEl);
    const facts = parent.createDiv({ cls: "goodobsidian-note-info" });
    const fact = (label: string, value: string) => {
      const row = facts.createDiv({ cls: "goodobsidian-note-info-row" });
      row.createSpan({ cls: "goodobsidian-note-info-label", text: label });
      row.createSpan({ cls: "goodobsidian-note-info-value", text: value });
    };
    if (!this.host.single) fact("Pages", String(info.pages));
    fact("Size", formatFileSize(info.bytes));
    fact("Created", dateTime(info.created));
    fact("Last edited", dateTime(info.modified));
    fact("Folder", info.folder || "Vault root");
    new Setting(parent)
      .setName("All FineNotes settings")
      .setDesc(
        "Pens and tools, pages, handwriting, AI, and where new files are saved, for every notebook.",
      )
      .addButton((button) =>
        button.setButtonText("Open").onClick(() => {
          this.close();
          this.host.openPluginSettings();
        }),
      );
  }
}

/** A date and time in the reader's own format; "" when unknown. */
function dateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
