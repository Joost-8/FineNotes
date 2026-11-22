/**
 * Reading a text note's paragraphs back out of the page, and finding the
 * caret in them. PURE: it walks anything shaped like a DOM node, so the
 * tests hand it plain objects.
 *
 * While someone types, the browser edits the paragraph's elements itself
 * (that is what keeps the keyboard, autocorrect, composition and Scribble
 * working), and what it leaves varies: `<b>` or `<strong>`, a `<span>` with
 * a style, text nodes split anywhere. So nothing here expects the shape the
 * editor rendered; it reads what is there.
 */

import {
  BOLD,
  HIGHLIGHT,
  HIGHLIGHTS,
  ITALIC,
  STRIKE,
  UNDERLINE,
  normalizeRuns,
  type Marks,
  type TextRun,
} from "../model/text-note";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** The part of a DOM node this module reads. */
export interface NodeLike {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<NodeLike>;
  getAttribute?(name: string): string | null;
  readonly style?: {
    readonly fontWeight?: string;
    readonly fontStyle?: string;
    readonly textDecorationLine?: string;
    readonly textDecoration?: string;
  };
}

const TAG_MARKS: Readonly<Record<string, Marks>> = {
  B: BOLD,
  STRONG: BOLD,
  I: ITALIC,
  EM: ITALIC,
  U: UNDERLINE,
  INS: UNDERLINE,
  S: STRIKE,
  STRIKE: STRIKE,
  DEL: STRIKE,
  MARK: HIGHLIGHT,
};

/** The marks an element gives the text inside it, by its tag and its inline style. */
export function marksOf(node: NodeLike): Marks {
  let marks = TAG_MARKS[node.nodeName.toUpperCase()] ?? 0;
  if (marks === HIGHLIGHT) {
    // A coloured highlight names its colour; a plain <mark> is yellow.
    const tint = node.getAttribute?.("data-tint") ?? node.getAttribute?.("class") ?? "";
    const named = HIGHLIGHTS.find((h) => tint === h.name || tint === `fn-${h.name}`);
    if (named) marks = named.mark;
  }
  const style = node.style;
  if (style) {
    const weight = style.fontWeight ?? "";
    if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) marks |= BOLD;
    if (style.fontStyle === "italic" || style.fontStyle === "oblique") marks |= ITALIC;
    const line = `${style.textDecorationLine ?? ""} ${style.textDecoration ?? ""}`;
    if (line.includes("underline")) marks |= UNDERLINE;
    if (line.includes("line-through")) marks |= STRIKE;
  }
  return marks;
}

/** A text node's characters as the note keeps them: a line break is a space. */
function textOf(node: NodeLike): string {
  return (node.nodeValue ?? "").replace(/[\r\n]/g, " ");
}

/** The runs a paragraph's element holds. */
export function readRuns(root: NodeLike): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (node: NodeLike, marks: Marks): void => {
    if (node.nodeType === TEXT_NODE) {
      const text = textOf(node);
      if (text) runs.push({ text, marks });
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const inner = marks | marksOf(node);
    for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i], inner);
  };
  // The paragraph's own element gives no marks: a heading is bold by its kind.
  for (let i = 0; i < root.childNodes.length; i++) walk(root.childNodes[i], 0);
  return normalizeRuns(runs);
}

/** How many characters a node holds. */
export function textLength(node: NodeLike): number {
  if (node.nodeType === TEXT_NODE) return textOf(node).length;
  let length = 0;
  for (let i = 0; i < node.childNodes.length; i++) length += textLength(node.childNodes[i]);
  return length;
}

/**
 * A DOM position inside `root` (a node and an offset, as a selection gives
 * them) as a count of characters from the paragraph's start. A position
 * that is not inside `root` counts as its end.
 */
export function offsetOf(root: NodeLike, node: NodeLike, offset: number): number {
  let total = 0;
  let found = -1;
  const walk = (current: NodeLike): boolean => {
    if (current === node) {
      if (current.nodeType === TEXT_NODE) {
        found = total + Math.min(offset, textOf(current).length);
      } else {
        let before = 0;
        const count = Math.min(offset, current.childNodes.length);
        for (let i = 0; i < count; i++) before += textLength(current.childNodes[i]);
        found = total + before;
      }
      return true;
    }
    if (current.nodeType === TEXT_NODE) {
      total += textOf(current).length;
      return false;
    }
    for (let i = 0; i < current.childNodes.length; i++) {
      if (walk(current.childNodes[i])) return true;
    }
    return false;
  };
  walk(root);
  return found >= 0 ? found : total;
}

/**
 * The DOM position `offset` characters into `root`: a text node and an
 * offset in it, or `root` itself at 0 when it holds no text. At a boundary
 * between two text nodes it is the end of the first, so typing there
 * continues that run's marks.
 */
export function positionAt<N extends NodeLike>(
  root: N,
  offset: number,
): { node: N; offset: number } {
  let left = Math.max(0, offset);
  let last: { node: N; offset: number } | null = null;
  const walk = (current: NodeLike): { node: N; offset: number } | null => {
    if (current.nodeType === TEXT_NODE) {
      const length = textOf(current).length;
      if (length === 0) return null;
      if (left <= length) return { node: current as N, offset: left };
      left -= length;
      last = { node: current as N, offset: length };
      return null;
    }
    for (let i = 0; i < current.childNodes.length; i++) {
      const hit = walk(current.childNodes[i]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root) ?? last ?? { node: root, offset: 0 };
}
