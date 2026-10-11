/**
 * The handwriting practice notebook: 20 short lines to copy, each printed
 * in a muted text box on ruled paper with a free line below it. What the
 * writer copies under a prompt is that prompt's text, so the labels are
 * exact and no AI is needed (research/PERSONAL_HANDWRITING_MODEL.md §2).
 * The lines cover the alphabet in both cases, digits, times, money, maths,
 * punctuation and a `[[link]]`.
 *
 * A prompt is a text box whose id starts with `practice-`; nothing else
 * marks the notebook, so it is an ordinary notebook in every other way.
 *
 * PURE: no DOM, no Obsidian.
 */

import { SCHEMA_VERSION } from "../constants";
import type { InkDocument, Page, PageGeometry, Stroke, TextBoxElement } from "../model/document";

/** The lines to copy, in order. */
export const PRACTICE_LINES: readonly string[] = [
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
];

/** Prompts on one page. */
export const PROMPTS_PER_PAGE = 10;
/** The ruling's pitch (ruled-wide), page px. */
const PITCH = 40;
/** Where a prompt's text box starts, page px from the left. */
const LEFT = 60;
/** The id prefix that marks a prompt. */
export const PRACTICE_PREFIX = "practice-";
const PROMPT_COLOR = "#7a7a7a";

/**
 * The practice notebook: two pages of ruled-wide paper, ten prompts each,
 * one every three lines (the prompt, the line to write on, a free line),
 * and a note on page one saying what to do.
 */
export function buildPracticeNotebook(geometry: PageGeometry): InkDocument {
  const pages: Page[] = [];
  const count = Math.ceil(PRACTICE_LINES.length / PROMPTS_PER_PAGE);
  for (let p = 0; p < count; p++) {
    const textBoxes: TextBoxElement[] = [];
    if (p === 0) {
      textBoxes.push({
        id: "t0",
        x: LEFT,
        y: PITCH * 0.5,
        w: geometry.width - 2 * LEFT,
        text: "Copy each grey line on the empty line below it, in your normal handwriting. Then choose Learn my handwriting in FineNotes' settings, under Handwriting.",
        color: PROMPT_COLOR,
        fontSize: 16,
      });
    }
    const first = p === 0 ? 3 : 1;
    PRACTICE_LINES.slice(p * PROMPTS_PER_PAGE, (p + 1) * PROMPTS_PER_PAGE).forEach((text, i) => {
      const n = p * PROMPTS_PER_PAGE + i;
      // Line k's band runs from rule k−1 to rule k; the prompt fills it.
      const k = first + i * 3;
      textBoxes.push({
        id: `${PRACTICE_PREFIX}${n + 1}`,
        x: LEFT,
        y: PITCH * k,
        w: geometry.width - 2 * LEFT,
        h: PITCH,
        text,
        color: PROMPT_COLOR,
        fontSize: 20,
      });
    });
    pages.push({
      id: `p${p + 1}`,
      kind: "ink",
      geometry: { ...geometry },
      backdrop: { kind: "ruled-wide" },
      strokes: [],
      images: [],
      textBoxes,
    });
  }
  return { version: SCHEMA_VERSION, view: { scrollY: 0, width: geometry.width, scale: 1 }, pages };
}

/** A copied line: the prompt's text and the strokes written under it. */
export interface PracticeLine {
  text: string;
  strokes: Stroke[];
}

/** Whether a notebook has practice prompts. */
export function isPracticeNotebook(doc: InkDocument): boolean {
  return doc.pages.some((page) => page.textBoxes.some((box) => box.id.startsWith(PRACTICE_PREFIX)));
}

/**
 * The lines copied in a practice notebook: for each prompt, the pen strokes
 * whose middle lies on the line below it (from just under the prompt to
 * half a line past the writing line, for descenders). Prompts with nothing
 * written under them are left out.
 */
export function practiceLines(doc: InkDocument): PracticeLine[] {
  const out: PracticeLine[] = [];
  for (const page of doc.pages) {
    const prompts = page.textBoxes
      .filter((box) => box.id.startsWith(PRACTICE_PREFIX))
      .sort((a, b) => a.y - b.y);
    for (const prompt of prompts) {
      const height = prompt.h ?? PITCH;
      const top = prompt.y + height + height * 0.15;
      const bottom = prompt.y + 2 * height + height * 0.5;
      const strokes = page.strokes.filter((stroke) => {
        if (stroke.tool === "highlighter" || stroke.shape) return false;
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
  }
  return out;
}
