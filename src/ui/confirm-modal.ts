import { type App, Modal, Setting } from "obsidian";

/** What a confirmation asks, and the word on the button that says yes. */
export interface ConfirmOptions {
  title: string;
  message: string;
  cta: string;
}

/**
 * A yes/no question that does not block the app, unlike `window.confirm`
 * (which Obsidian's review forbids). The answer is a promise: `true` from
 * the confirming button, `false` from Cancel or from closing the dialog any
 * other way. It settles once, whatever happens after.
 */
export class ConfirmModal extends Modal {
  private answer: ((yes: boolean) => void) | null = null;

  constructor(
    app: App,
    private readonly options: ConfirmOptions,
  ) {
    super(app);
  }

  /** Ask, and wait for the answer. */
  static confirm(app: App, options: ConfirmOptions): Promise<boolean> {
    const dialog = new ConfirmModal(app, options);
    const answered = new Promise<boolean>((resolve) => (dialog.answer = resolve));
    dialog.open();
    return answered;
  }

  override onOpen(): void {
    const { title, message, cta } = this.options;
    this.modalEl.addClass("goodobsidian-dialog");
    this.titleEl.setText(title);
    this.contentEl.createEl("p", { text: message });
    new Setting(this.contentEl)
      .addButton((yes) =>
        yes
          .setButtonText(cta)
          .setCta()
          .onClick(() => this.answerAndClose(true)),
      )
      .addButton((no) => no.setButtonText("Cancel").onClick(() => this.answerAndClose(false)));
  }

  override onClose(): void {
    this.contentEl.empty();
    this.settle(false); // Esc, the ×, a tap outside: a no, unless a button answered first
  }

  private answerAndClose(yes: boolean): void {
    this.settle(yes);
    this.close();
  }

  /** Hand over the first answer only. */
  private settle(yes: boolean): void {
    const answer = this.answer;
    this.answer = null;
    answer?.(yes);
  }
}
