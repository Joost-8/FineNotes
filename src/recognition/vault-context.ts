/**
 * Ask AI beyond the open notebook: which vault files it may look at, finding
 * the ones that mention some words (`search_vault`), and handing one over as
 * text (`read_note`).
 *
 * Everything is found on the device; only the hits and the text read go to
 * the AI. Text before pictures: another notebook goes as its transcriptions
 * and text boxes (about 200 tokens a page, against about 1,500 for an image),
 * and every result is capped, since each follow-up resends it.
 *
 * Pure: no DOM, no Obsidian, no network. The view lists the files and reads
 * them (`ink-view.ts`).
 */

import { isFolderNotebook } from "../model/folder-notebook";
import { type LibraryBook, searchLibrary } from "../search/library-search";
import { type PageText, queryTerms } from "../search/notebook-search";

/** How far Ask AI may look: nowhere else, the notebook's folder, or the whole vault. */
export type AskVaultScope = "off" | "folder" | "vault";

export const ASK_VAULT_SCOPES: readonly AskVaultScope[] = ["off", "folder", "vault"];

/** A stored scope, or the default (the notebook's folder) when it is not one. */
export function askVaultScopeOf(raw: unknown): AskVaultScope {
  return ASK_VAULT_SCOPES.includes(raw as AskVaultScope) ? (raw as AskVaultScope) : "folder";
}

/** Most hits one search hands the AI. */
export const MAX_VAULT_HITS = 10;
/** Most hits from one file, so a search shows several notes rather than one note's pages. */
const MAX_HITS_PER_FILE = 3;
/** Most characters one `read_note` hands the AI: about 2,000 tokens. */
export const MAX_READ_CHARS = 8000;
/** Most files a search looks through, newest first. */
export const MAX_SCANNED_FILES = 3000;
/** A Markdown file larger than this is skipped: it is data, not a note. */
export const MAX_NOTE_BYTES = 1_000_000;

/** A file Ask AI may look at, as the search and the reader see it. */
export interface VaultDoc {
  path: string;
  kind: "note" | "notebook" | "pdf";
  /**
   * The text, page by page. A note is one page; a notebook read from its
   * text layer alone (`paged: false`) is one page too.
   */
  pages: readonly PageText[];
  /** False when the pages do not match the file's real pages. */
  paged: boolean;
}

/**
 * The folder a notebook's lookups stay in: the notebook's folder, with its
 * subfolders. A notebook in a folder of its own (`X/X.notebook.md`) looks
 * from the folder that holds that one. "" is the vault's root.
 */
export function scopeFolder(notebookPath: string): string {
  let folder = parentOf(notebookPath);
  if (isFolderNotebook(notebookPath)) folder = parentOf(folder);
  return folder;
}

/**
 * Whether Ask AI may look at `path` from the notebook at `notebookPath`.
 * Never the notebook itself (it has its own tools), hidden files and
 * folders, or transcript files, which are read as part of their notebook.
 */
export function inScope(path: string, notebookPath: string, scope: AskVaultScope): boolean {
  if (scope === "off" || path === notebookPath) return false;
  if (path.split("/").some((part) => part.startsWith("."))) return false;
  if (isTranscriptFile(path)) return false;
  if (scope === "vault") return true;
  const folder = scopeFolder(notebookPath);
  return folder === "" || path.startsWith(`${folder}/`);
}

/** A transcript server's sidecar: `X.transcript.md`, `_transcript.md`. */
export function isTranscriptFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return name === "_transcript.md" || name.endsWith(".transcript.md");
}

/** Where the search looked, as the AI is told it. */
export function scopeText(notebookPath: string, scope: AskVaultScope): string {
  if (scope === "vault") return "the whole vault";
  const folder = scopeFolder(notebookPath);
  return folder === "" ? "the whole vault" : `the folder ${folder}/ and its subfolders`;
}

/** What the AI is told when the user has not let it look past the notebook. */
export const VAULT_OFF_TEXT =
  "The user has not let you read their other notes. Answer from this notebook, and tell them they can let you: the folder button at the top of this chat, or Settings › AI › Ask AI can read (This notebook's folder or The whole vault).";

/** A Markdown note's text as the search and the reader see it: no notebook payloads. */
export function noteText(markdown: string): string {
  // A handwritten note's ink is a base64 block between %% markers: never text.
  return markdown.replace(/%%(?:goodobsidian|inkedmark)[\s\S]*?%%/g, "").trim();
}

/**
 * Files whose name holds every word of `query`, then pages holding every
 * word, as the AI reads them: path, page where it means something, and the
 * words around each match. At most {@link MAX_VAULT_HITS}.
 */
export function vaultSearchText(docs: readonly VaultDoc[], query: string, where: string): string {
  const terms = queryTerms(query);
  if (terms.length === 0) return '"query" is empty.';
  const lines = hitLines(docs, terms, query);
  if (lines.length > 0) {
    // Files named with some of the words come after: the notebook called Network
    // lecture notes is what "computer networks" means, though its name lacks "computer".
    const listed = new Set(lines.map((line) => line.slice(2).split(/[,:(]/)[0].trim()));
    const named: string[] = [];
    if (terms.length > 1) {
      for (const doc of docs) {
        if (lines.length + named.length >= MAX_VAULT_HITS) break;
        if (listed.has(doc.path)) continue;
        const words = pathWords(doc.path.slice(doc.path.lastIndexOf("/") + 1));
        const has = terms.filter(
          (term) => term.length >= 4 && words.some((word) => wordMeans(term, word)),
        );
        if (has.length > 0) {
          named.push(`- ${doc.path} (${doc.kind}; its name has “${has.join("”, “")}”)`);
        }
      }
    }
    return [
      `Found in ${where}:`,
      ...lines,
      ...(named.length ? ["Named with some of the words:", ...named] : []),
      "",
      "Read one with read_note to see more.",
    ].join("\n");
  }
  // Nothing has every word: the files with some of them, the longest word first
  // ("computer networks" still finds the notebook called Network lecture notes).
  const some: string[] = [];
  const seen = new Set<string>();
  for (const term of [...terms].filter((t) => t.length >= 3).sort((a, b) => b.length - a.length)) {
    for (const line of hitLines(docs, [term], term)) {
      if (some.length >= MAX_VAULT_HITS) break;
      if (seen.has(line)) continue;
      seen.add(line);
      some.push(`${line} [has “${term}”]`);
    }
  }
  if (some.length > 0) {
    return [
      `Nothing in ${where} has all of “${query}”; these have some of the words:`,
      ...some,
      "",
      "Read one with read_note to see more.",
    ].join("\n");
  }
  return `Nothing in ${where} matches “${query}”. Handwriting that was never transcribed is not searched.`;
}

/** Whether `term` means `word`: its start, or the word with a short ending either way ("network" and "networks"). */
function wordMeans(term: string, word: string): boolean {
  if (word.startsWith(term)) return true;
  return word.length >= 4 && term.startsWith(word) && term.length - word.length <= 3;
}

/** A path's words, lower case: folders and file name, extensions dropped. */
function pathWords(path: string): string[] {
  return stem(path.toLowerCase())
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/** Files named with every term, then pages holding every term, as lines for the AI. */
function hitLines(docs: readonly VaultDoc[], terms: readonly string[], query: string): string[] {
  const lines: string[] = [];
  for (const doc of docs) {
    if (lines.length >= MAX_VAULT_HITS) break;
    const words = pathWords(doc.path.slice(doc.path.lastIndexOf("/") + 1));
    if (terms.every((term) => words.some((word) => wordMeans(term, word)))) {
      lines.push(`- ${doc.path} (${doc.kind}; its name matches)`);
    }
  }
  const books: LibraryBook[] = docs.map((doc) => ({ path: doc.path, pages: doc.pages }));
  const paged = new Map(docs.map((doc) => [doc.path, doc.paged && doc.kind !== "note"]));
  const perFile = new Map<string, number>();
  for (const hit of searchLibrary(books, query, MAX_VAULT_HITS * MAX_HITS_PER_FILE)) {
    if (lines.length >= MAX_VAULT_HITS) break;
    const count = perFile.get(hit.path) ?? 0;
    if (count >= MAX_HITS_PER_FILE) continue;
    perFile.set(hit.path, count + 1);
    const page = paged.get(hit.path) ? `, page ${hit.pageIndex + 1}` : "";
    const words = hit.snippets
      .map((s) => oneLine(`${s.before}${s.match}${s.after}`).trim())
      .join(" ");
    lines.push(`- ${hit.path}${page}: ${words}`);
  }
  return lines;
}

/** A note's whole text as the AI reads it: a notebook or PDF page by page. */
export function docText(doc: VaultDoc): string {
  if (doc.kind === "note" || !doc.paged) {
    return doc.pages
      .flatMap((page) => page.sources.map((s) => s.text))
      .join("\n\n")
      .trim();
  }
  return doc.pages
    .map((page) => {
      const text = page.sources
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join("\n");
      return text ? `## Page ${page.pageIndex + 1}\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * At most {@link MAX_READ_CHARS} of `text` from character `from`, cut at a
 * line break where one is near, with a line saying where it is and how to
 * read on.
 */
export function readSlice(path: string, kind: VaultDoc["kind"], text: string, from = 0): string {
  if (!text.trim()) {
    return kind === "note"
      ? `${path} is empty.`
      : `${path} has no text yet: its handwriting was never transcribed.`;
  }
  const start = Math.max(0, Math.min(Math.floor(from), text.length));
  if (start >= text.length)
    return `${path} has ${text.length} characters; there is nothing after ${start}.`;
  let end = Math.min(text.length, start + MAX_READ_CHARS);
  if (end < text.length) {
    const lineBreak = text.lastIndexOf("\n", end);
    if (lineBreak > start + MAX_READ_CHARS / 2) end = lineBreak;
  }
  const head =
    start === 0 && end === text.length
      ? `${path} (${kind}):`
      : `${path} (${kind}), characters ${start + 1} to ${end} of ${text.length}:`;
  const tail = end < text.length ? `\n\n[More: read_note with "from": ${end}.]` : "";
  return `${head}\n\n${text.slice(start, end)}${tail}`;
}

/**
 * The file the AI means by `asked`, among `paths`: the path itself, a
 * wikilink (`[[Name|alias]]`, `#heading` ignored), or a name with or without
 * its extension, matched without regard to case. Several files with that
 * name: what is wrong, with the paths to choose from.
 */
export function resolveNotePath(
  asked: string,
  paths: readonly string[],
): { path: string } | { error: string } {
  const wanted = asked
    .trim()
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/\|.*$/, "")
    .replace(/#.*$/, "")
    .trim()
    .replace(/^\/+/, "");
  if (!wanted) return { error: '"path" is empty.' };
  const exact = paths.find((p) => p === wanted || p === `${wanted}.md`);
  if (exact) return { path: exact };
  const lower = wanted.toLowerCase();
  const sameCase = paths.filter((p) => {
    const l = p.toLowerCase();
    return l === lower || l === `${lower}.md`;
  });
  if (sameCase.length === 1) return { path: sameCase[0] };
  const named = paths.filter((p) => {
    const name = p.slice(p.lastIndexOf("/") + 1).toLowerCase();
    return name === lower || stem(name) === stem(lower);
  });
  if (named.length === 1) return { path: named[0] };
  if (named.length > 1) {
    return {
      error: `Several files are called that: ${named.slice(0, 5).join(", ")}. Give the whole path.`,
    };
  }
  return {
    error: `There is no file "${wanted}" that you may read. Use search_vault to find one.`,
  };
}

// --- Linked notes -------------------------------------------------------------

/**
 * The notes this notebook links to and the ones that link to it, as the AI
 * reads them: names it can pass to read_note. Links the user may not let it
 * read are counted, not named.
 */
export function linkedNotesText(
  outgoing: readonly string[],
  incoming: readonly string[],
  allowed: (path: string) => boolean,
): string {
  const lines: string[] = [];
  let hidden = 0;
  const list = (title: string, paths: readonly string[]): void => {
    const shown = [...new Set(paths)].filter((p) => {
      const ok = allowed(p);
      if (!ok) hidden++;
      return ok;
    });
    if (shown.length) lines.push(title, ...shown.slice(0, 30).map((p) => `- ${p}`));
  };
  list("This notebook links to:", outgoing);
  list("Linked from:", incoming);
  if (lines.length === 0 && hidden === 0)
    return "This notebook has no links to or from other notes.";
  if (hidden) lines.push(`(${hidden} more outside the folders you may read.)`);
  return lines.join("\n");
}

// --- New notes ----------------------------------------------------------------

/** Longest text create_note writes, characters. */
export const MAX_NOTE_CHARS = 20_000;

/** A title as a file name: no characters a vault refuses or links break on. */
export function noteFileName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100)
    .trim();
  return clean || "AI note";
}

/** `folder/name.md`, or `name 2.md` and so on when that is taken. */
export function freeNotePath(
  folder: string,
  name: string,
  taken: (path: string) => boolean,
): string {
  const at = (n: number): string =>
    `${folder ? `${folder}/` : ""}${name}${n > 1 ? ` ${n}` : ""}.md`;
  let n = 1;
  while (taken(at(n)) && n < 1000) n++;
  return at(n);
}

/** A new note's text: where it came from, as a property, then what the AI wrote. */
export function newNoteText(text: string, notebookPath: string): string {
  const name = stem(notebookPath.slice(notebookPath.lastIndexOf("/") + 1));
  const link = notebookPath.replace(/\.md$/i, "");
  const source = `"[[${link}|${name.replace(/"/g, "'")}]]"`;
  return `---\nsource: ${source}\n---\n\n${text.trim()}\n`;
}

/** The folder a new note goes in: beside the notebook (in its own folder, when it has one). */
export function newNoteFolder(notebookPath: string): string {
  return parentOf(notebookPath);
}

/** A file name without its extensions: `Week 3.notebook.md` → `week 3`. */
function stem(name: string): string {
  return name.replace(/\.(notebook|page|ink)\.md$|\.md$|\.pdf$/i, "");
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ");
}
