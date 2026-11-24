/**
 * The guide as a wiki: the Markdown pages in `guide/` are where FineNotes'
 * guide is read, audited and edited; `npm run guide` turns them into
 * `finenotes-guide-data.ts`, which Ask AI searches. A test fails when the
 * two disagree, so an edit to a page cannot be forgotten.
 *
 * A page is a `# Title`, an intro, a `<!-- area: … -->` line, then one
 * `### ` section per entry:
 *
 *     ### Pen tool
 *
 *     - **Id:** penTool
 *     - **What:** Picks the pen.
 *     - **Where:** Toolbar › Pen (keys P or W).
 *     - **Notes:** …            (optional)
 *     - **Words:** pen, write, ink
 *     - **Seen as:** pen draws nothing, lines too thin   (optional: a bug report's words)
 *     - **Settings:** `pressureWidth`, `pencilTilt`   (optional)
 *     - **Commands:** `zoom-in`                       (optional)
 *     - **Tip:** `penOrder`                           (optional)
 *
 * Also the tips page (`guide/tips.md`), generated whole from the feature
 * index, so every tip and its words can be audited beside the guide.
 *
 * Pure: no DOM, no Obsidian, no file access.
 */

import type { GuideArea, GuideEntry } from "./finenotes-guide";

export interface GuidePage {
  area: GuideArea;
  /** The page's file in `guide/`. */
  file: string;
  title: string;
}

/** The guide's pages, in reading order. */
export const GUIDE_PAGES: readonly GuidePage[] = [
  { area: "start", file: "01-start.md", title: "Start here" },
  { area: "settings", file: "02-settings.md", title: "Settings" },
  { area: "toolbar", file: "03-toolbar.md", title: "The toolbar" },
  { area: "page", file: "04-on-the-page.md", title: "On the page" },
  { area: "notebooks", file: "05-notebooks.md", title: "Notebooks, pages, Home, PDF and files" },
  { area: "ai", file: "06-ai-recordings-maths.md", title: "AI, recordings and maths" },
];

const AREAS = new Set<string>(GUIDE_PAGES.map((page) => page.area));

/** Where the guide's pages are read on GitHub. */
const GUIDE_URL = "https://github.com/Joost-8/FineNotes/blob/main/guide";

/**
 * The anchor GitHub gives a heading: lower case, punctuation dropped,
 * spaces as hyphens ("Simple look (hide Obsidian's bars)" →
 * "simple-look-hide-obsidians-bars").
 */
export function headingAnchor(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** An entry's place in the wiki on GitHub: its page, at its heading. */
export function guideEntryUrl(entry: Pick<GuideEntry, "area" | "title">): string {
  const page = GUIDE_PAGES.find((candidate) => candidate.area === entry.area) ?? GUIDE_PAGES[0];
  return `${GUIDE_URL}/${page.file}#${headingAnchor(entry.title)}`;
}

/** What each page says under its title. */
const INTRO: Readonly<Record<GuideArea, string>> = {
  start:
    "What FineNotes is, and what Ask AI should say about the things people ask first: devices, sync, setting up AI, where to report a bug.",
  settings: "Every row of FineNotes' settings tab, section by section, as it is on screen.",
  toolbar: "Every button on the bar, its options pill, the ⋯ menu and Customize toolbar.",
  page: "Gestures with the pen, fingers and keys; the lasso and the selection bar; text, shapes, tables, pictures and the tools that act on the page.",
  notebooks:
    "Making notebooks, Home (the library), the page sidebar, templates and paper, boards, Markdown, PDF, export and import.",
  ai: "Ask AI, reading handwriting, recordings and transcription, the calculator, graphs and handwritten maths.",
};

/** A field's label on the page, in the order it is written. */
const FIELDS = [
  ["id", "Id"],
  ["what", "What"],
  ["where", "Where"],
  ["notes", "Notes"],
  ["words", "Words"],
  ["seen", "Seen as"],
  ["settings", "Settings"],
  ["commands", "Commands"],
  ["feature", "Tip"],
] as const;

type Field = (typeof FIELDS)[number][0];

const FIELD_OF: ReadonlyMap<string, Field> = new Map(
  FIELDS.map(([field, label]) => [label.toLowerCase(), field]),
);

/** A problem in a page, with its line, so `npm run guide` can say where. */
export class GuidePageError extends Error {}

/** `a`, `b` from "`a`, `b`": the names in a list, code marks dropped. */
function listOf(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().replace(/^`|`$/g, ""))
    .filter((item) => item !== "");
}

/** The entries of one page, in its order. */
export function parseGuidePage(markdown: string, file = "page"): GuideEntry[] {
  const lines = markdown.split(/\r?\n/);
  const areaLine = lines.findIndex((line) => /^<!-- area: [a-z]+ -->$/.test(line.trim()));
  if (areaLine < 0) throw new GuidePageError(`${file}: no "<!-- area: … -->" line.`);
  const area = /area: ([a-z]+)/.exec(lines[areaLine])?.[1] ?? "";
  if (!AREAS.has(area)) throw new GuidePageError(`${file}: unknown area "${area}".`);

  const entries: GuideEntry[] = [];
  let title: string | null = null;
  let fields = new Map<Field, string>();
  let at = 0;
  const finish = (): void => {
    if (title === null) return;
    for (const needed of ["id", "what", "where", "words"] as const) {
      if (!fields.get(needed)) {
        throw new GuidePageError(`${file}:${at + 1}: "${title}" has no ${needed}.`);
      }
    }
    const entry: GuideEntry = {
      id: fields.get("id") ?? "",
      area: area as GuideArea,
      title,
      words: fields.get("words") ?? "",
      what: fields.get("what") ?? "",
      where: fields.get("where") ?? "",
    };
    const notes = fields.get("notes");
    if (notes) entry.notes = notes;
    const seen = fields.get("seen");
    if (seen) entry.seen = seen;
    const settings = listOf(fields.get("settings") ?? "");
    if (settings.length > 0) entry.settings = settings;
    const commands = listOf(fields.get("commands") ?? "");
    if (commands.length > 0) entry.commands = commands;
    const feature = listOf(fields.get("feature") ?? "")[0];
    if (feature) entry.feature = feature;
    entries.push(entry);
  };

  lines.forEach((raw, index) => {
    if (index <= areaLine) return;
    const line = raw.trimEnd();
    const heading = /^### (.+)$/.exec(line);
    if (heading) {
      finish();
      title = heading[1].trim();
      fields = new Map();
      at = index;
      return;
    }
    const field = /^- \*\*([A-Za-z][A-Za-z ]*):\*\* ?(.*)$/.exec(line);
    if (field && title !== null) {
      const name = FIELD_OF.get(field[1].toLowerCase());
      if (!name) throw new GuidePageError(`${file}:${index + 1}: unknown field "${field[1]}".`);
      const value = field[2].trim();
      fields.set(name, name === "id" ? value.replace(/^`|`$/g, "") : value);
      return;
    }
    // A wrapped field goes on in an indented line.
    const more = /^ {2,}(\S.*)$/.exec(line);
    if (more && title !== null && fields.size > 0) {
      const last = [...fields.keys()].pop();
      if (last) fields.set(last, `${fields.get(last)} ${more[1].trim()}`);
    }
  });
  finish();
  return entries;
}

const code = (names: readonly string[]): string => names.map((name) => `\`${name}\``).join(", ");

/** One page of the wiki, from its entries. */
export function formatGuidePage(page: GuidePage, entries: readonly GuideEntry[]): string {
  const out = [
    `# ${page.title}`,
    "",
    INTRO[page.area],
    "",
    "Part of FineNotes' guide (see `README.md` here): what Ask AI looks up to answer questions about the app. Edit an entry, then run `npm run guide`.",
    "",
    `<!-- area: ${page.area} -->`,
  ];
  for (const entry of entries) {
    out.push("", `### ${entry.title}`, "");
    out.push(`- **Id:** \`${entry.id}\``);
    out.push(`- **What:** ${entry.what}`);
    out.push(`- **Where:** ${entry.where}`);
    if (entry.notes) out.push(`- **Notes:** ${entry.notes}`);
    out.push(`- **Words:** ${entry.words}`);
    if (entry.seen) out.push(`- **Seen as:** ${entry.seen}`);
    if (entry.settings?.length) out.push(`- **Settings:** ${code(entry.settings)}`);
    if (entry.commands?.length) out.push(`- **Commands:** ${code(entry.commands)}`);
    if (entry.feature) out.push(`- **Tip:** \`${entry.feature}\``);
  }
  return `${out.join("\n")}\n`;
}

/** `finenotes-guide-data.ts` for the entries of every page, before Prettier. */
export function formatGuideData(entries: readonly GuideEntry[]): string {
  const body = entries.map((entry) => `  ${JSON.stringify(entry)},`).join("\n");
  return [
    "/**",
    " * The entries of FineNotes' guide (`finenotes-guide.ts`), English only.",
    " *",
    " * GENERATED from the wiki in `guide/` by `npm run guide`: edit the pages",
    " * there, not this file. `tests/model/guide-markdown.test.ts` fails when",
    " * the two disagree.",
    " */",
    "",
    'import type { GuideEntry } from "./finenotes-guide";',
    "",
    "export const GUIDE_ENTRIES: readonly GuideEntry[] = [",
    body,
    "];",
    "",
  ].join("\n");
}

/** A tip or switch of the feature index, as the tips page lists it. */
export interface TipRow {
  id: string;
  collection: string;
  title: string;
  body: string;
  /** How it is reached: its switch or command; empty for a gesture or a picture. */
  reach: string;
  words: string;
}

/** `guide/tips.md`: every tip and switch of the feature index, with the guide entries that link it. */
export function formatTipsPage(rows: readonly TipRow[], guide: readonly GuideEntry[]): string {
  const linked = new Map<string, string[]>();
  for (const entry of guide) {
    if (!entry.feature) continue;
    linked.set(entry.feature, [...(linked.get(entry.feature) ?? []), entry.id]);
  }
  const out = [
    "# Tips and switches",
    "",
    "Every tip in Tips and every switch the feature search finds, as Ask AI reads them, with the guide entries that link to each. GENERATED by `npm run guide` from `src/model/tips.ts`, `src/model/feature-index.ts` and the English texts: change those, not this page.",
    "",
    "A tip no guide entry links is still found by `finenotes_help`, by its own words.",
  ];
  let collection = "";
  for (const row of rows) {
    if (row.collection !== collection) {
      collection = row.collection;
      out.push("", `## ${collection}`);
    }
    out.push("", `### ${row.title}`, "");
    out.push(`- **Id:** \`${row.id}\``);
    out.push(`- **What:** ${row.body}`);
    if (row.reach) out.push(`- **Reach:** ${row.reach}`);
    if (row.words) out.push(`- **Words:** ${row.words}`);
    const from = linked.get(row.id);
    out.push(`- **In the guide:** ${from ? code(from) : "none"}`);
  }
  return `${out.join("\n")}\n`;
}
