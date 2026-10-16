/**
 * The welcome a new user sees the first time FineNotes runs in a vault with
 * no notebooks (`shouldShowWelcome`), and again from the command "Show the
 * welcome":
 *
 *   Welcome to FineNotes
 *   Handwritten notebooks with real pages, kept as files in this vault.
 *   Take the tour            A short notebook that shows the tools.   [Open]
 *   Bring your notebooks     From Goodnotes or Notability.            [Import…]
 *   Start fresh              A notebook with the cover and paper …    [New notebook]
 *
 * Written for someone who has never used Obsidian. It only reports the
 * choice; the plugin makes the notebook or opens the dialog.
 */

import { type App, Modal, Setting } from "obsidian";
import { WELCOME_TITLE } from "../model/welcome";

export interface WelcomeActions {
  // Properties holding functions, not methods (CLAUDE.md: a callback is a value).
  openTour: () => void;
  importNotebooks: () => void;
  newNotebook: () => void;
}

export class WelcomeModal extends Modal {
  constructor(
    app: App,
    private readonly actions: WelcomeActions,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-welcome");
    this.titleEl.setText(WELCOME_TITLE);
    const el = this.contentEl;
    el.createEl("p", {
      text:
        "Handwritten notebooks with real pages, as in Goodnotes. Each notebook is a file " +
        "in this vault, on your device.",
    });
    this.choice(
      "Take the tour",
      "A short notebook that shows the tools. Write in it as much as you like.",
      "Open",
      true,
      this.actions.openTour,
    );
    this.choice(
      "Bring your notebooks",
      "From Goodnotes or Notability, with your handwriting still editable.",
      "Import…",
      false,
      this.actions.importNotebooks,
    );
    this.choice(
      "Start fresh",
      "A new notebook, with the cover and paper you choose.",
      "New notebook",
      false,
      this.actions.newNotebook,
    );
    el.createEl("p", {
      cls: "goodobsidian-welcome-hint",
      text: "To see this again, run the command “FineNotes: Show the welcome”.",
    });
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  /** One row; its button closes the welcome before doing what it says. */
  private choice(name: string, desc: string, label: string, cta: boolean, run: () => void): void {
    new Setting(this.contentEl)
      .setName(name)
      .setDesc(desc)
      .addButton((button) => {
        button
          .setClass("clickable-icon")
          .setButtonText(label)
          .onClick(() => {
            this.close();
            run();
          });
        if (cta) button.setCta();
      });
  }
}
