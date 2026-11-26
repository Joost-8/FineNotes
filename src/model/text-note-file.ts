/**
 * A text note on disk: ordinary Markdown, one block a line, so the file
 * reads (and can be edited) in any Markdown editor and Obsidian's search,
 * links and sync treat it as the note it is. PURE.
 *
 * ```
 * ---
 * finenotes-note: 1
 * ---
 * # Title
 * Body text with **bold**, *italic*, <u>underline</u> and ~~strike~~.
 * * a bullet
 * 	* an indented one (a tab a level)
 * - a dashed item
 * 1. a numbered item
 * A. a lettered item (a. in small letters)
 * - [x] a ticked checklist item
 * > a quote
 * ![[Pictures/photo.jpg|360]]
 * %%finenotes-ink
 * v2:<the strokes, as a notebook page stores them>
 * %%
 * %%finenotes-graph
 * {"expressions":["y = x^2"],"xMin":-10, …}
 * %%
 * ```
 *
 * - A line is a block; an empty line is an empty paragraph. One empty line
 *   written after a list item or quote, before body text or a picture, is only a
 *   separator (Markdown would otherwise read that text into the list), and
 *   reading drops exactly one empty line there.
 * - Monostyled lines that follow each other share one code fence.
 * - A handwriting section is an Obsidian comment (`%%`), so reading view
 *   hides it. Its payload is a one-page notebook document
 *   ({@link INK_WIDTH} wide, the section's height), written and read by the
 *   notebook's own serializer: every stroke field a notebook keeps, a
 *   section keeps. What the device read the ink as follows the opener on
 *   its line, as JSON (`%%finenotes-ink {"read":"…","of":"<ink hash>"}`),
 *   so search finds handwriting; older versions read such a section too.
 * - A picture is an embed on a line of its own; the number is its width.
 * - A recording is one too, `![[Recordings/x.m4a|1:23]]`: the time is its
 *   length ({@link readAudioEmbed}).
 * - Text that would read as one of the above is written with a backslash.
 * - A section this version cannot read is kept as it is ({@link RawBlock}).
 */

import { emptyDocument } from "./document";
import { encodeTable, readTable, tableStartsAt } from "./note-table";
import { makeGraph } from "./graph-element";
import { audioEmbedLine, readAudioEmbed } from "./note-audio-embed";
import { decodeDocument, encodeDocument } from "./serialize";
import {
  ANY_HIGHLIGHT,
  BOLD,
  HIGHLIGHT,
  HIGHLIGHTS,
  INK_MIN_HEIGHT,
  INK_PAPERS,
  INK_WIDTH,
  ITALIC,
  MAX_INDENT,
  STRIKE,
  UNDERLINE,
  clampInkHeight,
  emptyNote,
  isList,
  listMarkers,
  type InkPaper,
  normalizeRuns,
  textBlock,
  type IdSource,
  type InkBlock,
  type Marks,
  type NoteBlock,
  type TextBlock,
  type TextNote,
  type TextRun,
  type GraphBlock,
} from "./text-note";

/** The file name suffix of a text note: `Title.note.md`. */
export const TEXT_NOTE_FILE_SUFFIX = ".note.md";

/** The frontmatter key a new text note carries (its value is the format's version). */
export const TEXT_NOTE_FLAG = "finenotes-note";

/** Opens a handwriting section; a line that is only `%%` closes it. */
export const INK_OPEN = "%%finenotes-ink";
const INK_CLOSE = "%%";

/**
 * Opens a graph: the calculator's graph as one line of JSON, then a line
 * that is only `%%`. A comment like a handwriting section, so reading view
 * hides it; the JSON names its expressions, so another editor shows what
 * is plotted.
 */
export const GRAPH_OPEN = "%%finenotes-graph";
const BACKSLASH = String.fromCharCode(92);

/** Whether a file name is a text note's. */
export function isTextNoteName(name: string): boolean {
  return name.toLowerCase().endsWith(TEXT_NOTE_FILE_SUFFIX);
}

/** The longest file name a title is turned into, in characters. */
const MAX_TITLE_NAME = 80;

/**
 * A note's title as a file name (without the suffix): the characters a file
 * name or an Obsidian link cannot hold are dropped. Empty when nothing is left.
 */
export function titleFileName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_TITLE_NAME)
    .trim();
  return clean.replace(/[. ]+$/, "");
}

/**
 * Whether a file still has the name a new note is given (`base`, or `base 2`,
 * `base 3`, …): only then does the note's title name the file.
 */
export function hasDefaultName(name: string, base: string): boolean {
  const stem = stripTextNoteSuffix(name);
  if (stem === base) return true;
  return stem.startsWith(`${base} `) && /^\d+$/.test(stem.slice(base.length + 1));
}

/** The first of `base`, `base 2`, `base 3`, … that `taken` does not refuse. */
export function freeNoteName(base: string, taken: (name: string) => boolean): string {
  for (let n = 1; ; n++) {
    const name = `${n === 1 ? base : `${base} ${n}`}${TEXT_NOTE_FILE_SUFFIX}`;
    if (!taken(name)) return name;
  }
}

/** A text note's title as its file is named: the name without the suffix. */
export function stripTextNoteSuffix(name: string): string {
  return isTextNoteName(name) ? name.slice(0, -TEXT_NOTE_FILE_SUFFIX.length) : name;
}

// ---------------------------------------------------------------- inline

/** Marks in the order they open; they close in reverse. */
const MARK_ORDER: ReadonlyArray<[Marks, string, string]> = [
  [BOLD, "**", "**"],
  [ITALIC, "*", "*"],
  [STRIKE, "~~", "~~"],
  [UNDERLINE, "<u>", "</u>"],
  [HIGHLIGHT, "==", "=="],
  // Markdown has one highlight; the other colours are Obsidian-readable HTML.
  ...HIGHLIGHTS.filter((h) => h.mark !== HIGHLIGHT).map((h): [Marks, string, string] => [
    h.mark,
    `<mark class="fn-${h.name}">`,
    "</mark>",
  ]),
];

const PUNCTUATION = /[!-/:-@[-`{-~]/;

/** Text with every character Markdown (or the reader below) would act on escaped. */
function escapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1] ?? "";
    if (c === "\\") {
      // A backslash is only an escape before punctuation (and at the end of a line).
      out += next === "" || PUNCTUATION.test(next) ? "\\\\" : "\\";
    } else if (c === "*") {
      out += "\\*";
    } else if (c === "~") {
      out += "\\~";
    } else if (c === "=" && (next === "=" || text[i - 1] === "=")) {
      out += "\\=";
    } else if (c === "<" && /^<\/?(?:u>|mark[ >])/i.test(text.slice(i, i + 6))) {
      out += "\\<";
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Runs with marks only on stretches that start and end on a non-space:
 * `**bold **` is not bold in Markdown, so the spaces at a marked run's edges
 * are written unmarked.
 */
function tightRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (run.marks === 0) {
      out.push(run);
      continue;
    }
    const lead = /^\s*/.exec(run.text)?.[0] ?? "";
    const core = run.text.slice(lead.length).replace(/\s+$/, "");
    const trail = run.text.slice(lead.length + core.length);
    if (lead) out.push({ text: lead, marks: 0 });
    if (core) out.push({ text: core, marks: run.marks });
    if (trail) out.push({ text: trail, marks: 0 });
  }
  return normalizeRuns(out);
}

/** Runs as Markdown. */
export function encodeInline(runs: readonly TextRun[]): string {
  let out = "";
  /** The marks open now, outermost first: always in {@link MARK_ORDER}, so they nest one way. */
  const open: Marks[] = [];
  const reach = (marks: Marks): void => {
    const wanted = MARK_ORDER.filter(([mark]) => (marks & mark) !== 0);
    let shared = 0;
    while (shared < open.length && shared < wanted.length && open[shared] === wanted[shared][0]) {
      shared++;
    }
    // Close from the innermost out, down to what the next run still shares.
    while (open.length > shared) {
      const mark = open.pop();
      out += MARK_ORDER.find(([m]) => m === mark)?.[2] ?? "";
    }
    for (const [mark, opener] of wanted.slice(shared)) {
      out += opener;
      open.push(mark);
    }
  };
  for (const run of tightRuns(runs)) {
    reach(run.marks);
    out += escapeText(run.text);
  }
  reach(0);
  return out;
}

/** Whether `needle` occurs, unescaped, in `text` from `from` on. */
function later(text: string, needle: string, from: number): boolean {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text.startsWith(needle, i)) return true;
  }
  return false;
}

/** Markdown as runs: `**`, `*`, `~~`, `==`, `<u>` and backslash escapes; all else is text. */
export function decodeInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let marks: Marks = 0;
  let pending = "";
  const flush = (): void => {
    if (pending) runs.push({ text: pending, marks });
    pending = "";
  };
  const toggle = (mark: Marks): void => {
    flush();
    marks ^= mark;
  };
  const spaceAt = (index: number): boolean =>
    index < 0 || index >= text.length || /\s/.test(text[index]);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length && PUNCTUATION.test(text[i + 1])) {
      pending += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "*") {
      const double = text[i + 1] === "*";
      // A mark that is open closes first; one only opens when it closes later.
      if (double && (marks & BOLD) !== 0 && !spaceAt(i - 1)) {
        toggle(BOLD);
        i += 2;
        continue;
      }
      if ((marks & ITALIC) !== 0 && !spaceAt(i - 1)) {
        toggle(ITALIC);
        i += 1;
        continue;
      }
      if (double && (marks & BOLD) === 0 && !spaceAt(i + 2) && later(text, "**", i + 2)) {
        toggle(BOLD);
        i += 2;
        continue;
      }
      if (!double && (marks & ITALIC) === 0 && !spaceAt(i + 1) && later(text, "*", i + 1)) {
        toggle(ITALIC);
        i += 1;
        continue;
      }
    } else if (c === "~" && text[i + 1] === "~") {
      if ((marks & STRIKE) !== 0 || later(text, "~~", i + 2)) {
        toggle(STRIKE);
        i += 2;
        continue;
      }
    } else if (c === "=" && text[i + 1] === "=") {
      if ((marks & HIGHLIGHT) !== 0 || (!spaceAt(i + 2) && later(text, "==", i + 2))) {
        toggle(HIGHLIGHT);
        i += 2;
        continue;
      }
    } else if (c === "<") {
      const tag = text.slice(i, i + 4).toLowerCase();
      if (
        tag.startsWith("<u>") &&
        (marks & UNDERLINE) === 0 &&
        later(text.toLowerCase(), "</u>", i)
      ) {
        toggle(UNDERLINE);
        i += 3;
        continue;
      }
      if (tag === "</u>" && (marks & UNDERLINE) !== 0) {
        toggle(UNDERLINE);
        i += 4;
        continue;
      }
      const open = /^<mark(?: class="fn-([a-z]+)")?>/i.exec(text.slice(i, i + 32));
      if (open && (marks & ANY_HIGHLIGHT) === 0 && later(text.toLowerCase(), "</mark>", i)) {
        const tint = HIGHLIGHTS.find((h) => h.name === (open[1] ?? "yellow").toLowerCase());
        toggle(tint?.mark ?? HIGHLIGHT);
        i += open[0].length;
        continue;
      }
      if (text.slice(i, i + 7).toLowerCase() === "</mark>" && (marks & ANY_HIGHLIGHT) !== 0) {
        toggle(marks & ANY_HIGHLIGHT);
        i += 7;
        continue;
      }
    }
    pending += c;
    i++;
  }
  flush();
  return normalizeRuns(runs);
}

// ---------------------------------------------------------------- lines

/** A no-break space: an indented paragraph starts with four a level. */
const NBSP = String.fromCharCode(0xa0);
const INDENT_LEAD = new RegExp(`^(?:${NBSP}{4})+`);

function indentLead(indent: number | undefined): string {
  return NBSP.repeat(4 * Math.max(0, indent ?? 0));
}

/** A paragraph's indent read from its no-break spaces, and the text after them. */
function readIndent(text: string): { indent: number; rest: string } {
  const lead = INDENT_LEAD.exec(text)?.[0] ?? "";
  return { indent: Math.min(MAX_INDENT, lead.length / 4), rest: text.slice(lead.length) };
}

const HEADING = /^(#{1,6})(?: (.*)|$)/;
const LIST = /^([\t ]*)(?:([-*+])|(\d{1,9})[.)])(?: (.*)|$)/;
/** A lettered item: `A.` or `a.` (one letter; the view counts them). */
const LETTER = /^([\t ]*)([A-Za-z])[.)](?: (.*)|$)/;
const CHECK = /^\[([ xX])\](?: (.*)|$)/;
const QUOTE = /^>(?: ?(.*))$/;
const FENCE = /^(`{3,})(.*)$/;
const EMBED =
  /^!\[\[([^\]|\n]+?\.(?:png|jpe?g|gif|webp|svg|bmp|avif|heic))(?:\|(\d{1,5}))?\]\]\s*$/i;
const RULE = /^([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/** Body text that would read as something else gets a backslash where the marker is. */
function guardLine(line: string): string {
  if (HEADING.test(line) || QUOTE.test(line) || RULE.test(line)) return `\\${line}`;
  // A line of pipes could start a table.
  if (line.trimStart().startsWith("|")) {
    const lead = line.length - line.trimStart().length;
    return `${line.slice(0, lead)}\\${line.slice(lead)}`;
  }
  if (
    line.startsWith("```") ||
    line.startsWith(INK_OPEN) ||
    line.startsWith(GRAPH_OPEN) ||
    EMBED.test(line)
  ) {
    return `\\${line}`;
  }
  if (readAudioEmbed(line)) return `\\${line}`;
  const list = LIST.exec(line);
  if (list) {
    const lead = list[1].length;
    // A bullet escapes its marker; a number escapes the dot after it.
    if (list[2]) return `${line.slice(0, lead)}\\${line.slice(lead)}`;
    const dot = lead + list[3].length;
    return `${line.slice(0, dot)}\\${line.slice(dot)}`;
  }
  const letter = LETTER.exec(line);
  if (letter) {
    const dot = letter[1].length + 1;
    return `${line.slice(0, dot)}\\${line.slice(dot)}`;
  }
  return line;
}

/** A section's lines, kept by the block: a block never changes, and packing one is the slow part of a save. */
const packed = new WeakMap<InkBlock, string[]>();

function inkLines(block: InkBlock): string[] {
  let lines = packed.get(block);
  if (!lines) {
    lines = packInk(block);
    packed.set(block, lines);
  }
  return lines;
}

function packInk(block: InkBlock): string[] {
  const doc = emptyDocument(INK_WIDTH);
  const page = doc.pages[0];
  page.geometry = { width: INK_WIDTH, height: clampInkHeight(block.height) };
  if (block.paper && block.paper !== "blank") page.backdrop = { kind: block.paper };
  page.strokes = block.strokes.map((stroke) => ({ ...stroke, pts: stroke.pts.slice() }));
  return [inkOpener(block.reading), encodeDocument(doc), INK_CLOSE];
}

/** A `%` written as JSON's escape for it: `%%` in the line would end Obsidian's comment. */
const PERCENT_ESCAPE = `${String.fromCharCode(92)}u0025`;

/**
 * A section's first line. With a reading, the reading follows on the same
 * line as JSON (`%%finenotes-ink {"read":"…","of":"…"}`): still inside the
 * comment, and a version that knows no readings reads the section anyway,
 * since it only looks at what the line starts with.
 */
export function inkOpener(reading?: { text: string; of: string }): string {
  if (!reading || (reading.text === "" && reading.of === "")) return INK_OPEN;
  // Ink read as nothing (a drawing) keeps only its hash, so it is not read again at every open.
  const value = reading.text === "" ? { of: reading.of } : { read: reading.text, of: reading.of };
  return `${INK_OPEN} ${JSON.stringify(value).replace(/%/g, PERCENT_ESCAPE)}`;
}

/** The reading a section's first line carries, or null (none, or not understood). */
export function readingOfOpener(line: string): { text: string; of: string } | null {
  const rest = line.slice(INK_OPEN.length).trim();
  if (!rest.startsWith("{")) return null;
  try {
    const value = JSON.parse(rest) as { read?: unknown; of?: unknown } | null;
    const text = typeof value?.read === "string" ? value.read : "";
    const of = typeof value?.of === "string" ? value.of : "";
    if (text === "" && of === "") return null;
    return { text, of };
  } catch {
    return null;
  }
}

const HEADING_MARK: Partial<Record<TextBlock["kind"], string>> = {
  title: "#",
  heading: "##",
  subheading: "###",
};

/** A note's blocks as the lines of its Markdown body. */
export function encodeNote(note: TextNote): string {
  const lines: string[] = [];
  const blocks = note.blocks;
  const markers = listMarkers(blocks);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === "ink") {
      lines.push(...inkLines(block));
      continue;
    }
    if (block.type === "image") {
      const width = block.width !== undefined ? `|${Math.round(block.width)}` : "";
      lines.push(`![[${block.path}${width}]]`);
      continue;
    }
    if (block.type === "raw") {
      lines.push(block.text);
      continue;
    }
    if (block.type === "table") {
      // Markdown reads a line right above or below a table into it: an empty line keeps them apart.
      const before = blocks[i - 1];
      if (before?.type === "text") lines.push("");
      lines.push(...encodeTable(block));
      if (blocks[i + 1]?.type === "text") lines.push("");
      continue;
    }
    if (block.type === "graph") {
      lines.push(...graphLines(block));
      continue;
    }
    if (block.type === "audio") {
      lines.push(audioEmbedLine(block));
      continue;
    }
    const text = encodeInline(block.runs);
    const mark = HEADING_MARK[block.kind];
    if (mark) {
      lines.push(text ? `${mark} ${text}` : mark);
    } else if (block.kind === "mono") {
      // Every monostyled line that follows shares this fence.
      const run: string[] = [];
      let j = i;
      for (; j < blocks.length; j++) {
        const next = blocks[j];
        if (next.type !== "text" || next.kind !== "mono") break;
        run.push(next.runs.map((r) => r.text).join(""));
      }
      i = j - 1;
      const longest = run.reduce((n, line) => Math.max(n, /^`*/.exec(line)?.[0].length ?? 0), 0);
      const fence = "`".repeat(Math.max(3, longest + 1));
      lines.push(fence, ...run, fence);
    } else if (block.kind === "quote") {
      const lead = indentLead(block.indent);
      lines.push(text || lead ? `> ${lead}${text}` : ">");
    } else if (isList(block.kind)) {
      const depth = block.indent ?? 0;
      let marker = markers[i] ?? (block.kind === "bullet" ? "*" : "-");
      if (block.kind === "check") {
        marker = block.checked ? "- [x]" : "- [ ]";
      }
      const lead = "\t".repeat(depth);
      const item = text ? `${lead}${marker} ${text}` : `${lead}${marker}`;
      // "- - -" would read as a rule, not as a bullet holding "- -".
      lines.push(RULE.test(item) ? `${lead}${marker} \\${text}` : item);
    } else {
      lines.push(indentLead(block.indent) + guardLine(text));
    }
    // Body text or a picture right under a list or quote would be read into it.
    const next = blocks[i + 1];
    const current = blocks[i];
    if (
      current.type === "text" &&
      (isList(current.kind) || current.kind === "quote") &&
      ((next?.type === "text" && next.kind === "body") ||
        next?.type === "image" ||
        next?.type === "audio")
    ) {
      lines.push("");
    }
  }
  return lines.join("\n");
}

function readInk(
  payload: string,
  id: string,
  reading: { text: string; of: string } | null,
): InkBlock | null {
  try {
    const page = decodeDocument(payload, INK_WIDTH).pages[0];
    if (!page) return null;
    const kind: string = page.backdrop.kind;
    const paper = INK_PAPERS.find((p): p is InkPaper => p === kind && p !== "blank");
    return {
      type: "ink",
      id,
      height: clampInkHeight(page.geometry.height),
      strokes: page.strokes,
      ...(paper ? { paper } : {}),
      ...(reading ? { reading } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * A graph's lines. A `%` is written as its JSON escape (backslash, u0025):
 * two of them would end Obsidian's comment in the middle of the graph.
 */
function graphLines(block: GraphBlock): string[] {
  const json = JSON.stringify(block.spec).replace(/%/g, `${BACKSLASH}u0025`);
  return [GRAPH_OPEN, json, INK_CLOSE];
}

/** A graph's JSON as a block; null when it is not a graph the calculator can draw. */
function readGraph(payload: string, id: string): GraphBlock | null {
  try {
    const raw: unknown = JSON.parse(payload);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const graph = makeGraph({ id, x: 0, y: 0, spec: raw as GraphBlock["spec"] });
    if (graph.spec.expressions.length === 0) return null;
    return { type: "graph", id, spec: graph.spec };
  } catch {
    return null;
  }
}

export interface DecodeOptions {
  /**
   * Leave handwriting undecoded: each section is an empty one that keeps
   * only its reading. For searching many notes, where the strokes are not
   * needed and unpacking them is the slow part.
   */
  readingsOnly?: boolean;
}

/** A Markdown body as a note. Any text is a note: what is not understood is body text. */
export function decodeNote(body: string, newId: IdSource, options: DecodeOptions = {}): TextNote {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: NoteBlock[] = [];
  /** The last line read was a list item or quote: one empty line after it is a separator. */
  let afterList = false;
  /** The last line read ended a table: one empty line after it is a separator. */
  let afterTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const wasList = afterList;
    const wasTable = afterTable;
    afterList = false;
    afterTable = false;
    if (line === "" && wasTable && lines[i + 1] !== undefined) continue;
    // The empty line written above a table, under text, only separates them.
    if (line === "" && blocks[blocks.length - 1]?.type === "text" && tableStartsAt(lines, i + 1)) {
      continue;
    }
    if (tableStartsAt(lines, i)) {
      const table = readTable(lines, i, newId());
      blocks.push(table.block);
      i = table.end;
      afterTable = true;
      continue;
    }
    if (line === INK_OPEN || line.startsWith(`${INK_OPEN} `)) {
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== INK_CLOSE) end++;
      const id = newId();
      const reading = readingOfOpener(line);
      let ink: InkBlock | null = null;
      if (end < lines.length && options.readingsOnly) {
        ink = {
          type: "ink",
          id,
          height: INK_MIN_HEIGHT,
          strokes: [],
          ...(reading ? { reading } : {}),
        };
      } else if (end < lines.length) {
        ink = readInk(lines.slice(i + 1, end).join(""), id, reading);
      }
      blocks.push(
        ink ?? {
          type: "raw",
          id,
          text: lines.slice(i, Math.min(end + 1, lines.length)).join("\n"),
        },
      );
      i = end;
      continue;
    }
    if (line === GRAPH_OPEN || line.startsWith(`${GRAPH_OPEN} `)) {
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== INK_CLOSE) end++;
      const id = newId();
      const graph = end < lines.length ? readGraph(lines.slice(i + 1, end).join(""), id) : null;
      blocks.push(
        graph ?? {
          type: "raw",
          id,
          text: lines.slice(i, Math.min(end + 1, lines.length)).join("\n"),
        },
      );
      i = end;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      let end = i + 1;
      const closes = (candidate: string): boolean => {
        const match = /^(`{3,})\s*$/.exec(candidate);
        return match !== null && match[1].length >= fence[1].length;
      };
      while (end < lines.length && !closes(lines[end])) end++;
      for (const mono of lines.slice(i + 1, end)) {
        blocks.push(textBlock(newId(), "mono", [{ text: mono, marks: 0 }]));
      }
      i = end;
      continue;
    }
    const embed = EMBED.exec(line);
    if (embed) {
      const width = embed[2] ? Number(embed[2]) : undefined;
      blocks.push({
        type: "image",
        id: newId(),
        path: embed[1].trim(),
        ...(width !== undefined && width > 0 ? { width } : {}),
      });
      continue;
    }
    const audio = readAudioEmbed(line);
    if (audio) {
      blocks.push({ type: "audio", id: newId(), ...audio });
      continue;
    }
    if (line === "") {
      // One empty line between a list or quote and body text only separates them.
      const next = lines[i + 1];
      if (wasList && next !== undefined) continue;
      blocks.push(textBlock(newId()));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const kind =
        heading[1].length === 1 ? "title" : heading[1].length === 2 ? "heading" : "subheading";
      blocks.push(textBlock(newId(), kind, decodeInline(heading[2] ?? "")));
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      const { indent, rest } = readIndent(quote[1] ?? "");
      blocks.push(textBlock(newId(), "quote", decodeInline(rest), { indent }));
      afterList = true;
      continue;
    }
    const list = RULE.test(line) ? null : LIST.exec(line);
    if (list) {
      const lead = list[1];
      const tabs = lead.split("\t").length - 1;
      const indent = Math.min(MAX_INDENT, tabs + Math.floor((lead.length - tabs) / 2));
      const rest = list[4] ?? "";
      const check = list[2] ? CHECK.exec(rest) : null;
      if (check) {
        blocks.push(
          textBlock(newId(), "check", decodeInline(check[2] ?? ""), {
            indent,
            checked: check[1] !== " ",
          }),
        );
      } else {
        const kind = !list[2] ? "number" : list[2] === "-" ? "dash" : "bullet";
        blocks.push(textBlock(newId(), kind, decodeInline(rest), { indent }));
      }
      afterList = true;
      continue;
    }
    const letter = LETTER.exec(line);
    if (letter) {
      const lead = letter[1];
      const tabs = lead.split("\t").length - 1;
      const indent = Math.min(MAX_INDENT, tabs + Math.floor((lead.length - tabs) / 2));
      const upper = letter[2] === letter[2].toUpperCase();
      blocks.push(
        textBlock(newId(), upper ? "upper" : "lower", decodeInline(letter[3] ?? ""), { indent }),
      );
      afterList = true;
      continue;
    }
    const { indent, rest } = readIndent(line);
    blocks.push(textBlock(newId(), "body", decodeInline(rest), { indent }));
  }
  return blocks.length > 0 ? { blocks } : emptyNote(newId);
}

// ---------------------------------------------------------------- files

/** A file's frontmatter (its fences included, ending in a line break) and what follows. */
export function splitNoteFile(text: string): { frontmatter: string; body: string } {
  const normal = text.replace(/\r\n?/g, "\n");
  if (!normal.startsWith("---\n")) return { frontmatter: "", body: normal };
  const close = normal.indexOf("\n---\n", 3);
  if (close < 0) {
    // A fence that closes on the file's last line, with no line break after it.
    if (normal.endsWith("\n---")) return { frontmatter: `${normal}\n`, body: "" };
    return { frontmatter: "", body: normal };
  }
  return { frontmatter: normal.slice(0, close + 5), body: normal.slice(close + 5) };
}

export interface ParsedNoteFile {
  frontmatter: string;
  note: TextNote;
}

/** Read a text note's file. The one line break a file ends with is not a paragraph. */
export function parseNoteFile(
  text: string,
  newId: IdSource,
  options: DecodeOptions = {},
): ParsedNoteFile {
  const { frontmatter, body } = splitNoteFile(text);
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return { frontmatter, note: decodeNote(trimmed, newId, options) };
}

/** A text note's file: its frontmatter as it was, then the note. */
export function buildNoteFile(frontmatter: string, note: TextNote): string {
  return `${frontmatter}${encodeNote(note)}\n`;
}

/** The frontmatter a new text note starts with. */
export function newNoteFrontmatter(createdIso: string): string {
  return `---\n${TEXT_NOTE_FLAG}: 1\ncreated: ${createdIso}\n---\n`;
}

/** A new, empty text note's file. */
export function newNoteFile(createdIso: string, newId: IdSource): string {
  return buildNoteFile(newNoteFrontmatter(createdIso), emptyNote(newId));
}
