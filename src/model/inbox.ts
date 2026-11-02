/**
 * The FineNotes inbox: a folder at the vault's root where a PDF put by
 * another app (the iPad's Shortcuts and Files, a file manager) becomes a
 * notebook. FineNotes makes the notebook in the new-notebook folder, moves
 * the PDF in beside it, and so keeps the inbox empty; the file list hides
 * the folder (styles.css), so nobody files anything there by hand.
 *
 * Not a dot-folder: Obsidian indexes none (so no PDF there would ever be
 * seen), and the iPad's Files app and Shortcuts' folder picker hide them.
 */

/** The inbox's vault path. Shortcuts we publish save here: never rename it. */
export const INBOX_FOLDER = "FineNotes inbox";

/**
 * The published Shortcuts-app shortcuts (iCloud links, offered in Settings on
 * Apple devices). "New notebook" opens `obsidian://finenotes?do=new`; "New
 * FineNotes notebook" takes a PDF from the share sheet, saves it here and
 * opens `do=pdf` with its name. An iCloud link is a snapshot: a changed
 * shortcut needs a new link here.
 */
export const SHORTCUT_NEW_NOTEBOOK_URL =
  "https://www.icloud.com/shortcuts/cdeb33cd23444704b9e94b065ff899e3";
export const SHORTCUT_PDF_URL = "https://www.icloud.com/shortcuts/cd6784b331634661a7d46b4d050798bf";

/** How long a link may still find the notebook an inbox PDF became, by the PDF's name. */
export const INBOX_MEMORY_MS = 2 * 60_000;

/** Whether `path` is a PDF lying directly in the inbox (not in a folder inside it). */
export function isInboxPdf(path: string): boolean {
  const prefix = `${INBOX_FOLDER}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/") && /\.pdf$/i.test(rest);
}

/**
 * The key a PDF is known by to a link: its file name without folder or
 * `.pdf`, lower-cased. A shortcut names the file it saved (`Lecture 7`,
 * `Lecture 7.pdf` or `FineNotes inbox/Lecture 7.pdf`), and by then the
 * inbox may already have moved it.
 */
export function pdfKey(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return name
    .replace(/\.pdf$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * The inbox runs, by `pdfKey`: each PDF's notebook (or `null` when it
 * failed), in flight or recent, so a link and the folder watcher that both
 * see one PDF make one notebook. `T` is whatever a run resolves to.
 */
export class InboxRuns<T> {
  private readonly runs = new Map<string, { run: Promise<T>; at: number; claimed: boolean }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The run for `file`, started now by `start` unless one is in flight or recent. */
  run(file: string, start: () => Promise<T>): Promise<T> {
    this.forget();
    const key = pdfKey(file);
    const known = this.runs.get(key);
    if (known) return known.run;
    const run = start();
    this.runs.set(key, { run, at: this.now(), claimed: false });
    return run;
  }

  /** The run a link names, if there is one; marks it as the link's to open. */
  claim(file: string): Promise<T> | null {
    this.forget();
    const known = this.runs.get(pdfKey(file));
    if (!known) return null;
    known.claimed = true;
    return known.run;
  }

  /** Whether a link has asked for `file`'s notebook (then the link opens it). */
  claimed(file: string): boolean {
    return this.runs.get(pdfKey(file))?.claimed ?? false;
  }

  private forget(): void {
    const now = this.now();
    for (const [key, entry] of this.runs) {
      if (now - entry.at > INBOX_MEMORY_MS) this.runs.delete(key);
    }
  }
}
