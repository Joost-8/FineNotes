/**
 * The library's Move, Duplicate and Delete, done on the vault. Each acts on
 * a notebook's own folder when it has one (model/library-files.ts), so a
 * notebook never leaves its pictures, recordings and transcripts behind.
 */

import { type App, Notice } from "obsidian";
import { t } from "../i18n/translate";
import { parentPath } from "../model/folder-notebook";
import {
  type Picked,
  duplicatePlan,
  notebookUnit,
  trashPlan,
  trashQuestion,
} from "../model/library-files";
import { ConfirmModal } from "../ui/confirm-modal";

/** Asks before a Delete; the dialog unless a test gives its own answer. */
export type AskToTrash = (question: { title: string; message: string }) => Promise<boolean>;

export class LibraryActions {
  constructor(
    private readonly app: App,
    /** Whether the file at a vault path is a notebook. */
    private readonly isNotebook: (path: string) => boolean,
    private readonly ask: AskToTrash = (question) =>
      ConfirmModal.confirm(app, { ...question, cta: t("common.delete"), warning: true }),
  ) {}

  private files(): string[] {
    return this.app.vault.getFiles().map((file) => file.path);
  }

  /** What a library item is on disk: a notebook's own folder, or the item itself. */
  unit(path: string): string {
    return this.isNotebook(path) ? notebookUnit(path, this.files(), this.isNotebook) : path;
  }

  /** Whether `unit` (see `unit`) may go into `dir`: not where it is, and not into itself. */
  static canMove(unit: string, dir: string): boolean {
    return parentPath(unit) !== dir && dir !== unit && !dir.startsWith(`${unit}/`);
  }

  /** The notebook or folder at `path` into `dir` ("" the root); a notice says why not. Whether it moved. */
  async move(path: string, dir: string): Promise<boolean> {
    const unit = this.unit(path);
    const item = this.app.vault.getAbstractFileByPath(unit);
    if (!item || parentPath(unit) === dir) return false;
    if (!LibraryActions.canMove(unit, dir)) {
      new Notice(t("notebooks.home.intoItself"));
      return false;
    }
    const target = dir === "" ? item.name : `${dir}/${item.name}`;
    if (this.app.vault.getAbstractFileByPath(target)) {
      new Notice(t("notebooks.home.existsThere", { name: item.name }));
      return false;
    }
    await this.app.fileManager.renameFile(item, target);
    return true;
  }

  /** A copy of the notebook at `path` beside it, in an own folder of its own if it has one. Its path. */
  async duplicate(path: string): Promise<string | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const { vault } = this.app;
    const plan = duplicatePlan(
      path,
      this.unit(path),
      (p) => vault.getAbstractFileByPath(p) !== null,
    );
    for (const folder of plan.folders) {
      if (!vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
    }
    await vault.copy(file, plan.note);
    return plan.note;
  }

  /** Ask once, naming what goes and what stays, then put it in the trash. Whether anything went. */
  async trash(picked: readonly Picked[]): Promise<boolean> {
    const plan = trashPlan(picked, this.files(), this.isNotebook);
    if (plan.trash.length === 0) return false;
    if (!(await this.ask(trashQuestion(plan)))) return false;
    for (const path of plan.trash) {
      const item = this.app.vault.getAbstractFileByPath(path);
      if (item) await this.app.fileManager.trashFile(item);
    }
    return true;
  }
}
