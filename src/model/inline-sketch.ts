/**
 * Pure model for inline handwriting sketches embedded in Markdown notes via
 * `![[Notebook#id=hw-…]]`. No DOM, no Obsidian.
 */

import { resolveSpacing } from "../canvas/backdrop";
import { DEFAULT_PAGE_HEIGHT } from "../constants";
import { blankPage, type InkDocument, type Page, type SyntheticBackdrop } from "./document";
import { DotClock, attachDotClock, dotClockOf, idsIn } from "./dot-ids";

export const INLINE_SKETCH_PREFIX = "hw-";
export const INLINE_SKETCH_WIDTH = 1024;
export const INLINE_DEFAULT_HEIGHT = 260;
export const INLINE_MIN_HEIGHT = 120;
export const INLINE_GROW_MARGIN = 64;
export const INLINE_GROW_STEP = 160;
export const INLINE_TOP_PAD = 28;
export const INLINE_BOTTOM_PAD = 28;
export const INLINE_RESIZE_PAD = 12;
/**
 * A block is at most one page tall. The editor's canvas layers are as tall as
 * the block on screen, so this bounds them to what a notebook page in its
 * own view costs (at most about 1400 x 2000 device px a layer on an iPad);
 * a longer drawing belongs on a notebook page.
 */
export const INLINE_MAX_HEIGHT = DEFAULT_PAGE_HEIGHT;

export function isInlineSketchId(id: string): boolean {
  return id.startsWith(INLINE_SKETCH_PREFIX);
}

export function isInlineSketchPage(page: Pick<Page, "id">): boolean {
  return isInlineSketchId(page.id);
}

/**
 * Whether the notebook named after a note can take that note's next block:
 * only when Handwrite here made it, so it holds blocks alone, and no note but
 * this one (`notePath`) embeds it. A notebook of the user's own that happens
 * to share the note's name, or one another note of that name uses, is left
 * alone.
 */
export function reusableNoteNotebook(
  pages: readonly Pick<Page, "id">[],
  linkingNotes: readonly string[],
  notePath: string,
): boolean {
  return (
    pages.length > 0 &&
    pages.every(isInlineSketchPage) &&
    linkingNotes.every((note) => note === notePath)
  );
}

/** Creates a compact, expandable inline sketch page (transparent by default). */
export function createInlineSketchPage(
  id: string,
  options?: {
    transparent?: boolean;
    width?: number;
    height?: number;
    backdrop?: SyntheticBackdrop;
  },
): Page {
  const page = blankPage(id);
  const width = options?.width ?? INLINE_SKETCH_WIDTH;
  const height = options?.height ?? INLINE_DEFAULT_HEIGHT;
  page.geometry = { width, height };
  page.backdrop = options?.backdrop
    ? structuredClone(options.backdrop)
    : options?.transparent === false
      ? { kind: "blank" }
      : { kind: "blank", paperColor: "transparent" };
  return page;
}

/** Highest Y coordinate (page px) reached by any drawn content on `page`, or `Infinity` when empty. */
export function highestInlineContentY(page: Page): number {
  let minY = Infinity;
  for (const stroke of page.strokes) {
    const pad = stroke.size / 2;
    for (let i = 1; i < stroke.pts.length; i += 3) {
      const y = stroke.pts[i] - pad;
      if (y < minY) minY = y;
    }
  }
  for (const image of page.images) {
    if (image.y < minY) minY = image.y;
  }
  for (const text of page.textBoxes) {
    if (text.y < minY) minY = text.y;
  }
  for (const table of page.tables ?? []) {
    if (table.y < minY) minY = table.y;
  }
  for (const graph of page.graphs ?? []) {
    if (graph.y < minY) minY = graph.y;
  }
  for (const eq of page.equations ?? []) {
    if (eq.y < minY) minY = eq.y;
  }
  return minY;
}

/**
 * Crops excess blank whitespace above the highest drawn content on an inline
 * sketch page by shifting all content up to `INLINE_TOP_PAD`. On ruled/grid
 * paper, snaps the shift to a multiple of the ruling spacing so handwriting
 * stays aligned on its lines. Returns the vertical shift applied (0 if none).
 */
export function trimInlinePageTop(page: Page): number {
  const highest = highestInlineContentY(page);
  if (!Number.isFinite(highest) || highest <= INLINE_TOP_PAD) return 0;
  let shiftY = Math.floor(highest - INLINE_TOP_PAD);
  if (page.backdrop.kind !== "blank" && page.backdrop.kind !== "pdf") {
    const spacing = resolveSpacing(page.backdrop.spacing, page.backdrop.kind);
    shiftY = Math.floor(shiftY / spacing) * spacing;
  }
  if (shiftY <= 0) return 0;

  for (const stroke of page.strokes) {
    for (let i = 1; i < stroke.pts.length; i += 3) {
      stroke.pts[i] -= shiftY;
    }
  }
  // Everything placed on the page moves with the ink: pictures, text boxes,
  // tables, graphs, equations, comments, regions and section headings.
  for (const [key, value] of Object.entries(page)) {
    if (key === "strokes" || !Array.isArray(value)) continue;
    for (const item of value as unknown[]) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as { y?: unknown }).y === "number"
      ) {
        (item as { y: number }).y -= shiftY;
      }
    }
  }

  page.geometry = {
    ...page.geometry,
    height: Math.max(INLINE_MIN_HEIGHT, page.geometry.height - shiftY),
  };
  return shiftY;
}

/** Lowest Y coordinate (page px) reached by any drawn content on `page`, or 0 when empty. */
export function lowestInlineContentY(page: Page): number {
  let maxY = 0;
  for (const stroke of page.strokes) {
    const pad = stroke.size / 2;
    for (let i = 1; i < stroke.pts.length; i += 3) {
      const y = stroke.pts[i] + pad;
      if (y > maxY) maxY = y;
    }
  }
  for (const image of page.images) {
    const y = image.y + image.h;
    if (y > maxY) maxY = y;
  }
  for (const text of page.textBoxes) {
    const y = text.y + (text.h ?? text.fontSize * 1.4);
    if (y > maxY) maxY = y;
  }
  for (const table of page.tables ?? []) {
    const h = table.rows.reduce((sum, r) => sum + r, 0);
    const y = table.y + h;
    if (y > maxY) maxY = y;
  }
  for (const graph of page.graphs ?? []) {
    const y = graph.y + graph.h;
    if (y > maxY) maxY = y;
  }
  for (const eq of page.equations ?? []) {
    const y = eq.y + eq.h;
    if (y > maxY) maxY = y;
  }
  return maxY;
}

/**
 * Target height while actively writing when the live pen reaches `y`: grows
 * immediately in `INLINE_GROW_STEP` increments so the inline box gets taller
 * on screen instead of scrolling internally.
 */
export function inlineGrowHeightForPoint(
  page: Page,
  y: number,
  buffer = INLINE_GROW_MARGIN,
): number {
  const current = page.geometry.height;
  if (y + buffer <= current) return current;
  let next = current;
  while (y + buffer > next && next < INLINE_MAX_HEIGHT) {
    next = Math.min(INLINE_MAX_HEIGHT, next + INLINE_GROW_STEP);
  }
  return next;
}

/**
 * Target height after a stroke finishes: grows smoothly in `INLINE_GROW_STEP`
 * increments when ink reaches within `INLINE_GROW_MARGIN` of the bottom edge.
 * Never shrinks while actively writing.
 */
export function inlineGrowHeight(page: Page): number {
  return inlineGrowHeightForPoint(page, lowestInlineContentY(page), INLINE_GROW_MARGIN);
}

/**
 * Target height when finishing an inline writing session: trims excess empty
 * bottom space while keeping `INLINE_BOTTOM_PAD` below the lowest content.
 * Respects `manualHeight` if the user explicitly dragged the bottom handle.
 */
export function inlineTrimHeight(page: Page, manualHeight?: number | null): number {
  const lowest = lowestInlineContentY(page);
  if (lowest <= 0) {
    if (manualHeight !== null && manualHeight !== undefined) {
      return Math.max(INLINE_MIN_HEIGHT, Math.min(INLINE_MAX_HEIGHT, Math.round(manualHeight)));
    }
    return INLINE_DEFAULT_HEIGHT;
  }
  const tight = Math.max(INLINE_MIN_HEIGHT, Math.ceil(lowest + INLINE_BOTTOM_PAD));
  if (manualHeight !== null && manualHeight !== undefined) {
    return Math.min(INLINE_MAX_HEIGHT, Math.max(tight, Math.round(manualHeight)));
  }
  return Math.min(INLINE_MAX_HEIGHT, tight);
}

/** Finish the merged page for storage without changing the inline editor's live page. */
export function finishInlineSketchPage(page: Page, manualHeight: number | null): void {
  const shifted = trimInlinePageTop(page);
  const adjustedHeight = manualHeight === null ? null : manualHeight - shifted;
  page.geometry = { ...page.geometry, height: inlineTrimHeight(page, adjustedHeight) };
}

/** Clamps a user-dragged bottom-handle height so existing content is never clipped. */
export function inlineClampedResizeHeight(page: Page, desiredHeight: number): number {
  const lowest = lowestInlineContentY(page);
  const floor = Math.max(
    INLINE_MIN_HEIGHT,
    lowest > 0 ? Math.ceil(lowest + INLINE_RESIZE_PAD) : INLINE_MIN_HEIGHT,
  );
  return Math.max(floor, Math.min(INLINE_MAX_HEIGHT, Math.round(desiredHeight)));
}

/**
 * Detects whether a reopened inline sketch page already has a user-chosen
 * height larger than its auto-trimmed height (or different from the default
 * when empty), so reopening and clicking Done preserves their dragged height.
 */
export function initialInlineManualHeight(page: Page): number | null {
  const lowest = lowestInlineContentY(page);
  const current = Math.round(page.geometry.height);
  if (lowest <= 0) {
    return current !== INLINE_DEFAULT_HEIGHT ? current : null;
  }
  const tight = Math.max(INLINE_MIN_HEIGHT, Math.ceil(lowest + INLINE_BOTTOM_PAD));
  return current > tight ? current : null;
}

function mergeById<T extends { id: string }>(
  base: readonly T[] | undefined,
  latest: readonly T[] | undefined,
  local: readonly T[] | undefined,
): T[] {
  const baseById = new Map<string, T>();
  for (const item of base ?? []) baseById.set(item.id, item);

  const latestById = new Map<string, T>();
  for (const item of latest ?? []) latestById.set(item.id, item);

  const localItems = local ?? [];
  const localIds = new Set(localItems.map((item) => item.id));
  const out: T[] = [];

  for (const localItem of localItems) {
    const baseItem = baseById.get(localItem.id);
    if (!baseItem) {
      // Newly added locally.
      out.push(structuredClone(localItem));
      continue;
    }
    const localChanged = JSON.stringify(localItem) !== JSON.stringify(baseItem);
    if (localChanged) {
      // Explicitly modified locally.
      out.push(structuredClone(localItem));
      continue;
    }
    // Untouched locally: honor remote erasure or remote edit.
    const latestItem = latestById.get(localItem.id);
    if (latestItem) {
      out.push(structuredClone(latestItem));
    }
  }

  for (const latestItem of latest ?? []) {
    if (!baseById.has(latestItem.id) && !localIds.has(latestItem.id)) {
      // Newly added on another device.
      out.push(structuredClone(latestItem));
    }
  }
  return out;
}

/** A list every item of which has a string id: merged item by item. */
function isIdList(value: unknown): value is Array<{ id: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { id?: unknown }).id === "string",
    )
  );
}

/** The lists every page has, even empty. */
const REQUIRED_LISTS = new Set(["strokes", "images", "textBoxes"]);

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merges local inline edits (`local`) against the latest page on disk
 * (`latest`) using the snapshot from when the session loaded or last saved
 * (`base`). Every field of the page is merged, not a known few: a list of
 * elements with ids (strokes, tasks, links, sections …) item by item, so what
 * another device added meanwhile stays; any other field (the paper, the
 * title, chapters …) is the session's when the session changed it, else the
 * one on disk.
 */
export function mergeInlinePageEdits(base: Page, latest: Page, local: Page): Page {
  const heightChanged = local.geometry.height !== base.geometry.height;
  const mergedHeight = heightChanged
    ? Math.max(
        local.geometry.height,
        latest.geometry.height > base.geometry.height ? latest.geometry.height : 0,
      )
    : latest.geometry.height;

  const merged = structuredClone(latest) as unknown as Record<string, unknown>;
  const b = base as unknown as Record<string, unknown>;
  const l = local as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(merged), ...Object.keys(l)]);
  for (const key of keys) {
    if (key === "id" || key === "geometry") continue;
    const [was, now, mine] = [b[key], merged[key], l[key]];
    if (
      (isIdList(was) || was === undefined) &&
      (isIdList(now) || now === undefined) &&
      isIdList(mine)
    ) {
      const list = mergeById(was, now, mine);
      // An optional list left empty is absent, as the file format keeps it.
      if (list.length > 0 || REQUIRED_LISTS.has(key)) merged[key] = list;
      else delete merged[key];
      continue;
    }
    if (same(mine, was)) continue;
    if (mine === undefined) delete merged[key];
    else merged[key] = structuredClone(mine);
  }
  const page = merged as unknown as Page;
  page.geometry = { ...local.geometry, height: mergedHeight };
  return page;
}

/**
 * The one-page notebook an inline editor writes in, from the whole notebook
 * it was read from: a copy of `pageId`'s page, with a clock for new ids
 * raised past every id in every page of the notebook, so a stroke, text box
 * or picture made in one block never takes the id of one in another block
 * (the notebook view keys its strokes by id). A notebook kept as page files
 * brings its own clock; a single-file one gets one for `device`.
 */
export function inlineEditDocument(
  full: InkDocument,
  pageId: string,
  device: string,
): { doc: InkDocument; page: Page } | null {
  const target = full.pages.find((p) => p.id === pageId);
  if (!target) return null;
  const page = structuredClone(target);
  const doc: InkDocument = {
    version: full.version,
    view: { scrollY: 0, width: page.geometry.width, scale: 1 },
    pages: [page],
  };
  const clock = dotClockOf(full) ?? new DotClock(device);
  clock.raise(idsIn(full));
  attachDotClock(doc, clock);
  return { doc, page };
}

function decodeLinkTarget(raw: string): string {
  const trimmed = raw.trim();
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1).trim() : trimmed;
  try {
    return decodeURIComponent(unwrapped);
  } catch {
    return unwrapped;
  }
}

/**
 * Finds the link target of the first inline handwriting embed — whether wiki
 * (`![[Notebook#id=hw-...]]`) or Markdown (`![](Notebook.notebook.md#id=hw-...)`)
 * — in a Markdown document, so "Handwrite here" automatically reuses the note's
 * existing backing notebook without needing a separate association registry.
 */
export function findLinkedNotebookInMarkdown(markdown: string): string | null {
  const candidates: Array<{ index: number; target: string }> = [];

  const wiki = /!\[\[([^\]|#]+)#id=hw-[A-Za-z0-9_-]+(?:\|[^\]]*)?\]\]/.exec(markdown);
  if (wiki) candidates.push({ index: wiki.index, target: wiki[1].trim() });

  const mdAngle = /!\[[^\]]*\]\(<([^>#]+)#id=hw-[A-Za-z0-9_-]+>(?:\s+["'][^"']*["'])?\)/.exec(
    markdown,
  );
  if (mdAngle) candidates.push({ index: mdAngle.index, target: decodeLinkTarget(mdAngle[1]) });

  const mdPlain =
    /!\[[^\]]*\]\((<[^>#]+>|[^)#\s]+)#id=hw-[A-Za-z0-9_-]+(?:\s+["'][^"']*["'])?\)/.exec(markdown);
  if (mdPlain) candidates.push({ index: mdPlain.index, target: decodeLinkTarget(mdPlain[1]) });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0].target;
}
