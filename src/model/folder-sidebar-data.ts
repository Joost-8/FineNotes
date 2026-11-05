/**
 * What the Folders sidebar keeps in FineNotes' settings (`folderSidebar` in
 * `data.json`): its choices, and what it remembers about folders (colours,
 * which are open, pinned, recent). Read tolerantly: a hand-edited or older
 * file never makes the sidebar fail. No Obsidian, no DOM.
 */

/** What the library sorts notes by. */
export type LibrarySort = "created" | "modified" | "name";

/** Whether the library shows notes as a grid of thumbnails or a list. */
export type LibraryViewMode = "grid" | "list";

export interface FolderSidebarData {
  /** Folder path → its colour. */
  folderColors: Record<string, string>;
  /** Folder path → true while it is open in the tree. */
  expanded: Record<string, boolean>;
  showFilesInSidebar: boolean;
  hideAttachmentFolders: boolean;
  librarySort: LibrarySort;
  librarySortDescending: boolean;
  libraryViewMode: LibraryViewMode;
  /** Pinned folder paths, in the order they were pinned. */
  pinned: string[];
  /** Folders opened lately, newest first. */
  recent: string[];
  showCounts: boolean;
  showPinned: boolean;
  showRecent: boolean;
  autoColorNewFolders: boolean;
  /** The tips card has been dismissed. */
  seenIntro: boolean;
  /** Colours the person chose beyond the palette, newest first. */
  recentColors: string[];
  searchInNotes: boolean;
}

const SORTS: readonly LibrarySort[] = ["created", "modified", "name"];
const MODES: readonly LibraryViewMode[] = ["grid", "list"];

/** The sidebar's choices on a fresh install. A new object each time. */
export function defaultFolderSidebarData(): FolderSidebarData {
  return {
    folderColors: {},
    expanded: {},
    showFilesInSidebar: false,
    hideAttachmentFolders: true,
    librarySort: "created",
    librarySortDescending: true,
    libraryViewMode: "grid",
    pinned: [],
    recent: [],
    showCounts: true,
    showPinned: true,
    showRecent: true,
    autoColorNewFolders: false,
    seenIntro: false,
    recentColors: [],
    searchInNotes: true,
  };
}

function record(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function strings(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function flag(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/**
 * The sidebar's data from whatever was stored: anything missing or of the
 * wrong kind takes the default, and every list and map is a copy, so the
 * defaults are never shared. Keys this build does not know are dropped.
 */
export function folderSidebarDataOf(raw: unknown): FolderSidebarData {
  const stored = record(raw);
  const defaults = defaultFolderSidebarData();
  const folderColors: Record<string, string> = {};
  for (const [path, color] of Object.entries(record(stored.folderColors))) {
    if (typeof color === "string") folderColors[path] = color;
  }
  const expanded: Record<string, boolean> = {};
  for (const [path, open] of Object.entries(record(stored.expanded))) {
    if (open === true) expanded[path] = true;
  }
  const sort = SORTS.find((entry) => entry === stored.librarySort);
  const mode = MODES.find((entry) => entry === stored.libraryViewMode);
  return {
    folderColors,
    expanded,
    showFilesInSidebar: flag(stored.showFilesInSidebar, defaults.showFilesInSidebar),
    hideAttachmentFolders: flag(stored.hideAttachmentFolders, defaults.hideAttachmentFolders),
    librarySort: sort ?? defaults.librarySort,
    librarySortDescending: flag(stored.librarySortDescending, defaults.librarySortDescending),
    libraryViewMode: mode ?? defaults.libraryViewMode,
    pinned: strings(stored.pinned),
    recent: strings(stored.recent),
    showCounts: flag(stored.showCounts, defaults.showCounts),
    showPinned: flag(stored.showPinned, defaults.showPinned),
    showRecent: flag(stored.showRecent, defaults.showRecent),
    autoColorNewFolders: flag(stored.autoColorNewFolders, defaults.autoColorNewFolders),
    seenIntro: flag(stored.seenIntro, defaults.seenIntro),
    recentColors: strings(stored.recentColors),
    searchInNotes: flag(stored.searchInNotes, defaults.searchInNotes),
  };
}
