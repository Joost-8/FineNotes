/**
 * Creating a notebook or a single page: the choices the "New notebook" dialog
 * collects, how they are remembered, the file name a title becomes, and the
 * document the file starts with.
 *
 * A notebook is still one `*.notebook.md` file holding every page; the
 * folder-per-notebook layout of contracts/api.md §1b is separate work. (The
 * dialog's "own folder" only puts that one file in a folder named after it,
 * next to the folders its pictures, recordings, transcripts, AI chats and
 * exports go in.) Pure:
 * the view supplies what exists on disk and does the writing.
 */

import {
  FRONTMATTER_FLAG,
  INK_FILE_SUFFIXES,
  NOTEBOOK_FILE_SUFFIX,
  SCHEMA_VERSION,
  SINGLE_PAGE_FILE_SUFFIX,
} from "../constants";
import { BOARD_RULINGS, boardStartGeometry } from "./board";
import { coverMonogramBox, coverTitleBox } from "./cover";
import { pdfPageGeometry } from "./scan-commands";
import {
  type AttachmentFolders,
  type CoverRuling,
  type InkDocument,
  type Page,
  type PageGeometry,
  type Ruling,
  type SyntheticBackdrop,
  RULINGS,
  isCoverRuling,
} from "./document";
import {
  COVER_COLORS,
  COVER_TEMPLATES,
  PAGE_SIZES,
  PAPER_COLORS,
  type PaperColorId,
  coverBackdrop,
  sizeGeometry,
  templateBackdrop,
} from "./templates";

/** A notebook of pages, a single page, or an endless board (`model/board.ts`). */
export type NotebookType = "notebook" | "single" | "endless";

/** A cover design, or none. */
export type CoverChoice = CoverRuling | "none";

/** Everything the dialog asks apart from the title and the folder. */
export interface NotebookChoices {
  type: NotebookType;
  /** Ignored for a single page and a board. */
  cover: CoverChoice;
  /** A {@link COVER_COLORS} id. */
  coverColor: string;
  /** The paper ruling. Never a cover. */
  ruling: Ruling;
  /**
   * A board's paper, one of `BOARD_RULINGS`: remembered on its own, so a
   * board's dots do not become the next notebook's paper.
   */
  boardRuling: Ruling;
  paper: PaperColorId;
  /** A {@link PAGE_SIZES} id. */
  size: string;
  landscape: boolean;
  /** "Join pages" (`model/joined-pages.ts`): no gap between them. Ignored for a board. */
  joined: boolean;
}

export const DEFAULT_NOTEBOOK_CHOICES: Readonly<NotebookChoices> = {
  type: "notebook",
  cover: "cover-gradient",
  coverColor: COVER_COLORS[0].id,
  // Blank, as every note created before the dialog existed was.
  ruling: "blank",
  boardRuling: "blank",
  paper: "white",
  size: PAGE_SIZES[0].id,
  landscape: false,
  joined: false,
};

/**
 * Read remembered choices back. They live in plugin data, which a newer or
 * older build — or a hand edit — may have written, so each field is checked
 * on its own and anything unrecognised reads as its default: one bad field
 * must not throw away the rest of what the user picked last time.
 */
export function parseNotebookChoices(raw: unknown): NotebookChoices {
  const out: NotebookChoices = { ...DEFAULT_NOTEBOOK_CHOICES };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  // Notebooks and boards are made now: a remembered "single" page reads as a notebook.
  if (r.type === "notebook" || r.type === "endless") out.type = r.type;
  // Only a design the picker still offers: a remembered classic one reads as the default.
  if (r.cover === "none" || COVER_TEMPLATES.some((t) => t.ruling === r.cover)) {
    out.cover = r.cover as CoverChoice;
  }
  if (COVER_COLORS.some((c) => c.id === r.coverColor)) out.coverColor = r.coverColor as string;
  // `includes`, not a lookup: "toString" must not pass for a ruling.
  if (
    typeof r.ruling === "string" &&
    (RULINGS as readonly string[]).includes(r.ruling) &&
    !isCoverRuling(r.ruling)
  ) {
    out.ruling = r.ruling as Ruling;
  }
  if (BOARD_RULINGS.some((ruling) => ruling === r.boardRuling)) {
    out.boardRuling = r.boardRuling as Ruling;
  }
  if (PAPER_COLORS.some((c) => c.id === r.paper)) out.paper = r.paper as PaperColorId;
  if (PAGE_SIZES.some((s) => s.id === r.size)) out.size = r.size as string;
  if (typeof r.landscape === "boolean") out.landscape = r.landscape;
  if (typeof r.joined === "boolean") out.joined = r.joined;
  return out;
}

/** The My templates entry the dialog made a notebook of last time. */
export interface NotebookTemplateChoice {
  /** Vault path of the library's PDF. */
  path: string;
  /** 0-based page of that PDF. */
  page: number;
}

/**
 * Read the remembered template back, or none. Like the choices, it may hold
 * anything; unlike them it has no default to fall back on field by field, so
 * one bad field means no template, and the dialog starts on the paper.
 */
export function parseNotebookTemplate(raw: unknown): NotebookTemplateChoice | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.path !== "string" || r.path.trim() === "") return null;
  if (typeof r.page !== "number" || !Number.isInteger(r.page) || r.page < 0) return null;
  return { path: r.path, page: r.page };
}

// --- Titles and file names --------------------------------------------------

/** Longest title kept, in characters: a cover and a heading, not an essay. */
const MAX_TITLE = 120;

/** Longest file base name, in characters, leaving room for " 99.notebook.md" under 255 bytes. */
const MAX_BASE_NAME = 100;

/** Characters that no file system here accepts, or that break an Obsidian link. */
const FORBIDDEN = new Set([...'\\/:*?"<>|#^[]']);

/** Names Windows reserves for devices, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Drop control characters without a control-character regex (eslint's no-control-regex). */
function printable(text: string): string {
  return Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
}

/** A title as typed, made one clean line: NFC, no control characters, single spaces, capped. */
export function cleanTitle(title: string): string {
  const oneLine = printable(title.normalize("NFC").replace(/\s+/g, " ")).trim();
  return Array.from(oneLine).slice(0, MAX_TITLE).join("").trim();
}

/**
 * A title turned into a file base name that every platform the vault syncs to
 * accepts: characters Windows, macOS, iOS or Obsidian links reject become
 * spaces; no leading dot (a hidden file), no trailing dot or space (Windows
 * drops them), no device name. May return "" — the caller then names it.
 */
export function sanitizeFileName(title: string): string {
  const replaced = Array.from(cleanTitle(title))
    .map((ch) => (FORBIDDEN.has(ch) ? " " : ch))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
  let name = Array.from(replaced).slice(0, MAX_BASE_NAME).join("");
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (RESERVED.test(name)) name = `${name} notebook`;
  return name;
}

/** The file name suffix for a type: `.notebook.md` or `.page.md`. */
export function fileSuffixFor(type: NotebookType): string {
  return type === "single" ? SINGLE_PAGE_FILE_SUFFIX : NOTEBOOK_FILE_SUFFIX;
}

/**
 * The ink suffix a file name ends in — `.notebook.md`, `.page.md`, or the
 * legacy `.ink.md` — or `undefined`. Compared case-insensitively, as the
 * file systems a vault syncs to are.
 */
export function inkFileSuffix(name: string): string | undefined {
  const lower = name.toLowerCase();
  return INK_FILE_SUFFIXES.find((suffix) => lower.endsWith(suffix));
}

/** A file name or basename without its ink suffix: "Physics.notebook" -> "Physics". */
export function stripInkSuffix(name: string): string {
  const lower = name.toLowerCase();
  for (const suffix of INK_FILE_SUFFIXES) {
    // With or without the ".md" (Obsidian's basename has none).
    for (const tail of [suffix, suffix.slice(0, -".md".length)]) {
      if (lower.endsWith(tail) && lower.length > tail.length) return name.slice(0, -tail.length);
    }
  }
  return name;
}

/** The name a notebook gets when its title leaves nothing usable. */
export function defaultTitle(type: NotebookType): string {
  if (type === "single") return "Untitled page";
  return type === "endless" ? "Untitled board" : "Untitled notebook";
}

/** The file base name for a title: sanitised, or the default for its type. */
export function notebookBaseName(title: string, type: NotebookType): string {
  return sanitizeFileName(title) || defaultTitle(type);
}

/**
 * `base + suffix`, or `base 1 + suffix`, `base 2 + suffix`… — the first one
 * not in `taken`. Compared case-insensitively: iPadOS, macOS and Windows file
 * systems are, so "physics" and "Physics" are the same file there.
 */
export function uniqueFileName(base: string, suffix: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((name) => name.toLowerCase()));
  for (let i = 0; ; i++) {
    const name = i === 0 ? `${base}${suffix}` : `${base} ${i}${suffix}`;
    if (!lower.has(name.toLowerCase())) return name;
  }
}

/**
 * A vault folder path in canonical form: forward slashes, no leading,
 * trailing or doubled slash, no "." segments. The vault root is "".
 */
export function normalizeFolder(folder: string): string {
  return folder
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

/** The folder a new notebook goes in: the setting when one is set, else the active file's. */
export function targetFolder(setting: string, activeFileFolder: string): string {
  return normalizeFolder(setting) || normalizeFolder(activeFileFolder);
}

/** The vault path of `name` inside `folder` ("" is the root). */
export function joinVaultPath(folder: string, name: string): string {
  const dir = normalizeFolder(folder);
  return dir ? `${dir}/${name}` : name;
}

/** The folders inside a notebook's own folder, beside the notebook file. */
export const OWN_FOLDER_IMAGES = "Images";
export const OWN_FOLDER_AUDIO = "Recordings";
export const OWN_FOLDER_TRANSCRIPTS = "Transcripts";
export const OWN_FOLDER_CHATS = "AI chats";
export const OWN_FOLDER_EXPORTS = "Exports";

/** Every folder a notebook's own folder holds, in the order they are made. */
export const OWN_FOLDERS: readonly string[] = [
  OWN_FOLDER_IMAGES,
  OWN_FOLDER_AUDIO,
  OWN_FOLDER_TRANSCRIPTS,
  OWN_FOLDER_CHATS,
  OWN_FOLDER_EXPORTS,
];

/** Where a new notebook goes on disk. */
export interface NotebookPaths {
  /** The folder the notebook file is written in ("" is the vault root). */
  folder: string;
  /** The notebook file's name, suffix included. */
  fileName: string;
  /** Every folder the notebook needs, parents first; the caller creates the missing ones. */
  folders: string[];
  /** Where its pictures, recordings, transcripts, AI chats and exports go, with its own folder. */
  attachments?: AttachmentFolders;
}

/**
 * Where a notebook titled `title` goes in `dir`, whose entries (files and
 * folders) are `taken`. Without a folder of its own it is
 * `<dir>/<Title>.notebook.md` (`.page.md` for a single page).
 * With one, the folder takes the unique name and everything inside is new;
 * the file explorer then shows the folder as the notebook (`folder-notebook.ts`):
 *
 *   <dir>/<Title>/<Title>.notebook.md
 *   <dir>/<Title>/Images/
 *   <dir>/<Title>/Recordings/
 *   <dir>/<Title>/Transcripts/
 *   <dir>/<Title>/AI chats/
 *   <dir>/<Title>/Exports/
 */
export function notebookPaths(
  dir: string,
  title: string,
  type: NotebookType,
  ownFolder: boolean,
  taken: ReadonlySet<string>,
): NotebookPaths {
  const parent = normalizeFolder(dir);
  const base = notebookBaseName(title, type);
  const suffix = fileSuffixFor(type);
  // A notebook, a page and a pre-0.6.3 note of one name are one name: the
  // transcript sidecar (`X.transcript.md`) and a bare [[X]] could not tell
  // them apart. So "Physics.page.md" takes "Physics.notebook.md"'s name.
  const clash = new Set(taken);
  for (const name of taken) {
    const other = inkFileSuffix(name);
    if (other) clash.add(`${name.slice(0, -other.length)}${suffix}`);
  }
  if (!ownFolder) {
    return {
      folder: parent,
      fileName: uniqueFileName(base, suffix, clash),
      folders: parent ? [parent] : [],
    };
  }
  const name = uniqueFileName(base, "", clash);
  const folder = joinVaultPath(parent, name);
  const [images, audio, transcripts, chats, exports] = OWN_FOLDERS.map((sub) =>
    joinVaultPath(folder, sub),
  );
  return {
    folder,
    fileName: `${name}${suffix}`,
    folders: [...(parent ? [parent] : []), folder, images, audio, transcripts, chats, exports],
    attachments: { images, audio, transcripts, chats, exports },
  };
}

/**
 * The folders to create before an imported notebook is written, parents
 * first and each once: its own folder (or its parents, when it has none),
 * and its `Images` folder when it has pictures or other files. The other
 * attachment folders are left out: each is made when a recording, transcript,
 * chat or export is first saved into it. Pure.
 */
export function importFolders(paths: NotebookPaths, hasAttachments: boolean): string[] {
  const lazy = new Set(Object.values(paths.attachments ?? {}));
  const images = paths.attachments?.images;
  const wanted = paths.folders.filter(
    (path) => !lazy.has(path) || (path === images && hasAttachments),
  );
  const out: string[] = [];
  for (const folder of wanted) {
    const parts = normalizeFolder(folder).split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      if (path && !out.includes(path)) out.push(path);
    }
  }
  return out;
}

// --- The new file -----------------------------------------------------------

/**
 * The markdown around the ink block: the same frontmatter the plugin has
 * always written, then the title as a heading.
 */
export function newNoteBody(heading: string, createdIso: string): string {
  return (
    `---\n` +
    `${FRONTMATTER_FLAG}: true\n` +
    `goodobsidian-version: ${SCHEMA_VERSION}\n` +
    `created: ${createdIso}\n` +
    `modified: ${createdIso}\n` +
    `---\n\n` +
    `# ${heading}\n`
  );
}

function page(id: string, geometry: PageGeometry, backdrop: SyntheticBackdrop): Page {
  return {
    id,
    kind: "ink",
    geometry: { ...geometry },
    backdrop: { ...backdrop },
    strokes: [],
    images: [],
    textBoxes: [],
  };
}

/**
 * The document a new notebook starts with. With a cover, page 1 is the cover
 * (same size as the paper, the title on it as a text box) and page 2 the
 * chosen paper; without one, just the paper. A single page is exactly one
 * page and is flagged so the view offers no way to add another. A board
 * (FineNotes#46) is one large page of white paper (blank, dotted or
 * squared; any other ruling reads as blank), flagged a single page too, so
 * that a build that knows no boards still opens it as one.
 */
export function buildNewDocument(
  choices: NotebookChoices,
  title: string,
  attachments?: AttachmentFolders,
): InkDocument {
  const geometry = sizeGeometry(choices.size, choices.landscape);
  const ruling = isCoverRuling(choices.ruling) ? "blank" : choices.ruling;
  const paper = templateBackdrop(ruling, choices.paper);
  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: geometry.width, scale: 1 },
    pages: [],
  };
  // Its own folder's subfolders, as if set in the note's settings.
  if (attachments && Object.keys(attachments).length > 0) doc.folders = { ...attachments };
  if (choices.type === "single") {
    doc.pages.push(page("p1", geometry, paper));
    doc.single = true;
    return doc;
  }
  if (choices.type === "endless") {
    const kind = BOARD_RULINGS.includes(choices.boardRuling) ? choices.boardRuling : "blank";
    const board = boardStartGeometry();
    doc.view.width = board.width;
    doc.pages.push(page("p1", board, templateBackdrop(kind, "white")));
    doc.single = true;
    doc.endless = true;
    return doc;
  }
  if (choices.joined === true) doc.joined = true;
  if (choices.cover !== "none") {
    const backdrop = coverBackdrop(choices.cover, choices.coverColor);
    const cover = page("p1", geometry, backdrop);
    const text = cleanTitle(title) || defaultTitle(choices.type);
    const color = backdrop.paperColor ?? "";
    // The big letter first, so the title is drawn over it.
    const letter = coverMonogramBox(choices.cover, geometry, color, text, "t0");
    if (letter) cover.textBoxes.push(letter);
    cover.textBoxes.push(coverTitleBox(choices.cover, geometry, color, text, "t1"));
    doc.pages.push(cover, page("p2", geometry, paper));
    return doc;
  }
  doc.pages.push(page("p1", geometry, paper));
  return doc;
}

/**
 * A new notebook whose pages are a vault PDF's pages, in order (#14: "open a
 * copy as notebook"). The PDF is only pointed at, never copied or changed;
 * the ink lives in the notebook. The chosen size sets how wide a page is
 * (as when importing into a notebook); cover and paper give way to the PDF.
 * No pages (an empty PDF) leaves the ordinary new notebook.
 */
export function buildPdfNotebook(
  choices: NotebookChoices,
  title: string,
  attachments: AttachmentFolders | undefined,
  path: string,
  sizes: ReadonlyArray<{ width: number; height: number }>,
  /** The PDF is a copy of a template from My templates: its pages are marked so. */
  fromTemplate = false,
): InkDocument {
  const doc = buildNewDocument({ ...choices, type: "notebook" }, title, attachments);
  if (sizes.length === 0) return doc;
  const base = sizeGeometry(choices.size, choices.landscape);
  doc.pages = sizes.map((size, index) => ({
    id: `p${index + 1}`,
    kind: "ink",
    geometry: pdfPageGeometry(base, size),
    backdrop: fromTemplate
      ? { kind: "pdf", path, page: index, template: true }
      : { kind: "pdf", path, page: index },
    strokes: [],
    images: [],
    textBoxes: [],
  }));
  doc.view.width = doc.pages[0].geometry.width;
  return doc;
}
