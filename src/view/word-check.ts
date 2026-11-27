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
  mergeCorrections,
  parseCorrections,
  parseWordList,
  plainWord,
  serializeCorrections,
  strokeKey,
} from "../recognition/hwr/corrections";
import { type LexiconSuggestion, SUGGEST_MARGIN, replaceCore } from "../recognition/hwr/lexicon";
import { personalWords, withPersonal } from "../recognition/hwr/personal-words";
import { spellingFixes } from "../recognition/hwr/spelling-flags";
import type { Stroke } from "../model/document";
import type { PageLanguage } from "../recognition/hwr/page-language";
import type { PackWords } from "./language-packs";
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
  /** The page's language (page-language.ts); English when absent. */
  language?: PageLanguage;
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
  /** The words the writer's answers add (personal-words.ts), from every answer in the file. */
  private personal: Set<string> = new Set();
  /** The word list with the writer's words: what reading, underlining and Beautify go by. */
  private listed: ReadonlySet<string> | null = null;
  /** Counts the times that list changed, so the reader knows when to send it again. */
  private version = 0;
  private corrections: CorrectionsFile = emptyCorrections();
  private loading: Promise<void> | null = null;
  /** Said once a session: there is no word list, so nothing is underlined. */
  private toldNoList = false;
  /** Language packs' word lists, as `flags` last read them, for the card's Should be. */
  private readonly packLists = new Map<PageLanguage, ReadonlySet<string>>();
  /** Told after each answer is saved, with how many answers there are now. */
  answered: (count: number) => void = () => {};

  constructor(
    private readonly app: App,
    private readonly pluginDir: () => string,
    /** The bundled word list's text (models/words.txt). */
    private readonly bundled: () => Promise<string | null> = bundledWords,
    /** A language pack's word list (language-packs.ts), when it is here. */
    private readonly packs: (language: PageLanguage) => Promise<PackWords | null> = async () =>
      null,
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
    const file = correctionsPath();
    this.corrections = (await adapter.exists(file))
      ? parseCorrections(await adapter.read(file))
      : emptyCorrections();
    await this.moveLegacy();
    this.relist(true);
  }

  /**
   * Take the answers' words into the list again (after a read, or an answer
   * here or synced from another device); the version moves when the list
   * did, or always when `changed`.
   */
  private relist(changed = false): void {
    const personal = personalWords(this.corrections);
    const same =
      personal.size === this.personal.size && [...personal].every((w) => this.personal.has(w));
    this.personal = personal;
    if (!changed && same) return;
    this.listed = this.words ? withPersonal(this.words, personal) : null;
    this.version++;
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

  /**
   * The words of a reading to underline on page `pageId` of `note`. A page
   * in another language (page-language.ts) is checked against its language
   * pack's list, when the pack is here and may underline; else nothing is
   * underlined there (the English list would mark most of its words).
   */
  async flags(
    note: string,
    pageId: string,
    words: readonly ReadWord[],
    language: PageLanguage = "en",
  ): Promise<ReadWord[]> {
    await this.load();
    const answered = answeredOn(this.corrections, note, pageId);
    if (language !== "en") {
      const pack = await this.packs(language);
      if (pack) this.packLists.set(language, pack.words);
      if (!pack?.underline) return [];
      return flagWords(words, pack.words, this.personal, answered);
    }
    if (!this.words || this.words.size === 0) {
      if (!this.toldNoList) {
        this.toldNoList = true;
        new Notice(t("ai.word.noList", { path: wordListPath(this.pluginDir()) }), 10000);
      }
      return [];
    }
    return flagWords(words, this.words, this.personal, answered);
  }

  /**
   * What `word` may have been meant as, when it is a spelling question
   * (spelling-flags.ts); empty when the question is whether Grape read it
   * right. Decides the word's mark and its card.
   */
  spellingOf(
    word: ReadWord,
    suggestion: LexiconSuggestion | null | undefined,
    language: PageLanguage = "en",
  ): string[] {
    const listed = this.listedFor(language);
    if (!listed) return [];
    return spellingFixes(word, suggestion, listed, language === "en", SUGGEST_MARGIN);
  }
  /**
   * The underlines of `words`: their ink, and the stroke keys of those that
   * are spelling questions (`spellingOf`), drawn as such.
   */
  marks(
    words: readonly ReadWord[],
    found: ReadonlyMap<string, LexiconSuggestion | null> | undefined,
    language: PageLanguage = "en",
  ): { flags: string[][]; spelling: Set<string> } {
    const keys = words.map((w) => strokeKey(w.strokeIds));
    const spelt = keys.filter((k, i) => this.spellingOf(words[i], found?.get(k), language).length);
    return { flags: words.map((w) => w.strokeIds), spelling: new Set(spelt) };
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

  /**
   * The word list with the writer's own words, for the reread and the
   * suggestions (lexicon.ts) and for Beautify; null without a list.
   * `answered` is the writer's words alone.
   */
  lexicon(): {
    version: number;
    words: () => string[];
    answered: () => ReadonlySet<string>;
  } | null {
    const words = this.listed;
    if (!this.words || this.words.size === 0 || !words) return null;
    const personal = this.personal;
    return { version: this.version, words: () => [...words], answered: () => personal };
  }

  /** How many answers there are, for the settings. */
  get count(): number {
    return this.corrections.corrections.length;
  }

  /**
   * The card for a tapped word (word-popover.ts). It asks one of two
   * questions, and says which above the word (Joost, 2026-11-27: one card
   * for both left him unable to tell whether he was fixing his spelling or
   * Grape's reading):
   *
   * - **You wrote** “…”: a spelling question (`spellingOf`). The chips are
   *   what it may have been meant as; one picked is a mistake with `meant`,
   *   the ink labelled as written, and that word alone is written again in
   *   the writer's hand (or, without the writer, its setup begins). Then
   *   Grape misread it… (the ink does not say this), Add to dictionary.
   * - **Grape read** “…”: a reading question. When its ink fits list words
   *   about as well as the reading (margin under `SUGGEST_MARGIN`), they are
   *   the chips: what the ink may say. Then Type what it says, It says “…”,
   *   and Add to dictionary.
   *
   * Which kind an answer is, Grape's misread or the writer's own mistake,
   * is still never guessed from the ink (RESEARCH-LOG 2026-11-25): the card
   * only picks the question, and the answer picked says the kind.
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
    // A word answered as misread is offered in the writer's hand, as the answer says it.
    const reply = (kind: CorrectionKind, text: string) =>
      void this.answer(word, kind, text).then(() => {
        done();
        if (hand && kind === "misread") hand.offer(text);
      });
    // What the ink spells before the list's second look, only when the writer
    // opened the card: Beautify asks about words that look unsure, and nearly
    // every word the second look changed is Grape putting itself right.
    const before = asked ? undefined : word.word.wrote;
    const asRead: ReadWord = { ...word.word, wrote: before };
    if (before === undefined) delete asRead.wrote;
    // Written wrong: the text shows `text`; the label is what the ink says (corrections.ts).
    const written = before ?? read;
    const meant = (text: string, write: boolean) =>
      void this.answer(word, "mistake", written, undefined, text).then(() => {
        done();
        if (!hand) return;
        if (write) hand.write(text);
        else hand.offer(text);
      });
    const fixes = this.spellingOf(asRead, found, word.language ?? "en");
    // Stored as "ignore", the kind's name since the first corrections files.
    const add: WordPopoverRow = {
      icon: "eye-off",
      label: t("ai.word.addToDictionary"),
      sub: t("ai.word.neverUnderline"),
      run: () => reply("ignore", written),
    };
    if (fixes.length > 0) {
      const misread: WordPopoverRow = {
        icon: "scan-text",
        label: t("ai.word.grapeMisread"),
        run: () =>
          new WordCorrectionModal(this.app, written, (text, wrong) =>
            wrong ? meant(text, false) : reply("misread", text),
          ).open(),
      };
      return new WordPopover(
        at,
        {
          read: written,
          spelling: true,
          chips: fixes,
          // The corrected word alone is written again in the hand (Joost, 2026-11-27).
          // Grape's own reading picked: the ink says it, so that is the label.
          onChip: (w) =>
            before !== undefined && w === read
              ? reply("mistake", read)
              : meant(w, !!hand && hand.writes(w)),
          rows: [misread, add],
        },
        closed,
      );
    }
    const misread = !!found && found.words.length > 0 && found.margin < SUGGEST_MARGIN;
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
    const addable = !(asked && this.unflagged(read)) ? [add] : [];
    return new WordPopover(
      at,
      {
        read,
        chips: misread ? found.words : [],
        onChip: (w) => reply("misread", replaceCore(read, w)),
        rows: misread || asked ? [correct, wrote, ...addable] : [wrote, add, correct],
      },
      closed,
    );
  }
  /**
   * Whether a word (lower case) is in `language`'s list or answered as
   * right; null when that list is not known (another language whose pack's
   * list `flags` has not read), so nothing can be judged by it.
   */
  private listedFor(language: PageLanguage): ((word: string) => boolean) | null {
    const list = language === "en" ? this.words : this.packLists.get(language);
    if (!list) return null;
    const personal = this.personal;
    return (word) => list.has(word) || personal.has(word);
  }

  /** Whether a word as read is one `flags` never underlines: listed, answered as right, or no plain word. */
  private unflagged(read: string, language: PageLanguage = "en"): boolean {
    const word = plainWord(read);
    if (!word) return true;
    if (this.personal.has(word)) return true;
    if (language === "en") return this.words?.has(word) === true;
    // Another language: its pack's list, as `flags` last read it; none known, nothing to judge by.
    const list = this.packLists.get(language);
    return !list || list.has(word);
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
    // The answer (and any another device synced) joins the list the reader and Beautify use.
    this.relist();
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
