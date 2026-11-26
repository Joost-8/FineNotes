/**
 * The note list beside a text note, and its search, after Apple Notes on
 * the iPad: a folder's notes, newest edit first; and while the bar's search
 * field holds words, every text note and notebook that holds them, in
 * sections (Top hits, Notes, Notebooks), each row its title, a short date,
 * the line that holds the words, and its folder. Also Home's Show filter.
 * PURE: no DOM, no Obsidian.
 */

/** The folder of a vault path; "" at the root. */
export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

// --- The folder's notes -----------------------------------------------------

/** A text note as the list shows it. */
export interface ListedNote {
  path: string;
  title: string;
  edited: number;
}

/** The notes directly in `folder`, newest edit first (Apple's default), then A to Z. */
export function notesIn(notes: readonly ListedNote[], folder: string): ListedNote[] {
  return notes
    .filter((n) => folderOf(n.path) === folder)
    .sort(
      (a, b) =>
        b.edited - a.edited ||
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
    );
}

// --- Search -------------------------------------------------------------------

/** A text hit as `searchLibrary` gives it, the parts the list shows. */
export interface TextHit {
  path: string;
  pageIndex: number;
  snippets: ReadonlyArray<{ before: string; match: string; after: string }>;
}

/** A note or notebook search can find. */
export interface Findable {
  path: string;
  title: string;
  edited: number;
  notebook?: boolean;
  /** Its first lines of text, for the row of one found by its title alone. */
  lead?: string;
}

/** One found note or notebook, and the line that holds the words. */
export interface FoundRow {
  path: string;
  title: string;
  edited: number;
  notebook: boolean;
  /** The page a notebook's hit is on; 0 for a note. */
  pageIndex: number;
  /** Whether its title holds every word: a top hit. */
  byTitle: boolean;
  snippet?: { before: string; match: string; after: string };
}

/** The words of a query, lower case. */
function wordsOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every note and notebook that holds `query`: in its title (every word),
 * or in its text (`hits`, from `searchLibrary`); each once, those in
 * `folder` (the open note's) first, then as found. Nothing for an empty query.
 */
export function searchRows(
  items: readonly Findable[],
  hits: readonly TextHit[],
  query: string,
  folder: string,
): FoundRow[] {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const known = new Map(items.map((i) => [i.path, i]));
  const rows: FoundRow[] = [];
  const row = (item: Findable, byTitle: boolean, pageIndex: number): FoundRow => ({
    path: item.path,
    title: item.title,
    edited: item.edited,
    notebook: item.notebook === true,
    pageIndex,
    byTitle,
  });
  for (const item of items) {
    const low = item.title.toLowerCase();
    if (words.every((w) => low.includes(w))) rows.push(row(item, true, 0));
  }
  for (const hit of hits) {
    const item = known.get(hit.path);
    if (!item) continue;
    // A note's text starts with its title, which the row shows already.
    const snippet = hit.snippets
      .map((s) => bodySnippet(s, item.title))
      .find((s): s is NonNullable<typeof s> => s !== null);
    const found = rows.find((r) => r.path === hit.path);
    if (found) {
      if (!found.snippet && snippet) {
        found.snippet = snippet;
        found.pageIndex = hit.pageIndex;
      }
      continue;
    }
    rows.push({ ...row(item, false, hit.pageIndex), ...(snippet ? { snippet } : {}) });
  }
  // A row found by its title alone shows its first line, as Apple's does.
  for (const r of rows) {
    const lead = known.get(r.path)?.lead;
    if (!r.snippet && lead) r.snippet = { before: lead, match: "", after: "" };
  }
  const here = (r: FoundRow): boolean => folderOf(r.path) === folder;
  return [...rows.filter(here), ...rows.filter((r) => !here(r))];
}

/**
 * A found line without the title in front of it: null when the words were
 * found in the title itself (the row's title marks them), else the line
 * with a leading title cut off.
 */
export function bodySnippet(
  snippet: { before: string; match: string; after: string },
  title: string,
): { before: string; match: string; after: string } | null {
  const head = title.trim();
  if (head === "") return snippet;
  const before = snippet.before.trimStart();
  if (head.startsWith(`${before}${snippet.match}`)) return null;
  if (before.startsWith(head)) return { ...snippet, before: before.slice(head.length).trimStart() };
  return snippet;
}

/** Found rows as the list shows them: Top hits (by title), then Notes, then Notebooks. */
export interface FoundSections {
  top: FoundRow[];
  notes: FoundRow[];
  notebooks: FoundRow[];
  /** Every row, each counted once. */
  total: number;
}

/** How many top hits the list shows at most. */
export const TOP_HITS = 3;

/** Split rows into sections; a top hit is not listed again below. */
export function foundSections(rows: readonly FoundRow[], top = TOP_HITS): FoundSections {
  const tops = rows.filter((r) => r.byTitle).slice(0, top);
  const rest = rows.filter((r) => !tops.includes(r));
  return {
    top: tops,
    notes: rest.filter((r) => !r.notebook),
    notebooks: rest.filter((r) => r.notebook),
    total: rows.length,
  };
}

/** `text` cut where it holds any word of `query` (no case), for marking the words. */
export function markSpans(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const words = wordsOf(query);
  const low = text.toLowerCase();
  const on = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    for (let at = low.indexOf(word); at >= 0; at = low.indexOf(word, at + word.length)) {
      for (let i = at; i < at + word.length; i++) on[i] = true;
    }
  }
  const spans: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const last = spans[spans.length - 1];
    if (last && last.hit === on[i]) last.text += text[i];
    else spans.push({ text: text[i], hit: on[i] });
  }
  return spans;
}

/** A note's first lines after its title, as one line, for a row with no line of its own. */
export function leadOf(text: string, title: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines[0] === title.trim()) lines.shift();
  return lines.join(" ").slice(0, 160);
}

/**
 * When a row's item was edited, short, as Apple's list writes it: the time
 * for today, else the date as two-digit day, month and year in the
 * language's order (22-11-26 in Dutch).
 */
export function shortWhen(edited: number, now: number, locale: string): string {
  const then = new Date(edited);
  const today = new Date(now);
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "2-digit" };
  try {
    return new Intl.DateTimeFormat(locale, options).format(then);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(then);
  }
}

// --- Home's Show filter --------------------------------------------------------

/** Home's "Show" filter: everything, notebooks alone, or text notes alone. */
export type ShowKind = "all" | "notebooks" | "notes";

/** The stored filter; "1" is the old "Notebooks only" switch. */
export function showKindOf(raw: string | null | undefined): ShowKind {
  if (raw === "1" || raw === "notebooks") return "notebooks";
  return raw === "notes" ? "notes" : "all";
}

/** Whether Home shows an item under `show`. */
export function shownBy(entry: { kind: string; textNote?: boolean }, show: ShowKind): boolean {
  if (show === "notebooks") return entry.kind === "notebook";
  if (show === "notes") return entry.textNote === true;
  return true;
}
