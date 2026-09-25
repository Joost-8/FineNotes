/**
 * Undo and redo for one open notebook. Each step is the {@link Command} that
 * made it, so a step costs what its edit changed and never a copy of the
 * document. Nothing here touches the DOM or Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument } from "./document";

/** How many steps back undo reaches before the oldest becomes permanent. */
const DEFAULT_LIMIT = 200;

export class History {
  /** Steps that can be undone, oldest first. */
  private readonly done: Command[] = [];
  /** Steps that were undone and can be redone, the next redo last. */
  private readonly undone: Command[] = [];

  /**
   * Called after anything changes what can be undone or redone, so a host
   * can grey out its Undo and Redo buttons. Not called for a no-op.
   */
  onChange: (() => void) | null = null;

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /**
   * Make a new edit: apply `command` and put it on top of the undo steps. A new
   * edit ends the redo branch, and past the limit the oldest step is kept for
   * good. A command that throws while applying is not recorded.
   */
  push(doc: InkDocument, command: Command): void {
    command.apply(doc);
    this.done.push(command);
    if (this.done.length > this.limit) this.done.shift();
    this.undone.length = 0;
    this.onChange?.();
  }

  /**
   * Take back `command` as if it had never been pushed — invert it and drop it
   * without a redo entry — but only if it is still the most recent command.
   * Returns false (and changes nothing) otherwise.
   */
  withdraw(doc: InkDocument, command: Command): boolean {
    if (this.done[this.done.length - 1] !== command) return false;
    this.done.pop();
    command.invert(doc);
    this.onChange?.();
    return true;
  }

  /**
   * {@link withdraw} for several commands at once: take back `commands`
   * (oldest first) only if they are exactly the most recent ones, newest
   * inverted first. All or nothing — returns false and changes nothing if
   * anything else was pushed among or after them.
   */
  withdrawTail(doc: InkDocument, commands: readonly Command[]): boolean {
    const start = this.done.length - commands.length;
    if (commands.length === 0 || start < 0) return false;
    if (commands.some((command, i) => this.done[start + i] !== command)) return false;
    this.done.length = start;
    for (let i = commands.length - 1; i >= 0; i--) commands[i].invert(doc);
    this.onChange?.();
    return true;
  }

  /** Whether `command` is the most recent one, so {@link withdraw} would take it back. */
  isLatest(command: Command): boolean {
    return this.done.length > 0 && this.done[this.done.length - 1] === command;
  }

  canUndo(): boolean {
    return this.done.length > 0;
  }

  canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Take back the newest step and return it, or `null` when there is none. */
  undo(doc: InkDocument): Command | null {
    return this.move(this.done, this.undone, (command) => command.invert(doc));
  }

  /** Make the last undone step again and return it, or `null` when there is none. */
  redo(doc: InkDocument): Command | null {
    return this.move(this.undone, this.done, (command) => command.apply(doc));
  }

  /** Forget every step, without running any. */
  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.onChange?.();
  }

  /** Run the newest command of `from` and hand it over to `to`. */
  private move(from: Command[], to: Command[], run: (command: Command) => void): Command | null {
    const command = from.pop();
    if (!command) return null;
    run(command);
    to.push(command);
    this.onChange?.();
    return command;
  }
}
