/**
 * Checking what Grape read, word by word (`recognition/hwr/corrections.ts`
 * has the rules). One per plugin: it holds the word list and the corrections
 * file, shared by every open notebook.
 *
 * - `flags` says which words of a page's reading to underline;
 * - `ask` shows the menu for a tapped word and records the answer.
 *
 * Files, both in `<plugin>/handwriting/`:
 * - `words.txt`, the words not to underline, one a line. Without it nothing
 *   is underlined (every word would be).
 * - `corrections.json`, the answers, ink included; "Learn my handwriting"
 *   and the nightly loop learn from them.
 */

import { type App, Menu, Modal, Notice, normalizePath } from "obsidian";
import {
  type CorrectionKind,
  type CorrectionsFile,
  type ReadWord,
  addCorrection,
  answeredOn,
  emptyCorrections,
  flagWords,
  ignoredWords,
  parseCorrections,
  parseWordList,
  serializeCorrections,
} from "../recognition/hwr/corrections";
import type { Stroke } from "../model/document";
import { DialogKeyboard } from "./dialog-keyboard";
import { errorMessage } from "../util/errors";

export function wordListPath(pluginDir: string): string {
  return normalizePath(`${pluginDir}/handwriting/words.txt`);
}

export function correctionsPath(pluginDir: string): string {
  return normalizePath(`${pluginDir}/handwriting/corrections.json`);
}

/** A word on a page, as the menu needs it. */
export interface CheckedWord {
  note: string;
  pageId: string;
  word: ReadWord;
  /** The word's strokes as they are on the page now. */
  strokes: readonly Stroke[];
}

export class WordCheck {
  private words: Set<string> | null = null;
  private corrections: CorrectionsFile = emptyCorrections();
  private loading: Promise<void> | null = null;
  /** Said once a session: there is no word list, so nothing is underlined. */
  private toldNoList = false;

  constructor(
    private readonly app: App,
    private readonly pluginDir: () => string,
  ) {}

  /** Read the word list and the corrections, once (`reload` to read them again). */
  load(): Promise<void> {
    this.loading ??= this.read();
    return this.loading;
  }

  reload(): Promise<void> {
    this.loading = null;
    return this.load();
  }

  private async read(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const list = wordListPath(this.pluginDir());
    this.words = (await adapter.exists(list)) ? parseWordList(await adapter.read(list)) : null;
    const file = correctionsPath(this.pluginDir());
    this.corrections = (await adapter.exists(file))
      ? parseCorrections(await adapter.read(file))
      : emptyCorrections();
  }

  /** The words of a reading to underline on page `pageId` of `note`. */
  async flags(note: string, pageId: string, words: readonly ReadWord[]): Promise<ReadWord[]> {
    await this.load();
    if (!this.words || this.words.size === 0) {
      if (!this.toldNoList) {
        this.toldNoList = true;
        new Notice(
          `FineNotes: checking words needs a word list at ${wordListPath(this.pluginDir())}.`,
          10000,
        );
      }
      return [];
    }
    return flagWords(
      words,
      this.words,
      ignoredWords(this.corrections),
      answeredOn(this.corrections, note, pageId),
    );
  }

  /** How many answers there are, for the settings. */
  get count(): number {
    return this.corrections.corrections.length;
  }

  /**
   * The menu for a tapped word: what Grape read, then the three answers.
   * `done` runs after an answer is saved, to take the underline away.
   */
  ask(word: CheckedWord, at: { x: number; y: number }, done: () => void): void {
    const read = word.word.text;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(`Read as “${read}”`).setIsLabel(true));
    menu.addItem((item) =>
      item
        .setTitle("Correct the reading…")
        .setIcon("pencil")
        .onClick(() => {
          new WordCorrectionModal(this.app, read, (text) => {
            void this.answer(word, "misread", text).then(done);
          }).open();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("That's what I wrote")
        .setIcon("check")
        .onClick(() => void this.answer(word, "mistake", read).then(done)),
    );
    menu.addItem((item) =>
      item
        .setTitle(`Ignore “${read}”`)
        .setIcon("eye-off")
        .onClick(() => void this.answer(word, "ignore", read).then(done)),
    );
    menu.showAtPosition(at);
  }

  private async answer(word: CheckedWord, kind: CorrectionKind, text: string): Promise<void> {
    const strokes = word.strokes.map((s) => ({
      id: s.id,
      pts: Array.from(s.pts),
      t0: typeof s.t0 === "number" ? s.t0 : null,
    }));
    this.corrections = addCorrection(this.corrections, {
      kind,
      read: word.word.text,
      text,
      note: word.note,
      page: word.pageId,
      strokes,
      at: Date.now(),
    });
    try {
      const adapter = this.app.vault.adapter;
      const folder = normalizePath(`${this.pluginDir()}/handwriting`);
      if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
      await adapter.write(
        correctionsPath(this.pluginDir()),
        serializeCorrections(this.corrections),
      );
    } catch (error) {
      new Notice(`FineNotes: could not save the correction — ${errorMessage(error)}`, 8000);
    }
  }
}

/** "What does it say?": one field, prefilled with the reading. */
class WordCorrectionModal extends Modal {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly read: string,
    private readonly submit: (text: string) => void,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText("What does it say?");
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    body.createDiv({
      cls: "goodobsidian-ask-note",
      text: "Type the word as you wrote it. FineNotes learns your handwriting from it.",
    });
    const row = body.createDiv({ cls: "goodobsidian-contents-field-row" });
    const field = row.createEl("input", {
      cls: "goodobsidian-contents-field",
      type: "text",
      attr: { "aria-label": "The word", autocapitalize: "none", spellcheck: "false" },
    });
    field.value = this.read;
    this.keyboard.watch(field, row);
    const save = row.createEl("button", { cls: "mod-cta", text: "Save" });
    const done = () => {
      const text = field.value.trim();
      if (!text) return;
      this.close();
      if (text !== this.read) this.submit(text);
    };
    save.addEventListener("click", done);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        done();
      }
    });
    window.setTimeout(() => {
      field.focus();
      field.select();
    }, 0);
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }
}
