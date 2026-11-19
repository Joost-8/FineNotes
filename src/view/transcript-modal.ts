/**
 * A page's transcript typed by hand (FineNotes#265): "Transcribe this page"
 * without an AI set up, the Recognize command with Manual chosen, and Edit
 * on a page's transcript in the sidebar's Files tab. It opens with the
 * page's transcript as it is, and hands back what was typed; the host saves
 * it as the person's, which no machine transcription replaces.
 *
 *   Page 3
 *   [ What the page says…                ]
 *   [                                    ]
 *                         [Cancel] [Save]
 *
 * Built like `ink-text-modal.ts`, but Enter starts a new line: a page is
 * typed in several, and only Save saves.
 */

import { type App, Modal } from "obsidian";
import { t } from "../i18n/translate";
import { DialogKeyboard } from "./dialog-keyboard";

/** Longest transcript typed in one go; a full page of writing fits many times over. */
const MAX_TRANSCRIPT = 20_000;

export class TranscriptModal extends Modal {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly page: number,
    private readonly text: string,
    private readonly submit: (text: string) => void,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-contents-modal");
    this.titleEl.setText(t("view.typeTranscript.title", { page: this.page }));
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    const field = body.createEl("textarea", {
      cls: "goodobsidian-ask-input goodobsidian-transcript-input",
      attr: {
        placeholder: t("view.typeTranscript.placeholder"),
        "aria-label": t("view.typeTranscript.fieldLabel"),
        maxlength: String(MAX_TRANSCRIPT),
        autocomplete: "off",
      },
    });
    field.value = this.text;
    this.keyboard.watch(field, field);

    const actions = body.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: t("common.cancel") });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "mod-cta", text: t("common.save") });
    save.addEventListener("click", () => {
      const typed = field.value.trim();
      this.close();
      if (typed !== this.text.trim()) this.submit(typed);
    });
    field.focus();
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }
}
