/**
 * Handwriting practice files (`Title.practice.md`): a cover that says what to
 * do, then pages of lines to copy, each printed on the paper in grey with an
 * empty line under it. What the writer copies under a prompt is that
 * prompt's text, so the labels are exact and no AI is needed
 * (research/PERSONAL_HANDWRITING_MODEL.md §2).
 *
 * The prompts are printed text (`SyntheticBackdrop.printed`), part of the
 * paper: they cannot be edited, moved or erased, and a `[[link]]` in one is
 * just text. The document's `practice` field marks the file; with it the
 * view offers only what writing needs, and the strokes keep their raw pen
 * samples, so the file on its own is training data.
 *
 * Three sets of lines, each covering the alphabet in both cases, digits,
 * times, money, maths, punctuation and a `[[link]]`, and a symbol sheet
 * ({@link SYMBOL_SET}): one digit, operator or sign per line, with its name
 * printed beside it, so the reader learns how this writer makes them (and
 * calculation notes can answer in their hand). Learning uses every sheet
 * written. Notebooks made before practice files (prompts in text boxes whose
 * ids start with `practice-`) are still read.
 *
 * PURE: no DOM, no Obsidian.
 */

import { writingLines } from "../canvas/backdrop";
import { assignLines, lineAt } from "../canvas/writing-lines";
import { SCHEMA_VERSION } from "../constants";
import {
  type InkDocument,
  type Page,
  type PageGeometry,
  type PrintedText,
  type Stroke,
  strokeBounds,
} from "../model/document";

/** The practice file's layout version, in its `practice.format`. */
export const PRACTICE_FORMAT = 1;

/** The lines to copy, set by set. Set 1 is the one the first practice notebooks had. */
export const PRACTICE_SETS: readonly (readonly string[])[] = [
  [
    "The quick brown fox jumps over the lazy dog.",
    "Pack my box with five dozen liquor jugs!",
    "Meeting on Tuesday at 10:30 in room B-214.",
    "Read chapter 7 before the exam on 12 March.",
    "x = (a + b) / 2, so y = 3x - 4.",
    "Email notes@example.com by Friday, please.",
    "Jumbo kites flew quietly over the zoo.",
    "Buy milk, eggs, bread & 2 apples.",
    "Question 4: why is the sky blue?",
    "Total: $45.80 (incl. 21% tax).",
    "How vexingly quick daft zebras jump!",
    "Lecture 9 - signals and systems.",
    '"Never give up," she said.',
    "The year 1984 had 366 days.",
    "Sphinx of black quartz, judge my vow.",
    "[[Project ideas]] and #todo items",
    "Call me at 555-0199 after 6 pm.",
    "E = mc^2 and F = m * a",
    "Waltz, bad nymph, for quick jigs vex.",
    "Next steps: review, write, repeat.",
    "(a + b)^2 = a^2 + 2ab + b^2",
    "sqrt(x^2 + y^2) = 5",
    "sin^2(x) + cos^2(x) = 1",
    "sum_(i=1)^n i = n(n + 1)/2",
    "d/dx (x^3) = 3x^2",
    "int_0^1 x^2 dx = 1/3",
    "a^(p-1) = 1 (mod p)",
    "lim_(x->0) sin(x)/x = 1",
    "log_2(8) = 3 and e^(ln 5) = 5",
    "|x - 3| < 2 => 1 < x < 5",
  ],
  [
    "Five boxing wizards jump quickly.",
    "Bright vixens jump; dozy fowl quack.",
    "Lab report due Monday 3 April, 9:00.",
    "Page 128, figure 4.2 (see appendix B).",
    "f(x) = 2x^2 + 3x - 7 for x > 0",
    "Ask Prof. Kim about the quiz in week 6.",
    "Quick zephyrs blow, vexing daft Jim.",
    "It's 50% off: only $12.99 today!",
    "TODO: fix bug #42 in parser.py",
    "Mr. Jock, TV quiz PhD, bags few lynx.",
    "Summary - cells, tissues & organs",
    "Q: what is the derivative of ln(x)?",
    "1 kg = 1000 g and 1 m = 100 cm",
    "Grumpy wizards make toxic brew.",
    "Deadline: 2026-11-30 @ 23:59",
    "See [[Lecture notes]] for more.",
    "If a < b and b < c, then a < c.",
    "Jackdaws love my big sphinx of quartz.",
    "Notes from today's meeting with Ana",
    "{a, b, c} | x ~ y, see ref [3]",
    "x = (-b +- sqrt(b^2 - 4ac)) / (2a)",
    "A = pi * r^2, C = 2 * pi * r",
    "v = d/t = 120 km / 1.5 h = 80 km/h",
    "n! = n * (n - 1) * ... * 1",
    "P(A | B) = P(A and B) / P(B)",
    "2^10 = 1024 and 10^-3 = 0.001",
    "gcd(12, 18) = 6, lcm(12, 18) = 36",
    "x_1 + x_2 = -b/a, x_1 * x_2 = c/a",
    "f'(x) = 3x^2 - 2 => f'(2) = 10",
    "for all x in R: x^2 >= 0",
  ],
  [
    "Heavy boxes perform quick waltzes and jigs.",
    "Amazingly few discotheques provide jukeboxes.",
    "Chapter 11: electric fields and charge",
    "Exam on Thursday 14 May in hall C.",
    "Mean = (3 + 7 + 8 + 10) / 4 = 7",
    "Don't forget: bring the USB stick!",
    "Questions? Ask Zoe or Victor.",
    "Waxy and quivering, jocks fumble the pizza.",
    "Order #7931 shipped on 2 June.",
    "Key idea: energy is always conserved.",
    "a_n = a_1 + (n - 1) * d",
    "Phone: +31 6 1234 5678",
    "Pros: fast, cheap; cons: noisy.",
    'Write 300 words about "climate".',
    "The jay, pig, fox, zebra and my wolves quack!",
    "p <= 0.05 means the result is significant",
    "Link: www.example.org/notes",
    "Review [[Exam prep]] before Sunday.",
    "Gym at 7, lunch at 12:30, call Mom.",
    "~/docs/thesis_v2.pdf is the latest",
    "a^2 + b^2 = c^2 (Pythagoras)",
    "1/2 + 1/3 = 5/6",
    "det(A) = ad - bc for A = [a b; c d]",
    "S = sum_(k=0)^(n-1) r^k = (1 - r^n)/(1 - r)",
    "e^(i*pi) + 1 = 0",
    "O(n log n) < O(n^2) for large n",
    "mu = 12.5, sigma^2 = 4.2, z = (x - mu)/sigma",
    "int sin(x) dx = -cos(x) + C",
    "A subset B and x not in B => x not in A",
    "F = G * m_1 * m_2 / r^2",
  ],
];

/**
 * The symbol sheet's set number: far above the text sets, so more of those
 * can follow without a clash, and positive, as `practice.set` must be.
 */
export const SYMBOL_SET = 100;

/**
 * The symbol sheet: each digit twice, then every operator, bracket and sign
 * in Grape's alphabet, one to a line, with a name printed beside it (a
 * caption, not part of the label: the line's label is the symbol alone). The
 * letter x is there because a calculation writes it for "times".
 */
export const SYMBOL_LINES: readonly { symbol: string; name: string }[] = [
  { symbol: "0", name: "zero" },
  { symbol: "1", name: "one" },
  { symbol: "2", name: "two" },
  { symbol: "3", name: "three" },
  { symbol: "4", name: "four" },
  { symbol: "5", name: "five" },
  { symbol: "6", name: "six" },
  { symbol: "7", name: "seven" },
  { symbol: "8", name: "eight" },
  { symbol: "9", name: "nine" },
  { symbol: "+", name: "plus" },
  { symbol: "-", name: "minus" },
  { symbol: "x", name: "times, as a letter x" },
  { symbol: "*", name: "times, as a star" },
  { symbol: "/", name: "divided by" },
  { symbol: "=", name: "equals" },
  { symbol: ".", name: "decimal point" },
  { symbol: ",", name: "comma" },
  { symbol: "(", name: "opening bracket" },
  { symbol: ")", name: "closing bracket" },
  { symbol: "^", name: "to the power" },
  { symbol: "%", name: "percent" },
  { symbol: "<", name: "less than" },
  { symbol: ">", name: "greater than" },
  { symbol: "[", name: "opening square bracket" },
  { symbol: "]", name: "closing square bracket" },
  { symbol: "{", name: "opening brace" },
  { symbol: "}", name: "closing brace" },
  { symbol: "|", name: "bar" },
  { symbol: "!", name: "factorial, exclamation mark" },
  { symbol: "_", name: "underscore, subscript" },
  { symbol: ":", name: "colon" },
  { symbol: ";", name: "semicolon" },
  { symbol: "?", name: "question mark" },
  { symbol: "'", name: "prime, apostrophe" },
  { symbol: '"', name: "quotation mark" },
  { symbol: "~", name: "tilde, about" },
  { symbol: "#", name: "number sign" },
  { symbol: "$", name: "dollar" },
  { symbol: "&", name: "and" },
  { symbol: "@", name: "at" },
  { symbol: String.fromCharCode(92), name: "backslash" },
  { symbol: "`", name: "backquote" },
  { symbol: "7", name: "seven, again" },
  { symbol: "4", name: "four, again" },
  { symbol: "1", name: "one, again" },
  { symbol: "9", name: "nine, again" },
  { symbol: "0", name: "zero, again" },
  { symbol: "5", name: "five, again" },
  { symbol: "2", name: "two, again" },
  { symbol: "8", name: "eight, again" },
  { symbol: "3", name: "three, again" },
  { symbol: "6", name: "six, again" },
];

/** Whether `set` is the symbol sheet. */
export function isSymbolSet(set: number | null | undefined): boolean {
  return set === SYMBOL_SET;
}

/** The labels a sheet asks for: a text set's lines, or the symbol sheet's symbols. */
export function practicePrompts(set: number): readonly string[] {
  if (isSymbolSet(set)) return SYMBOL_LINES.map((line) => line.symbol);
  return PRACTICE_SETS[Math.min(PRACTICE_SETS.length, Math.max(1, Math.round(set))) - 1];
}

/** Set 1's lines (the first practice notebooks had only these). */
export const PRACTICE_LINES = PRACTICE_SETS[0];

/** Prompts on one page. */
export const PROMPTS_PER_PAGE = 10;
/** Symbols on one page of the symbol sheet: one every two lines. */
export const SYMBOLS_PER_PAGE = 15;
/** The ruling's pitch (ruled-wide), page px. */
const PITCH = 40;
/** Where printed text starts, page px from the left. */
const LEFT = 60;
/** How far above its rule a prompt's baseline sits, page px. */
const ABOVE_RULE = 9;
/** The id prefix that marks a prompt. */
export const PRACTICE_PREFIX = "practice-";
/** Printed colours: prompts and notes grey, the cover's headings near black. */
const PROMPT_COLOR = "#7a7a7a";
const HEADING_COLOR = "#2b2b2b";

/** The cover's words, as headed paragraphs. `{set}` and `{sets}` are filled in. */
const COVER: readonly { heading?: string; text: string }[] = [
  {
    heading: "How to do it",
    text:
      "1. On the next pages, each grey line has an empty line under it.\n" +
      "2. Copy each grey line onto the empty line below it, in your normal handwriting, " +
      "at your normal size and speed.\n" +
      "3. Copy it exactly, punctuation included. Made a mistake? Erase it and write it again. " +
      "Skipping a line is fine.\n" +
      "4. Write only on the empty lines. This file only has the pen and the eraser, on purpose.",
  },
  {
    heading: "When you are done",
    text:
      "Open Settings, FineNotes, Handwriting, and tap Learn now. It takes a few minutes on " +
      "this device, and you can go on writing in other notes meanwhile. FineNotes keeps what " +
      "it learned only if it reads your writing better than before, and shows you the result.",
  },
  {
    heading: "Afterwards",
    text:
      "Keep this file: every time FineNotes learns again (after you have corrected more " +
      "words, or after an update), it starts from scratch and learns from every sheet you " +
      "have written, so a deleted sheet is forgotten. For better results, write another set " +
      "(this is set {set} of {sets}): each has different lines.",
  },
  {
    heading: "Your data",
    text:
      "Everything stays on this device and in your vault. This file holds your strokes " +
      "(their positions, pressure and timing) and the lines you copied, nothing else.",
  },
];

/**
 * Text broken into lines that fit `width` at `size`, by an average glyph of
 * 0.5 em: the same lines on every device, since the file stores them.
 */
export function wrapPrinted(text: string, width: number, size: number): string[] {
  const max = Math.max(8, Math.floor(width / (size * 0.5)));
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > max && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** The symbol sheet's cover: what to do with one symbol a line. */
const SYMBOL_COVER: readonly { heading?: string; text: string }[] = [
  {
    heading: "How to do it",
    text:
      "1. On the next pages, each grey symbol has its name beside it and an empty line under it.\n" +
      "2. Write the symbol once on the empty line below it, at the size you write maths, " +
      "the way you always write it.\n" +
      "3. One symbol per line, nothing else. Made a mistake? Erase it and write it again. " +
      "Skipping a line is fine.",
  },
  COVER[1],
  {
    heading: "What it is for",
    text:
      "FineNotes learns how you write digits, operators and signs, so it reads your maths " +
      "better. Calculation notes, when on, also write their answers in your own hand with it.",
  },
  COVER[3],
];

/** The cover: a title, the set, and what to do, printed on plain paper. */
function coverPage(set: number, geometry: PageGeometry): Page {
  const symbols = isSymbolSet(set);
  const printed: PrintedText[] = [];
  const width = geometry.width - 2 * LEFT;
  // Below where the floating tool pill sits at fit zoom, and large enough
  // to read there on an iPad.
  let y = 200;
  printed.push({
    x: LEFT,
    y,
    text: symbols ? "Symbol practice" : "Handwriting practice",
    size: 52,
    bold: true,
    color: HEADING_COLOR,
  });
  y += 48;
  printed.push({
    x: LEFT,
    y,
    text: symbols
      ? "Digits, operators and signs · teaches FineNotes to read your maths"
      : `Set ${set} of ${PRACTICE_SETS.length} · teaches FineNotes to read your handwriting`,
    size: 24,
    color: PROMPT_COLOR,
  });
  y += 30;
  for (const part of symbols ? SYMBOL_COVER : COVER) {
    y += 44;
    if (part.heading) {
      printed.push({ x: LEFT, y, text: part.heading, size: 30, bold: true, color: HEADING_COLOR });
      y += 42;
    }
    const text = part.text
      .replace("{set}", String(set))
      .replace("{sets}", String(PRACTICE_SETS.length));
    for (const line of wrapPrinted(text, width, 23)) {
      printed.push({ x: LEFT, y, text: line, size: 23, color: HEADING_COLOR });
      y += 34;
    }
  }
  return {
    id: "cover",
    kind: "ink",
    geometry: { ...geometry },
    backdrop: { kind: "blank", printed },
    strokes: [],
    images: [],
    textBoxes: [],
  };
}

/**
 * Practice set `set` (1-based): the cover, then pages of ruled-wide paper
 * with ten prompts each, one every three lines (the prompt, the line to
 * write on, a spare line), under a short reminder at the top.
 */
export function buildPracticeFile(set: number, geometry: PageGeometry): InkDocument {
  if (isSymbolSet(set)) return buildSymbolFile(geometry);
  const which = Math.min(PRACTICE_SETS.length, Math.max(1, Math.round(set)));
  const lines = PRACTICE_SETS[which - 1];
  const pages: Page[] = [coverPage(which, geometry)];
  const count = Math.ceil(lines.length / PROMPTS_PER_PAGE);
  for (let p = 0; p < count; p++) {
    const printed: PrintedText[] = [
      {
        x: LEFT,
        y: PITCH - ABOVE_RULE,
        text: `Set ${which} · page ${p + 1} of ${count} · copy each grey line on the empty line below it`,
        size: 15,
        color: PROMPT_COLOR,
      },
    ];
    lines.slice(p * PROMPTS_PER_PAGE, (p + 1) * PROMPTS_PER_PAGE).forEach((text, i) => {
      const n = p * PROMPTS_PER_PAGE + i;
      // The prompt sits on rule k, as handwriting would; the copy goes on
      // the line below it, and the line after that is left free.
      const k = 3 + i * 3;
      printed.push({
        x: LEFT,
        y: PITCH * k - ABOVE_RULE,
        text,
        size: 22,
        color: PROMPT_COLOR,
        prompt: `${PRACTICE_PREFIX}${which}-${n + 1}`,
      });
    });
    pages.push({
      id: `p${p + 1}`,
      kind: "ink",
      geometry: { ...geometry },
      backdrop: { kind: "ruled-wide", printed },
      strokes: [],
      images: [],
      textBoxes: [],
    });
  }
  return {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: geometry.width, scale: 1 },
    practice: { format: PRACTICE_FORMAT, set: which },
    pages,
  };
}

/**
 * The symbol sheet: the cover, then pages of ruled-wide paper with a symbol
 * every two lines (printed large, its name small beside it), written on the
 * line below. The name is printed text without a prompt id, so it is never
 * a label.
 */
function buildSymbolFile(geometry: PageGeometry): InkDocument {
  const pages: Page[] = [coverPage(SYMBOL_SET, geometry)];
  const count = Math.ceil(SYMBOL_LINES.length / SYMBOLS_PER_PAGE);
  for (let p = 0; p < count; p++) {
    const printed: PrintedText[] = [
      {
        x: LEFT,
        y: PITCH - ABOVE_RULE,
        text: `Symbols · page ${p + 1} of ${count} · write each grey symbol once on the empty line below it`,
        size: 15,
        color: PROMPT_COLOR,
      },
    ];
    SYMBOL_LINES.slice(p * SYMBOLS_PER_PAGE, (p + 1) * SYMBOLS_PER_PAGE).forEach((line, i) => {
      const n = p * SYMBOLS_PER_PAGE + i;
      // The symbol sits on rule k and is copied on the line below it; the
      // next symbol is on the rule after that.
      const y = PITCH * (3 + i * 2) - ABOVE_RULE;
      printed.push({
        x: LEFT,
        y,
        text: line.symbol,
        size: 26,
        color: PROMPT_COLOR,
        prompt: `${PRACTICE_PREFIX}${SYMBOL_SET}-${n + 1}`,
      });
      printed.push({ x: LEFT + 70, y, text: line.name, size: 15, color: PROMPT_COLOR });
    });
    pages.push({
      id: `p${p + 1}`,
      kind: "ink",
      geometry: { ...geometry },
      backdrop: { kind: "ruled-wide", printed },
      strokes: [],
      images: [],
      textBoxes: [],
    });
  }
  return {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: geometry.width, scale: 1 },
    practice: { format: PRACTICE_FORMAT, set: SYMBOL_SET },
    pages,
  };
}

/** A copied line: the prompt's text and the strokes written under it. */
export interface PracticeLine {
  text: string;
  strokes: Stroke[];
}

/** Whether a document is a practice file, or a practice notebook from before them. */
export function isPracticeNotebook(doc: InkDocument): boolean {
  return (
    doc.practice !== undefined ||
    doc.pages.some((page) => page.textBoxes.some((box) => box.id.startsWith(PRACTICE_PREFIX)))
  );
}

/** Whether a stroke is handwriting the reader can learn from. */
function isWriting(stroke: Stroke): boolean {
  return stroke.tool !== "highlighter" && !stroke.shape;
}

/**
 * The lines copied in a practice file: for each prompt, the pen strokes on
 * the lines between it and the next prompt (the writing line and the spare
 * one), so writing that drifts onto the spare line is not cut off. Prompts
 * with nothing written under them are left out.
 */
export function practiceLines(doc: InkDocument): PracticeLine[] {
  const out: PracticeLine[] = [];
  for (const page of doc.pages) {
    if (page.backdrop.kind === "pdf") continue;
    const prompts = (page.backdrop.printed ?? []).filter((line) => line.prompt);
    if (prompts.length === 0) {
      out.push(...legacyLines(page));
      continue;
    }
    const blocks = writingLines(page.backdrop, page.geometry);
    const writing = page.strokes.filter(isWriting);
    const bounds = writing.map((stroke) => strokeBounds(stroke));
    const refs = assignLines(
      blocks,
      bounds.map((b) => b ?? { minX: 0, minY: -1e9, maxX: 0, maxY: -1e9 }),
    );
    const at = prompts
      .map((prompt) => ({ prompt, ref: lineAt(blocks, prompt.x, prompt.y) }))
      .filter((p) => p.ref !== null)
      .sort((a, b) => (a.ref?.line ?? 0) - (b.ref?.line ?? 0));
    at.forEach(({ prompt, ref }, i) => {
      if (!ref) return;
      const next = at[i + 1]?.ref;
      const last = next && next.block === ref.block ? next.line - 1 : ref.line + 2;
      const strokes = writing.filter((_, j) => {
        const r = refs[j];
        return r !== null && r.block === ref.block && r.line > ref.line && r.line <= last;
      });
      if (strokes.length > 0) out.push({ text: prompt.text, strokes });
    });
  }
  return out;
}

/**
 * The characters written on a symbol sheet, with the rule each was written
 * above: what calculation notes write their answers with
 * (`model/answer-glyphs.ts`). Empty for any other practice file.
 */
export function symbolSamples(
  doc: InkDocument,
): { symbol: string; strokes: Stroke["pts"][]; baseline: number }[] {
  if (!isSymbolSet(doc.practice?.set)) return [];
  const out: { symbol: string; strokes: Stroke["pts"][]; baseline: number }[] = [];
  for (const page of doc.pages) {
    if (page.backdrop.kind === "pdf") continue;
    const prompts = (page.backdrop.printed ?? []).filter((line) => line.prompt);
    if (prompts.length === 0) continue;
    const blocks = writingLines(page.backdrop, page.geometry);
    const writing = page.strokes.filter(isWriting);
    const refs = assignLines(
      blocks,
      writing.map((s) => strokeBounds(s) ?? { minX: 0, minY: -1e9, maxX: 0, maxY: -1e9 }),
    );
    for (const prompt of prompts) {
      const ref = lineAt(blocks, prompt.x, prompt.y);
      if (!ref || Array.from(prompt.text).length !== 1) continue;
      const line = ref.line + 1;
      const baseline = blocks[ref.block].baselines[line];
      if (baseline === undefined) continue;
      const strokes = writing
        .filter((_, j) => refs[j]?.block === ref.block && refs[j]?.line === line)
        .map((s) => s.pts);
      if (strokes.length > 0) out.push({ symbol: prompt.text, strokes, baseline });
    }
  }
  return out;
}

/**
 * A practice notebook from before practice files: prompts in text boxes, the
 * copy the strokes whose middle lies on the line below one (from just under
 * the prompt to half a line past the writing line, for descenders).
 */
function legacyLines(page: Page): PracticeLine[] {
  const out: PracticeLine[] = [];
  const prompts = page.textBoxes
    .filter((box) => box.id.startsWith(PRACTICE_PREFIX))
    .sort((a, b) => a.y - b.y);
  for (const prompt of prompts) {
    const height = prompt.h ?? PITCH;
    const top = prompt.y + height + height * 0.15;
    const bottom = prompt.y + 2 * height + height * 0.5;
    const strokes = page.strokes.filter((stroke) => {
      if (!isWriting(stroke)) return false;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 1; i < stroke.pts.length; i += 3) {
        lo = Math.min(lo, stroke.pts[i]);
        hi = Math.max(hi, stroke.pts[i]);
      }
      const mid = (lo + hi) / 2;
      return mid >= top && mid < bottom;
    });
    if (strokes.length > 0) out.push({ text: prompt.text, strokes });
  }
  return out;
}
