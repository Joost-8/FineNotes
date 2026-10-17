/**
 * The toolbar's settings button: this notebook's (or single page's) own
 * settings — which way its pages run (a notebook only), and where its new
 * pictures, recordings, recording transcripts, AI chats and PDF exports are saved. Each row takes a typed
 * path (with type-ahead, and a folder that does not exist yet is created on
 * the first save) or a pick from the full folder list, which is what a
 * finger on an iPad wants. An empty row means Obsidian's own "Default
 * location for new attachments" — or, for transcripts, the recording's
 * folder, and for exports, the note's own folder.
 *
 * The modal only reports choices; the host applies them as undoable commands
 * and the modal re-reads the note, so what it shows is always what is stored.
 *
 * Typing a path on the iPad (Joost's recording, 2026-09-22): the keyboard
 * covered the field being typed in, Obsidian's floating type-ahead list
 * placed itself over the toolbar because the field was under the keyboard,
 * and the app behind the dialog collapsed to black. So the matches are listed
 * inside the dialog, right under the field; while a field has focus the
 * dialog rises just far enough to keep the field and its list above the
 * keyboard; and Obsidian's keyboard cap is lifted as in the New notebook
 * dialog.
 */

import { type NotebookPalette, PALETTES } from "../model/palette";
import { type App, Modal, Setting } from "obsidian";
import { cleanFolder, suggestFolders } from "../model/attachment-folders";
import type { AttachmentFolders, AttachmentKind, ScrollDirection } from "../model/document";
import { FolderSuggestModal } from "./folder-suggest";
import { DialogKeyboard } from "./dialog-keyboard";
/** Most folders listed under a field at once. */
const SUGGESTIONS = 5;

export interface NoteSettingsHost {
  /** A single page rather than a notebook: only the wording changes. */
  single: boolean;
  /** The note's folders as stored now. */
  folders: () => AttachmentFolders;
  /** Set (`undefined` clears) where the note saves `kind`. */
  setFolder: (kind: AttachmentKind, folder: string | undefined) => void;
  /** Which way the pages run now. */
  scrollDirection: () => ScrollDirection;
  setScrollDirection: (direction: ScrollDirection) => void;
  /** Open FineNotes' own tab in Obsidian's settings. */
  openPluginSettings: () => void;
  /** The notebook's palette now, and setting another (which recolours it). */
  palette?: () => NotebookPalette;
  setPalette?: (palette: NotebookPalette) => void;
}

/** A row per kind; `empty` is what an empty row does, `reset` its button's tooltip. */
const ROWS: ReadonlyArray<{
  kind: AttachmentKind;
  name: string;
  desc: string;
  empty: string;
  reset: string;
}> = [
  {
    kind: "images",
    name: "Images and PDFs",
    desc: "Inserted, pasted, scanned and generated pictures, and imported PDFs.",
    empty: "Obsidian's default",
    reset: "Use Obsidian's default",
  },
  {
    kind: "audio",
    name: "Recordings",
    desc: "Audio recorded with the microphone button.",
    empty: "Obsidian's default",
    reset: "Use Obsidian's default",
  },
  {
    kind: "transcripts",
    name: "Recording transcripts",
    desc: "Notes made by transcribing a recording.",
    empty: "Next to the recording",
    reset: "Save next to the recording",
  },
  {
    kind: "chats",
    name: "AI chats",
    desc: "Ask AI conversations you save.",
    empty: "AI chats, next to the note",
    reset: "Save in AI chats, next to the note",
  },
  {
    kind: "exports",
    name: "PDF exports",
    desc: "PDFs made with the share button.",
    empty: "Next to the note",
    reset: "Save next to the note",
  },
];

export class NoteSettingsModal extends Modal {
  /** Keeps the row being typed in, and its folder list, above the keyboard. */
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
    // A single page has nowhere to scroll to.
    if (!this.host.single) this.renderScroll(contentEl);
    this.renderPalette(contentEl);
    new Setting(contentEl).setName("Where new files are saved").setHeading();
    contentEl.createDiv({
      cls: "setting-item-description goodobsidian-note-settings-intro",
      text:
        `Choose a folder for this ${this.host.single ? "page" : "notebook"}'s new ` +
        "files. Empty: pictures, PDFs and recordings follow Obsidian's attachment " +
        "setting, transcripts go next to their recording, AI chats in an AI " +
        "chats folder next to the note, and exports next to the note. Files " +
        "already saved stay " +
        "where they are.",
    });
    const folders = this.host.folders();
    for (const row of ROWS) this.renderRow(contentEl, row, folders[row.kind]);
    new Setting(contentEl)
      .setName("All FineNotes settings")
      .setDesc("Pens and tools, pages, handwriting, AI and more, for every notebook.")
      .addButton((button) =>
        button.setButtonText("Open").onClick(() => {
          this.close();
          this.host.openPluginSettings();
        }),
      );
  }

  /**
   * The notebook's colours: a chip per curated palette, its six colours over
   * its name. A pick recolours what is in the old palette's colours, as one
   * step of undo.
   */
  private renderPalette(parent: HTMLElement): void {
    const current = this.host.palette?.();
    const setPalette = this.host.setPalette;
    if (!current || !setPalette) return;
    new Setting(parent).setName("Colours").setHeading();
    parent.createDiv({
      cls: "setting-item-description goodobsidian-note-settings-intro",
      text:
        "The colours offered first in every colour picker. Choosing other colours " +
        "recolours the ink, shapes and text that use this notebook's colours; undo takes it back.",
    });
    const row = parent.createDiv({ cls: "goodobsidian-palette-chips" });
    for (const palette of PALETTES) {
      const on = palette.id === current.id;
      const chip = row.createEl("button", {
        cls: "goodobsidian-palette-chip clickable-icon",
        attr: { "aria-label": `${palette.name} colours`, "aria-pressed": String(on) },
      });
      chip.toggleClass("is-active", on);
      const dots = chip.createDiv({ cls: "goodobsidian-palette-dots" });
      for (const color of palette.colors) {
        dots
          .createSpan({ cls: "goodobsidian-palette-dot" })
          .setCssStyles({ backgroundColor: color });
      }
      chip.createDiv({ cls: "goodobsidian-palette-name", text: palette.name });
      chip.addEventListener("click", () => {
        if (on) return;
        setPalette(palette);
        this.render();
      });
    }
  }

  private renderScroll(parent: HTMLElement): void {
    new Setting(parent).setName("Pages").setHeading();
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

  private renderRow(
    parent: HTMLElement,
    row: (typeof ROWS)[number],
    current: string | undefined,
  ): void {
    const choose = (value: string): void => {
      const folder = cleanFolder(value);
      if (folder !== current) this.host.setFolder(row.kind, folder);
      this.render();
    };
    let input: HTMLInputElement | null = null;
    const setting = new Setting(parent)
      .setName(row.name)
      .setDesc(row.desc)
      .addText((text) => {
        text.setPlaceholder(row.empty).setValue(current ?? "");
        input = text.inputEl;
        input.addClass("goodobsidian-note-settings-path");
        // Committed on blur or Enter, not per keystroke: every change is an
        // undo step on the note.
        input.addEventListener("change", () => choose(text.getValue()));
      })
      .addExtraButton((button) =>
        button
          .setIcon("folder")
          .setTooltip("Choose from folders")
          .onClick(() => {
            new FolderSuggestModal(
              this.app,
              choose,
              `Choose a folder for this note's ${row.name.toLowerCase()}`,
              current ?? "",
            ).open();
          }),
      );
    if (current !== undefined) {
      setting.addExtraButton((button) =>
        button
          .setIcon("rotate-ccw")
          .setTooltip(row.reset)
          .onClick(() => choose("")),
      );
    }
    // The matches for what is typed, in the dialog itself, under the field.
    const list = parent.createDiv({
      cls: "goodobsidian-folder-list is-hidden",
      attr: { role: "listbox", "aria-label": `Folders for ${row.name.toLowerCase()}` },
    });
    const field = input as HTMLInputElement | null;
    if (!field) return;
    const fill = (): void => {
      list.empty();
      const matches = suggestFolders(this.folderPaths(), field.value, SUGGESTIONS);
      for (const path of matches) {
        const item = list.createEl("button", {
          cls: "goodobsidian-folder-item clickable-icon",
          text: path,
          attr: { role: "option" },
        });
        // Keep the field's focus (and the keyboard) until the choice is made.
        item.addEventListener("pointerdown", (event) => event.preventDefault());
        item.addEventListener("mousedown", (event) => event.preventDefault());
        item.addEventListener("click", () => {
          field.value = path;
          choose(path);
        });
      }
      list.toggleClass("is-hidden", matches.length === 0);
      this.keyboard.update();
    };
    field.addEventListener("pointerdown", () => {
      if (document.activeElement !== field) this.keyboard.holdWindow(field);
    });
    field.addEventListener("focus", () => {
      this.keyboard.start(setting.settingEl, list);
      fill();
    });
    field.addEventListener("input", fill);
    field.addEventListener("blur", () => {
      list.addClass("is-hidden");
      // Straight into the other row's field: that focus takes over.
      this.keyboard.endFor(setting.settingEl);
    });
  }

  /** Every folder in the vault but the root, alphabetically. */
  private folderPaths(): string[] {
    return this.app.vault
      .getAllFolders(false)
      .map((folder) => folder.path)
      .sort((a, b) => a.localeCompare(b));
  }
}
