/**
 * Checking what Grape read, word by word (`recognition/hwr/corrections.ts`
 * has the rules). One per plugin: it holds the word list and the corrections
 * file, shared by every open notebook.
 *
 * - `flags` says which words of a page's reading to underline;
 * - `ask` shows the card for a tapped word (word-popover.ts) and records the answer.
 *
 * Files:
 * - `<plugin>/handwriting/words.txt`, the user's own words not to
 *   underline, one a line, added to the public list bundled with the plugin
 *   (models/words.txt, built by scripts/build-words.mjs). Without either
 *   nothing is underlined.
 * - `FineNotes assets/Handwriting sheets/corrections.json`, the answers, ink
 *   included; "Learn my handwriting" and the nightly loop learn from them.
 *   In the vault, beside the practice sheets, so reinstalling the plugin
 *   keeps them (they were in the plugin's folder before 2.6).
 */

import { type App, Modal, Notice, normalizePath } from "obsidian";
import { t } from "../i18n/translate";
import {
  type Correction,
  type CorrectionKind,
  type CorrectionsFile,
  type ReadWord,
  addCorrection,
  shownAnswers,
  answeredOn,
  emptyCorrections,
  flagWords,
  ignoredWords,
  mergeCorrections,
  parseCorrections,
  parseWordList,
  plainWord,
  serializeCorrections,
} from "../recognition/hwr/corrections";
import { type LexiconSuggestion, SUGGEST_MARGIN, replaceCore } from "../recognition/hwr/lexicon";
import type { Stroke } from "../model/document";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { WordPopover, type WordPopoverRow } from "./word-popover";
import { errorMessage } from "../util/errors";
import { HANDWRITING_FOLDER, correctionsFile, legacyCorrectionsFile } from "../model/vault-folders";

export function wordListPath(pluginDir: string): string {
  return normalizePath(`${pluginDir}/handwriting/words.txt`);
}

/** The public word list bundled with the plugin, read when first needed. */
export async function bundledWords(): Promise<string> {
  const { default: text } = await import("../../models/words.txt");
  return text;
}

export function correctionsPath(): string {
  return normalizePath(correctionsFile());
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

/** Writing a checked word in the writer's own hand (`write-in-hand.ts`), when the writer can. */
export interface WriteWordInHand {
  /** After an answer: offer to write `text` in place of the word's ink. */
  offer(text: string): void;
  /** Write `text` in place of the word's ink now. */
  write(text: string): void;
  /** Whether the model can write `text` (every letter one it has). */
  writes(text: string): boolean;
}

export class WordCheck {
  private words: Set<string> | null = null;
  /** Counts the times the word list was read, so the reader knows when to send it again. */
  private version = 0;
  private corrections: CorrectionsFile = emptyCorrections();
  private loading: Promise<void> | null = null;
  /** Said once a session: there is no word list, so nothing is underlined. */
  private toldNoList = false;
  /** Told after each answer is saved, with how many answers there are now. */
  answered: (count: number) => void = () => {};

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
    const file = correctionsPath();
    this.corrections = (await adapter.exists(file))
      ? parseCorrections(await adapter.read(file))
      : emptyCorrections();
    await this.moveLegacy();
  }

  /**
   * Corrections kept in the plugin's folder before 2.6 join the vault's
   * file, and the old one goes. Done on every read, since a device on an
   * older FineNotes may still write there. A file that is not JSON at all
   * is left where it is, never thrown away.
   */
  private async moveLegacy(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const old = normalizePath(legacyCorrectionsFile(this.pluginDir()));
    try {
      if (!(await adapter.exists(old))) return;
      const raw = await adapter.read(old);
      try {
        JSON.parse(raw);
      } catch {
        return;
      }
      this.corrections = mergeCorrections(this.corrections, parseCorrections(raw));
      await this.save();
      await adapter.remove(old);
    } catch (error) {
      console.warn("FineNotes: could not move the old corrections file", error);
    }
  }

  /**
   * Write the answers, after taking in any the file has that this copy does
   * not: sync may have brought another device's answers since they were
   * read, and writing this copy over them would lose them.
   */
  private async save(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const folder = normalizePath(HANDWRITING_FOLDER);
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
    const file = correctionsPath();
    if (await adapter.exists(file)) {
      const raw = await adapter.read(file);
      try {
        JSON.parse(raw);
      } catch {
        // Not JSON (a write cut short?): kept beside it, never written over.
        await adapter.write(`${file}.unreadable-${Date.now()}`, raw);
      }
      this.corrections = mergeCorrections(this.corrections, parseCorrections(raw));
    }
    await adapter.write(file, serializeCorrections(this.corrections));
  }

  /** When each answer was given (ms since the epoch), for counting the new ones. */
  get answeredAt(): number[] {
    return this.corrections.corrections.map((c) => c.at);
  }

  /** The words of a reading to underline on page `pageId` of `note`. */
  async flags(note: string, pageId: string, words: readonly ReadWord[]): Promise<ReadWord[]> {
    await this.load();
    if (!this.words || this.words.size === 0) {
      if (!this.toldNoList) {
        this.toldNoList = true;
        new Notice(t("ai.word.noList", { path: wordListPath(this.pluginDir()) }), 10000);
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

  /** The answers given on page `pageId` of `note`: what each answered word is, by its strokes (Neaten). */
  async answersOn(
    note: string,
    pageId: string,
  ): Promise<{ kind: CorrectionKind; text: string; ids: string[] }[]> {
    await this.load();
    return this.corrections.corrections
      .filter((c) => c.note === note && c.page === pageId)
      .map((c) => ({
        // A word written wrong is written as meant: the line says what the text says.
        kind: c.meant ? "misread" : c.kind,
        text: c.meant ?? c.text,
        ids: c.strokes.map((s) => s.id),
      }));
  }

  /**
   * What each answered word on page `pageId` of `note` shows instead of its
   * reading, by stroke key (`shownAnswers`), from the answers read so far;
   * empty before the first `load`. For the text search keeps.
   */
  shownOn(note: string, pageId: string): Map<string, string> {
    return shownAnswers(this.corrections, note, pageId);
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
   *   come first, as chips under the reading, then Type what it says, It
   *   says "…", and Add to dictionary.
   * - Otherwise the ink really shows this word: It says "…", then Should
   *   be "…" when a list word is close (the writer wrote it wrong: the text
   *   shows that word, and the ink is written again in the writer's hand
   *   when it can be), Add to dictionary, then Type.
   *
   * Which kind of correction an answer is, Grape's misread or the writer's
   * own mistake, is never guessed: the ink fits both about as well
   * (RESEARCH-LOG 2026-11-25). The answer picked says it, and Type what it
   * says asks with its two buttons.
   *
   * `done` runs after an answer is saved, to take the underline away;
   * `closed` whenever the card closes, answered or not.
   *
   * `asked`: opened by hand ("Correct" on any word, underlined or not).
   * Whoever asks thinks it misread, so Type what it says comes first, and
   * Add to dictionary goes when the word would never be underlined anyway.
   */
  ask(
    word: CheckedWord,
    at: { x: number; y: number },
    done: () => void,
    closed: () => void = () => {},
    asked = false,
    hand?: WriteWordInHand,
  ): WordPopover {
    const read = word.word.text;
    const found = word.suggestion;
    const misread = !!found && found.words.length > 0 && found.margin < SUGGEST_MARGIN;
    // A word answered as misread is offered in the writer's hand, as the answer says it.
    const reply = (kind: CorrectionKind, text: string) =>
      void this.answer(word, kind, text).then(() => {
        done();
        if (hand && kind === "misread") hand.offer(text);
      });
    // Written wrong: the text shows `text`; the label stays the reading, what the ink says (corrections.ts).
    const meant = (text: string, write: boolean) =>
      void this.answer(word, "mistake", read, undefined, text).then(() => {
        done();
        if (!hand) return;
        if (write) hand.write(text);
        else hand.offer(text);
      });
    // The ink really says the reading, and a list word is close: the writer may have meant it.
    const closest = !misread && found?.words[0] ? replaceCore(read, found.words[0]) : null;
    const inHand = !!hand && !!closest && hand.writes(closest);
    const spelled: WordPopoverRow[] =
      closest && closest !== read
        ? [
            {
              icon: "spell-check",
              label: t("ai.word.shouldBe", { word: closest }),
              sub: inHand ? t("ai.word.inYourHand") : undefined,
              run: () => meant(closest, inHand),
            },
          ]
        : [];
    const correct: WordPopoverRow = {
      icon: "pencil",
      label: t("ai.word.type"),
      run: () =>
        new WordCorrectionModal(this.app, read, (text, wrong) =>
          wrong ? meant(text, false) : reply("misread", text),
        ).open(),
    };
    const wrote: WordPopoverRow = {
      icon: "check",
      label: t("ai.word.itSays", { word: read }),
      run: () => reply("mistake", read),
    };
    // Stored as "ignore", the kind's name since the first corrections files.
    const add: WordPopoverRow = {
      icon: "eye-off",
      label: t("ai.word.addToDictionary"),
      sub: t("ai.word.neverUnderline"),
      run: () => reply("ignore", read),
    };
    return new WordPopover(
      at,
      {
        read,
        chips: misread ? found.words : [],
        onChip: (w) => reply("misread", replaceCore(read, w)),
        rows: misread
          ? [correct, wrote, ...(asked && this.unflagged(read) ? [] : [add])]
          : asked
            ? [correct, wrote, ...spelled, ...(this.unflagged(read) ? [] : [add])]
            : [wrote, ...spelled, add, correct],
      },
      closed,
    );
  }

  /** Whether a word as read is one `flags` never underlines: listed, answered as right, or no plain word. */
  private unflagged(read: string): boolean {
    const word = plainWord(read);
    if (!word) return true;
    return this.words?.has(word) === true || ignoredWords(this.corrections).has(word);
  }

  /**
   * Record an answer given elsewhere (a lassoed title corrected in its
   * dialog, Beautify asking about a word). `text` is what the ink says;
   * `meant`, on a "mistake" only, what the writer meant to write.
   */
  record(
    word: CheckedWord,
    kind: CorrectionKind,
    text: string,
    source?: Correction["source"],
    meant?: string,
  ): Promise<void> {
    return this.answer(word, kind, text, source, kind === "mistake" ? meant : undefined);
  }

  private async answer(
    word: CheckedWord,
    kind: CorrectionKind,
    text: string,
    source?: Correction["source"],
    meant?: string,
  ): Promise<void> {
    const strokes = word.strokes.map((s) => ({
      id: s.id,
      pts: Array.from(s.pts),
      t0: typeof s.t0 === "number" ? s.t0 : null,
    }));
    this.corrections = addCorrection(this.corrections, {
      kind,
      read: word.word.text,
      text,
      ...(meant && meant !== text ? { meant } : {}),
      note: word.note,
      page: word.pageId,
      strokes,
      at: Date.now(),
      ...(source ? { source } : {}),
    });
    try {
      await this.save();
    } catch (error) {
      new Notice(t("ai.word.saveFailed", { message: errorMessage(error) }), 8000);
      return;
    }
    this.answered(this.count);
  }
}

/**
 * "Correct “…”": one field, prefilled with the reading, and two buttons
 * that say which is wrong: Grape misread it (Enter, as before: the typed
 * word is what the ink says), or I wrote it wrong (`wrong`: the typed word
 * is what the writer meant; the text shows it, and the ink is labelled with
 * the reading, which the writer says is what they wrote). The buttons stay
 * above the iPad's keyboard with the field.
 */
class WordCorrectionModal extends Modal {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly read: string,
    private readonly submit: (text: string, wrong: boolean) => void,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText(t("ai.word.correctTitle", { word: this.read }));
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    const row = body.createDiv({ cls: "goodobsidian-contents-field-row" });
    const field = row.createEl("input", {
      cls: "goodobsidian-contents-field",
      type: "text",
      attr: { "aria-label": t("ai.word.field"), autocapitalize: "none", spellcheck: "false" },
    });
    field.value = this.read;
    const buttons = body.createDiv({ cls: "modal-button-container" });
    this.keyboard.watch(field, row, buttons);
    const done = (wrong: boolean) => {
      const text = field.value.trim();
      if (!text) return;
      this.close();
      if (text !== this.read) this.submit(text, wrong);
    };
    buttons
      .createEl("button", { text: t("ai.word.wroteWrong") })
      .addEventListener("click", () => done(true));
    buttons
      .createEl("button", { cls: "mod-cta", text: t("ai.word.misreadIt") })
      .addEventListener("click", () => done(false));
    onEnterKey(field, () => done(false));
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
