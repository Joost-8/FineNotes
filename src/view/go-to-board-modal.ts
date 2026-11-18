/**
 * "Go to board" (discussion #160): a searchable list of a board file's
 * boards, each by its number and its name (its line in the contents), the
 * board being read marked. A finger on an iPad picks from it as from the
 * Boards tab; a keyboard types a name or a number.
 */

import { type App, FuzzySuggestModal } from "obsidian";
import { t } from "../i18n/translate";
import { boardLabel } from "../model/board";
import type { Page } from "../model/document";

export class GoToBoardModal extends FuzzySuggestModal<number> {
  constructor(
    app: App,
    private readonly boards: readonly Page[],
    private readonly current: number,
    private readonly onChoose: (index: number) => void,
  ) {
    super(app);
    this.setPlaceholder(t("notebooks.command.goToBoard"));
  }

  getItems(): number[] {
    return this.boards.map((_, index) => index);
  }

  getItemText(index: number): string {
    const label = boardLabel(this.boards[index], index);
    return index === this.current ? `${label} ●` : label;
  }

  onChooseItem(index: number): void {
    this.onChoose(index);
  }
}
