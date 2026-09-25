/**
 * The notebook manifest: `_notebook.md`.
 *
 * A notebook is a folder; each page is its own `p-NNN.ink.md` file; this file
 * holds the title, the cover and — the part that matters — the **page order**.
 * Reordering, duplicating or deleting a page rewrites only this file and never
 * touches page content. See contracts/api.md §1b.
 *
 * Pure: no DOM, no Obsidian, no filesystem. Parsing is a function over a
 * string; reading files is the view's job.
 *
 * The frontmatter is a deliberately tiny, self-generated subset of YAML —
 * `key: value` scalars plus a `key:` followed by `  - item` list. It is parsed
 * by hand rather than with a YAML dependency because we own the format and the
 * subset is small enough to test exhaustively. Anything unrecognised is
 * ignored rather than throwing: Joost can hand-edit this file, and a typo in
 * it must never cost him a notebook.
 */

import { NOTEBOOK_FLAG, PAGE_FILE_SUFFIX } from "../constants";

export interface NotebookPageRef {
  /** Page id — the file's basename without the suffix, e.g. `p-001`. */
  id: string;
  /** Filename relative to the notebook folder, e.g. `p-001.ink.md`. */
  file: string;
}

export interface Notebook {
  title: string;
  /** Page id used as the cover. A cover is just a page, as in GoodNotes. */
  cover?: string;
  /** Ordered. This array **is** the page order. */
  pages: NotebookPageRef[];
}

const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** Strip one layer of matching quotes, if present. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** `p-001.ink.md` -> `p-001`. Leaves an unsuffixed name untouched. */
export function pageIdFromFile(file: string): string {
  return file.endsWith(PAGE_FILE_SUFFIX) ? file.slice(0, -PAGE_FILE_SUFFIX.length) : file;
}

/** `p-001` -> `p-001.ink.md`. Idempotent. */
export function pageFileFromId(id: string): string {
  return id.endsWith(PAGE_FILE_SUFFIX) ? id : `${id}${PAGE_FILE_SUFFIX}`;
}

/**
 * Parse `_notebook.md`. Returns `null` only when the file is not a notebook
 * manifest at all (no frontmatter, or the claim flag absent) — never for a
 * merely malformed one, which degrades to whatever could be read.
 */
export function parseNotebook(markdown: string): Notebook | null {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  let claimed = false;
  let title = "";
  let cover: string | undefined;
  const pages: NotebookPageRef[] = [];
  const seen = new Set<string>();

  let inPages = false;
  for (const line of lines) {
    // A list item belongs to the `pages:` key until a new top-level key starts.
    const item = /^[ \t]+-[ \t]+(.*)$/.exec(line);
    if (inPages && item) {
      const file = unquote(item[1]);
      if (!file) continue;
      const id = pageIdFromFile(file);
      // A duplicated page id would make reorder and undo ambiguous.
      if (seen.has(id)) continue;
      seen.add(id);
      pages.push({ id, file: pageFileFromId(file) });
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = unquote(kv[2]);
    inPages = key === "pages" && value === "";

    switch (key) {
      case NOTEBOOK_FLAG:
        claimed = value === "true";
        break;
      case "title":
        title = value;
        break;
      case "cover":
        cover = value || undefined;
        break;
      default:
        break;
    }
  }

  if (!claimed) return null;

  // A cover naming a page that isn't in the notebook would render nothing;
  // drop it rather than carrying a dangling reference around.
  if (cover && !seen.has(pageIdFromFile(cover))) cover = undefined;

  return { title, ...(cover ? { cover: pageIdFromFile(cover) } : {}), pages };
}

/** Serialize a notebook manifest. Round-trips with {@link parseNotebook}. */
export function buildNotebook(notebook: Notebook, body = ""): string {
  const lines = [`${NOTEBOOK_FLAG}: true`, `title: ${notebook.title}`];
  if (notebook.cover) lines.push(`cover: ${notebook.cover}`);
  lines.push("pages:");
  for (const page of notebook.pages) lines.push(`  - ${page.file}`);

  const trimmed = body.replace(/^\s+|\s+$/g, "");
  return `---\n${lines.join("\n")}\n---\n${trimmed ? `\n${trimmed}\n` : ""}`;
}

/** An empty notebook with a single page. */
export function newNotebook(title: string, firstPageId = "p-001"): Notebook {
  return {
    title,
    cover: firstPageId,
    pages: [{ id: firstPageId, file: pageFileFromId(firstPageId) }],
  };
}

/**
 * Next free page id, as `p-NNN` zero-padded to three digits.
 *
 * Deliberately **max + 1, never count + 1**: ids must not be reused after a
 * delete, or a stale thumbnail or link would silently resolve to a different
 * page.
 */
export function nextPageId(notebook: Notebook): string {
  let max = 0;
  for (const page of notebook.pages) {
    const m = /^p-(\d+)$/.exec(page.id);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `p-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Move the page at `from` to index `to`, clamping both. Returns a new
 * notebook; the input is not mutated.
 */
export function reorderPage(notebook: Notebook, from: number, to: number): Notebook {
  const n = notebook.pages.length;
  if (n === 0) return notebook;
  const src = Math.max(0, Math.min(n - 1, Math.trunc(from)));
  const dst = Math.max(0, Math.min(n - 1, Math.trunc(to)));
  if (src === dst) return notebook;
  const pages = notebook.pages.slice();
  const [moved] = pages.splice(src, 1);
  pages.splice(dst, 0, moved);
  return { ...notebook, pages };
}
