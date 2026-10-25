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
   * Make `extra` part of the newest step, so one undo takes back both: what
   * an edit set off by itself, such as a board growing under new ink
   * (`model/board.ts`). Only onto a fresh step, with nothing to redo: added
   * under a redo branch, it would move the document out from under the
   * steps there. Returns false (and changes nothing) otherwise.
   */
  attach(doc: InkDocument, extra: Command): boolean {
    const top = this.done[this.done.length - 1];
    if (!top || this.undone.length > 0) return false;
    extra.apply(doc);
    this.done[this.done.length - 1] = new AttachedStep(top, extra);
    this.onChange?.();
    return true;
  }

  /** The newest step, or `null`: what {@link attach} would join. */
  get latest(): Command | null {
    return this.done[this.done.length - 1] ?? null;
  }

  /**
   * Take back `command` as if it had never been pushed — invert it and drop it
   * without a redo entry — but only if it is still the most recent command.
   * Returns false (and changes nothing) otherwise.
   */
  withdraw(doc: InkDocument, command: Command): boolean {
    const top = this.done[this.done.length - 1];
    if (!top || baseOf(top) !== command) return false;
    this.done.pop();
    top.invert(doc);
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
    if (commands.some((command, i) => baseOf(this.done[start + i]) !== command)) return false;
    const steps = this.done.slice(start);
    this.done.length = start;
    for (let i = steps.length - 1; i >= 0; i--) steps[i].invert(doc);
    this.onChange?.();
    return true;
  }

  /** Whether `command` is the most recent one, so {@link withdraw} would take it back. */
  isLatest(command: Command): boolean {
    return this.done.length > 0 && baseOf(this.done[this.done.length - 1]) === command;
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

/**
 * A step with something attached to it ({@link History.attach}): it applies
 * as the step, then the extra, and inverts the other way round. It answers
 * to the step's name and page, so the history reads as before.
 */
export class AttachedStep implements Command {
  readonly label: string;
  readonly pageId?: string;
  readonly keepsReading?: boolean;

  constructor(
    readonly base: Command,
    readonly extra: Command,
  ) {
    this.label = base.label;
    this.pageId = base.pageId;
    this.keepsReading = base.keepsReading;
  }

  apply(doc: InkDocument): void {
    this.base.apply(doc);
    this.extra.apply(doc);
  }

  invert(doc: InkDocument): void {
    this.extra.invert(doc);
    this.base.invert(doc);
  }
}

/** The step a command was pushed as, under anything attached to it since. */
function baseOf(command: Command): Command {
  return command instanceof AttachedStep ? baseOf(command.base) : command;
}

/**
 * What the readout says after an undo or redo, naming the step by its
 * command's `label`, as Procreate's notice does: "Undid: Change shape
 * style", "Redid: Add page". A step with no label says only what happened.
 */
export function historyNotice(redo: boolean, label: string): string {
  const verb = redo ? "Redid" : "Undid";
  const what = label.trim();
  return what === "" ? verb : `${verb}: ${what}`;
}
