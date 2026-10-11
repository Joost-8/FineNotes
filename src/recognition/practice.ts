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
 * times, money, maths, punctuation and a `[[link]]`. Learning uses every set
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
  ],
];

/** Set 1's lines (the first practice notebooks had only these). */
export const PRACTICE_LINES = PRACTICE_SETS[0];

/** Prompts on one page. */
export const PROMPTS_PER_PAGE = 10;
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
      "You can delete this file: what was learned stays. Keep it if you want to learn again " +
      "later, for example after a FineNotes update. For better results, write another set " +
      "(this is set {set} of {sets}): each has different lines, and learning uses every set " +
      "you have written.",
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

/** The cover: a title, the set, and what to do, printed on plain paper. */
function coverPage(set: number, geometry: PageGeometry): Page {
  const printed: PrintedText[] = [];
  const width = geometry.width - 2 * LEFT;
  // Below where the floating tool pill sits at fit zoom, and large enough
  // to read there on an iPad.
  let y = 200;
  printed.push({
    x: LEFT,
    y,
    text: "Handwriting practice",
    size: 52,
    bold: true,
    color: HEADING_COLOR,
  });
  y += 48;
  printed.push({
    x: LEFT,
    y,
    text: `Set ${set} of ${PRACTICE_SETS.length} · teaches FineNotes to read your handwriting`,
    size: 24,
    color: PROMPT_COLOR,
  });
  y += 30;
  for (const part of COVER) {
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
