/**
 * Which pages an export takes, and what the file is called: the whole
 * notebook, the page being read, or a custom range typed as `1-3, 5, 8-`.
 *
 * PURE: no DOM, no Obsidian.
 */

import { sanitizeFileName, stripInkSuffix } from "../model/new-notebook";

export type ExportScope = "all" | "current" | "custom";

export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };

/**
 * Parse a page range as a reader writes it: 1-based numbers and spans
 * separated by commas or spaces. `8-` runs to the last page, `-3` from the
 * first; en and em dashes count as hyphens, since iPadOS "smart
 * punctuation" turns a typed `-` into one. Returns 0-based indices in the
 * order written — that is the order they export in, so `5, 1-3` puts page
 * 5 first and `3-1` runs backwards — each page once, where first named.
 */
export function parsePageRange(input: string, total: number): RangeResult {
  // `1 – 3` is one span, not three parts.
  const text = input.trim().replace(/\s*[-–—]\s*/g, "-");
  if (!text) return { ok: false, error: "Type the pages to export, e.g. 1-3, 5" };
  // A Set keeps insertion order: the order the pages were written in.
  const picked = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const span = /^(\d*)-(\d*)$/.exec(part);
    let from: number;
    let to: number;
    if (span) {
      if (!span[1] && !span[2]) return { ok: false, error: `"${part}" is not a page range` };
      from = span[1] ? Number(span[1]) : 1;
      to = span[2] ? Number(span[2]) : total;
    } else if (/^\d+$/.test(part)) {
      from = to = Number(part);
    } else {
      return { ok: false, error: `"${part}" is not a page number` };
    }
    if (Math.min(from, to) < 1) return { ok: false, error: "Pages are numbered from 1" };
    const last = Math.max(from, to);
    if (last > total) {
      const has = total === 1 ? "has 1 page" : `has ${total} pages`;
      return { ok: false, error: `There is no page ${last}: this notebook ${has}` };
    }
    const step = from <= to ? 1 : -1;
    for (let p = from; p !== to + step; p += step) picked.add(p - 1);
  }
  if (picked.size === 0) return { ok: false, error: "Type the pages to export, e.g. 1-3, 5" };
  return { ok: true, pages: [...picked] };
}

/** Every page of a notebook of `total`, 0-based. */
export function allPages(total: number): number[] {
  return Array.from({ length: Math.max(0, total) }, (_, i) => i);
}

/**
 * A tap on page `index` in the page grid: tick it (it goes last), or untick
 * it (the others keep their order). The selection's order is the PDF's page
 * order. With `extend` (shift-click on a desktop) every page from `anchor`
 * to `index` not yet ticked is added, in the direction of the click.
 * Returns a new selection; the one given is not changed.
 */
export function toggleSelection(
  selected: readonly number[],
  index: number,
  anchor: number | null,
  extend: boolean,
): number[] {
  const out = new Set(selected);
  if (extend && anchor !== null) {
    const step = anchor <= index ? 1 : -1;
    for (let i = anchor; i !== index + step; i += step) out.add(i);
  } else if (out.has(index)) {
    out.delete(index);
  } else {
    out.add(index);
  }
  return [...out];
}

/**
 * The pages written back compactly, 1-based and in their order: `[0, 1, 2,
 * 4]` → `1-3, 5`, `[4, 2, 1, 0]` → `5, 3-1`. Parses back to the same list.
 * Used in the file name, the dialog's summary and its range field.
 */
export function formatPageRange(pages: readonly number[]): string {
  const list = [...new Set(pages)];
  const parts: string[] = [];
  let i = 0;
  while (i < list.length) {
    // A run of neighbours, forwards or backwards.
    const step = list[i + 1] === list[i] + 1 ? 1 : list[i + 1] === list[i] - 1 ? -1 : 0;
    let j = i;
    if (step !== 0) while (j + 1 < list.length && list[j + 1] === list[j] + step) j++;
    const a = list[i] + 1;
    const b = list[j] + 1;
    parts.push(a === b ? String(a) : `${a}-${b}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/**
 * The export's file base name (no extension): `Biology` for the whole
 * notebook, `Biology (page 3)` for one page, `Biology (pages 1-3,5)` for a
 * range. The title is sanitised as a new notebook's is.
 */
export function exportBaseName(title: string, pages: readonly number[], total: number): string {
  const base = sanitizeFileName(stripInkSuffix(title)) || "Notebook";
  if (pages.length === total && total > 0) return base;
  const range = formatPageRange(pages).replace(/, /g, ",");
  const noun = pages.length === 1 ? "page" : "pages";
  // A long scattered selection would make an unwieldy name.
  const label = range.length <= 40 ? `${noun} ${range}` : `${pages.length} pages`;
  return `${base} (${label})`;
}
