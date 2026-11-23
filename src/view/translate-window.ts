/**
 * The Translate window: a floating window over the notebook, like the
 * calculator's and the equation editor's (`floating-window.ts`): dragged by
 * its bar, sized from its corner, minimised to a pill.
 *
 * - It opens from selected text (PDF text, a highlight, text boxes) with
 *   that text in it, sized to the text and placed beside the selection; or
 *   empty, from the Translate tool, to type into. One window per notebook:
 *   opening it again loads the new text into it.
 * - From → Into as two dropdowns with a swap between them; From starts on
 *   "Detect language" and names what it found. Swapping also moves the
 *   translation into the text, to translate back.
 * - The text is editable and translated as it is typed (after a pause).
 * - Under the translation: Read aloud, Copy, Replace (for a text box's own
 *   text) and Add as text box.
 * - The first time a pair of languages needs files, the translation's
 *   place shows a download card styled as the model download card is.
 */

import { Notice, setIcon } from "obsidian";
import { formatSize, totalBytes } from "../downloads/model-manifest";
import type { AssetStore } from "../downloads/model-store";
import { currentLanguage, t } from "../i18n/translate";
import {
  type AiTranslateRequest,
  type AiTranslation,
  sentenceAround,
} from "../translate/ai-translate";
import {
  pickTarget,
  sourceLanguages,
  targetLanguages,
  withoutPrivateUse,
} from "../translate/languages";
import { TRANSLATE_MIN, translatePlace } from "../translate/window-place";
import { FloatingWindow } from "./floating-window";
import { writeSystemText } from "./system-clipboard";
import { type Translator, languageName } from "./translator";

/** "Detect language" in the From list. */
const AUTO = "auto";
/** Typing pauses this long before the text is translated, ms. */
const TYPE_PAUSE_MS = 400;
/** With the AI: a request each pause costs, so it waits for a longer one. */
const AI_TYPE_PAUSE_MS = 1000;
/** The busy mark shows only when a translation takes longer than this, ms. */
const BUSY_AFTER_MS = 150;
/** The language last translated from, this session: short text that cannot be told apart is taken as it. */
let lastSource: string | null = null;

/** Text to translate, and what can be done with the translation. */
export interface TranslateTarget {
  text: string;
  /**
   * The text around it (the PDF page it was selected on): its language is
   * the text's unless the text says otherwise for sure. Short selections
   * cannot tell their language on their own.
   */
  context?: string;
  /** The selection's bottom centre and top, client px: the window opens beside it. */
  at?: { x: number; y: number; top: number };
  /** Put the translation on the page as a new text box. */
  onInsert?: (text: string) => void;
  /** Put the translation in place of the selected text box's text. */
  onReplace?: (text: string) => void;
}

/** The languages last chosen, kept in the settings. */
export interface TranslateMemory {
  /** "auto" (or "") to detect, or a language code. */
  from(): string;
  to(): string;
  remember(from: string, to: string): void;
}

/**
 * Translating with the AI service the user set up: given only when one is
 * (a key, or the user's own endpoint). The window shows its switch then.
 */
export interface TranslateAi {
  /** The service's name, for the switch's label ("Anthropic"). */
  label: string;
  /** Whether the AI translates (remembered in the settings). */
  on(): boolean;
  set(on: boolean): void;
  /** The translation, or null when the user did not agree to send the text. Throws a Notice-ready error. */
  translate(request: AiTranslateRequest): Promise<AiTranslation | null>;
}

export interface TranslateWindowOptions {
  container: HTMLElement;
  translator: Translator;
  memory: TranslateMemory;
  ai?: TranslateAi;
  onClosed: () => void;
}

export class TranslateWindow {
  private readonly frame: FloatingWindow;
  private readonly fromEl: HTMLSelectElement;
  private readonly toEl: HTMLSelectElement;
  private readonly autoOption: HTMLOptionElement;
  /** The AI switch, when an AI service is set up. */
  private readonly aiButton: HTMLButtonElement | null = null;
  private readonly sourceEl: HTMLTextAreaElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly resultEl: HTMLElement;
  private readonly actionsEl: HTMLElement;
  private target: TranslateTarget = { text: "" };
  private result = "";
  /** Bumped by every change: an answer for an older one is dropped. */
  private turn = 0;
  private typeTimer = 0;
  private busyTimer = 0;
  private closed = false;

  constructor(
    private readonly options: TranslateWindowOptions,
    first: TranslateTarget,
  ) {
    const place = translatePlace(first.text.length, this.bounds(), this.anchorOf(first));
    this.frame = new FloatingWindow({
      container: options.container,
      cls: "goodobsidian-tr-window",
      title: t("ai.translate.title"),
      label: t("ai.translate.title"),
      minimise: true,
      min: TRANSLATE_MIN,
      firstPlace: () => place,
      place: () => null,
      savePlace: () => {},
      onClose: () => this.close(),
    });
    const body = this.frame.body.createDiv({ cls: "goodobsidian-tr" });

    const langs = body.createDiv({ cls: "goodobsidian-tr-langs" });
    this.fromEl = this.languageSelect(langs, sourceLanguages(), t("ai.translate.from"));
    this.autoOption = createEl("option", { value: AUTO, text: t("ai.translate.detect") });
    this.fromEl.prepend(this.autoOption);
    this.iconButton(langs, "arrow-left-right", t("ai.translate.swap"), () => this.swap(), "swap");
    this.toEl = this.languageSelect(langs, targetLanguages(), t("ai.translate.into"));
    const ai = options.ai;
    if (ai) {
      // A switch: on is the accent fill; its label says what a tap does.
      this.aiButton = this.iconButton(langs, "sparkles", "", () => this.toggleAi(), "ai");
      this.showAi();
    }

    const source = body.createDiv({ cls: "goodobsidian-tr-source" });
    this.sourceEl = source.createEl("textarea", {
      cls: "goodobsidian-tr-text",
      attr: {
        rows: "3",
        spellcheck: "true",
        "aria-label": t("ai.translate.source"),
        placeholder: t("ai.translate.placeholder"),
      },
    });
    this.clearButton = this.iconButton(
      source,
      "x",
      t("ai.translate.clear"),
      () => {
        this.sourceEl.value = "";
        this.sourceEl.focus();
        this.changed(true);
      },
      "clear",
    );

    this.resultEl = body.createDiv({ cls: "goodobsidian-tr-result" });
    this.resultEl.setAttribute("aria-live", "polite");
    this.actionsEl = body.createDiv({ cls: "goodobsidian-tr-actions" });

    const from = options.memory.from();
    this.fromEl.value = from && from !== AUTO ? from : AUTO;
    this.toEl.value =
      options.memory.to() || pickTarget(null, undefined, currentLanguage(), targetLanguages());
    this.fromEl.addEventListener("change", () => this.languagesChanged());
    this.toEl.addEventListener("change", () => this.languagesChanged());
    this.sourceEl.addEventListener("input", () => this.changed(false));
    this.sourceEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
      // The notebook's own keys (tools, undo) are not for this field.
      event.stopPropagation();
    });
    this.load(first);
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Show `target`'s text (opened again from another selection, or empty from the tool). */
  load(target: TranslateTarget): void {
    this.target = target;
    this.frame.raise();
    this.sourceEl.value = withoutPrivateUse(target.text);
    if (!target.text) {
      this.sourceEl.focus();
      this.showEmpty();
    }
    this.changed(true);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.typeTimer);
    window.clearTimeout(this.busyTimer);
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.frame.destroy();
    this.options.onClosed();
  }

  private bounds(): { w: number; h: number } {
    const { container } = this.options;
    return { w: container.clientWidth, h: container.clientHeight };
  }

  /** The selection's anchor in the view's own px. */
  private anchorOf(target: TranslateTarget): { x: number; y: number; top: number } | null {
    if (!target.at) return null;
    const rect = this.options.container.getBoundingClientRect();
    return { x: target.at.x - rect.left, y: target.at.y - rect.top, top: target.at.top - rect.top };
  }

  private languageSelect(parent: HTMLElement, codes: string[], label: string): HTMLSelectElement {
    const select = parent.createEl("select", { cls: "dropdown goodobsidian-tr-lang" });
    select.setAttribute("aria-label", label);
    const named = codes.map((code) => ({ code, name: languageName(code) }));
    named.sort((a, b) => a.name.localeCompare(b.name));
    for (const { code, name } of named) select.createEl("option", { value: code, text: name });
    return select;
  }

  /** An icon button that acts on pointerup (a Pencil tap over the page may never click). */
  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    run: () => void,
    kind: string,
  ): HTMLButtonElement {
    // `clickable-icon`: Obsidian pads any other button 20 px on iPad.
    const button = parent.createEl("button", {
      cls: `clickable-icon goodobsidian-tr-button is-${kind}`,
      attr: { "aria-label": label },
    });
    setIcon(button, icon);
    let down = false;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      down = true;
    });
    button.addEventListener("pointerup", () => {
      if (down) run();
      down = false;
    });
    button.addEventListener("pointercancel", () => (down = false));
    button.addEventListener("click", (event) => {
      if (event.detail === 0) run();
    });
    return button;
  }

  private toggleAi(): void {
    const ai = this.options.ai;
    if (!ai) return;
    ai.set(!ai.on());
    this.showAi();
    this.changed(true);
  }

  private showAi(): void {
    const ai = this.options.ai;
    const button = this.aiButton;
    if (!ai || !button) return;
    const on = ai.on();
    button.toggleClass("is-on", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute(
      "aria-label",
      on ? t("ai.translate.onDevice") : t("ai.translate.withAi", { label: ai.label }),
    );
  }

  private languagesChanged(): void {
    this.options.memory.remember(this.fromEl.value, this.toEl.value);
    void this.run();
  }

  /** The text changed: at once (`now`), or after a pause in typing. */
  private changed(now: boolean): void {
    this.clearButton.toggleClass("is-hidden", this.sourceEl.value === "");
    window.clearTimeout(this.typeTimer);
    if (now) void this.run();
    else
      this.typeTimer = window.setTimeout(
        () => void this.run(),
        this.options.ai?.on() ? AI_TYPE_PAUSE_MS : TYPE_PAUSE_MS,
      );
  }

  /** Swap From and Into; the translation becomes the text, to go back. */
  private swap(): void {
    const detected = this.fromEl.value === AUTO ? this.autoOption.dataset.lang : this.fromEl.value;
    const from = this.toEl.value;
    const to = detected ?? "";
    if (!sourceLanguages().includes(from) || !targetLanguages().includes(to)) return;
    this.fromEl.value = from;
    this.toEl.value = to;
    if (this.result) {
      this.sourceEl.value = this.result;
      // Replace no longer means the selected box's text: this is a new text.
      this.target = { text: this.result, onInsert: this.target.onInsert };
    }
    this.languagesChanged();
  }

  private async run(): Promise<void> {
    const turn = ++this.turn;
    const text = this.sourceEl.value.trim();
    this.result = "";
    this.renderActions();
    // Detecting is a mark (the accent colour), not words: the name alone fits.
    this.fromEl.toggleClass("is-auto", this.fromEl.value === AUTO);
    if (!text) {
      this.autoOption.text = t("ai.translate.detect");
      this.fromEl.setAttribute("aria-label", t("ai.translate.from"));
      delete this.autoOption.dataset.lang;
      this.showEmpty();
      return;
    }
    let from = this.fromEl.value;
    // Whether the text's language is known: chosen, or found by detection.
    let fromKnown = true;
    if (from === AUTO) {
      const chosen = this.options.memory.from();
      const fallback = chosen && chosen !== AUTO ? chosen : lastSource;
      // The page's text tells the language while the text is still the selection.
      const selected = withoutPrivateUse(this.target.text).trim() === text;
      const context = selected ? this.target.context : undefined;
      const guess = await this.options.translator.detect(text, fallback, context);
      if (turn !== this.turn || this.closed) return;
      from = guess?.lang ?? "en";
      fromKnown = guess !== null;
      const detected = t("ai.translate.detected", { language: languageName(from) });
      this.autoOption.dataset.lang = from;
      this.autoOption.text = languageName(from);
      this.fromEl.setAttribute("aria-label", detected);
      this.fromEl.title = detected;
    } else {
      this.fromEl.removeAttribute("title");
    }
    lastSource = from;
    const to = this.toEl.value;
    const ai = this.options.ai;
    if (ai?.on()) {
      await this.runAi(ai, turn, text, fromKnown ? from : null, to);
      return;
    }
    const stores = this.options.translator.storesFor(from, to);
    if (!stores) {
      this.note(t("ai.translate.unsupported", { from: languageName(from), to: languageName(to) }));
      return;
    }
    const missing = await this.options.translator.missing(stores);
    if (turn !== this.turn || this.closed) return;
    if (missing.length > 0) {
      this.offerDownload(from, to, missing);
      return;
    }
    window.clearTimeout(this.busyTimer);
    this.busyTimer = window.setTimeout(() => {
      if (turn === this.turn) this.busy();
    }, BUSY_AFTER_MS);
    try {
      const out = await this.options.translator.translate(this.sourceEl.value, from, to);
      if (turn !== this.turn || this.closed) return;
      window.clearTimeout(this.busyTimer);
      this.result = out.trim();
      this.resultEl.empty();
      this.resultEl.removeClass("is-empty");
      this.resultEl.createDiv({ cls: "goodobsidian-tr-output", text: out });
      this.renderActions();
    } catch (error) {
      if (turn !== this.turn || this.closed) return;
      window.clearTimeout(this.busyTimer);
      const message = error instanceof Error ? error.message : String(error);
      this.note(t("ai.translate.failed", { message }));
    }
  }

  /** The AI's translation: and for a word, its dictionary notes under it. */
  private async runAi(
    ai: TranslateAi,
    turn: number,
    text: string,
    from: string | null,
    to: string,
  ): Promise<void> {
    window.clearTimeout(this.busyTimer);
    this.busyTimer = window.setTimeout(() => {
      if (turn === this.turn) this.busy();
    }, BUSY_AFTER_MS);
    const selected = withoutPrivateUse(this.target.text).trim() === text;
    try {
      const answer = await ai.translate({
        text,
        to,
        toName: englishName(to),
        fromName: from === null || from === to ? null : englishName(from),
        sentence: selected ? sentenceAround(this.target.context, text) : null,
      });
      if (turn !== this.turn || this.closed) return;
      window.clearTimeout(this.busyTimer);
      if (!answer) {
        // Not agreed to send: back to this device.
        ai.set(false);
        this.showAi();
        void this.run();
        return;
      }
      this.result = answer.translation;
      this.resultEl.empty();
      this.resultEl.removeClass("is-empty");
      this.resultEl.createDiv({ cls: "goodobsidian-tr-output", text: answer.translation });
      if (answer.notes.length > 0) {
        const list = this.resultEl.createEl("ul", { cls: "goodobsidian-tr-notes" });
        for (const note of answer.notes) list.createEl("li", { text: note });
      }
      this.renderActions();
    } catch (error) {
      if (turn !== this.turn || this.closed) return;
      window.clearTimeout(this.busyTimer);
      const message = error instanceof Error ? error.message : String(error);
      this.note(t("ai.translate.failed", { message }));
    }
  }

  private showEmpty(): void {
    this.resultEl.empty();
    this.resultEl.addClass("is-empty");
    this.resultEl.createDiv({ cls: "goodobsidian-tr-placeholder", text: t("ai.translate.result") });
  }

  private busy(): void {
    this.resultEl.empty();
    this.resultEl.removeClass("is-empty");
    const row = this.resultEl.createDiv({ cls: "goodobsidian-tr-busy" });
    row.setAttribute("aria-label", t("ai.translate.working"));
    for (let i = 0; i < 3; i++) row.createSpan({ cls: "goodobsidian-tr-dot" });
  }

  private note(text: string): void {
    this.resultEl.empty();
    this.resultEl.removeClass("is-empty");
    this.resultEl.createDiv({ cls: "goodobsidian-tr-note", text });
  }

  /** The download card, in the translation's place: as the model download card looks. */
  private offerDownload(from: string, to: string, missing: AssetStore[]): void {
    const size = formatSize(missing.reduce((sum, store) => sum + totalBytes(store.asset), 0));
    this.resultEl.empty();
    this.resultEl.removeClass("is-empty");
    const card = this.resultEl.createDiv({ cls: "goodobsidian-tr-download" });
    setIcon(card.createDiv({ cls: "goodobsidian-download-card-icon" }), "download");
    const text = card.createDiv({ cls: "goodobsidian-download-card-text" });
    text.createDiv({
      cls: "goodobsidian-download-card-title",
      text: t("ai.translate.downloadTitle", { from: languageName(from), to: languageName(to) }),
    });
    const detail = text.createDiv({
      cls: "goodobsidian-download-card-detail",
      text: t("ai.translate.downloadDetail", { size }),
    });
    const track = text.createDiv({ cls: "goodobsidian-download-card-track" });
    const bar = track.createDiv({ cls: "goodobsidian-download-card-bar" });
    text.createDiv({ cls: "goodobsidian-tr-fine", text: t("ai.translate.private") });
    const button = card.createEl("button", {
      cls: "goodobsidian-download-card-button clickable-icon is-cta",
      text: t("settings.models.download"),
    });
    const turn = this.turn;
    button.addEventListener("click", () => {
      button.disabled = true;
      card.addClass("is-busy");
      void this.options.translator
        .download(missing, (fraction) => {
          const percent = Math.floor(fraction * 100);
          bar.setCssProps({ "--gob-download-progress": `${percent}%` });
          detail.setText(t("ai.translate.downloading", { percent }));
        })
        .then((ok) => {
          if (this.closed || turn !== this.turn) return;
          if (ok) {
            void this.run();
            return;
          }
          button.disabled = false;
          card.removeClass("is-busy");
          card.addClass("is-failed");
          const failed = missing.find((store) => store.state.kind === "failed");
          detail.setText(
            failed?.state.kind === "failed"
              ? failed.state.detail
              : t("ai.translate.downloadDetail", { size }),
          );
        });
    });
  }

  /** Under the translation: Read aloud, then Copy, Replace and Add as text box. */
  private renderActions(): void {
    this.actionsEl.empty();
    const text = this.result;
    this.actionsEl.toggleClass("is-hidden", !text);
    if (!text) return;
    if (typeof speechSynthesis !== "undefined") {
      this.iconButton(
        this.actionsEl,
        "volume-2",
        t("ai.translate.speak"),
        () => this.speak(text),
        "speak",
      );
    }
    this.actionsEl.createDiv({ cls: "goodobsidian-tr-spacer" });
    this.iconButton(
      this.actionsEl,
      "copy",
      t("common.copy"),
      () => {
        void writeSystemText(text).then(
          () => new Notice(t("surface.notice.textCopied")),
          () => new Notice(t("surface.notice.clipboardUnusable")),
        );
      },
      "copy",
    );
    const { onInsert, onReplace } = this.target;
    if (onReplace) {
      this.iconButton(
        this.actionsEl,
        "replace",
        t("ai.translate.replace"),
        () => {
          onReplace(text);
          this.close();
        },
        "replace",
      );
    }
    if (onInsert) {
      this.iconButton(
        this.actionsEl,
        "text-cursor-input",
        t("ai.translate.insert"),
        () => {
          onInsert(text);
          this.close();
        },
        "insert",
      );
    }
  }

  private speak(text: string): void {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.toEl.value;
    speechSynthesis.speak(utterance);
  }
}

/** A language's name in English, for the AI's prompt ("nl" → "Dutch"). */
function englishName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
