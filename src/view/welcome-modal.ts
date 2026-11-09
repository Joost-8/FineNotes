/**
 * The welcome a new user sees the first time FineNotes runs in a vault with
 * no notebooks (`shouldShowWelcome`), and again from the command "Show the
 * welcome". Written for someone who has never used Obsidian: the first row
 * hides Obsidian's chrome, live, so sliding it back is its own undo.
 */

import { type App, Modal, ToggleComponent } from "obsidian";
import { WELCOME_TITLE } from "../model/welcome";
import { t } from "../i18n/translate";

export interface WelcomeActions {
  // Properties holding functions, not methods (CLAUDE.md: a callback is a value).
  openTour: () => void;
  importNotebooks: () => void;
  /** Opens Home, the notebook library, where New makes a notebook. */
  openHome: () => void;
  simpleLook: () => boolean;
  setSimpleLook: (on: boolean) => void;
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
    el.createEl("p", { cls: "goodobsidian-welcome-intro", text: t("notebooks.welcome.intro") });
    this.simpleRow(el);
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
      t("notebooks.welcome.homeInfo"),
      t("notebooks.welcome.homeButton"),
      false,
      this.actions.openHome,
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private simpleRow(parent: HTMLElement): void {
    const row = parent.createDiv({ cls: "goodobsidian-welcome-row is-lead" });
    const on = this.actions.simpleLook();
    const picture = row.createDiv({ cls: "goodobsidian-welcome-window" });
    picture.toggleClass("is-simple", on);
    picture.createDiv({ cls: "goodobsidian-welcome-window-ribbon" });
    picture.createDiv({ cls: "goodobsidian-welcome-window-side" });
    picture.createDiv({ cls: "goodobsidian-welcome-window-page" });
    this.words(row, t("notebooks.welcome.simple"), t("notebooks.welcome.simpleInfo"));
    new ToggleComponent(row).setValue(on).onChange((next) => {
      picture.toggleClass("is-simple", next);
      this.actions.setSimpleLook(next);
    });
  }

  /** One row; its button closes the welcome before doing what it says. */
  private choice(name: string, desc: string, label: string, cta: boolean, run: () => void): void {
    const row = this.contentEl.createDiv({ cls: "goodobsidian-welcome-row" });
    this.words(row, name, desc);
    const button = row.createEl("button", {
      cls: "clickable-icon goodobsidian-welcome-button",
      text: label,
      attr: { type: "button" },
    });
    button.toggleClass("mod-cta", cta);
    button.addEventListener("click", () => {
      this.close();
      run();
    });
  }

  private words(row: HTMLElement, name: string, desc: string): void {
    const words = row.createDiv({ cls: "goodobsidian-welcome-words" });
    words.createDiv({ cls: "goodobsidian-welcome-name", text: name });
    words.createDiv({ cls: "goodobsidian-welcome-desc", text: desc });
  }
}
