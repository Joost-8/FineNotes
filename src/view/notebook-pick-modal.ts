/**
 * "Keep beside notebook…" in a PDF's file menu: which notebook it goes
 * beside, found by name. Last moved-to first, then the newest edited
 * (`orderTargets`, as Move to another notebook lists them).
 */

import { type App, SuggestModal } from "obsidian";
import { t } from "../i18n/translate";
import { type TransferTarget, orderTargets } from "../model/page-transfer";

export class NotebookPickModal extends SuggestModal<TransferTarget> {
  constructor(
    app: App,
    private readonly targets: readonly TransferTarget[],
    private readonly recent: readonly string[],
    private readonly pick: (target: TransferTarget) => void,
  ) {
    super(app);
    this.setPlaceholder(t("notebooks.keepBeside.find"));
    this.emptyStateText = t("notebooks.keepBeside.none");
  }

  getSuggestions(query: string): TransferTarget[] {
    return orderTargets(this.targets, this.recent, query, "");
  }

  renderSuggestion(target: TransferTarget, el: HTMLElement): void {
    el.createDiv({ text: target.title });
    const folder = target.path.slice(0, Math.max(0, target.path.lastIndexOf("/")));
    // Obsidian's own second line of a suggestion.
    if (folder) el.createDiv({ cls: "suggestion-note", text: folder });
  }

  onChooseSuggestion(target: TransferTarget): void {
    this.pick(target);
  }
}
