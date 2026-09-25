/**
 * Creating a notebook or a single page: the choices the "New notebook" dialog
 * collects, how they are remembered, the file name a title becomes, and the
 * document the file starts with.
 *
 * A notebook is still one `*.notebook.md` file holding every page; the
 * folder-per-notebook layout of contracts/api.md §1b is separate work. (The
 * dialog's "own folder" only puts that one file in a folder named after it,
 * next to the folders its pictures and recordings go in.) Pure:
 * the view supplies what exists on disk and does the writing.
 */

import {
  FRONTMATTER_FLAG,
  INK_FILE_SUFFIXES,
  NOTEBOOK_FILE_SUFFIX,
  SCHEMA_VERSION,
  SINGLE_PAGE_FILE_SUFFIX,
} from "../constants";
import { coverTitleBox } from "./cover";
import {
  type AttachmentFolders,
  type CoverRuling,
  type InkDocument,
  type Page,
  type PageGeometry,
  type Ruling,
  type SyntheticBackdrop,
  COVER_RULINGS,
  RULINGS,
  isCoverRuling,
} from "./document";
import {
  COVER_COLORS,
  PAGE_SIZES,
  PAPER_COLORS,
  type PaperColorId,
  coverBackdrop,
  sizeGeometry,
  templateBackdrop,
} from "./templates";

export type NotebookType = "notebook" | "single";

/** A cover design, or none. */
export type CoverChoice = CoverRuling | "none";

/** Everything the dialog asks apart from the title and the folder. */
export interface NotebookChoices {
  type: NotebookType;
  /** Ignored for a single page. */
  cover: CoverChoice;
  /** A {@link COVER_COLORS} id. */
  coverColor: string;
  /** The paper ruling. Never a cover. */
  ruling: Ruling;
  paper: PaperColorId;
  /** A {@link PAGE_SIZES} id. */
  size: string;
  landscape: boolean;
  /**
   * Give it a folder of its own, named after it, holding the notebook and
   * the folders its pictures and recordings are saved in.
   */
  ownFolder: boolean;
}

export const DEFAULT_NOTEBOOK_CHOICES: Readonly<NotebookChoices> = {
  type: "notebook",
  cover: "cover-label",
  coverColor: COVER_COLORS[0].id,
  // Blank, as every note created before the dialog existed was.
  ruling: "blank",
  paper: "white",
  size: PAGE_SIZES[0].id,
  landscape: false,
  ownFolder: false,
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
  if (r.type === "notebook" || r.type === "single") out.type = r.type;
  if (r.cover === "none" || (COVER_RULINGS as readonly unknown[]).includes(r.cover)) {
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
  if (PAPER_COLORS.some((c) => c.id === r.paper)) out.paper = r.paper as PaperColorId;
  if (PAGE_SIZES.some((s) => s.id === r.size)) out.size = r.size as string;
  if (typeof r.landscape === "boolean") out.landscape = r.landscape;
  if (typeof r.ownFolder === "boolean") out.ownFolder = r.ownFolder;
  return out;
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
  return type === "single" ? "Untitled page" : "Untitled notebook";
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

/** The folders inside a notebook's own folder, for its pictures, recordings and PDF exports. */
export const OWN_FOLDER_IMAGES = "Images";
export const OWN_FOLDER_AUDIO = "Recordings";
export const OWN_FOLDER_EXPORTS = "Exports";

/** Where a new notebook goes on disk. */
export interface NotebookPaths {
  /** The folder the notebook file is written in ("" is the vault root). */
  folder: string;
  /** The notebook file's name, suffix included. */
  fileName: string;
  /** Every folder the notebook needs, parents first; the caller creates the missing ones. */
  folders: string[];
  /** Where its pictures, recordings and exports go, when it has a folder of its own. */
  attachments?: AttachmentFolders;
}

/**
 * Where a notebook titled `title` goes in `dir`, whose entries (files and
 * folders) are `taken`. Without a folder of its own it is
 * `<dir>/<Title>.notebook.md` (`.page.md` for a single page).
 * With one, the folder takes the unique name and everything inside is new:
 *
 *   <dir>/<Title>/<Title>.notebook.md
 *   <dir>/<Title>/Images/
 *   <dir>/<Title>/Recordings/
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
  const images = joinVaultPath(folder, OWN_FOLDER_IMAGES);
  const audio = joinVaultPath(folder, OWN_FOLDER_AUDIO);
  const exports = joinVaultPath(folder, OWN_FOLDER_EXPORTS);
  return {
    folder,
    fileName: `${name}${suffix}`,
    folders: [...(parent ? [parent] : []), folder, images, audio, exports],
    attachments: { images, audio, exports },
  };
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
 * page and is flagged so the view offers no way to add another.
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
  // Its own folder's Images, Recordings and Exports, as if set in the note's settings.
  if (attachments && Object.keys(attachments).length > 0) doc.folders = { ...attachments };
  if (choices.type === "single") {
    doc.pages.push(page("p1", geometry, paper));
    doc.single = true;
    return doc;
  }
  if (choices.cover !== "none") {
    const backdrop = coverBackdrop(choices.cover, choices.coverColor);
    const cover = page("p1", geometry, backdrop);
    const text = cleanTitle(title) || defaultTitle(choices.type);
    cover.textBoxes.push(
      coverTitleBox(choices.cover, geometry, backdrop.paperColor ?? "", text, "t1"),
    );
    doc.pages.push(cover, page("p2", geometry, paper));
    return doc;
  }
  doc.pages.push(page("p1", geometry, paper));
  return doc;
}
