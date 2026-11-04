import { setIcon } from "obsidian";
import { ICON_LIBRARY } from "../constants";
import { t } from "../i18n/translate";

/**
 * A button in the file explorer's bar that opens the notebook library (Home).
 * Obsidian exposes explorer leaves, but no API for adding a button to their bar.
 */
export class FileExplorerNotebookButton {
  private destroyed = false;
  private readonly buttons = new Map<HTMLElement, HTMLButtonElement>();

  constructor(private readonly openLibrary: () => void) {}

  sync(containers: readonly HTMLElement[], enabled: boolean): void {
    if (this.destroyed) return;
    const bars = new Set(
      enabled
        ? containers.flatMap((container) => {
            const bar = container.querySelector<HTMLElement>(".nav-buttons-container");
            return bar ? [bar] : [];
          })
        : [],
    );
    for (const [bar, button] of this.buttons) {
      if (!bars.has(bar) || button.parentElement !== bar) {
        button.remove();
        this.buttons.delete(bar);
      }
    }
    for (const bar of bars) {
      if (this.buttons.has(bar)) continue;
      const button = bar.createEl("button", {
        cls: "clickable-icon nav-action-button goodobsidian-new-notebook",
        attr: {
          type: "button",
          "aria-label": t("notebooks.explorer.library"),
          title: t("notebooks.explorer.library"),
        },
      });
      setIcon(button, ICON_LIBRARY);
      button.addEventListener("click", this.openLibrary);
      // Beside the built-in New note and New folder buttons.
      bar.insertBefore(button, bar.children.item(2));
      this.buttons.set(bar, button);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const button of this.buttons.values()) button.remove();
    this.buttons.clear();
  }
}
