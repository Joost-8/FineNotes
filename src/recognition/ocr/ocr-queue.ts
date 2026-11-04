/**
 * Which page the OCR reads next. Pure bookkeeping: the service
 * (view/ocr-service.ts) adds pages that need reading, says which page of
 * which PDF the user is on, and asks what to do next.
 *
 * - The page in view first, then its neighbours (a page at most
 *   {@link NEAR} away from it); both whenever the pen is up.
 * - The rest of that PDF only while idle, nearest the page in view first.
 * - The PDF most recently looked at goes first.
 * - A PDF no open notebook uses any more is cancelled whole.
 * - Pages that are not known to need reading are probed (the service reads
 *   their text to find out) while idle, for the PDFs that have a scanned
 *   page: only that PDF, never anything else in the vault.
 *
 * PURE: no DOM, no Obsidian.
 */

/** Pages this near the one in view are read without waiting for idle. */
export const NEAR = 1;

export interface PageRef {
  path: string;
  page: number;
}

interface Fill {
  total: number;
  /** Pages whose text is known (read, or needing nothing). */
  probed: Set<number>;
}

function key(path: string, page: number): string {
  return `${path}\u0000${page}`;
}

export class OcrQueue {
  private readonly jobs = new Map<string, PageRef & { seq: number }>();
  /** Per PDF: the page in view, and when it was last looked at (a counter). */
  private readonly focused = new Map<string, { page: number; at: number }>();
  private readonly fills = new Map<string, Fill>();
  private clock = 0;

  /** Queue a page to be read. False when it is already queued. */
  add(path: string, page: number): boolean {
    const k = key(path, page);
    if (this.jobs.has(k)) return false;
    this.jobs.set(k, { path, page, seq: ++this.clock });
    return true;
  }

  has(path: string, page: number): boolean {
    return this.jobs.has(key(path, page));
  }

  remove(path: string, page: number): boolean {
    return this.jobs.delete(key(path, page));
  }

  /** The user is on page `page` of `path`. */
  focus(path: string, page: number): void {
    this.focused.set(path, { page, at: ++this.clock });
  }

  /** Pages of `path` still to read. */
  size(path?: string): number {
    if (path === undefined) return this.jobs.size;
    let n = 0;
    for (const job of this.jobs.values()) if (job.path === path) n++;
    return n;
  }

  /** Start finding which of `total` pages of `path` need reading (once). */
  startFill(path: string, total: number): void {
    if (this.fills.has(path) || !(total > 0)) return;
    this.fills.set(path, { total, probed: new Set() });
  }

  /** Page `page` of `path` is known: it needs no probing. */
  markProbed(path: string, page: number): void {
    this.fills.get(path)?.probed.add(page);
  }

  /** Forget everything about a PDF: its pages, its focus, its fill. Returns how many pages were queued. */
  cancelPath(path: string): number {
    let removed = 0;
    for (const [k, job] of [...this.jobs]) {
      if (job.path === path) {
        this.jobs.delete(k);
        removed++;
      }
    }
    this.focused.delete(path);
    this.fills.delete(path);
    return removed;
  }

  private distance(path: string, page: number): number {
    const f = this.focused.get(path);
    return f ? Math.abs(page - f.page) : Infinity;
  }

  /** Orders PDFs (most recently looked at first), then by distance, forward pages first, then queue order. */
  private rank(a: PageRef & { seq?: number }, b: PageRef & { seq?: number }): number {
    const fa = this.focused.get(a.path)?.at ?? 0;
    const fb = this.focused.get(b.path)?.at ?? 0;
    if (fa !== fb) return fb - fa;
    const da = this.distance(a.path, a.page);
    const db = this.distance(b.path, b.page);
    if (da !== db) return da < db ? -1 : 1;
    const f = this.focused.get(a.path)?.page ?? 0;
    const aFwd = a.page >= f ? 0 : 1;
    const bFwd = b.page >= f ? 0 : 1;
    if (aFwd !== bFwd) return aFwd - bFwd;
    return (a.seq ?? 0) - (b.seq ?? 0);
  }

  /**
   * The page to read now, removed from the queue; null when none may be
   * read yet (pages away from the one in view wait for `idle`).
   */
  next(idle: boolean): PageRef | null {
    let best: (PageRef & { seq: number }) | null = null;
    for (const job of this.jobs.values()) {
      if (!idle && this.distance(job.path, job.page) > NEAR) continue;
      if (!best || this.rank(job, best) < 0) best = job;
    }
    if (!best) return null;
    this.jobs.delete(key(best.path, best.page));
    return { path: best.path, page: best.page };
  }

  /**
   * A page whose text should be read to find out whether it needs OCR:
   * only while idle, nearest the page in view first. It is marked probed.
   */
  nextProbe(idle: boolean): PageRef | null {
    if (!idle) return null;
    let best: PageRef | null = null;
    for (const [path, fill] of this.fills) {
      const f = this.focused.get(path)?.page ?? 0;
      for (let step = 0; step < fill.total; step++) {
        // Forward before back at the same distance.
        for (const page of step === 0 ? [f] : [f + step, f - step]) {
          if (page < 0 || page >= fill.total || fill.probed.has(page)) continue;
          if (this.jobs.has(key(path, page))) continue;
          const candidate = { path, page };
          if (!best || this.rank(candidate, best) < 0) best = candidate;
          step = fill.total;
          break;
        }
      }
    }
    if (best) this.fills.get(best.path)?.probed.add(best.page);
    return best;
  }
}
