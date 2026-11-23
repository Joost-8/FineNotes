/**
 * The issue helper: what a new GitHub issue is likely about, for the
 * workflow in `.github/workflows/issue-helper.yml`. It reads the bug form's
 * answers, finds the guide entries and closed issues that match them, notes
 * which diagnostics are missing. No model: GitHub Models, the free one an
 * Action could use, was retired on 2026-07-30, and Joost keeps public
 * replies his own. The probe writes to its run summary and never comments.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { type GuideEntry, type Searchable, bestOf, rank, searchGuide } from "./finenotes-guide";
import { guideEntryUrl } from "./guide-markdown";

/** A form field's answer when it was left empty. */
const NO_RESPONSE = "_No response_";

/** The bug form's answers by their label: "### What is it about?\n\nPDFs" gives that pair. */
export function formAnswers(body: string): Map<string, string> {
  const answers = new Map<string, string>();
  const parts = body.replace(/\r\n/g, "\n").split(/^### /m);
  for (const part of parts.slice(1)) {
    const end = part.indexOf("\n");
    if (end < 0) continue;
    const label = part.slice(0, end).trim();
    let value = part.slice(end + 1).trim();
    if (value === NO_RESPONSE) value = "";
    // An empty Diagnostics box still has its code fence.
    if (/^```[a-z]*\s*```$/i.test(value)) value = "";
    answers.set(label, value);
  }
  return answers;
}

/** A new issue as the helper reads it. */
export interface NewIssue {
  title: string;
  body: string;
}

const AREA = "What is it about?";
const WHAT = "What happened, and what did you expect?";
const DEVICE = "Device";
const DIAGNOSTICS = "Diagnostics";
const FILES = "Recording, screenshots and files";

/** The words that say what went wrong: the title and the "What happened" answer, not the form's labels. */
export function problemText(issue: NewIssue): string {
  const answers = formAnswers(issue.body);
  const what = answers.get(WHAT);
  return what === undefined ? `${issue.title}\n${issue.body}` : `${issue.title}\n${what}`;
}

/** A guide entry that may answer the issue, with its page on GitHub. */
export interface GuideMatch {
  id: string;
  title: string;
  url: string;
  what: string;
  where: string;
}

/** Entries that only say where to report: the reporter has found that already. */
const ABOUT_REPORTING = new Set(["reportBug"]);

/**
 * The guide entries the issue's own words find, best first: the title on its
 * own first (a short summary the search matches well), then the title with
 * what happened. A long description searched whole fails the search's rule
 * that half of a question must be answered: #297's did.
 */
export function guideMatches(
  issue: NewIssue,
  limit = 3,
  search: (query: string, limit: number) => GuideEntry[] = searchGuide,
): GuideMatch[] {
  const found = new Map<string, GuideEntry>();
  for (const query of [issue.title, problemText(issue)]) {
    for (const entry of search(query, limit + ABOUT_REPORTING.size)) {
      if (!ABOUT_REPORTING.has(entry.id) && !found.has(entry.id)) found.set(entry.id, entry);
    }
  }
  return [...found.values()].slice(0, limit).map((entry) => ({
    id: entry.id,
    title: entry.title,
    url: guideEntryUrl(entry),
    what: entry.what,
    where: entry.where,
  }));
}

/** An earlier issue, as the similar-issue search reads it. */
export interface EarlierIssue {
  number: number;
  title: string;
  /** Closed issues are the likely answers; open ones the likely duplicates. */
  closed: boolean;
}

/**
 * Earlier issues whose titles say much the same, best first: the guide's own
 * search over their titles, so a typo or a reporter's padding words change
 * nothing.
 */
export function similarIssues(
  issue: NewIssue,
  earlier: readonly EarlierIssue[],
  limit = 2,
): EarlierIssue[] {
  const items: Searchable[] = earlier.map((other) => ({ title: other.title, words: "", body: "" }));
  return bestOf(rank(issue.title, items), limit).map((at) => earlier[at]);
}

/** Areas of the bug form where a recording or diagnostics tell most. */
const INK_AREAS = [
  "Writing, erasing or how the ink looks",
  "Shapes snapping (or not)",
  "Scrolling, zooming or the page jumping",
];

/**
 * What the form asks for and the issue does not have, as short notes for the
 * draft: a recording for ink and scrolling problems, the device, the shape
 * diagnostics for snapping.
 */
export function missingDiagnostics(issue: NewIssue): string[] {
  const answers = formAnswers(issue.body);
  if (answers.size === 0) return [];
  const missing: string[] = [];
  const area = answers.get(AREA) ?? "";
  const files = answers.get(FILES) ?? "";
  const diagnostics = answers.get(DIAGNOSTICS) ?? "";
  if (INK_AREAS.includes(area) && files === "") {
    missing.push("a screen recording with the input debug overlay on");
  }
  if (area === "Shapes snapping (or not)" && diagnostics === "") {
    missing.push("the output of Copy shape diagnostics");
  }
  if ((answers.get(DEVICE) ?? "") === "") missing.push("the device");
  return missing;
}

/**
 * What the helper found, as the Markdown it writes: three short lines a
 * reader takes in at a glance. Links only to the guide and this repo.
 */
export function summaryMarkdown(
  number: number,
  issue: NewIssue,
  matches: readonly GuideMatch[],
  similar: readonly EarlierIssue[],
  missing: readonly string[],
): string {
  const guide = matches.length
    ? matches.map((m) => "[" + m.title + "](" + m.url + ")").join(" · ")
    : "nothing";
  const earlier = similar.length
    ? similar
        .map((s) => "#" + s.number + " " + s.title + " (" + (s.closed ? "closed" : "open") + ")")
        .join(" · ")
    : "nothing";
  const gaps = missing.length ? missing.join("; ") : "nothing";
  return [
    "## #" + number + " " + issue.title,
    "",
    "**Guide:** " + guide,
    "**Similar:** " + earlier,
    "**Missing:** " + gaps,
    "",
  ].join("\n");
}
