/**
 * What a text note does besides being typed and drawn in: where its files
 * go (`model/note-files.ts`), its recordings (`note-recording.ts`) and Ask
 * AI about it (`note-ask.ts`). The view (`note-view.ts`) owns one and
 * forwards its taps and lifecycle here, so the view stays the bar and the
 * page.
 */

import { type App, type TAbstractFile, type TFile, Menu, TFolder } from "obsidian";
import { t } from "../i18n/translate";
import { cleanFolder } from "../model/attachment-folders";
import { type NoteFileKind, movedPath, noteFilesSubfolder } from "../model/note-files";
import { chatsFolderFor } from "../recognition/ask-chat-file";
import { attachmentDefaults } from "../settings-data";
import type { TextNote } from "../model/text-note";
import type GoodObsidianPlugin from "../main";
import type { NoteEditor } from "./note-editor";
import { NoteAsk } from "./note-ask";
import { ensureFolder } from "./note-files";
import { NoteRecordings } from "./note-recording";

export interface NoteExtrasHost {
  readonly app: App;
  plugin: () => GoodObsidianPlugin | null;
  file: () => TFile | null;
  editor: () => NoteEditor | null;
  /** What the recording pill and the player float over. */
  container: () => HTMLElement;
  /** A recording started or stopped, or the Ask AI window opened or closed: the bar shows it. */
  recordingChanged: () => void;
}

export class NoteExtras {
  readonly recordings: NoteRecordings;
  private ask: NoteAsk | null = null;

  constructor(private readonly host: NoteExtrasHost) {
    this.recordings = new NoteRecordings({
      app: host.app,
      plugin: host.plugin,
      file: host.file,
      folder: (kind) => this.folder(kind),
      container: host.container,
      insertAudio: (path, duration) => host.editor()?.insertAudio(path, duration),
      insertTextAfter: (id, text) => host.editor()?.insertTextAfter(id, text) ?? false,
      refreshCards: () => host.editor()?.refreshAudio(),
      recordingChanged: host.recordingChanged,
    });
  }

  /**
   * Where the note saves `kind`: its files folder beside it while notebooks
   * get folders of their own (the setting), else where a notebook without
   * one saves it (FineNotes' folder for the kind, else Obsidian's attachment
   * location: `undefined`).
   */
  folder(kind: NoteFileKind): string | undefined {
    const path = this.host.file()?.path;
    if (!path) return undefined;
    const plugin = this.host.plugin();
    if (plugin && !plugin.settings.notebookOwnFolder) {
      return cleanFolder(attachmentDefaults(plugin.settings)[kind]);
    }
    return noteFilesSubfolder(path, kind) || undefined;
  }

  /** {@link folder}, made if it is missing (with the folders above it). */
  async madeFolder(kind: NoteFileKind): Promise<string | undefined> {
    const folder = this.folder(kind);
    if (folder) await ensureFolder(this.host.app, folder);
    return folder;
  }

  /** The attach button's menu: a picture, or a recording. Call inside the tap. */
  attachMenu(anchor: HTMLElement, pickPicture: () => void): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle(t("notebooks.note.addPicture")).setIcon("image").onClick(pickPicture),
    );
    const recording = this.recordings.isRecording;
    menu.addItem((item) =>
      item
        .setTitle(t(recording ? "ai.audio.stopRecording" : "ai.audio.recordAudio"))
        .setIcon(recording ? "square" : "mic")
        .onClick(() => this.recordings.toggle()),
    );
    const at = anchor.getBoundingClientRect();
    menu.showAtPosition({ x: at.left, y: at.bottom + 6 });
  }

  /** Whether the Ask AI window is open. */
  get askOpen(): boolean {
    return this.ask?.isOpen === true;
  }

  /** Open the Ask AI window about this note, or close it. */
  openAsk(): void {
    const plugin = this.host.plugin();
    if (!plugin) return;
    this.ask ??= new NoteAsk({
      app: this.host.app,
      plugin,
      file: this.host.file,
      note: () => this.host.editor()?.current() ?? { blocks: [] },
      chatsFolder: () => {
        const path = this.host.file()?.path ?? "";
        return this.folder("chats") ?? chatsFolderFor(path);
      },
      insert: (text) => {
        const editor = this.host.editor();
        if (!editor) return false;
        return editor.insertMarkdown(text);
      },
      insertDrawing: async (svg) => {
        const editor = this.host.editor();
        if (!editor) return false;
        await editor.insertImages([new File([svg], "Drawing.svg", { type: "image/svg+xml" })]);
        return true;
      },
      container: this.host.container,
      changed: this.host.recordingChanged,
    });
    this.ask.toggle();
  }

  /**
   * A file or folder moved: the note's pictures and recordings that were in
   * it point where they are now. (The note's own files folder moving with
   * the note is one of these.)
   */
  moved(file: TAbstractFile, oldPath: string): void {
    const to = file.path;
    const folder = file instanceof TFolder;
    this.host
      .editor()
      ?.relinkPaths((path) =>
        folder ? movedPath(path, oldPath, to) : path === oldPath ? to : undefined,
      );
  }

  /** The note was read: pictures and recordings whose files moved on this device point at them again. */
  relinkFromLog(note: TextNote): void {
    const plugin = this.host.plugin();
    const editor = this.host.editor();
    if (!plugin || !editor) return;
    const log = plugin.fileMoves.log();
    if (log.length === 0) return;
    const vault = this.host.app.vault;
    const missing = note.blocks.some(
      (b) => (b.type === "image" || b.type === "audio") && !vault.getAbstractFileByPath(b.path),
    );
    if (!missing) return;
    editor.relinkPaths((path) =>
      vault.getAbstractFileByPath(path) ? undefined : plugin.fileMoves.relink(path, log),
    );
  }

  onHidden(): void {
    this.recordings.onHidden();
  }

  finishForUnload(): Promise<void> {
    return this.recordings.finishForUnload();
  }

  destroy(): void {
    this.recordings.destroy();
    this.ask?.close();
  }
}
