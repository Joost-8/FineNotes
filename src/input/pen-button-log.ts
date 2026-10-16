/**
 * What a pen's buttons send, for the diagnostics HUD and export. Pens differ
 * here more than anywhere: a tablet pen's barrel button is `buttons & 2`, an
 * Android pen's second button may come as the middle button (`buttons & 4`)
 * or not at all, when the tablet's own pen app keeps it, and some pens send
 * their buttons as key presses over Bluetooth. Before a button is wired to
 * anything, this log shows which of those a pen does.
 *
 * It keeps every pen event whose buttons differ from the one before it, so a
 * run of moves (or of hovering) with the same buttons is one entry with a
 * count, and the right-click menus and keys that arrive alongside.
 *
 * Pure: no DOM, no Obsidian.
 */

/** How many entries are kept; older ones drop off the front. */
const LOG_LENGTH = 40;

/** How many of the latest entries the HUD's line shows. */
const HUD_ENTRIES = 6;

/** The parts of a pointer (or `contextmenu`) event this log reads. */
export interface ButtonEventInput {
  /** The DOM event type: `pointerdown`, `pointermove`, `contextmenu`… */
  type: string;
  pointerType: string;
  button: number;
  buttons: number;
  timeStamp: number;
}

/** The parts of a key event this log reads. */
export interface KeyEventInput {
  type: string;
  key: string;
  code: string;
  timeStamp: number;
}

/** One entry: an event, its buttons, and how many in a row were alike. */
export interface ButtonLogEntry {
  /** `dn`, `mv` (touching), `hv` (hovering), `up`, `cx`, `menu`, `in`, `out`, `key`, `keyup`. */
  ev: string;
  /** The button that changed (`-1`: none); for a key, `-1`. */
  b: number;
  /** Every button held, as a bit set; for a key, `0`. */
  bs: number;
  /** For a pointer event, its `pointerType` (a menu's may be a mouse's, or empty). */
  pt?: string;
  /** For a key: its `key` and `code`, as `key/code`. */
  key?: string;
  /** How many events in a row this entry stands for. */
  n: number;
  /** The first one's time stamp, ms. */
  t: number;
}

/** `buttons` bit of a pen touching the surface. */
const CONTACT_BIT = 1;

/** The short name of a pointer event, or null for one this log does not keep. */
function eventName(type: string, buttons: number): string | null {
  switch (type) {
    case "pointerdown":
      return "dn";
    case "pointermove":
      return (buttons & CONTACT_BIT) !== 0 ? "mv" : "hv";
    case "pointerup":
      return "up";
    case "pointercancel":
      return "cx";
    case "contextmenu":
      return "menu";
    case "auxclick":
      return "aux";
    case "pointerover":
    case "pointerenter":
      return "in";
    case "pointerout":
    case "pointerleave":
      return "out";
    default:
      return null;
  }
}

export class PenButtonLog {
  private log: ButtonLogEntry[] = [];

  /**
   * Note a pointer event. Only a pen's are kept, and a right-click menu of
   * any pointer (a driver may send a pen button as a right click, and
   * WebViews do not always say which pointer it came from).
   */
  record(event: ButtonEventInput): void {
    const menu = event.type === "contextmenu" || event.type === "auxclick";
    if (event.pointerType !== "pen" && !menu) return;
    const ev = eventName(event.type, event.buttons);
    if (ev === null) return;
    const last = this.log[this.log.length - 1];
    // A move only says which button changed when one did; -1 otherwise.
    const repeat =
      last !== undefined &&
      last.key === undefined &&
      last.ev === ev &&
      last.bs === event.buttons &&
      last.b === event.button;
    if (repeat && (ev === "mv" || ev === "hv")) {
      last.n += 1;
      return;
    }
    const { button: b, buttons: bs, pointerType: pt, timeStamp: t } = event;
    this.append({ ev, b, bs, pt, n: 1, t });
  }

  /** Note a key press or release: a pen's buttons may arrive as keys. */
  key(event: KeyEventInput): void {
    const ev = event.type === "keyup" ? "keyup" : "key";
    this.append({ ev, b: -1, bs: 0, key: `${event.key}/${event.code}`, n: 1, t: event.timeStamp });
  }

  /** The HUD was just switched on: an empty log. */
  restart(): void {
    this.log = [];
  }

  /** Every entry kept, oldest first, for the diagnostics export. */
  entries(): ButtonLogEntry[] {
    return this.log.map((entry) => ({ ...entry }));
  }

  /** One line for the HUD: the latest entries, `-` when there are none. */
  line(): string {
    const latest = this.log.slice(-HUD_ENTRIES).map(entryText);
    return `btn ${latest.length > 0 ? latest.join(" · ") : "-"}`;
  }

  private append(entry: ButtonLogEntry): void {
    this.log.push(entry);
    if (this.log.length > LOG_LENGTH) this.log.shift();
  }
}

/** An entry as the HUD shows it: `dn b2 bs3`, `hv b-1 bs2 ×14`, `key PageDown/PageDown`. */
export function entryText(entry: ButtonLogEntry): string {
  const what =
    entry.key !== undefined ? `${entry.ev} ${entry.key}` : `${entry.ev} b${entry.b} bs${entry.bs}`;
  return entry.n > 1 ? `${what} ×${entry.n}` : what;
}
