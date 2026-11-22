/**
 * Organising notes by tag, after Apple Notes (research:
 * `research/apple-notes-organisation-2026-11-22.md`): the Tag Browser
 * (pick tags, see the notes that have them all), smart folders (a saved
 * rule over tags, live, that moves nothing), and the one thing Apple does
 * not do but FineNotes offers per smart folder: filing a note into a real
 * folder when it gains a matching tag. PURE: no DOM, no Obsidian.
 *
 * Tags come in as Obsidian's `metadataCache` gives them (`#uni/algebra`,
 * frontmatter tags included); they are compared without the `#` and
 * without case, and a nested tag matches its parent, as Obsidian's tag pane
 * groups them.
 */

/** A note, notebook or file as organising sees it. */
export interface Tagged {
  path: string;
  /** Tags as Obsidian lists them, with or without `#`. */
  tags: readonly string[];
  /** A text note (`.note.md`): the only kind a smart folder ever files. */
  textNote?: boolean;
}

/** A saved rule over tags, shown on Home and in a note's sidebar as a folder. */
export interface SmartFolder {
  /** Stable id, never shown. */
  id: string;
  name: string;
  /** Tags it looks for, normalised (`tagKey`). Empty with `untagged` set: notes with no tag. */
  tags: string[];
  /** Tags whose notes it leaves out (Apple: a tag tapped until it is struck through). */
  exclude: string[];
  /** A note must have every tag (`all`) or one of them (`any`). */
  match: "any" | "all";
  /** Only notes with no tag at all (Apple's "Untagged notes only"). */
  untagged?: boolean;
  /**
   * Opt-in: a text note that gains a matching tag is moved into this vault
   * folder ("" the root). Absent: the smart folder moves nothing, as Apple's.
   */
  fileTo?: string;
}

/** A tag as the comparison reads it: no `#`, no slashes at its ends, lower case. */
export function tagKey(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

/** `tags` as keys, each once, in their first order; empty ones dropped. */
export function tagKeys(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const key = tagKey(tag);
    if (key !== "" && !out.includes(key)) out.push(key);
  }
  return out;
}

/** Whether a note's `tag` counts as `wanted`: the same, or nested below it. */
export function tagCovers(tag: string, wanted: string): boolean {
  const a = tagKey(tag);
  const b = tagKey(wanted);
  return b !== "" && (a === b || a.startsWith(`${b}/`));
}

function hasTag(tags: readonly string[], wanted: string): boolean {
  return tags.some((tag) => tagCovers(tag, wanted));
}

/**
 * Whether `item` belongs in `folder`: no excluded tag, and every (`all`) or
 * one (`any`) of its tags. A rule with no tags matches nothing, unless it
 * asks for untagged notes.
 */
export function matchesSmart(item: Pick<Tagged, "tags">, folder: SmartFolder): boolean {
  const tags = item.tags;
  if (folder.untagged) return tagKeys(tags).length === 0;
  if (folder.exclude.some((tag) => hasTag(tags, tag))) return false;
  if (folder.tags.length === 0) return false;
  return folder.match === "all"
    ? folder.tags.every((tag) => hasTag(tags, tag))
    : folder.tags.some((tag) => hasTag(tags, tag));
}

/**
 * The Tag Browser: the items that have every one of `selected` and none of
 * `excluded`. Nothing picked: every item with a tag ("All Tags").
 */
export function browseTags<T extends Pick<Tagged, "tags">>(
  items: readonly T[],
  selected: readonly string[],
  excluded: readonly string[] = [],
): T[] {
  return items.filter((item) => {
    if (tagKeys(item.tags).length === 0) return false;
    if (excluded.some((tag) => hasTag(item.tags, tag))) return false;
    return selected.every((tag) => hasTag(item.tags, tag));
  });
}

/** One tag of the Tag Browser: its key and how many items have it (or a tag below it). */
export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Every tag the items use, each with how many items have it, A to Z (as
 * Apple's tag list and Obsidian's tag pane sort). A nested tag also counts
 * toward its parents, which are listed too.
 */
export function tagCounts(items: ReadonlyArray<Pick<Tagged, "tags">>): TagCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const key of tagKeys(item.tags)) {
      const parts = key.split("/");
      for (let i = 1; i <= parts.length; i++) seen.add(parts.slice(0, i).join("/"));
    }
    for (const tag of seen) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true, sensitivity: "base" }));
}

/** A tag picked in the browser: on, then struck through (left out), then off again. */
export type TagPick = "on" | "out" | "off";

/** The next state of a tag tapped in the browser: off → on → out → off, as Apple cycles it. */
export function nextPick(now: TagPick): TagPick {
  return now === "off" ? "on" : now === "on" ? "out" : "off";
}

/** A folder's name as a tag, as Apple tags a converted folder's notes: one word, `-` for spaces. */
export function tagFromName(name: string): string {
  return tagKey(
    name
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}_\-/]/gu, ""),
  );
}

/** A smart folder's caption: "#a #b", "#a or #b", "no tags". */
export function ruleText(folder: SmartFolder, untaggedText: string, or: string): string {
  if (folder.untagged) return untaggedText;
  const join = folder.match === "all" ? " " : ` ${or} `;
  const shown = folder.tags.map((tag) => `#${tag}`).join(join);
  const left = folder.exclude.map((tag) => `-#${tag}`).join(" ");
  return [shown, left].filter(Boolean).join(" ");
}

// --- Filing -----------------------------------------------------------------

/** The folder of a vault path; "" at the root. */
function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Where `path` lands in `folder`. */
export function pathIn(folder: string, path: string): string {
  return folder === "" ? baseName(path) : `${folder}/${baseName(path)}`;
}

/** One move filing would make. */
export interface Move {
  from: string;
  to: string;
}

/**
 * Where a text note goes now that its tags changed from `before` to `after`,
 * or null to leave it: the first smart folder that files notes (`fileTo`)
 * and that the note has just come to match (it did not before), unless it
 * is already in that folder. A note that matched already is never moved
 * again, so moving it out by hand sticks.
 */
export function filingFor(
  path: string,
  before: readonly string[],
  after: readonly string[],
  folders: readonly SmartFolder[],
): string | null {
  for (const folder of folders) {
    if (folder.fileTo === undefined) continue;
    if (!matchesSmart({ tags: after }, folder) || matchesSmart({ tags: before }, folder)) continue;
    return folderOf(path) === folder.fileTo ? null : folder.fileTo;
  }
  return null;
}

/**
 * The moves that file every text note already matching `folder` into its
 * `fileTo` (asked for once, when filing is turned on). A note already
 * there, or whose name is taken there (by a file in `taken` or by an
 * earlier move), stays.
 */
export function plannedMoves(
  items: readonly Tagged[],
  folder: SmartFolder,
  taken: ReadonlySet<string>,
): Move[] {
  const target = folder.fileTo;
  if (target === undefined) return [];
  const used = new Set([...taken].map((p) => p.toLowerCase()));
  const moves: Move[] = [];
  for (const item of items) {
    if (!item.textNote || !matchesSmart(item, folder)) continue;
    if (folderOf(item.path) === target) continue;
    const to = pathIn(target, item.path);
    if (used.has(to.toLowerCase())) continue;
    used.add(to.toLowerCase());
    moves.push({ from: item.path, to });
  }
  return moves;
}

// --- Stored -----------------------------------------------------------------

function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? tagKeys(raw.filter((x): x is string => typeof x === "string")) : [];
}

/** The smart folders read from settings: anything malformed dropped, ids unique. */
export function smartFoldersOf(raw: unknown): SmartFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: SmartFolder[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (id === "" || name === "" || out.some((f) => f.id === id)) continue;
    out.push({
      id,
      name,
      tags: stringList(e.tags),
      exclude: stringList(e.exclude),
      match: e.match === "all" ? "all" : "any",
      ...(e.untagged === true ? { untagged: true } : {}),
      ...(typeof e.fileTo === "string" ? { fileTo: e.fileTo.replace(/^\/+|\/+$/g, "") } : {}),
    });
  }
  return out;
}

/** The smart folders after a vault folder moved from `from` to `to`: filing follows it. */
export function moveFilingTargets(
  folders: readonly SmartFolder[],
  from: string,
  to: string,
): SmartFolder[] {
  return folders.map((f) => {
    const at = f.fileTo;
    if (at === undefined || at === "") return f;
    if (at === from) return { ...f, fileTo: to };
    if (at.startsWith(`${from}/`)) return { ...f, fileTo: to + at.slice(from.length) };
    return f;
  });
}

/** The smart folders after a vault folder was deleted: filing into it stops. */
export function dropFilingTargets(folders: readonly SmartFolder[], gone: string): SmartFolder[] {
  return folders.map((f) => {
    const at = f.fileTo;
    if (at === undefined || (at !== gone && !at.startsWith(`${gone}/`))) return f;
    const rest: SmartFolder = { ...f };
    delete rest.fileTo;
    return rest;
  });
}

/** The smart folders after a tag was deleted: it leaves every rule (Apple's Delete Tag). */
export function dropTag(folders: readonly SmartFolder[], tag: string): SmartFolder[] {
  const key = tagKey(tag);
  return folders.map((f) => ({
    ...f,
    tags: f.tags.filter((x) => x !== key),
    exclude: f.exclude.filter((x) => x !== key),
  }));
}

// --- The note list ----------------------------------------------------------

/** A text note as a note's sidebar lists it. */
export interface ListedNote extends Tagged {
  title: string;
  edited: number;
}

/** What a note's sidebar shows: a folder's notes, a tag's, or a smart folder's. */
export type NoteScope =
  { kind: "folder"; folder: string } | { kind: "tag"; tag: string } | { kind: "smart"; id: string };

/** The notes `scope` holds, newest edit first (Apple's default), then A to Z. */
export function notesIn(
  notes: readonly ListedNote[],
  scope: NoteScope,
  smart: readonly SmartFolder[],
): ListedNote[] {
  let kept: ListedNote[];
  if (scope.kind === "folder") kept = notes.filter((n) => folderOf(n.path) === scope.folder);
  else if (scope.kind === "tag") kept = notes.filter((n) => hasTag(n.tags, scope.tag));
  else {
    const folder = smart.find((f) => f.id === scope.id);
    kept = folder ? notes.filter((n) => matchesSmart(n, folder)) : [];
  }
  return kept.sort(
    (a, b) =>
      b.edited - a.edited ||
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
  );
}

/** A scope read back from storage, or null when it is not one. */
export function scopeOf(raw: unknown): NoteScope | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "folder" && typeof r.folder === "string")
    return { kind: "folder", folder: r.folder };
  if (r.kind === "tag" && typeof r.tag === "string") return { kind: "tag", tag: tagKey(r.tag) };
  if (r.kind === "smart" && typeof r.id === "string") return { kind: "smart", id: r.id };
  return null;
}

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

// --- Searching from the note list ---------------------------------------------

/** A text hit as `searchLibrary` gives it, the parts the list shows. */
export interface TextHit {
  path: string;
  pageIndex: number;
  snippets: ReadonlyArray<{ before: string; match: string; after: string }>;
}

/** One row of the note list's search: a note or notebook, and the line that holds the words. */
export interface SearchRow {
  path: string;
  title: string;
  pageIndex: number;
  snippet?: { before: string; match: string; after: string };
}

/**
 * What the note list shows for `query`, as Apple Notes' sidebar search
 * does: the notes and notebooks whose title holds every word, then those
 * whose text does (from `searchLibrary`); each item once, those in
 * `folder` (the note's own) first. Nothing for an empty query.
 */
export function searchRows(
  items: ReadonlyArray<{ path: string; title: string }>,
  hits: readonly TextHit[],
  query: string,
  folder: string,
): SearchRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const titles = new Map(items.map((i) => [i.path, i.title]));
  const rows: SearchRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const low = item.title.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue;
    seen.add(item.path);
    rows.push({ path: item.path, title: item.title, pageIndex: 0 });
  }
  for (const hit of hits) {
    const title = titles.get(hit.path);
    if (title === undefined) continue;
    const row = rows.find((r) => r.path === hit.path);
    const snippet = hit.snippets[0];
    if (row) {
      if (!row.snippet && snippet) row.snippet = snippet;
      continue;
    }
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    rows.push({ path: hit.path, title, pageIndex: hit.pageIndex, ...(snippet ? { snippet } : {}) });
  }
  const here = (r: SearchRow): boolean => folderOf(r.path) === folder;
  return [...rows.filter(here), ...rows.filter((r) => !here(r))];
}
