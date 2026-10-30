import { type App, Modal } from "obsidian";

import { SHORTCUT_GROUPS, type ShortcutGroup } from "../model/shortcuts";
import { renderShortcutList } from "../view/shortcut-list";

/**
 * The keyboard and stylus shortcuts in a pop-up over the notebook, the same
 * list the settings show. Opened with ?, the command "Show keyboard
 * shortcuts" or the notebook's ⋯ panel; ?, Escape or a tap outside closes
 * it.
 */
export class ShortcutsModal extends Modal {
  /** Between open and close. */
  shown = false;

  constructor(
    app: App,
    /** Name the keys as on a Mac or an iPad (⌘ ⌥ ⇧), else Ctrl, Alt, Shift. */
    private readonly apple: boolean,
    /** The list, with this device's own keys in it. */
    private readonly groups: readonly ShortcutGroup[] = SHORTCUT_GROUPS,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.shown = true;
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-shortcuts-modal");
    this.titleEl.setText("Keyboard and stylus shortcuts");
    renderShortcutList(this.contentEl, this.apple, this.groups);
    this.contentEl.createDiv({
      cls: "goodobsidian-shortcuts-hint",
      text: "Press ? to show or hide this list. None of them act while you type in a text box.",
    });
    // ? closes it, as it opened it.
    this.scope.register(null, "?", () => {
      this.close();
      return false;
    });
  }

  override onClose(): void {
    this.shown = false;
    this.contentEl.empty();
  }
}
