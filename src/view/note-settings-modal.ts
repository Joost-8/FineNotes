/**
 * The toolbar's settings button: this notebook's own settings, the ones that
 * belong to one notebook rather than to every one.
 *
 *   FineNotes 2.6.0 is out      [Update]  only while one is out
 *   Don't show again
 *   [cover] Name (tap to rename)          the notebook itself
 *           23 pages · 911 KB
 *           Created … · edited 19 Oct
 *           folder
 *   Scroll direction · Join pages · Page numbers · Header   (not on a board)
 *   Read-only · Simple look
 *   [⚙ All FineNotes settings              ›]  everything else
 *
 * The rows sit in one rounded frame with no titles, each hint behind the ⓘ
 * after its name, so the whole dialog fits an iPad's landscape screen and
 * the card to every other setting shows without scrolling. Scroll direction
 * is a two-way switch. Where new files are saved is in FineNotes' own settings
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
import { onEnterKey } from "./enter-key";
import { t, tn } from "../i18n/translate";
import { addInfo } from "../settings";

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
  /** An endless board (FineNotes#46, a single page too): no Pages group, it has none. */
  board?: boolean;
  /** Which way the pages run now. */
  scrollDirection: () => ScrollDirection;
  setScrollDirection: (direction: ScrollDirection) => void;
  /** Whether the pages are joined (no gap, writing runs on), and setting it. */
  joinedPages?: () => boolean;
  setJoinedPages?: (on: boolean) => void;
  /** The notebook's header and page numbers, and setting them. */
  furniture?: () => NotebookFurniture;
  setFurniture?: (furniture: NotebookFurniture | undefined) => void;
  /** The simple look (Obsidian's own bars hidden): one setting for every notebook. */
  simpleLook?: () => boolean;
  setSimpleLook?: (on: boolean) => void;
  /** Whether the notebook is read-only, and setting it. */
  readOnly: () => boolean;
  setReadOnly: (on: boolean) => void;
  /** The notebook's facts now. */
  info: () => NotebookInfo;
  /** Rename the notebook (and its own folder, when it has one). */
  rename: (name: string) => Promise<void>;
  /** Open FineNotes' own tab in Obsidian's settings. */
  openPluginSettings: () => void;
  /** A newer FineNotes that is out, marked on the way to the settings; null when none. */
  update?: string | null;
  /** Open FineNotes' page under Community plugins, with Obsidian's Update button. */
  openUpdate?: () => void;
  /** Whether "Update available" still pops up under the gear every other day. */
  updateReminders?: () => boolean;
  /** "Don't show again": the gear's dot alone says it from now on. */
  stopUpdateReminders?: () => void;
  /**
   * Paint the cover page, title and all, into `canvas` at `cssWidth`.
   * Resolves `false` when there is no cover to paint.
   */
  paintCover?: (canvas: HTMLCanvasElement, cssWidth: number) => Promise<boolean>;
}

/** The summary card's cover, in CSS px. */
const COVER_WIDTH = 64;

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
    this.titleEl.setText(
      this.host.board
        ? t("notebooks.noteSettings.boardTitle")
        : this.host.single
          ? t("notebooks.noteSettings.pageTitle")
          : t("notebooks.noteSettings.title"),
    );
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
    this.renderUpdate(contentEl);
    this.renderSummary(contentEl, info);
    // One frame of rows, no group titles: the whole dialog fits an iPad's
    // landscape screen, so the way to every other setting shows without scrolling.
    const group = contentEl.createDiv({ cls: "goodobsidian-ns-group" });
    if (!this.host.board) this.renderPages(group);
    this.renderEditing(group);
    this.renderLook(group);
    this.renderAllSettings(contentEl);
  }

  /** A row: its name, and its hint behind the ⓘ after the name. */
  private row(group: HTMLElement, name: string, info: string): Setting {
    const setting = new Setting(group).setName(name);
    addInfo(setting.settingEl, info);
    return setting;
  }

  /**
   * While a newer FineNotes is out, above the notebook: its version and
   * Obsidian's Update a tap away, so it is reached from the gear as well as
   * from the "Update available" bubble; and, while that bubble still comes
   * back, the way to stop it.
   */
  private renderUpdate(parent: HTMLElement): void {
    const { update, openUpdate } = this.host;
    if (!update || !openUpdate) return;
    const box = parent.createDiv({
      cls: "goodobsidian-callout goodobsidian-update-callout goodobsidian-ns-update",
    });
    const line = box.createDiv({ cls: "goodobsidian-callout-title" });
    line.createSpan({ text: t("notebooks.noteSettings.updateOut", { version: update }) });
    const open = line.createEl("button", {
      cls: "mod-cta",
      text: t("notebooks.noteSettings.update"),
    });
    open.setAttribute("aria-label", t("notebooks.noteSettings.updateOpen"));
    open.addEventListener("click", () => {
      this.close();
      openUpdate();
    });
    const stop = this.host.stopUpdateReminders;
    if (!stop || this.host.updateReminders?.() !== true) return;
    const mute = box.createEl("button", {
      cls: "goodobsidian-ns-update-mute clickable-icon",
      text: t("notebooks.noteSettings.muteUpdate"),
      attr: { type: "button" },
    });
    mute.setAttribute("aria-label", t("notebooks.noteSettings.muteUpdateInfo"));
    mute.addEventListener("click", () => {
      stop();
      mute.remove();
    });
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
        "aria-label": this.host.board
          ? t("notebooks.noteSettings.renameBoard")
          : this.host.single
            ? t("notebooks.noteSettings.renamePage")
            : t("notebooks.noteSettings.renameNotebook"),
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
    onEnterKey(field, () => field.blur());
    this.keyboard.watch(field, card);

    const facts: string[] = [];
    if (!this.host.single) facts.push(tn("notebooks.noteSettings.pages", info.pages));
    const size = formatFileSize(info.bytes);
    if (size) facts.push(size);
    if (facts.length) body.createDiv({ cls: "goodobsidian-ns-facts", text: facts.join(" · ") });
    const dates: string[] = [];
    const created = shortDate(info.created, true);
    if (created) dates.push(t("notebooks.noteSettings.created", { date: created }));
    const edited = shortDate(info.modified);
    if (edited) dates.push(t("notebooks.noteSettings.edited", { date: edited }));
    if (dates.length) body.createDiv({ cls: "goodobsidian-ns-facts", text: dates.join(" · ") });
    const folder = body.createDiv({ cls: "goodobsidian-ns-facts" });
    setIcon(folder.createSpan({ cls: "goodobsidian-ns-facts-icon" }), "folder");
    folder.createSpan({ text: info.folder || t("notebooks.importModal.topFolder") });
  }

  private renderPages(group: HTMLElement): void {
    // A single page has nowhere to scroll to.
    if (!this.host.single) {
      const row = new Setting(group).setName(t("notebooks.noteSettings.scroll"));
      const seg = row.controlEl.createDiv({
        cls: "goodobsidian-ns-segmented",
        attr: { role: "radiogroup", "aria-label": t("notebooks.noteSettings.scroll") },
      });
      const current = this.host.scrollDirection();
      for (const [value, label] of [
        ["vertical", t("notebooks.noteSettings.vertical")],
        ["horizontal", t("notebooks.noteSettings.horizontal")],
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
      this.renderJoined(group);
    }
    this.renderFurniture(group);
  }

  /** "Join pages": no gap between the pages, so writing runs on over the join. */
  private renderJoined(group: HTMLElement): void {
    const get = this.host.joinedPages;
    const set = this.host.setJoinedPages;
    if (!get || !set) return;
    this.row(
      group,
      t("notebooks.noteSettings.join"),
      t("notebooks.noteSettings.joinInfo"),
    ).addToggle((toggle) =>
      toggle.setValue(get()).onChange((on) => {
        set(on);
        this.render();
      }),
    );
  }

  /** Page numbers and a header, printed on every page but the cover. */
  private renderFurniture(group: HTMLElement): void {
    const get = this.host.furniture;
    const set = this.host.setFurniture;
    if (!get || !set) return;
    const current = get();
    this.row(
      group,
      t("notebooks.noteSettings.numbers"),
      t("notebooks.noteSettings.numbersInfo"),
    ).addDropdown((dropdown) =>
      dropdown
        .addOption("none", t("notebooks.noteSettings.numbersNone"))
        .addOption("center", t("notebooks.noteSettings.numbersCentre"))
        .addOption("right", t("notebooks.noteSettings.numbersRight"))
        .setValue(current.numbers ?? "none")
        .onChange((value) => {
          const next = { ...get() };
          if (value === "center" || value === "right") next.numbers = value;
          else delete next.numbers;
          set(next);
        }),
    );
    const header = this.row(
      group,
      t("notebooks.noteSettings.header"),
      t("notebooks.noteSettings.headerInfo"),
    ).addText((text) => {
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

  private renderEditing(group: HTMLElement): void {
    this.row(
      group,
      t("notebooks.noteSettings.readOnly"),
      t("notebooks.noteSettings.readOnlyInfo"),
    ).addToggle((toggle) =>
      toggle.setValue(this.host.readOnly()).onChange((on) => {
        this.host.setReadOnly(on);
        this.render();
      }),
    );
  }

  /** The simple look: it belongs to the app, but the notebook is where one wants it back. */
  private renderLook(group: HTMLElement): void {
    const { simpleLook, setSimpleLook } = this.host;
    if (!simpleLook || !setSimpleLook) return;
    this.row(
      group,
      t("settings.simpleLook.name"),
      t("notebooks.noteSettings.simpleLookDesc"),
    ).addToggle((toggle) => toggle.setValue(simpleLook()).onChange((on) => setSimpleLook(on)));
  }

  /**
   * The way to every other setting, as a card of its own: what is here
   * belongs to this notebook, and everything else (pens, toolbar,
   * handwriting, AI, shortcuts) is one tap away.
   */
  private renderAllSettings(parent: HTMLElement): void {
    const all = parent.createEl("button", {
      cls: "goodobsidian-ns-all clickable-icon",
      attr: { type: "button" },
    });
    setIcon(all.createSpan({ cls: "goodobsidian-ns-all-lead" }), "settings");
    const text = all.createSpan({ cls: "goodobsidian-ns-all-text" });
    text.createSpan({
      cls: "goodobsidian-ns-all-name",
      text: t("notebooks.noteSettings.allSettings"),
    });
    text.createSpan({
      cls: "goodobsidian-ns-all-desc",
      text: t("notebooks.noteSettings.allSettingsInfo"),
    });
    if (this.host.update) {
      // The gear's dot, carried on to where the update is.
      all.addClass("has-mark");
      all.setAttribute(
        "aria-label",
        t("notebooks.noteSettings.allSettingsUpdate", { version: this.host.update }),
      );
    }
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
