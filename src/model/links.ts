/**
 * Handwritten links: ink that links to a note, a heading, a notebook page
 * or a web address (FineNotes#20, after Stylus Labs Write's handwritten
 * links). A link belongs to a set of strokes on one page, by id, so it moves
 * wherever those strokes move; a stroke is in at most one link. The ink
 * keeps its own colour: the view draws an underline.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument, InkLink, Page } from "./document";

/** Longest target kept, in UTF-16 units. */
export const MAX_LINK_TARGET_LENGTH = 2000;

/**
 * A target as stored, or `undefined` for none: trimmed, one line, and not
 * too long. A wikilink's brackets are taken off: `[[Signals#FIR]]` is
 * stored as `Signals#FIR`.
 */
export function normalizeLinkTarget(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let target = raw.replace(/\s+/g, " ").trim();
  const wiki = /^\[\[(.*)\]\]$/.exec(target);
  if (wiki) target = wiki[1].split("|")[0].trim();
  if (target === "" || target.length > MAX_LINK_TARGET_LENGTH) return undefined;
  return target;
}

/** Whether a target is a web address (or another scheme) rather than a note in the vault. */
export function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || /^www\./i.test(target);
}

/** A target to open: a bare `www.` address gets its `https://`. */
export function externalUrl(target: string): string {
  return /^www\./i.test(target) ? `https://${target}` : target;
}

/** The next free link id in the notebook: `l<N>`. */
export function nextLinkId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const link of page.links ?? []) {
      const m = /^l(\d+)$/.exec(link.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `l${max + 1}`;
}

/**
 * Set one link of a page, by id: its strokes and target, or (with `null`)
 * none. One undo step, which puts back exactly the list the page had.
 */
export class SetLink implements Command {
  readonly label: string;
  private previous: { links: InkLink[] | undefined } | null = null;

  constructor(
    private readonly page: Page,
    private readonly id: string,
    private readonly value: Omit<InkLink, "id"> | null,
    label?: string,
  ) {
    this.label = label ?? (value === null ? "Remove link" : "Link");
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    if (!doc.pages.includes(this.page)) return;
    const before = this.page.links;
    this.previous = { links: before };
    const value = this.value;
    const target = value ? normalizeLinkTarget(value.target) : undefined;
    const next = (before ?? []).filter((link) => link.id !== this.id);
    if (value && target !== undefined && value.strokes.length > 0) {
      const at = (before ?? []).findIndex((link) => link.id === this.id);
      const link: InkLink = { id: this.id, strokes: [...value.strokes], target };
      next.splice(at >= 0 ? at : next.length, 0, link);
    }
    if (next.length > 0) this.page.links = next;
    else delete this.page.links;
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    const { links } = this.previous;
    if (links === undefined) delete this.page.links;
    else this.page.links = links;
    this.previous = null;
  }
}

/**
 * The commands that link `strokeIds` on `page` to `target` (or, with `null`,
 * unlink them): any link already holding one of them gives it up, and is
 * removed if it has none left; then the new link, when there is one.
 */
export function linkStrokes(
  doc: InkDocument,
  page: Page,
  strokeIds: readonly string[],
  target: string | null,
): Command[] {
  const ids = new Set(strokeIds);
  const commands: Command[] = [];
  for (const link of page.links ?? []) {
    if (!link.strokes.some((id) => ids.has(id))) continue;
    const rest = link.strokes.filter((id) => !ids.has(id));
    const label = target === null ? "Remove link" : "Link";
    commands.push(
      new SetLink(page, link.id, rest.length > 0 ? { ...link, strokes: rest } : null, label),
    );
  }
  if (target !== null && ids.size > 0 && normalizeLinkTarget(target) !== undefined) {
    commands.push(new SetLink(page, nextLinkId(doc), { strokes: [...ids], target }));
  }
  return commands;
}

/** The links of a page that hold any of these strokes. */
export function linksOf(page: Page, strokeIds: readonly string[]): InkLink[] {
  const ids = new Set(strokeIds);
  return (page.links ?? []).filter((link) => link.strokes.some((id) => ids.has(id)));
}

/**
 * Every link target in the notebook, once each, in page order: only links
 * that still hold ink on their page. An erased link keeps its record until
 * the notebook is next opened, so an undo brings it back whole.
 */
export function linkTargets(doc: InkDocument): string[] {
  const out: string[] = [];
  for (const page of doc.pages) {
    if (!page.links) continue;
    const present = new Set(page.strokes.map((s) => s.id));
    for (const link of page.links) {
      if (!link.strokes.some((id) => present.has(id))) continue;
      if (!out.includes(link.target)) out.push(link.target);
    }
  }
  return out;
}

/**
 * A page's links as stored, or none: each needs an id not seen yet in the
 * notebook, a target, and at least one of its strokes still on the page
 * (strokes that are gone are dropped from it).
 */
export function normalizeLinks(
  raw: unknown,
  strokeIds: ReadonlySet<string>,
  seen: Set<string>,
): InkLink[] {
  if (!Array.isArray(raw)) return [];
  const out: InkLink[] = [];
  // A stroke is in one link at most: the first that names it keeps it.
  const claimed = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, strokes, target } = item as Record<string, unknown>;
    const to = normalizeLinkTarget(target);
    if (typeof id !== "string" || id === "" || seen.has(id) || to === undefined) continue;
    if (!Array.isArray(strokes)) continue;
    const held = [
      ...new Set(
        strokes.filter(
          (s): s is string => typeof s === "string" && strokeIds.has(s) && !claimed.has(s),
        ),
      ),
    ];
    if (held.length === 0) continue;
    for (const s of held) claimed.add(s);
    seen.add(id);
    out.push({ id, strokes: held, target: to });
  }
  return out;
}

/**
 * These strokes and every stroke linked with any of them: a linked word is
 * one thing to the eraser, which takes all of it or none of it.
 */
export function withLinkedStrokes(page: Page, strokeIds: Iterable<string>): Set<string> {
  const out = new Set(strokeIds);
  for (const link of page.links ?? []) {
    if (link.strokes.some((id) => out.has(id))) for (const id of link.strokes) out.add(id);
  }
  return out;
}

/** Whether a stroke is in one of its page's links. */
export function isLinked(page: Page, strokeId: string): boolean {
  return (page.links ?? []).some((link) => link.strokes.includes(strokeId));
}
