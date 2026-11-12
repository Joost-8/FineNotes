/**
 * Markdown in a page text box (discussion #107). PURE.
 *
 * A box in Markdown mode (`TextBoxElement.markdown`) keeps its text exactly
 * as typed, Markdown and all, so it reads the same pasted into a note, synced
 * to a device without this feature, searched or exported as text. While it is
 * edited the textarea shows that raw text; at rest it is drawn formatted, by
 * the canvas (`canvas/markdown-layout.ts`), which is also what thumbnails,
 * exports and the AI's page render draw. This module reads the text into
 * what is drawn: one block per line, each a run of styled spans.
 *
 * The subset is what a note's body mostly holds, written as Obsidian writes
 * it: headings (`#` to `######`), `**bold**`, `*italic*`, `~~strike~~`,
 * `==highlight==`, `` `code` ``, bulleted (`-`, `*`, `+`), numbered and task
 * lists (`- [ ]`, `- [x]`), quotes (`>`), rules (`---`), fenced code, and
 * links (`[[Note]]`, `[text](url)`, bare addresses; `text-links.ts`, so they
 * open on a tap as in any box). A line is a line: Obsidian's default shows a
 * single newline as a break, and so does a box. Embeds, callouts and LaTeX are
 * not read: they show as the text they are.
 *
 * The lists the text pill writes (`•`, `☐`, `☑`, `text-list.ts`) read as
 * lists too, so a box switched to Markdown keeps its lists.
 */

import { linkAt } from "./text-links";
import { setTaskDone, continueList, type TextEdit } from "./text-list";

/** A piece of a line in one look. Flags are `true` or absent. */
export interface MdSpan {
  text: string;
  bold?: true;
  italic?: true;
  strike?: true;
  /** Inline code: drawn in a monospace face on a tint. */
  code?: true;
  /** `==highlight==`. */
  mark?: true;
  /** Where a link leads (as `TextSegment.target`). */
  target?: string;
}

export type MdBlockKind = "paragraph" | "heading" | "bullet" | "number" | "task" | "rule" | "code";

/** One line of a box, read. */
export interface MdBlock {
  kind: MdBlockKind;
  /** The line of the text it was read from (0-based), for ticking a task. */
  line: number;
  /** A heading's level, 1 to 6; 0 for anything else. */
  level: number;
  /** How deep a list item is nested (0: not indented). */
  depth: number;
  /** How many quote markers (`>`) it sits in. */
  quote: number;
  /** A numbered item's number as written, with its dot or bracket ("3."). */
  marker: string;
  /** A ticked task. */
  done: boolean;
  spans: MdSpan[];
}

/** Characters a backslash makes literal (CommonMark's ASCII punctuation). */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

const QUOTE = /^ {0,3}> ?/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TASK = /^([ \t]*)(?:[-*+] \[([ xX])\]|([☐☑]))(?: (.*)|$)/;
const BULLET = /^([ \t]*)([-*+•])(?: (.*)|$)/;
const NUMBER = /^([ \t]*)(\d{1,9}[.)])(?: (.*)|$)/;

/** A list item's nesting from its indent: a tab or up to four spaces a level. */
function depthOf(indent: string): number {
  let width = 0;
  for (const c of indent) width += c === "\t" ? 4 : 1;
  return Math.ceil(width / 4);
}

function block(kind: MdBlockKind, line: number, quote: number, spans: MdSpan[]): MdBlock {
  return { kind, line, level: 0, depth: 0, quote, marker: "", done: false, spans };
}

/** Read a box's text into blocks, one per line (fence lines aside). */
export function parseMarkdown(text: string): MdBlock[] {
  const out: MdBlock[] = [];
  let fence: string | null = null;
  let fenceQuote = 0;
  text.split("\n").forEach((raw, index) => {
    let rest = raw;
    let quote = 0;
    for (let m = QUOTE.exec(rest); m; m = QUOTE.exec(rest)) {
      quote++;
      rest = rest.slice(m[0].length);
    }
    const fenceMark = FENCE.exec(rest);
    if (fence !== null) {
      // A fence closes with at least as many of the same character.
      if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) {
        fence = null;
        return;
      }
      out.push(block("code", index, fenceQuote, rest ? [{ text: rest, code: true }] : []));
      return;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      fenceQuote = quote;
      return;
    }
    const heading = HEADING.exec(rest);
    if (heading) {
      const b = block("heading", index, quote, parseInline(heading[2] ?? ""));
      b.level = heading[1].length;
      out.push(b);
      return;
    }
    if (RULE.test(rest)) {
      out.push(block("rule", index, quote, []));
      return;
    }
    const task = TASK.exec(rest);
    if (task) {
      const b = block("task", index, quote, parseInline(task[4] ?? ""));
      b.depth = depthOf(task[1]);
      b.done = task[2] !== undefined ? task[2] !== " " : task[3] === "☑";
      out.push(b);
      return;
    }
    const bullet = BULLET.exec(rest);
    if (bullet) {
      const b = block("bullet", index, quote, parseInline(bullet[3] ?? ""));
      b.depth = depthOf(bullet[1]);
      out.push(b);
      return;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      const b = block("number", index, quote, parseInline(number[3] ?? ""));
      b.depth = depthOf(number[1]);
      b.marker = number[2];
      out.push(b);
      return;
    }
    out.push(block("paragraph", index, quote, parseInline(rest)));
  });
  return out;
}

/** The look a span is drawn in, without its text. */
type SpanStyle = Omit<MdSpan, "text">;

const FLAG_OF: ReadonlyArray<{ delim: string; flag: "bold" | "italic" | "strike" | "mark" }> = [
  { delim: "**", flag: "bold" },
  { delim: "__", flag: "bold" },
  { delim: "~~", flag: "strike" },
  { delim: "==", flag: "mark" },
  { delim: "*", flag: "italic" },
  { delim: "_", flag: "italic" },
];

function isSpace(c: string | undefined): boolean {
  return c === undefined || /\s/.test(c);
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[\p{L}\p{N}]/u.test(c);
}

/** How many of `c` start at `at`. */
function runOf(src: string, at: number, c: string): number {
  let n = 0;
  while (src[at + n] === c) n++;
  return n;
}

/** Where a code span opened by `ticks` backticks closes, or -1. */
function codeClose(src: string, from: number, ticks: number): number {
  for (let j = src.indexOf("`", from); j >= 0; j = src.indexOf("`", j)) {
    const run = runOf(src, j, "`");
    if (run === ticks) return j;
    j += run;
  }
  return -1;
}

/**
 * Where the emphasis opened by `delim` at `at` closes, or -1. An opener is
 * followed by a non-space and a closer preceded by one; `_` never opens or
 * closes inside a word (`snake_case`). A single `*` or `_` skips over a
 * doubled run, which is emphasis of its own inside it (`*a **b** c*`), and
 * takes the last of an odd run (`*a **b***`).
 */
function emphasisClose(src: string, at: number, delim: string): number {
  const c = delim[0];
  const start = at + delim.length;
  if (isSpace(src[start])) return -1;
  const underscore = c === "_";
  if (underscore && isWordChar(src[at - 1])) return -1;
  // A single delimiter opening right before another is the start of a double one.
  if (delim.length === 1 && src[start] === c) return -1;
  const paired = c === "~" || c === "=";
  let j = start;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "`") {
      const ticks = runOf(src, j, "`");
      const close = codeClose(src, j + ticks, ticks);
      j = close >= 0 ? close + ticks : j + ticks;
      continue;
    }
    if (ch !== c) {
      j++;
      continue;
    }
    const run = runOf(src, j, c);
    let close = -1;
    if (paired) {
      if (run >= 2) close = j;
    } else if (delim.length === 1) {
      if (run % 2 === 1) close = j + run - 1;
    } else if (run >= 2) {
      close = j + run - 2;
    }
    if (
      close > start &&
      !isSpace(src[close - 1]) &&
      !(underscore && isWordChar(src[close + delim.length]))
    ) {
      return close;
    }
    j += run;
  }
  return -1;
}

/** Add a span, joined to the one before when it looks the same. */
function pushSpan(out: MdSpan[], span: MdSpan): void {
  if (span.text === "") return;
  const last = out[out.length - 1];
  if (last && sameLook(last, span)) last.text += span.text;
  else out.push(span);
}

function sameLook(a: SpanStyle, b: SpanStyle): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.code === b.code &&
    a.mark === b.mark &&
    a.target === b.target
  );
}

/** One line's inline Markdown, as styled spans. */
export function parseInline(src: string): MdSpan[] {
  const out: MdSpan[] = [];
  readInline(src, {}, out);
  return out;
}

function readInline(src: string, style: SpanStyle, out: MdSpan[]): void {
  let plain = "";
  const flush = (): void => {
    pushSpan(out, { ...style, text: plain });
    plain = "";
  };
  let i = 0;
  scan: while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      plain += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const ticks = runOf(src, i, "`");
      const close = codeClose(src, i + ticks, ticks);
      if (close < 0) {
        plain += src.slice(i, i + ticks);
        i += ticks;
        continue;
      }
      flush();
      let code = src.slice(i + ticks, close);
      // One space each side is padding (CommonMark), so `` `a` `` can be written.
      if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") {
        code = code.slice(1, -1);
      }
      pushSpan(out, { ...style, code: true, text: code });
      i = close + ticks;
      continue;
    }
    // A link: `[[…]]`, `[…](…)`, or an address starting a word.
    if (
      c === "[" ||
      ((c === "h" || c === "H" || c === "w" || c === "W") && !isWordChar(src[i - 1]))
    ) {
      const found = linkAt(src, i);
      if (found) {
        flush();
        const target = found.link.target as string;
        const label = src[i + 1] !== "[" && c === "[";
        // A markdown link's label may be formatted; a wikilink's alias is shown as written.
        if (label) readInline(found.link.text, { ...style, target }, out);
        else pushSpan(out, { ...style, target, text: found.link.text });
        i += found.length;
        continue;
      }
    }
    for (const { delim, flag } of FLAG_OF) {
      if (!src.startsWith(delim, i)) continue;
      const close = emphasisClose(src, i, delim);
      if (close < 0) continue;
      flush();
      readInline(src.slice(i + delim.length, close), { ...style, [flag]: true }, out);
      i = close + delim.length;
      continue scan;
    }
    plain += c;
    i++;
  }
  flush();
}

/** What a box's Markdown says, without the marks: for measuring and reading aloud. */
export function markdownPlainText(text: string): string {
  return parseMarkdown(text)
    .map((b) => b.spans.map((s) => s.text).join(""))
    .join("\n");
}

const MD_TASK_LINE = /^((?:[ \t]*> ?)*[ \t]*[-*+] \[)([ xX])(\])/;

/**
 * `text` with the task on line `line` ticked (`done`) or not: a Markdown
 * `- [ ]` gets an `x`, or loses it; a `☐`/`☑` item is ticked as the text
 * pill ticks it. Unchanged when the line is no task.
 */
export function setMarkdownTaskDone(text: string, line: number, done: boolean): string {
  const lines = text.split("\n");
  const source = lines[line];
  if (source === undefined) return text;
  const m = MD_TASK_LINE.exec(source);
  if (!m) return setTaskDone(text, line, done);
  if ((m[2] !== " ") === done) return text;
  lines[line] = m[1] + (done ? "x" : " ") + source.slice(m[1].length + 1);
  return lines.join("\n");
}

const MD_ITEM = /^((?:[ \t]*> ?)*)([ \t]*)(?:([-*+]) \[[ xX]\] |([-*+]) |(\d{1,9})([.)]) |(> ?))/;

/**
 * Return in a Markdown box: a list item goes on with the next item (a task
 * with an open box, a number one higher), a quote with another quote line,
 * and an empty item ends its list, as the text pill's lists do. `null` when
 * the caret's line is none of those, so the textarea types a newline.
 */
export function continueMarkdownList(text: string, caret: number): TextEdit | null {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const nextBreak = text.indexOf("\n", caret);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const line = text.slice(lineStart, lineEnd);
  const m = MD_ITEM.exec(line);
  if (!m) return continueList(text, caret);
  const prefixEnd = lineStart + m[0].length;
  if (caret < prefixEnd) return null;
  if (line.slice(m[0].length).trim() === "") {
    // An empty item ends the list: its marker goes, its indent and quote stay.
    const keep = m[7] !== undefined ? "" : m[1] + m[2];
    const out = text.slice(0, lineStart) + keep + text.slice(prefixEnd);
    const at = lineStart + keep.length;
    return { text: out, selectionStart: at, selectionEnd: at };
  }
  let next: string;
  if (m[3] !== undefined) next = `${m[3]} [ ] `;
  else if (m[4] !== undefined) next = `${m[4]} `;
  else if (m[5] !== undefined) next = `${Number(m[5]) + 1}${m[6]} `;
  else next = m[7];
  const insert = `\n${m[1]}${m[2]}${next}`;
  const out = text.slice(0, caret) + insert + text.slice(caret);
  const at = caret + insert.length;
  return { text: out, selectionStart: at, selectionEnd: at };
}
