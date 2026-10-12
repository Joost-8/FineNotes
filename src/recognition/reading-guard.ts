/**
 * Keeps a page that took the app down while it was read on this device from
 * doing it again at every launch (FineNotes#22: a notebook that crashed the
 * reader reopened, was read again and crashed again, until the notebook was
 * closed). Before a page is read a mark is stored on this device; a mark
 * still there at the next start means that reading never finished. That page
 * is then skipped until its ink changes, and a new plugin version, which may
 * have fixed the cause, reads such pages again.
 *
 * A page whose reading failed (an error, a timeout) is skipped until it
 * changes too, for this session only, so it is not read again after every
 * edit.
 *
 * Storage is device-local (`App.loadLocalStorage`), never synced: a page
 * that is too much for one device may be fine on another.
 *
 * PURE: the storage is passed in.
 */

/** A page being read: its note, its key and content hash, and its number for people. */
export interface ReadingMark {
  path: string;
  key: string;
  hash: string;
  page: number;
}

export interface GuardStore {
  load(): unknown;
  save(value: string): void;
}

interface Stored {
  version: string;
  reading: ReadingMark | null;
  crashed: ReadingMark[];
}

/** Crashed pages remembered, the latest kept. */
export const MAX_CRASHED = 50;

function isMark(value: unknown): value is ReadingMark {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.path === "string" &&
    typeof m.key === "string" &&
    typeof m.hash === "string" &&
    typeof m.page === "number"
  );
}

function parse(raw: unknown): Stored | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  return {
    version: typeof v.version === "string" ? v.version : "",
    reading: isMark(v.reading) ? v.reading : null,
    crashed: Array.isArray(v.crashed) ? v.crashed.filter(isMark) : [],
  };
}

const same = (a: ReadingMark, b: ReadingMark): boolean =>
  a.path === b.path && a.key === b.key && a.hash === b.hash;

export class ReadingGuard {
  /** The reading the last run never finished, found at start; null when it did. */
  readonly crash: ReadingMark | null;
  private readonly stored: Stored;
  private readonly failed: ReadingMark[] = [];
  /** The app is in the background: the mark is lifted meanwhile. */
  private hidden = false;

  constructor(
    private readonly store: GuardStore,
    version: string,
  ) {
    const raw = parse(store.load());
    this.crash = raw?.reading ?? null;
    // A new version may have fixed what crashed: those pages are read again.
    const crashed = raw && raw.version === version ? raw.crashed : [];
    if (this.crash && !crashed.some((m) => same(m, this.crash as ReadingMark))) {
      crashed.push(this.crash);
    }
    this.stored = { version, reading: null, crashed: crashed.slice(-MAX_CRASHED) };
    if (raw && (raw.reading || raw.version !== version)) this.persist();
  }

  /** Automatic reading waits for the next start after a crash. */
  get paused(): boolean {
    return this.crash !== null;
  }

  /** Pages of the note at `path` not to read, by key, at the hash not to read them at. */
  skipped(path: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of [...this.stored.crashed, ...this.failed]) {
      if (m.path === path) out.set(m.key, m.hash);
    }
    return out;
  }

  /** A page is about to be read. */
  begin(mark: ReadingMark): void {
    this.stored.reading = mark;
    if (!this.hidden) this.persist();
  }

  /** The page's reading is over, whatever came of it. */
  end(): void {
    if (!this.stored.reading) return;
    this.stored.reading = null;
    if (!this.hidden) this.persist();
  }

  /** The page could not be read: skip it until it changes. */
  fail(mark: ReadingMark): void {
    if (!this.failed.some((m) => same(m, mark))) this.failed.push(mark);
  }

  /**
   * The app went to the background or came back. iPadOS may end a
   * suspended app at any time, which is no fault of the page being read, so
   * the mark is lifted while the app is away.
   */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (this.stored.reading) this.persist(hidden ? null : this.stored.reading);
  }

  private persist(reading: ReadingMark | null = this.stored.reading): void {
    this.store.save(JSON.stringify({ ...this.stored, reading }));
  }
}
