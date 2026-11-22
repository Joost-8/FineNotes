/**
 * Organising text notes by tag, after Apple Notes: reading a file's tags
 * from Obsidian's index, the smart folder dialog, Convert to smart folder,
 * and the opt-in filing of a note that gains a smart folder's tag
 * (`NoteFiler`). The rules are pure, in `model/note-organise.ts`; the
 * research behind them is `research/apple-notes-organisation-2026-11-22.md`.
 *
 * Filing is the one place FineNotes moves a file by itself, so it is
 * narrow on purpose: only a smart folder that asks for it (`fileTo`), only
 * a text note, only when the note *gains* a matching tag, and only while
 * that note is the one being edited on this device. A note synced in from
 * another device, or moved back out by hand, is never moved again.
 */

import {
  type App,
  type EventRef,
  type Events,
  Modal,
  Notice,
  Setting,
  type TFile,
  TFolder,
  getAllTags,
} from "obsidian";
import { t, tn } from "../i18n/translate";
import { isTextNoteName, stripTextNoteSuffix } from "../model/text-note-file";
import {
  type ListedNote,
  type Move,
  type SmartFolder,
  type TagPick,
  filingFor,
  nextPick,
  pathIn,
  plannedMoves,
  tagCounts,
  tagFromName,
  tagKey,
  tagKeys,
} from "../model/note-organise";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";

/** What organising needs from the plugin: its saved smart folders. */
export interface OrganiseHost {
  smartFolders(): readonly SmartFolder[];
  setSmartFolders(folders: SmartFolder[]): void;
}

/** Fired on the workspace when the smart folders change: Home and the note lists follow. */
export const SMART_FOLDERS_EVENT = "finenotes:smart-folders";

/** Listen for `SMART_FOLDERS_EVENT` (the workspace's typings only know Obsidian's own events). */
export function onSmartFolders(app: App, listener: () => void): EventRef {
  const events: Events = app.workspace;
  return events.on(SMART_FOLDERS_EVENT, listener);
}

/** A file's tags as Obsidian indexed them (frontmatter and inline), with `#`. */
export function tagsOf(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  return cache ? (getAllTags(cache) ?? []) : [];
}

/** Every text note in the vault, as the note list and the dialogs read them. */
export function listedNotes(app: App): ListedNote[] {
  return app.vault
    .getFiles()
    .filter((file) => isTextNoteName(file.name))
    .map((file) => ({
      path: file.path,
      title: stripTextNoteSuffix(file.name),
      edited: file.stat.mtime,
      tags: tagsOf(app, file),
      textNote: true,
    }));
}

/** A tag as a chip: `#name`, its state a mark (accent fill on, struck through when left out). */
export function tagChip(
  parent: HTMLElement,
  tag: string,
  pick: TagPick,
  tap: () => void,
  count?: number,
): HTMLElement {
  const label =
    pick === "on"
      ? t("notebooks.organise.tagOn", { tag: `#${tag}` })
      : pick === "out"
        ? t("notebooks.organise.tagOut", { tag: `#${tag}` })
        : t("notebooks.organise.tagOff", { tag: `#${tag}` });
  const chip = parent.createEl("button", {
    cls: "clickable-icon finenotes-tag-chip",
    attr: { type: "button", "aria-label": label, "aria-pressed": String(pick !== "off") },
  });
  chip.toggleClass("is-on", pick === "on");
  chip.toggleClass("is-out", pick === "out");
  chip.createSpan({ cls: "finenotes-tag-chip-name", text: `#${tag}` });
  if (count !== undefined)
    chip.createSpan({ cls: "finenotes-tag-chip-count", text: String(count) });
  chip.addEventListener("click", (event) => {
    event.stopPropagation();
    tap();
  });
  return chip;
}

/** The vault's folders, A to Z, for the "Move notes into" choice. */
function vaultFolders(app: App): string[] {
  return app.vault
    .getAllLoadedFiles()
    .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && !f.path.startsWith("."))
    .map((f) => f.path)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** A folder's name as a sentence shows it. */
function folderName(folder: string): string {
  return folder === "" ? t("notebooks.organise.root") : folder;
}

/**
 * Make or edit a smart folder: its name, the tags it looks for (tap: in,
 * tap again: left out, again: off), any or all, and where notes that get
 * those tags are moved, "nowhere" unless the user picks a folder.
 */
export class SmartFolderModal extends Modal {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly start: SmartFolder,
    private readonly title: string,
    private readonly submit: (folder: SmartFolder) => void,
    /** A line under the title (Convert to smart folder says what it does). */
    private readonly note?: string,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    const draft: SmartFolder = { ...this.start, tags: [...this.start.tags] };
    draft.exclude = [...this.start.exclude];
    this.modalEl.addClass("goodobsidian-dialog", "finenotes-smart-modal");
    this.titleEl.setText(this.title);
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    if (this.note) body.createDiv({ cls: "goodobsidian-ask-note", text: this.note });

    const row = body.createDiv({ cls: "finenotes-smart-name-row" });
    const field = row.createEl("input", {
      cls: "finenotes-smart-name",
      type: "text",
      attr: {
        "aria-label": t("notebooks.organise.name"),
        placeholder: t("notebooks.organise.name"),
        enterkeyhint: "done",
        autocomplete: "off",
      },
    });
    field.value = draft.name;
    this.keyboard.watch(field, row);

    const chips = body.createDiv({ cls: "finenotes-smart-tags" });
    const match = body.createDiv({ cls: "finenotes-smart-match" });
    const counts = tagCounts(listedNotes(this.app));
    // Tags a rule names that no note has any more still show, so they can be taken out.
    const known = [...new Set([...counts.map((c) => c.tag), ...draft.tags, ...draft.exclude])];
    const pickOf = (tag: string): TagPick =>
      draft.tags.includes(tag) ? "on" : draft.exclude.includes(tag) ? "out" : "off";
    const paint = (): void => {
      chips.empty();
      if (known.length === 0)
        chips.createDiv({ cls: "finenotes-smart-empty", text: t("notebooks.organise.noTagsYet") });
      for (const tag of known) {
        tagChip(chips, tag, draft.untagged ? "off" : pickOf(tag), () => {
          const next = nextPick(pickOf(tag));
          draft.untagged = undefined;
          draft.tags = draft.tags.filter((x) => x !== tag);
          draft.exclude = draft.exclude.filter((x) => x !== tag);
          if (next === "on") draft.tags.push(tag);
          if (next === "out") draft.exclude.push(tag);
          paint();
        });
      }
      // "No tags": Apple's untagged notes only, which no tag can share.
      const none = chips.createEl("button", {
        cls: "clickable-icon finenotes-tag-chip is-untagged",
        text: t("notebooks.organise.noTags"),
        attr: { type: "button", "aria-pressed": String(draft.untagged === true) },
      });
      none.toggleClass("is-on", draft.untagged === true);
      none.addEventListener("click", () => {
        draft.untagged = draft.untagged ? undefined : true;
        if (draft.untagged) {
          draft.tags = [];
          draft.exclude = [];
        }
        paint();
      });
      // Any or all only means something with two tags or more.
      match.empty();
      match.toggleClass("is-hidden", draft.tags.length < 2);
      for (const kind of ["any", "all"] as const) {
        const button = match.createEl("button", {
          cls: "clickable-icon finenotes-smart-match-option",
          text: t(kind === "all" ? "notebooks.organise.matchAll" : "notebooks.organise.matchAny"),
          attr: { type: "button", "aria-pressed": String(draft.match === kind) },
        });
        button.toggleClass("is-on", draft.match === kind);
        button.addEventListener("click", () => {
          draft.match = kind;
          paint();
        });
      }
    };
    paint();

    // Filing: off unless the user picks a folder (opt-in, per smart folder).
    new Setting(body).setName(t("notebooks.organise.fileIn")).addDropdown((dropdown) => {
      dropdown.addOption("-", t("notebooks.organise.dontMove"));
      dropdown.addOption("/", t("notebooks.organise.root"));
      for (const folder of vaultFolders(this.app)) dropdown.addOption(folder, folder);
      dropdown.setValue(
        draft.fileTo === undefined ? "-" : draft.fileTo === "" ? "/" : draft.fileTo,
      );
      dropdown.onChange((value) => {
        if (value === "-") delete draft.fileTo;
        else draft.fileTo = value === "/" ? "" : value;
      });
    });

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.close());
    const done = actions.createEl("button", { cls: "mod-cta", text: t("common.save") });
    const finish = (): void => {
      const name = field.value.trim();
      if (name === "") {
        field.focus();
        return;
      }
      this.close();
      this.submit({ ...draft, name, tags: tagKeys(draft.tags), exclude: tagKeys(draft.exclude) });
    };
    done.addEventListener("click", finish);
    onEnterKey(field, finish);
    field.focus();
    field.select();
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }
}

/** Ask before moving notes that already match: the only bulk move, and only on a yes. */
class MoveNowModal extends Modal {
  constructor(
    app: App,
    private readonly moves: readonly Move[],
    private readonly folder: string,
    private readonly yes: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    body.createDiv({
      cls: "goodobsidian-ask-note",
      text: tn("notebooks.organise.moveNow", this.moves.length, {
        folder: folderName(this.folder),
      }),
    });
    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    actions
      .createEl("button", { text: t("notebooks.organise.notNow") })
      .addEventListener("click", () => this.close());
    actions
      .createEl("button", { cls: "mod-cta", text: t("notebooks.organise.move") })
      .addEventListener("click", () => {
        this.close();
        this.yes();
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** A fresh id for a smart folder. */
function newId(): string {
  return `sf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Move a text note into `folder` with Obsidian's own rename, so links follow. */
async function fileInto(app: App, file: TFile, folder: string): Promise<boolean> {
  const to = pathIn(folder, file.path);
  if (folder !== "" && !(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) return false;
  if (app.vault.getAbstractFileByPath(to)) {
    new Notice(
      t("notebooks.organise.nameTaken", {
        name: stripTextNoteSuffix(file.name),
        folder: folderName(folder),
      }),
    );
    return false;
  }
  await app.fileManager.renameFile(file, to);
  return true;
}

/**
 * Save `next` (new or edited); when it newly files notes into a folder,
 * offer to move the notes that match already.
 */
export function saveSmartFolder(app: App, host: OrganiseHost, next: SmartFolder): void {
  const all = host.smartFolders();
  const before = all.find((f) => f.id === next.id);
  host.setSmartFolders(before ? all.map((f) => (f.id === next.id ? next : f)) : [...all, next]);
  if (next.fileTo === undefined || before?.fileTo === next.fileTo) return;
  const taken = new Set(app.vault.getFiles().map((f) => f.path));
  const moves = plannedMoves(listedNotes(app), next, taken);
  if (moves.length === 0) return;
  const folder = next.fileTo;
  new MoveNowModal(app, moves, folder, () => {
    void (async () => {
      for (const move of moves) {
        const file = app.vault.getFileByPath(move.from);
        if (file) await fileInto(app, file, folder);
      }
    })();
  }).open();
}

/** New smart folder, with `tags` already in (from the Tag Browser). */
export function newSmartFolder(app: App, host: OrganiseHost, tags: readonly string[] = []): void {
  const start: SmartFolder = {
    id: newId(),
    name: tags.length > 0 ? tags.map((tag) => `#${tag}`).join(" ") : "",
    tags: tagKeys(tags),
    exclude: [],
    match: "all",
  };
  new SmartFolderModal(app, start, t("notebooks.organise.newSmart"), (folder) =>
    saveSmartFolder(app, host, folder),
  ).open();
}

export function editSmartFolder(app: App, host: OrganiseHost, folder: SmartFolder): void {
  new SmartFolderModal(app, folder, t("notebooks.organise.editSmart"), (next) =>
    saveSmartFolder(app, host, next),
  ).open();
}

/**
 * Apple's Convert to Smart Folder, for files: the text notes in `folder`
 * (and below) are tagged with its name, in their frontmatter, and a smart
 * folder on that tag is made. Unlike Apple, nothing is moved: the folder
 * stays the vault's own. Filing into it is offered, off, in the dialog.
 */
export function convertToSmart(app: App, host: OrganiseHost, folder: string): void {
  const name = folder.slice(folder.lastIndexOf("/") + 1);
  const tag = tagFromName(name);
  if (tag === "") return;
  const notes = app.vault
    .getFiles()
    .filter(
      (f) =>
        isTextNoteName(f.name) && (f.parent?.path === folder || f.path.startsWith(`${folder}/`)),
    );
  const start: SmartFolder = { id: newId(), name, tags: [tag], exclude: [], match: "any" };
  new SmartFolderModal(
    app,
    start,
    t("notebooks.organise.convert"),
    (next) => {
      void (async () => {
        for (const file of notes) {
          if (tagsOf(app, file).some((x) => tagKey(x) === tag)) continue;
          await app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
            const now: unknown = front.tags;
            const list = Array.isArray(now)
              ? now.filter((x): x is string => typeof x === "string")
              : typeof now === "string"
                ? now.split(/[,\s]+/).filter(Boolean)
                : [];
            front.tags = [...list, tag];
          });
        }
        saveSmartFolder(app, host, next);
      })();
    },
    tn("notebooks.organise.convertLine", notes.length, { tag: `#${tag}` }),
  ).open();
}

/**
 * Files a text note into a smart folder's folder when, being edited here,
 * it gains that folder's tags. Knows each note's tags as of the last index,
 * so it can tell a tag just typed from one the note always had.
 */
export class NoteFiler {
  private readonly known = new Map<string, string[]>();
  private ready = false;

  constructor(
    private readonly app: App,
    private readonly host: OrganiseHost,
  ) {}

  /** Read every text note's tags once the index is complete; changes after that are what count. */
  start(register: (ref: ReturnType<App["metadataCache"]["on"]>) => void): void {
    const fill = (): void => {
      for (const note of listedNotes(this.app)) this.known.set(note.path, [...note.tags]);
      this.ready = true;
    };
    if ((this.app.metadataCache as unknown as { resolved?: boolean }).resolved) fill();
    register(this.app.metadataCache.on("resolved", () => !this.ready && fill()));
    register(
      this.app.metadataCache.on("changed", (file) => {
        void this.changed(file);
      }),
    );
  }

  /** A rename moves what is known with the note. */
  renamed(file: TFile, oldPath: string): void {
    const tags = this.known.get(oldPath);
    this.known.delete(oldPath);
    if (tags) this.known.set(file.path, tags);
  }

  forget(path: string): void {
    this.known.delete(path);
  }

  private async changed(file: TFile): Promise<void> {
    if (!this.ready || !isTextNoteName(file.name)) return;
    const after = tagsOf(this.app, file);
    const before = this.known.get(file.path) ?? [];
    this.known.set(file.path, after);
    // Only the note being written in here: never one a sync or another app changed.
    if (this.app.workspace.getActiveFile() !== file) return;
    const folder = filingFor(file.path, before, after, this.host.smartFolders());
    if (folder === null) return;
    if (await fileInto(this.app, file, folder)) {
      new Notice(
        t("notebooks.organise.moved", {
          name: stripTextNoteSuffix(file.name),
          folder: folderName(folder),
        }),
      );
    }
  }
}
