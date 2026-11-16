/**
 * What became of the keys pressed on a notebook, for a bug report
 * (FineNotes#226: "P sometimes does nothing" on an iPad's keyboard, which
 * has no console). Each key gets one verdict: taken, or why it was left.
 *
 * PURE: no DOM. A key typed into a field is counted, never written down:
 * diagnostics are pasted into public issues.
 */

/** Why a key was taken or left alone. */
export type KeyVerdict =
  /** A shortcut or a screen key ran. */
  | "taken"
  /** Bound to nothing here. */
  | "unbound"
  /** Two rows share it, or the user cleared it: taken, does nothing. */
  | "conflict"
  /** Its tool's button is off (Customize toolbar). */
  | "off"
  /** A practice sheet has the pen and the eraser only. */
  | "practice"
  /** Typed into a field, or while a text box is being edited. */
  | "field"
  /** Mid-composition (an input method, or keyCode 229). */
  | "composing"
  /** Something before the notebook already handled it. */
  | "prevented"
  /** A dialog or a menu was open. */
  | "modal"
  /** Its target was outside the notebook. */
  | "outside"
  /** The notebook's key scope was never asked: another scope came first. */
  | "unheard";

/** The verdicts whose key is typing, so its name is not kept. */
const PRIVATE: ReadonlySet<KeyVerdict> = new Set<KeyVerdict>(["field", "composing"]);

/** How many recent keys a report lists. */
export const KEY_LOG_MAX = 40;

/** A key as a report names it: a letter, a digit or a named key, never text. */
export function keyName(key: string, code: string, repeat: boolean): string {
  let name: string;
  if (key === "Unidentified" || key === "Process" || key === "") name = `?${code || "-"}`;
  else if (key === " ") name = "Space";
  else if (key.length === 1) name = /[a-z0-9]/i.test(key) ? key.toLowerCase() : "sym";
  else name = /^[A-Za-z0-9]+$/.test(key) ? key : "named";
  return repeat ? `${name}*` : name;
}

/** The counts and the latest keys, as diagnostics hold them. */
export interface KeyLogReport {
  seen: number;
  verdicts: Partial<Record<KeyVerdict, number>>;
  /** Oldest first, `key:verdict` (`:field` alone for a typed key). */
  recent: string[];
}

export class KeyLog {
  private seen = 0;
  private readonly verdicts: Partial<Record<KeyVerdict, number>> = {};
  private readonly recent: string[] = [];

  /** One key press and what became of it. `name` comes from {@link keyName}. */
  note(name: string, verdict: KeyVerdict): void {
    this.seen++;
    this.verdicts[verdict] = (this.verdicts[verdict] ?? 0) + 1;
    this.recent.push(PRIVATE.has(verdict) ? `:${verdict}` : `${name}:${verdict}`);
    if (this.recent.length > KEY_LOG_MAX) this.recent.shift();
  }

  report(): KeyLogReport {
    return { seen: this.seen, verdicts: { ...this.verdicts }, recent: [...this.recent] };
  }

  /** One HUD line: the counts, and the last few keys. */
  hudLine(last = 4): string {
    const counts = Object.entries(this.verdicts)
      .map(([verdict, n]) => `${verdict}=${n}`)
      .join(" ");
    const tail = this.recent.slice(-last).join(" ");
    return `keys ${this.seen}${counts ? ` ${counts}` : ""}${tail ? ` | ${tail}` : ""}`;
  }
}
