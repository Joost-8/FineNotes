/**
 * The welcome a new user sees the first time FineNotes runs in a vault with
 * no notebooks (`shouldShowWelcome`), and again from the command "Show the
 * welcome":
 *
 *   Welcome to FineNotes
 *   Handwritten notebooks with real pages, kept as files in this vault.
 *   Take the tour            A short notebook that shows the tools.   [Open]
 *   Bring your notebooks     From Goodnotes, Notability and more.     [Import…]
 *   Start fresh              A notebook with the cover and paper …    [New notebook]
 *
 * Written for someone who has never used Obsidian. It only reports the
 * choice; the plugin makes the notebook or opens the dialog.
 */

import { type App, Modal, Setting } from "obsidian";
import { WELCOME_TITLE } from "../model/welcome";
import { t } from "../i18n/translate";

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
      text: t("notebooks.welcome.intro"),
    });
    this.choice(
      t("notebooks.welcome.tour"),
      t("notebooks.welcome.tourInfo"),
      t("notebooks.welcome.tourButton"),
      true,
      this.actions.openTour,
    );
    this.choice(
      t("notebooks.welcome.bring"),
      t("notebooks.welcome.bringInfo"),
      t("notebooks.welcome.bringButton"),
      false,
      this.actions.importNotebooks,
    );
    this.choice(
      t("notebooks.welcome.fresh"),
      t("notebooks.welcome.freshInfo"),
      t("notebooks.welcome.freshButton"),
      false,
      this.actions.newNotebook,
    );
    el.createEl("p", {
      cls: "goodobsidian-welcome-hint",
      text: t("notebooks.welcome.hint", { command: t("notebooks.command.showWelcome") }),
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
