/**
 * Checking what Grape read, word by word (`recognition/hwr/corrections.ts`
 * has the rules). One per plugin: it holds the word list and the corrections
 * file, shared by every open notebook.
 *
 * - `flags` says which words of a page's reading to underline;
 * - `ask` shows the card for a tapped word (word-popover.ts) and records the answer.
 *
 * Files, all in `<plugin>/handwriting/`:
 * - `words.txt`, the user's own words not to underline, one a line, added
 *   to the public list bundled with the plugin (models/words.txt, built by
 *   scripts/build-words.mjs). Without either nothing is underlined.
 * - `corrections.json`, the answers, ink included; "Learn my handwriting"
 *   and the nightly loop learn from them.
 */

import { type App, Modal, Notice, normalizePath } from "obsidian";
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
import { type LexiconSuggestion, SUGGEST_MARGIN, replaceCore } from "../recognition/hwr/lexicon";
import type { Stroke } from "../model/document";
import { DialogKeyboard } from "./dialog-keyboard";
import { WordPopover, type WordPopoverRow } from "./word-popover";
import { errorMessage } from "../util/errors";

export function wordListPath(pluginDir: string): string {
  return normalizePath(`${pluginDir}/handwriting/words.txt`);
}

/** The public word list bundled with the plugin, read when first needed. */
export async function bundledWords(): Promise<string> {
  const { default: text } = await import("../../models/words.txt");
  return text;
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
  /** The list words its ink fits best (lexicon.ts), when they were worked out. */
  suggestion?: LexiconSuggestion | null;
}

export class WordCheck {
  private words: Set<string> | null = null;
  /** Counts the times the word list was read, so the reader knows when to send it again. */
  private version = 0;
  private corrections: CorrectionsFile = emptyCorrections();
  private loading: Promise<void> | null = null;
  /** Said once a session: there is no word list, so nothing is underlined. */
  private toldNoList = false;

  constructor(
    private readonly app: App,
    private readonly pluginDir: () => string,
    /** The bundled word list's text (models/words.txt). */
    private readonly bundled: () => Promise<string | null> = bundledWords,
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
    const own = (await adapter.exists(list)) ? parseWordList(await adapter.read(list)) : null;
    const text = await this.bundled().catch(() => null);
    const shared = text === null ? null : parseWordList(text);
    this.words = own && shared ? new Set([...shared, ...own]) : (own ?? shared);
    this.version++;
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

  /** The word list, for suggestions (lexicon.ts); null without one. */
  lexicon(): { version: number; words: () => string[] } | null {
    const words = this.words;
    if (!words || words.size === 0) return null;
    return { version: this.version, words: () => [...words] };
  }

  /** How many answers there are, for the settings. */
  get count(): number {
    return this.corrections.corrections.length;
  }

  /**
   * The card for a tapped word (word-popover.ts): what Grape read, then the
   * answers. Nothing is changed without a tap.
   *
   * - When its ink fits list words about as well as the reading (margin
   *   under `SUGGEST_MARGIN`), it is probably a misread: the best list words
   *   come first, as chips ("Did you mean"), then Correct the reading, That's
   *   what I wrote, and Add to dictionary.
   * - Otherwise the ink really shows this word: That's what I wrote (with the
   *   closest list spelling under it), Add to dictionary, then Correct.
   *
   * `done` runs after an answer is saved, to take the underline away;
   * `closed` whenever the card closes, answered or not.
   */
  ask(
    word: CheckedWord,
    at: { x: number; y: number },
    done: () => void,
    closed: () => void = () => {},
  ): WordPopover {
    const read = word.word.text;
    const found = word.suggestion;
    const misread = !!found && found.words.length > 0 && found.margin < SUGGEST_MARGIN;
    const reply = (kind: CorrectionKind, text: string) =>
      void this.answer(word, kind, text).then(done);
    const correct: WordPopoverRow = {
      icon: "pencil",
      label: "Correct the reading…",
      run: () => new WordCorrectionModal(this.app, read, (text) => reply("misread", text)).open(),
    };
    const wrote: WordPopoverRow = {
      icon: "check",
      label: "That's what I wrote",
      sub: !misread && found?.words[0] ? `Closest word: ${found.words[0]}` : undefined,
      run: () => reply("mistake", read),
    };
    // Stored as "ignore", the kind's name since the first corrections files.
    const add: WordPopoverRow = {
      icon: "eye-off",
      label: "Add to dictionary",
      sub: "Never underline it again",
      run: () => reply("ignore", read),
    };
    return new WordPopover(
      at,
      {
        read,
        chips: misread ? found.words : [],
        onChip: (w) => reply("misread", replaceCore(read, w)),
        rows: misread ? [correct, wrote, add] : [wrote, add, correct],
      },
      closed,
    );
  }

  /** Record an answer given elsewhere (a lassoed title corrected in its dialog). */
  record(word: CheckedWord, kind: CorrectionKind, text: string): Promise<void> {
    return this.answer(word, kind, text);
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
