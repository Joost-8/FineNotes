/**
 * The guide's search page on GitHub Pages (`scripts/guide-site.mjs` builds
 * it): one search box over the guide, run by the same `searchGuide` as the
 * app's Tips and Ask AI, so the same words find the same answer everywhere.
 * This module turns a search into the page's HTML; the page's script only
 * reads the box and writes the result in.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { type GuideEntry, GUIDE, searchGuide } from "./finenotes-guide";
import { GUIDE_PAGES, guideEntryUrl } from "./guide-markdown";

/** Text made safe to put between tags or in an attribute. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Where to report when the guide has no answer. */
const BUG_FORM = "https://github.com/Joost-8/FineNotes/issues/new?template=bug_report.yml";

/** One entry as a result: its name, what it does, where it is, and its page. */
export function resultHtml(entry: GuideEntry): string {
  const notes = entry.notes ? `<p class="notes">${escapeHtml(entry.notes)}</p>` : "";
  return [
    `<article class="hit">`,
    `<h2><a href="${escapeHtml(guideEntryUrl(entry))}">${escapeHtml(entry.title)}</a></h2>`,
    `<p>${escapeHtml(entry.what)}</p>`,
    `<p class="where">${escapeHtml(entry.where)}</p>`,
    notes,
    `</article>`,
  ].join("");
}

/** The page's results for `query`: what the guide says, then the way to report. */
export function resultsHtml(query: string, entries: readonly GuideEntry[] = GUIDE): string {
  const trimmed = query.trim();
  if (trimmed === "") return pagesHtml();
  const hits = searchGuide(trimmed, 6, entries);
  const report = `<p class="report">Not it? <a href="${escapeHtml(
    `${BUG_FORM}&title=${encodeURIComponent(trimmed.slice(0, 200))}`,
  )}">Report it on GitHub</a></p>`;
  if (hits.length === 0) return `<p class="none">The guide has nothing on that.</p>${report}`;
  return `${hits.map(resultHtml).join("")}${report}`;
}

/** With an empty box: the guide's pages, to read in order. */
export function pagesHtml(): string {
  const items = GUIDE_PAGES.map(
    (page) =>
      `<li><a href="https://github.com/Joost-8/FineNotes/blob/main/guide/${page.file}">${escapeHtml(page.title)}</a></li>`,
  ).join("");
  return `<ul class="pages">${items}</ul>`;
}

/** The query a link carries (`?q=left+panel+gone`), so the form and the app can open a search. */
export function queryOf(search: string): string {
  return new URLSearchParams(search).get("q") ?? "";
}

/** The number of entries, for the page's placeholder. */
export const GUIDE_SIZE = GUIDE.length;
