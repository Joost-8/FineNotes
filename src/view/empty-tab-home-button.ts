import { setIcon, type WorkspaceLeaf } from "obsidian";
import { ICON_LIBRARY } from "../constants";

/**
 * A "Notebooks" action on Obsidian's empty tab (what you see after closing the Home
 * tab, or opening a new one), so the library is one tap away without the palette.
 */
export class EmptyTabHomeButton {
  private destroyed = false;
  private readonly actions = new Map<HTMLElement, HTMLElement>();

  constructor(private readonly openLibrary: (leaf: WorkspaceLeaf) => void) {}

  sync(empties: readonly { leaf: WorkspaceLeaf; el: HTMLElement }[]): void {
    if (this.destroyed) return;
    const lists = new Set(
      empties.flatMap(({ el }) => {
        const list = el.querySelector<HTMLElement>(".empty-state-action-list");
        return list ? [list] : [];
      }),
    );
    const leafOf = (list: HTMLElement) => empties.find(({ el }) => el.contains(list))?.leaf;
    for (const [list, action] of this.actions) {
      if (!lists.has(list) || action.parentElement !== list) {
        action.remove();
        this.actions.delete(list);
      }
    }
    for (const list of lists) {
      if (this.actions.has(list)) continue;
      const action = list.createDiv({
        cls: "empty-state-action goodobsidian-empty-home",
        attr: { role: "button", tabindex: "0", "aria-label": "Notebooks" },
      });
      const icon = action.createSpan({ cls: "goodobsidian-empty-home-icon" });
      setIcon(icon, ICON_LIBRARY);
      action.createSpan({ text: "Notebooks" });
      const go = () => {
        const leaf = leafOf(list);
        if (leaf) this.openLibrary(leaf);
      };
      action.addEventListener("click", go);
      action.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          go();
        }
      });
      // First: the way back to Home comes before the generic actions.
      list.insertBefore(action, list.firstChild);
      this.actions.set(list, action);
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const action of this.actions.values()) action.remove();
    this.actions.clear();
  }
}
