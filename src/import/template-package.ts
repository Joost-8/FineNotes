/**
 * A FineNotes template: one `.finetemplate` file anyone can share, holding a
 * notebook and everything it needs. It is a zip of
 *
 *     manifest.json   name, author, version, licence, page count
 *     notebook.fn     the notebook, in the note's own payload format
 *     preview.png     its first page, for a gallery
 *     assets/…        the pictures and PDFs its pages use
 *
 * Opened, it becomes a new notebook through the importer, whose pictures are
 * saved beside it (Joost's call, 2026-10-17): the template's assets are
 * copies, never links. A gallery is a JSON index of such files
 * ({@link readGalleryIndex}), modelled on Obsidian's own theme registry,
 * with a licence and a "retired" flag on every entry from the start
 * (research/reports/GoodNotes aesthetics and design freedom.md).
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { strFromU8, strToU8, zipSync } from "fflate";
import type { InkDocument } from "../model/document";
import { decodeDocument, encodeDocument } from "../model/serialize";
import { type ImportResult, sniffFile } from "./import-types";

export const TEMPLATE_EXTENSION = "finetemplate";
/** The package layout this code writes and reads. */
export const TEMPLATE_FORMAT = 1;

const MANIFEST = "manifest.json";
const NOTEBOOK = "notebook.fn";
const PREVIEW = "preview.png";
const ASSETS = "assets/";

/** What may be done with a template, said up front so nobody has to guess. */
export type TemplateLicence = "personal" | "commercial" | "cc-by" | "cc0";

export const TEMPLATE_LICENCES: ReadonlyArray<{ id: TemplateLicence; label: string }> = [
  { id: "personal", label: "Personal use only" },
  { id: "commercial", label: "Personal and commercial use" },
  { id: "cc-by", label: "CC BY 4.0 (share and adapt, with credit)" },
  { id: "cc0", label: "CC0 (no rights reserved)" },
];

export interface TemplateManifest {
  format: number;
  /** Stable across versions: lower case, digits and dashes. */
  id: string;
  name: string;
  author?: string;
  description?: string;
  /** The template's own version, `1`, `1.2`, … */
  version: string;
  licence: TemplateLicence;
  pages: number;
  /** When the file was made, ISO 8601. */
  created: string;
}

/** A name as an id: lower case, words joined by dashes. */
export function templateId(name: string): string {
  const id = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "template";
}

/** A manifest as read from a file or an index, or `null` when it is not one. */
export function readManifest(raw: unknown): TemplateManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.format !== "number" || r.format > TEMPLATE_FORMAT || r.format < 1) return null;
  if (typeof r.name !== "string" || !r.name.trim()) return null;
  const licence = TEMPLATE_LICENCES.some((l) => l.id === r.licence)
    ? (r.licence as TemplateLicence)
    : "personal";
  return {
    format: r.format,
    id: typeof r.id === "string" && r.id ? templateId(r.id) : templateId(r.name),
    name: r.name.trim(),
    ...(typeof r.author === "string" && r.author.trim() ? { author: r.author.trim() } : {}),
    ...(typeof r.description === "string" && r.description.trim()
      ? { description: r.description.trim() }
      : {}),
    version: typeof r.version === "string" && r.version ? r.version : "1",
    licence,
    pages: typeof r.pages === "number" && r.pages > 0 ? Math.round(r.pages) : 1,
    created: typeof r.created === "string" ? r.created : "",
  };
}

export interface TemplateInput {
  doc: InkDocument;
  name: string;
  author?: string;
  description?: string;
  version?: string;
  licence: TemplateLicence;
  /** The bytes of each picture or PDF the pages use, by its vault path. */
  files: ReadonlyMap<string, Uint8Array>;
  /** The first page as a PNG, for galleries. */
  preview?: Uint8Array;
  /** Stamped into the manifest; defaults to now. */
  created?: string;
}

/**
 * The template file: the notebook with its file paths rewritten to the
 * package's `assets/` and its personal fields left out (recordings, where
 * its files are saved, practice data). A picture whose bytes were not given
 * is left out, and named in `missing`.
 */
export function buildTemplatePackage(input: TemplateInput): {
  bytes: Uint8Array;
  missing: string[];
} {
  const doc = structuredClone(input.doc);
  delete doc.recordings;
  delete doc.folders;
  delete doc.practice;
  delete doc.recognizedHash;
  const assets = new Map<string, Uint8Array>();
  const names = new Map<string, string>();
  const missing: string[] = [];
  const asset = (path: string): string | null => {
    const known = names.get(path);
    if (known) return known;
    const bytes = input.files.get(path);
    if (!bytes) {
      if (!missing.includes(path)) missing.push(path);
      return null;
    }
    const leaf = (path.split("/").pop() ?? "file").replace(/[^\w.\- ]+/g, "_");
    let name = `${ASSETS}${leaf}`;
    for (let n = 2; assets.has(name); n++) name = `${ASSETS}${n}-${leaf}`;
    assets.set(name, bytes);
    names.set(path, name);
    return name;
  };
  for (const page of doc.pages) {
    page.images = page.images.filter((image) => {
      const name = asset(image.path);
      if (name) image.path = name;
      return name !== null;
    });
    if (page.backdrop.kind === "pdf") {
      const name = asset(page.backdrop.path);
      // A page whose PDF is missing keeps its path; the importer then reports it.
      if (name) page.backdrop = { ...page.backdrop, path: name };
    }
  }
  const manifest: TemplateManifest = {
    format: TEMPLATE_FORMAT,
    id: templateId(input.name),
    name: input.name.trim() || "Template",
    ...(input.author?.trim() ? { author: input.author.trim() } : {}),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    version: input.version?.trim() || "1",
    licence: input.licence,
    pages: doc.pages.length,
    created: input.created ?? new Date().toISOString(),
  };
  const files: Record<string, Uint8Array> = {
    [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)),
    [NOTEBOOK]: strToU8(encodeDocument(doc)),
  };
  if (input.preview) files[PREVIEW] = input.preview;
  for (const [name, bytes] of assets) files[name] = bytes;
  // A fixed time stamp: the same template always makes the same bytes.
  return { bytes: zipSync(files, { level: 6, mtime: new Date(Date.UTC(2020, 0, 1)) }), missing };
}

/** Whether a zip's entries are a template's. */
export function isTemplatePackage(files: ReadonlyMap<string, unknown>): boolean {
  return files.has(MANIFEST) && files.has(NOTEBOOK);
}

/** A template's manifest, or `null`. */
export function templateManifestOf(
  files: ReadonlyMap<string, Uint8Array>,
): TemplateManifest | null {
  const raw = files.get(MANIFEST);
  if (!raw) return null;
  try {
    return readManifest(JSON.parse(strFromU8(raw)));
  } catch {
    return null;
  }
}

/** A template as the importer's result: the notebook, and its assets to save beside it. */
export function readTemplatePackage(
  files: ReadonlyMap<string, Uint8Array>,
  title: string,
): ImportResult {
  const manifest = templateManifestOf(files);
  if (!manifest) throw new Error("its manifest is missing or unreadable");
  const payload = files.get(NOTEBOOK);
  if (!payload) throw new Error("it holds no notebook");
  const doc = decodeDocument(strFromU8(payload));
  const attachments = [...files.entries()]
    .filter(([name]) => name.startsWith(ASSETS) && name.length > ASSETS.length)
    .map(([name, bytes]) => ({ name, bytes, mime: sniffFile(bytes).mime }));
  const warnings: string[] = [];
  if (manifest.licence === "personal") {
    warnings.push(
      `“${manifest.name}”${manifest.author ? ` by ${manifest.author}` : ""} is for personal use only.`,
    );
  }
  return { source: "template", title: manifest.name || title, doc, attachments, warnings };
}

/**
 * What a gallery entry installs: a paper (a PDF or picture, every page of it
 * into My templates) or a whole notebook (a `.finetemplate`).
 */
export type GalleryKind = "paper" | "notebook";

/** The categories a gallery groups templates under; anything else is "other". */
export const GALLERY_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "planner", label: "Planners" },
  { id: "study", label: "Study" },
  { id: "journal", label: "Journals" },
  { id: "work", label: "Work" },
  { id: "paper", label: "Papers" },
  { id: "other", label: "Other" },
];

/**
 * FineNotes' own gallery (github.com/Joost-8/FineNotes-templates): what an
 * empty gallery address in the settings means.
 */
export const DEFAULT_GALLERY_URL =
  "https://raw.githubusercontent.com/Joost-8/FineNotes-templates/main/index.json";

/** One template in a gallery index. */
export interface GalleryEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  licence: TemplateLicence;
  kind: GalleryKind;
  category: string;
  tags: string[];
  /** HTTPS URL of a preview image. */
  preview: string;
  /** HTTPS URLs of a small picture of every page, in order (the gallery's template page). */
  previews: string[];
  /** HTTPS URL of the file: a PDF, PNG or JPEG paper, or a `.finetemplate`. Empty for a shop-only entry. */
  download: string;
  /** HTTPS URL of the creator's own shop, for a template sold there. FineNotes sells nothing. */
  shop: string;
  pages: number;
  /** Downloads so far, all versions together (counted by GitHub, synced a few times a day). */
  downloads: number;
  /** When it came into the gallery, ISO 8601; empty when unknown. */
  added: string;
  /** Kept in the index so links still resolve, but no longer offered. */
  retired: boolean;
}

const HTTPS = /^https:\/\/[^\s]+$/i;

/** What a download URL installs, by its file's extension; null for anything else. */
export function galleryKindOf(url: string): GalleryKind | null {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(pdf|png|jpe?g)$/.test(path)) return "paper";
  if (path.endsWith(`.${TEMPLATE_EXTENSION}`)) return "notebook";
  return null;
}

/**
 * A gallery index: `{ "format": 1, "templates": [ … ] }`. Entries that are
 * not usable (no name; neither a download of a known kind nor a shop) are
 * dropped; retired ones are kept and flagged, and the rest come in name order.
 */
export function readGalleryIndex(raw: unknown): GalleryEntry[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as Record<string, unknown>).templates;
  if (!Array.isArray(list)) return [];
  const out: GalleryEntry[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== "string" || !r.name.trim()) continue;
    const download = typeof r.download === "string" && HTTPS.test(r.download) ? r.download : "";
    const kind = download ? galleryKindOf(download) : null;
    const shop = typeof r.shop === "string" && HTTPS.test(r.shop) ? r.shop : "";
    if (!kind && !shop) continue;
    const category =
      typeof r.category === "string" && GALLERY_CATEGORIES.some((c) => c.id === r.category)
        ? r.category
        : "other";
    out.push({
      id: typeof r.id === "string" && r.id ? templateId(r.id) : templateId(r.name),
      name: r.name.trim(),
      author: typeof r.author === "string" ? r.author.trim() : "",
      description: typeof r.description === "string" ? r.description.trim() : "",
      version: typeof r.version === "string" && r.version ? r.version : "1",
      licence: TEMPLATE_LICENCES.some((l) => l.id === r.licence)
        ? (r.licence as TemplateLicence)
        : "personal",
      kind: kind ?? "paper",
      category,
      tags: Array.isArray(r.tags)
        ? r.tags
            .filter((t): t is string => typeof t === "string" && t.trim() !== "")
            .map((t) => t.trim().toLowerCase())
            .slice(0, 12)
        : [],
      preview: typeof r.preview === "string" && HTTPS.test(r.preview) ? r.preview : "",
      previews: Array.isArray(r.previews)
        ? r.previews.filter((p): p is string => typeof p === "string" && HTTPS.test(p)).slice(0, 60)
        : [],
      download: kind ? download : "",
      shop,
      pages: typeof r.pages === "number" && r.pages > 0 ? Math.round(r.pages) : 1,
      downloads:
        typeof r.downloads === "number" && Number.isFinite(r.downloads) && r.downloads > 0
          ? Math.floor(r.downloads)
          : 0,
      added: typeof r.added === "string" && !Number.isNaN(Date.parse(r.added)) ? r.added : "",
      retired: r.retired === true,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** How the gallery orders templates. */
export type GallerySort = "popular" | "new" | "name";

export const GALLERY_SORTS: ReadonlyArray<{ id: GallerySort; label: string }> = [
  { id: "popular", label: "Popular" },
  { id: "new", label: "New" },
  { id: "name", label: "A–Z" },
];

/**
 * `entries` in `sort` order: most downloaded first, newest first, or by
 * name; ties (and templates with no date) by name, so the order is stable.
 */
export function sortGallery(entries: readonly GalleryEntry[], sort: GallerySort): GalleryEntry[] {
  const byName = (a: GalleryEntry, b: GalleryEntry): number => a.name.localeCompare(b.name);
  const time = (e: GalleryEntry): number => (e.added ? Date.parse(e.added) : 0);
  return [...entries].sort((a, b) => {
    if (sort === "popular") return b.downloads - a.downloads || byName(a, b);
    if (sort === "new") return time(b) - time(a) || byName(a, b);
    return byName(a, b);
  });
}

/** A download count as the gallery shows it: 7, 980, 1.2k, 12k, 1.4M. */
export function formatDownloads(n: number): string {
  const count = Math.max(0, Math.floor(n));
  if (count < 1000) return String(count);
  const short = (value: number, unit: string): string =>
    `${value < 10 ? (Math.floor(value * 10) / 10).toString() : Math.floor(value).toString()}${unit}`;
  return count < 1_000_000 ? short(count / 1000, "k") : short(count / 1_000_000, "M");
}

/** Whether `entry` matches a search: every word in its name, author, description or tags. */
export function galleryMatches(entry: GalleryEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [entry.name, entry.author, entry.description, ...entry.tags].join(" ").toLowerCase();
  return words.every((word) => hay.includes(word));
}
