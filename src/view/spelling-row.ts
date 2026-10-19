/**
 * "Did you mean Rationals?" under a field that lassoed ink filled in
 * ("Add to contents", "Link to…"): one compact row per word the ink fits a
 * list word about as well as the reading (lexicon.ts). A tap on a word puts
 * it in the field in place of the reading; nothing changes without one. The
 * host records corrections when the dialog is confirmed, from the field's
 * final text (selection-words.ts `editedWords`).
 */

import { replaceToken } from "../recognition/hwr/selection-words";

export interface SpellingFix {
  /** The word as it reads in the field now. */
  token: string;
  /** List words to offer, best first, cased for the field. */
  words: readonly string[];
}

export class SpellingRows {
  private readonly el: HTMLElement;

  constructor(
    after: HTMLElement,
    private readonly field: HTMLInputElement,
    fixes: readonly SpellingFix[],
  ) {
    this.el = createDiv({ cls: "goodobsidian-spelling" });
    after.insertAdjacentElement("afterend", this.el);
    for (const fix of fixes) this.row(fix);
    // A word typed over is no longer there to correct.
    field.addEventListener("input", () => this.prune());
    this.prune();
  }

  private row(fix: SpellingFix): void {
    const row = this.el.createDiv({ cls: "goodobsidian-spelling-row" });
    row.dataset.token = fix.token;
    row.createSpan({ cls: "goodobsidian-spelling-label", text: "Did you mean" });
    fix.words.forEach((word, i) => {
      // `clickable-icon`: Obsidian pads any other button 20 px on iPad.
      const chip = row.createEl("button", {
        cls: "goodobsidian-wordcheck-chip goodobsidian-spelling-chip clickable-icon",
        text: word,
      });
      chip.toggleClass("is-first", i === 0);
      chip.addEventListener("click", () => {
        this.field.value = replaceToken(this.field.value, fix.token, word);
        row.remove();
        this.field.dispatchEvent(new Event("input"));
        this.field.focus();
      });
    });
    row.createSpan({ cls: "goodobsidian-spelling-label", text: "?" });
  }

  private prune(): void {
    const tokens = new Set(this.field.value.split(/\s+/));
    for (const row of Array.from(this.el.children) as HTMLElement[]) {
      if (!tokens.has(row.dataset.token ?? "")) row.remove();
    }
    this.el.toggleClass("is-hidden", this.el.childElementCount === 0);
  }
}
