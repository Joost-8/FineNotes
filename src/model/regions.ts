/**
 * Named regions (discussion #167): a part of a board, or of any page,
 * lassoed and named, that an ordinary Markdown note embeds alone:
 * `![[Mind map.notebook#Krebs cycle]]`. A region is a rectangle in page px
 * with a name; it holds no elements, so what shows in an embed is whatever
 * is drawn in it when the embed paints. Allowed on every page, not only a
 * board's: on a page it costs nothing and works the same way.
 *
 * Names are what links use, so they are kept fit for one: one line, at most
 * `MAX_PAGE_TITLE_LENGTH`, and without the characters that end a link or
 * its subpath (`# | ^ [ ] \`). They are matched without regard to case or
 * runs of spaces, as Obsidian matches a heading.
 *
 * PURE: no DOM, no Obsidian.
 */

import { t } from "../i18n/translate";
import type { Command } from "./commands";
import { normalizePageTitle } from "./contents";
import type { Bounds, InkDocument, Page, PageGeometry, PageRegion } from "./document";

/** Paper kept round a lasso's selection when it becomes a region, page px. */
export const REGION_PAD = 24;

/**
 * A region's name as it is stored, or `undefined` for none: the characters
 * a link cannot hold become spaces, then it is trimmed and cut as a
 * contents title is (`normalizePageTitle`).
 */
export function normalizeRegionName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  return normalizePageTitle(raw.replace(/[#|^[\]\\]/g, " "));
}

/** What two names are compared by: case and runs of spaces do not count. */
export function regionKey(name: string): string {
  return (normalizeRegionName(name) ?? "").toLocaleLowerCase();
}

/**
 * The region name a link's subpath may ask for (`#Krebs cycle` → "Krebs
 * cycle"), or `null` when it asks for nothing or for a block (`#^id`).
 * A Markdown link's `%20` is read as a space. A page (`#page=3`, `#Page 3`,
 * `#p3`) is not told apart here: callers read those first, so a page wins
 * over a region named like one.
 */
export function regionSubpathName(subpath: string): string | null {
  let text = subpath.trim().replace(/^#/, "");
  if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Not an escape after all: the text as written.
    }
  }
  text = text.trim();
  return text === "" || text.startsWith("^") ? null : text;
}

/** A region found by its name: the page it is on (0-based) and the region. */
export interface FoundRegion {
  index: number;
  region: PageRegion;
}

/** The first region named `name` (page order, then the order they were made), or `null`. */
export function findRegion(pages: readonly Page[], name: string): FoundRegion | null {
  const key = regionKey(name);
  if (key === "") return null;
  for (let index = 0; index < pages.length; index++) {
    for (const region of pages[index].regions ?? []) {
      if (regionKey(region.name) === key) return { index, region };
    }
  }
  return null;
}

/** Every region of the notebook, page by page. */
export function allRegions(pages: readonly Page[]): FoundRegion[] {
  const out: FoundRegion[] = [];
  pages.forEach((page, index) => {
    for (const region of page.regions ?? []) out.push({ index, region });
  });
  return out;
}

/**
 * `name`, or, when another region of the notebook (not `exceptId`) has it
 * already, the first of "name 2", "name 3", … that is free: a link must
 * lead to one place.
 */
export function uniqueRegionName(pages: readonly Page[], name: string, exceptId?: string): string {
  const taken = new Set<string>();
  for (const { region } of allRegions(pages)) {
    if (region.id !== exceptId) taken.add(regionKey(region.name));
  }
  if (!taken.has(regionKey(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const base = name.slice(0, Math.max(1, 80 - suffix.length)).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(regionKey(candidate))) return candidate;
  }
}

/** The next free region id in the notebook: `rg<N>`. */
export function nextRegionId(doc: Pick<InkDocument, "pages">): string {
  let max = 0;
  for (const { region } of allRegions(doc.pages)) {
    const m = /^rg(\d+)$/.exec(region.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `rg${max + 1}`;
}

/**
 * The region a lasso's selection makes: its bounds with `pad` of paper
 * round them, out to whole page px, kept on the page. `null` for bounds
 * that are not finite or hold no area on the page.
 */
export function regionRect(
  bounds: Bounds,
  geometry: PageGeometry,
  pad = REGION_PAD,
): Omit<PageRegion, "id" | "name"> | null {
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY, pad].every(Number.isFinite)) return null;
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  const right = Math.min(geometry.width, Math.ceil(maxX + pad));
  const bottom = Math.min(geometry.height, Math.ceil(maxY + pad));
  if (!(right > x) || !(bottom > y)) return null;
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * A page's regions as stored, or none: each needs an id not seen before in
 * the notebook, a name `normalizeRegionName` keeps, a finite corner and a
 * finite size greater than 0. Anything else is dropped, never mended.
 */
export function normalizeRegions(raw: unknown, seen: Set<string>): PageRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: PageRegion[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, x, y, w, h } = item as Record<string, unknown>;
    const kept = normalizeRegionName(name);
    if (typeof id !== "string" || id === "" || seen.has(id) || kept === undefined) continue;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
    if (!isFiniteNumber(w) || !isFiniteNumber(h) || !(w > 0) || !(h > 0)) continue;
    seen.add(id);
    out.push({ id, name: kept, x, y, w, h });
  }
  return out;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Add, rename, move or resize (one record with the same id) or, with
 * `null`, remove one region of a page. The page is held by identity, as
 * the contents' commands hold it. One undo step, which puts back exactly
 * the list the page had. A region keeps its place in the list when it is
 * changed; a new one goes last.
 */
export class SetRegion implements Command {
  readonly label: string;
  private previous: { regions: PageRegion[] | undefined } | null = null;

  constructor(
    private readonly page: Page,
    private readonly id: string,
    private readonly value: Omit<PageRegion, "id"> | null,
  ) {
    const exists = page.regions?.some((r) => r.id === id) === true;
    if (value === null) this.label = t("surface.command.removeRegion");
    else this.label = exists ? t("surface.command.changeRegion") : t("surface.command.addRegion");
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    if (!doc.pages.includes(this.page)) return;
    const before = this.page.regions;
    this.previous = { regions: before };
    const value = this.value;
    const name = value ? normalizeRegionName(value.name) : undefined;
    const keep =
      value !== null &&
      name !== undefined &&
      [value.x, value.y, value.w, value.h].every(Number.isFinite) &&
      value.w > 0 &&
      value.h > 0;
    const list = before ?? [];
    let next: PageRegion[];
    if (!keep) {
      next = list.filter((r) => r.id !== this.id);
    } else {
      const record: PageRegion = {
        id: this.id,
        name,
        x: value.x,
        y: value.y,
        w: value.w,
        h: value.h,
      };
      const at = list.findIndex((r) => r.id === this.id);
      next = at < 0 ? [...list, record] : list.map((r, i) => (i === at ? record : r));
    }
    if (next.length > 0) this.page.regions = next;
    else delete this.page.regions;
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    const { regions } = this.previous;
    if (regions === undefined) delete this.page.regions;
    else this.page.regions = regions;
    this.previous = null;
  }
}
