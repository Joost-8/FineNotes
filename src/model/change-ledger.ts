/**
 * Ask AI's changes to one open notebook, numbered, so each can be taken back
 * later, from the chat or by asking the AI: one entry per action that
 * changed the notebook, holding what it changed (`model/change-set.ts`) and
 * the answer it was part of.
 *
 * Kept while the notebook stays open; a chat loaded from a file has no
 * changes to take back (its answers' changes were made to a notebook as it
 * was then).
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument } from "./document";
import {
  type ChangeSet,
  type ChangeState,
  type RevertRefusal,
  changeState,
  revertChange,
} from "./change-set";

export interface LedgerEntry {
  /** 1, 2, 3… in the order the changes were made: how the chat and the AI name them. */
  id: number;
  /** What the action did, as the chat says it. */
  label: string;
  /** Which answer it was part of: 1, 2, 3… */
  answer: number;
  set: ChangeSet;
}

export class ChangeLedger {
  private readonly entries: LedgerEntry[] = [];

  /** Keep a change; returns its number. */
  record(set: ChangeSet, label: string, answer: number): number {
    const id = this.entries.length + 1;
    this.entries.push({ id, label, answer, set });
    return id;
  }

  entry(id: number): LedgerEntry | null {
    return this.entries[id - 1] ?? null;
  }

  /** Where change `id` stands; null when there is no such change. */
  state(doc: InkDocument, id: number): ChangeState | null {
    const entry = this.entry(id);
    return entry ? changeState(doc, entry.set) : null;
  }

  /**
   * The changes of the newest answer that still has any in place, before
   * answer `before` (the one asking), oldest first; empty when none has.
   */
  latestApplied(doc: InkDocument, before: number): number[] {
    const answers = [...new Set(this.entries.map((entry) => entry.answer))]
      .filter((answer) => answer < before)
      .sort((a, b) => b - a);
    for (const answer of answers) {
      const ids = this.entries.filter((entry) => entry.answer === answer).map((entry) => entry.id);
      if (ids.some((id) => this.state(doc, id) !== "undone")) return ids;
    }
    return [];
  }

  /**
   * One step taking changes `ids` back (`undo`) or making them again
   * (`redo`), or why it cannot be (`changed`: a later edit touched them;
   * `already`: nothing to do). Unknown ids are reported as `unknown`.
   */
  revert(
    doc: InkDocument,
    ids: readonly number[],
    direction: "undo" | "redo",
    label: string,
  ): Command | RevertRefusal | { reason: "unknown"; ids: number[] } {
    const unknown = ids.filter((id) => this.entry(id) === null);
    if (unknown.length > 0) return { reason: "unknown", ids: unknown };
    const sets = [...new Set(ids)]
      .sort((a, b) => a - b)
      .map((id) => (this.entry(id) as LedgerEntry).set);
    return revertChange(doc, sets, direction, label);
  }

  get size(): number {
    return this.entries.length;
  }
}
