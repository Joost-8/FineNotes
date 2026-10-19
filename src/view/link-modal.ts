/**
 * "Link to…" for ink selected with the lasso (FineNotes#20): Obsidian's own
 * search list, so it types like the quick switcher, with the field at the
 * top of the screen where the iPad keyboard cannot cover it.
 *
 *   [ Link to a note, a heading (Note#Heading) or a web address ]
 *   ⌫ Remove link                        (when the ink is linked already)
 *   📄 Signals                Courses/Signals.md
 *   # Signals › FIR filters
 *   🌐 https://en.wikipedia.org/…
 *   + Link to “Fourier”      a note that does not exist yet
 *
 * What is offered is decided in `src/search/link-choices.ts`; this only
 * shows it and hands back the chosen target (or `null` to remove the link).
 * The host applies it as an undoable command.
 */

import { type App, SuggestModal, setIcon } from "obsidian";
import { type LinkChoice, type LinkableNote, linkChoices } from "../search/link-choices";
import { DialogKeyboard } from "./dialog-keyboard";
import { type SpellingFix, SpellingRows } from "./spelling-row";

type PickerItem = LinkChoice | { kind: "remove"; target: string };

export interface LinkPickerHost {
  /** The vault's notes, most recently changed first. */
  notes: readonly LinkableNote[];
  /** The selected ink's link now, if it has one. */
  current: string | null;
  /** A target was picked, or (null) the link removed. */
  choose: (target: string | null) => void;
  /** What the field said when a target was picked (for corrections of the ink's reading). */
  chosenFrom?: (query: string) => void;
}

const ICONS: Record<PickerItem["kind"], string> = {
  remove: "unlink",
  note: "file-text",
  heading: "heading",
  url: "globe",
  new: "file-plus",
};

export class LinkSuggestModal extends SuggestModal<PickerItem> {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly host: LinkPickerHost,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
    this.modalEl.addClass("goodobsidian-link-modal");
    this.limit = 60;
    this.setPlaceholder("Link to a note, a heading (Note#Heading) or a web address");
    this.emptyStateText = "Type a note's name, or a web address.";
  }

  override async onOpen(): Promise<void> {
    await super.onOpen();
    this.keyboard.start(this.inputEl);
    if (!this.host.current) return;
    // Show where it leads now, selected, so typing replaces it.
    this.inputEl.value = this.host.current;
    this.inputEl.dispatchEvent(new Event("input"));
    this.inputEl.select();
  }

  override onClose(): void {
    super.onClose();
    this.keyboard.end();
  }

  /**
   * Where the ink seems to lead, read from it after the list opens: typed
   * into the field, selected so typing replaces it, unless something is
   * typed there already. `fixes`: words the ink may say otherwise, offered
   * under the field (spelling-row.ts).
   */
  suggest(text: string, fixes: readonly SpellingFix[] = []): void {
    const query = text.trim();
    if (query === "" || this.inputEl.value.trim() !== "") return;
    this.inputEl.value = query;
    this.inputEl.dispatchEvent(new Event("input"));
    this.inputEl.select();
    const box = this.inputEl.parentElement;
    if (fixes.length > 0 && box) new SpellingRows(box, this.inputEl, fixes);
  }

  getSuggestions(query: string): PickerItem[] {
    const choices: PickerItem[] = linkChoices(query, this.host.notes);
    const current = this.host.current;
    return current ? [{ kind: "remove", target: current }, ...choices] : choices;
  }

  renderSuggestion(item: PickerItem, el: HTMLElement): void {
    el.addClass("goodobsidian-link-choice");
    setIcon(el.createSpan({ cls: "goodobsidian-link-choice-icon" }), ICONS[item.kind]);
    const text = el.createDiv({ cls: "goodobsidian-link-choice-text" });
    const title = text.createDiv({ cls: "goodobsidian-link-choice-title" });
    const sub = (value: string): void => {
      text.createDiv({ cls: "goodobsidian-link-choice-sub", text: value });
    };
    switch (item.kind) {
      case "remove":
        title.setText("Remove link");
        sub(item.target);
        break;
      case "note":
        title.setText(item.note.basename);
        sub(item.note.path);
        break;
      case "heading":
        title.setText(`${item.note.basename} › ${item.heading}`);
        sub(item.note.path);
        break;
      case "url":
        title.setText(item.target);
        sub("Web address");
        break;
      case "new":
        title.setText(`Link to “${item.target}”`);
        sub("A note that does not exist yet");
        break;
    }
  }

  onChooseSuggestion(item: PickerItem): void {
    this.host.chosenFrom?.(this.inputEl.value);
    this.host.choose(item.kind === "remove" ? null : item.target);
  }
}
