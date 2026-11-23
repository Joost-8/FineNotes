/**
 * FineNotes' guide: what the app can do, where each thing is and how to
 * reach it, written for Ask AI to look up (`finenotes_help`). It answers
 * "how do I…?", "can FineNotes…?" and "where is…?" from entries traced to
 * the code that implements them, not from the changelog.
 *
 * The entries are in `finenotes-guide-data.ts`. Each names the settings
 * keys and command ids it is about; `tests/model/finenotes-guide.test.ts`
 * fails when one of those no longer exists, so the guide cannot quietly
 * drift from the app. English only: what goes to the AI is never translated.
 *
 * Pure: no DOM, no Obsidian, no network.
 */

import { GUIDE_ENTRIES } from "./finenotes-guide-data";

/** Where in the app an entry lives, for reading the guide in order. */
export type GuideArea = "start" | "toolbar" | "page" | "notebooks" | "ai" | "settings";

export interface GuideEntry {
  /** Unique, camelCase. */
  id: string;
  area: GuideArea;
  /** What a user would call it. */
  title: string;
  /** Words and phrases people use for it, comma-separated. */
  words: string;
  /**
   * What people see when this is the answer to a problem, in a bug report's
   * words ("left panel disappears"), comma-separated. Searched like `words`,
   * so a report finds the setting that explains it.
   */
  seen?: string;
  /** What it does, in a few plain sentences. */
  what: string;
  /** How to reach it: the path through the UI, by its on-screen names. */
  where: string;
  /** Platform limits, conditions and caveats, when there are any. */
  notes?: string;
  /** Keys of the plugin's settings it is about (`penGestures.<name>` for a pen gesture). */
  settings?: readonly string[];
  /** Ids of this plugin's commands that run it, without the `finenotes:` prefix. */
  commands?: readonly string[];
  /** The feature index's id (a tip or a switch), whose link opens it in FineNotes. */
  feature?: string;
}

export const GUIDE: readonly GuideEntry[] = GUIDE_ENTRIES;

const BY_ID: ReadonlyMap<string, GuideEntry> = new Map(GUIDE.map((entry) => [entry.id, entry]));

/** The entry called `id`, or null. */
export function guideEntry(id: string): GuideEntry | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Where each settings key is changed: "Settings › Writing › Pressure-sensitive
 * pens", from the guide's own settings rows. A key no row writes is not here.
 */
export const SETTING_PLACES: ReadonlyMap<string, string> = (() => {
  const places = new Map<string, string>();
  for (const entry of GUIDE) {
    if (entry.area !== "settings") continue;
    for (const key of entry.settings ?? []) {
      if (!places.has(key)) places.set(key, entry.where);
    }
  }
  return places;
})();

/** Each command's name in the command palette, in English, by id. */
export const COMMAND_NAMES: Readonly<Record<string, string>> = {
  "create-handwriting-note": "New notebook or board…",
  "create-notebook-with-last-settings": "Create notebook with last settings",
  "insert-new-notebook": "Insert a new notebook here",
  "open-library": "Open the notebook library",
  "show-notebooks-sidebar": "Show notebooks in the sidebar",
  "show-tips": "Show the tips",
  "report-bug": "Report a bug",
  "show-whats-new": "Show what's new on Home",
  "next-look-style": "Look: next style",
  "next-look-palette": "Look: next colours",
  "toggle-simple-look": "Simple look: hide or show Obsidian's tabs, sidebars and menus",
  "show-welcome": "Show the welcome",
  "create-notebook-from-pdf": "New notebook from a PDF in the vault…",
  "convert-to-notebook": "Convert single page to notebook",
  "scan-document": "Scan document into this notebook",
  "import-pdf": "Import PDF…",
  "import-vault-pdf": "Import PDF from vault…",
  "search-notebook": "Search this notebook…",
  "customize-toolbar": "Customize toolbar",
  "copy-page-link": "Copy link to current page",
  "copy-highlighted-text": "Copy highlighted text on this page",
  "turn-selection-into-text": "Turn selection into text",
  "export-pdf": "Export…",
  "save-as-template": "Save notebook as template…",
  "save-page-as-template": "Save page as template",
  "new-from-template": "New notebook from template…",
  "template-gallery": "Browse template gallery…",
  "share-template": "Share a template with the community…",
  "toggle-canvas-markdown-view": "Switch between notebook and Markdown view",
  "toggle-text-layer": "Show or hide the text layer",
  "recognize-handwriting": "Transcribe this notebook's handwriting",
  "write-handwriting-practice": "Write a handwriting practice set",
  "write-symbol-practice": "Write the symbol practice sheet (digits, operators, signs)",
  "learn-handwriting": "Learn my handwriting from the practice files",
  "show-keyboard-shortcuts": "Show keyboard shortcuts",
  "read-handwriting-on-device": "Show this page read on this device",
  "reread-scanned-pages": "Re-read scanned pages of this PDF",
  "fit-reset-view": "Fit the page and go to the top",
  "fit-board-drawing": "Fit the whole drawing on screen",
  "add-board": "Add board",
  "go-to-board": "Go to board",
  "zoom-in": "Zoom in",
  "zoom-out": "Zoom out",
  "toggle-only-stylus-mode": "Turn Stylus-only mode on or off",
  "toggle-input-debug-overlay": "Show or hide the input debug overlay",
  "copy-shape-diagnostics": "Copy shape diagnostics",
  "view-changelog": "Show the changelog",
};

// --- Search ------------------------------------------------------------------

/** Words of a text, lower case, accents folded. */
export function guideWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/** Words too common to tell entries apart. */
const STOP = new Set(
  (
    "a about an and any are as at be by can could do does doing for from get got have how i if in " +
    "into is it its me my of on or please should so that the then there this to use using want was " +
    "way what when where which while who why will with without would you your finenotes app make makes put just also some " +
    // A bug report's padding: says how bad, not what.
    "latest completely totally suddenly urgent really anymore still since after now"
  ).split(" "),
);

/**
 * Words that mean the same thing to someone asking. A question's word that
 * is in a group also looks for the group's other words, at half weight.
 * British and American spellings, competitors' names and casual words.
 */
const SYNONYM_GROUPS: readonly string[] = [
  "calculation calculate calculator calc maths math sum sums arithmetic compute",
  "erase eraser rubber delete remove rub",
  "lasso select selection selecting pick",
  "colour color colours colors",
  "dark night black",
  "picture pictures image images photo photos",
  "record recording recordings audio voice microphone mic sound dictaphone",
  "transcribe transcription transcript speech",
  "handwriting writing ink",
  "recognize recognise recognition ocr read reading",
  "export share print save",
  "import goodnotes notability noteful remarkable supernote saber xournal",
  "page pages sheet",
  "notebook notebooks book",
  "library home bookshelf shelf",
  "template templates paper background lined grid dotted",
  "shape shapes circle rectangle square line arrow triangle",
  "toolbar bar tools buttons",
  "hide remove off disable",
  "move drag",
  "zoom magnify magnifier enlarge",
  "undo back mistake",
  "text type typing keyboard textbox",
  "ai chatgpt claude gemini openai gpt llm assistant chat",
  "key apikey token",
  "graph plot function chart",
  "equation formula latex",
  "palm wrist hand",
  "pencil stylus pen",
  "finger fingers touch",
  "link links linking",
  "bookmark bookmarks contents outline",
  "sticker stickers",
  "board canvas whiteboard infinite endless",
  "search find look",
  "sync icloud devices device",
  "settings preferences options",
  "shortcut shortcuts hotkey hotkeys keys",
  "highlight highlighter marker",
  "copy paste duplicate",
  "reorder order rearrange",
  "folder folders",
  "pdf pdfs document",
  "laser pointer present presentation",
];

const SYNONYMS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    const words = group.split(" ");
    for (const word of words) {
      const others = words.filter((other) => other !== word);
      map.set(word, [...(map.get(word) ?? []), ...others]);
    }
  }
  return map;
})();

/** Endings dropped before two words are compared: "calculation" and "calculate" meet at "calcul". */
const ENDINGS = [
  "ations",
  "ation",
  "ions",
  "ings",
  "ion",
  "ing",
  "ers",
  "ed",
  "es",
  "er",
  "ly",
  "s",
  "e",
];

/** A word without its ending, for comparing words of one family. */
export function stem(word: string): string {
  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 4) {
      return word.slice(0, -ending.length).replace(/at$/, "");
    }
  }
  return word;
}

/**
 * Whether two words are at most `limit` edits apart, a swap of two
 * neighbouring letters counting as one ("compeltely" for "completely").
 */
export function withinEdits(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  // Optimal string alignment: three rows of the distance table.
  let before: number[] = [];
  let last = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(last[j] + 1, row[j - 1] + 1, last[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, before[j - 2] + 1);
      }
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > limit) return false;
    before = last;
    last = row;
  }
  return last[b.length] <= limit;
}

/** A word with each run of one letter made single: "dissapears" and "disappears" both "disapears". */
function single(word: string): string {
  return word.replace(/(.)\1+/g, "$1");
}

/**
 * The typos a word may carry and still be meant: none under six letters
 * (too many short words are one letter apart), one up to eight, two beyond.
 * Both words must be long, and they must start alike. Doubled letters are
 * not counted, the most common misspelling ("dissapers").
 */
function typoLimit(term: string, word: string): number {
  const shorter = Math.min(term.length, word.length);
  if (shorter < 6 || term[0] !== word[0]) return 0;
  return shorter <= 8 ? 1 : 2;
}

/**
 * Whether a question's term means a word: the same word, the word with a
 * short ending ("boxes" for "box"), one family ("erasing" for "erase"), or
 * the word with a typo or two ("dissapears" for "disappears").
 * A short term is not the start of any longer word: "free" is not "freehand".
 */
function means(term: string, word: string): boolean {
  if (term === word) return true;
  if (term.length >= 3 && word.startsWith(term) && word.length - term.length <= 3) return true;
  if (word.length >= 3 && term.startsWith(word) && term.length - word.length <= 3) return true;
  const root = stem(term);
  if (root.length >= 4 && root === stem(word)) return true;
  const typos = typoLimit(term, word);
  return typos > 0 && withinEdits(single(term), single(word), typos);
}

/** A question's terms: its words without the common ones. */
export function questionTerms(question: string): string[] {
  return [...new Set(guideWords(question).filter((word) => word.length >= 2 && !STOP.has(word)))];
}

/** The synonyms of a term: those of the group word it means. */
function synonymsOf(term: string): readonly string[] {
  const direct = SYNONYMS.get(term);
  if (direct) return direct;
  for (const [word, others] of SYNONYMS) {
    if (means(term, word)) return others;
  }
  return [];
}

/** What a searchable thing offers: its title, its people's words, then the rest. */
export interface Searchable {
  title: string;
  words: string;
  body: string;
}

const TITLE_WEIGHT = 4;
const WORDS_WEIGHT = 3;
const BODY_WEIGHT = 1;

/** A searchable's words, by field, best field first. */
type Fields = readonly (readonly [readonly string[], number])[];

function fieldsOf(item: Searchable): Fields {
  return [
    [guideWords(item.title), TITLE_WEIGHT],
    [guideWords(item.words), WORDS_WEIGHT],
    [guideWords(item.body), BODY_WEIGHT],
  ];
}

/** The weight of the best field holding a word `term` means; 0 when none does. */
function bestField(fields: Fields, term: string): number {
  for (const [words, weight] of fields) {
    if (words.some((word) => means(term, word))) return weight;
  }
  return 0;
}

/**
 * How well each item answers the question, in the items' order; 0 for none
 * of it. A term counts by the best field it is in (a synonym at half) and by
 * how rare it is among the items, so "android" outweighs "work"; an item
 * that answers more of the question beats one that answers part of it well.
 */
export function rank(question: string, items: readonly Searchable[]): number[] {
  const terms = questionTerms(question);
  if (terms.length === 0) return items.map(() => 0);
  const all = items.map(fieldsOf);
  const rarity = terms.map((term) => {
    const holding = all.filter((fields) => bestField(fields, term) > 0).length;
    return Math.log(1 + items.length / (1 + holding));
  });
  return all.map((fields) => {
    let score = 0;
    let found = 0;
    terms.forEach((term, at) => {
      let points = bestField(fields, term);
      if (points === 0) {
        for (const other of synonymsOf(term))
          points = Math.max(points, bestField(fields, other) / 2);
      }
      if (points > 0) found++;
      score += points * rarity[at];
    });
    // Of a question of three words or more, an item must hold at least half.
    if (found === 0 || (terms.length >= 3 && found * 2 < terms.length)) return 0;
    return score * (found / terms.length);
  });
}

/** Below this share of the best score, an item is noise beside it. */
const NEAR_BEST = 0.35;

/**
 * The places of the best items, best first, at most `limit`: those that
 * scored, and not far below the best (ties keep the items' order).
 */
export function bestOf(scores: readonly number[], limit: number): number[] {
  const top = Math.max(0, ...scores);
  if (top === 0) return [];
  return scores
    .map((score, at) => ({ score, at }))
    .filter((item) => item.score >= top * NEAR_BEST)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, limit)
    .map((item) => item.at);
}

/** What the scorer reads of a guide entry. */
export function searchableOf(entry: GuideEntry): Searchable {
  return {
    title: entry.title,
    words: entry.seen ? `${entry.words}, ${entry.seen}` : entry.words,
    body: `${entry.what} ${entry.where}`,
  };
}

/** The guide entries a question means, best first. */
export function searchGuide(
  question: string,
  limit = 6,
  entries: readonly GuideEntry[] = GUIDE,
): GuideEntry[] {
  return bestOf(rank(question, entries.map(searchableOf)), limit).map((at) => entries[at]);
}
