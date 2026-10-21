/**
 * Bulleted, numbered and checklist lists in a page text box. PURE.
 *
 * A list is written into the text itself — "• ", "1. " or a box "☐ " / "☑ "
 * at the start of a line — rather than kept as a style, so it survives
 * everything plain text does: saving, search, export, transcription and
 * another device. The text pill's list button toggles the lines under the
 * selection; Enter on a list line continues the list, and Enter on an empty
 * item ends it (GoodNotes and every word processor behave this way).
 *
 * A checklist (2.5) uses the two glyphs the Notability importer and the AI's
 * answers already write, so those became live checklists; each item is also
 * written into the note as a `- [ ]` task (`recognition/task-index.ts`).
 */

export type ListKind = "bullet" | "number" | "task";

/** The marker a bullet line starts with. */
export const BULLET = "• ";
/** The marker of a checklist item still to do, and of one done. */
export const TASK_OPEN = "☐ ";
export const TASK_DONE = "☑ ";

/** A line's leading list marker: the indent, the marker, and what it is. */
interface Marker {
  indent: string;
  marker: string;
  kind: ListKind;
  /** The item number, for a numbered line. */
  n: number;
  /** A checklist item that is ticked. */
  done: boolean;
}

const MARKER = /^([ \t]*)(?:(•) |(\d{1,4})[.)] |([☐☑]) )/;

function markerOf(line: string): Marker | null {
  const m = MARKER.exec(line);
  if (!m) return null;
  const [whole, indent] = m;
  const marker = whole.slice(indent.length);
  if (m[2]) return { indent, marker, kind: "bullet", n: 0, done: false };
  if (m[4]) return { indent, marker, kind: "task", n: 0, done: m[4] === "☑" };
  return { indent, marker, kind: "number", n: Number(m[3]), done: false };
}

/** The list a line belongs to, or `null` for a plain line. */
export function listKindOf(line: string): ListKind | null {
  return markerOf(line)?.kind ?? null;
}

/** The text and selection after an edit. */
export interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Start offset of each line of `text`. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** Index of the line holding offset `at`. */
function lineAt(starts: readonly number[], at: number): number {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= at) line++;
  return line;
}

/**
 * Move an offset after a line's first `from` chars became `to` chars. An
 * offset at the line's very start moves past a new marker (a caret on an
 * empty line lands after "• "), unless `stay` — a selection's start, which
 * should go on covering the whole line.
 */
function shiftOffset(
  offset: number,
  lineStart: number,
  from: number,
  to: number,
  stay = false,
): number {
  if (offset < lineStart || (stay && offset === lineStart)) return offset;
  // Inside the replaced prefix: land after the new one.
  if (offset < lineStart + from) return lineStart + to;
  return offset + to - from;
}

/**
 * Renumber the numbered run that contains line `index`, from its first item:
 * 1, 2, 3 … in the same indent. Returns the new lines; selection offsets are
 * the caller's business (see {@link applyLines}).
 */
function renumberedRun(lines: string[], index: number): Map<number, string> {
  const out = new Map<number, string>();
  const at = markerOf(lines[index] ?? "");
  if (!at || at.kind !== "number") return out;
  let first = index;
  while (first > 0) {
    const prev = markerOf(lines[first - 1]);
    if (!prev || prev.kind !== "number" || prev.indent !== at.indent) break;
    first--;
  }
  let n = 1;
  for (let i = first; i < lines.length; i++) {
    const m = markerOf(lines[i]);
    if (!m || m.kind !== "number" || m.indent !== at.indent) break;
    const marker = `${n}. `;
    if (m.marker !== marker) {
      out.set(i, m.indent + marker + lines[i].slice(m.indent.length + m.marker.length));
    }
    n++;
  }
  return out;
}

/** Replace whole lines, keeping the selection on the same characters. */
function applyLines(
  text: string,
  replaced: ReadonlyMap<number, string>,
  selectionStart: number,
  selectionEnd: number,
): TextEdit {
  const lines = text.split("\n");
  const starts = lineStarts(text);
  let start = selectionStart;
  let end = selectionEnd;
  // Back to front, so earlier line starts stay valid for the offsets.
  const order = [...replaced.keys()].sort((a, b) => b - a);
  for (const i of order) {
    const before = lines[i];
    const after = replaced.get(i) ?? before;
    // Only a line's prefix changes here: its common tail keeps its offsets.
    let tail = 0;
    while (
      tail < before.length &&
      tail < after.length &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
      tail++;
    }
    const from = before.length - tail;
    const to = after.length - tail;
    start = shiftOffset(start, starts[i], from, to, selectionStart < selectionEnd);
    end = shiftOffset(end, starts[i], from, to);
    lines[i] = after;
  }
  return { text: lines.join("\n"), selectionStart: start, selectionEnd: end };
}

/**
 * The list button: make the lines under the selection a `kind` list, or, if
 * every one of them already is one, plain lines again. A numbered list is
 * numbered from 1 and the run it joins is renumbered.
 */
export function toggleList(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  kind: ListKind,
): TextEdit {
  const lines = text.split("\n");
  const starts = lineStarts(text);
  const lo = Math.min(selectionStart, selectionEnd);
  const hi = Math.max(selectionStart, selectionEnd);
  const first = lineAt(starts, lo);
  // A selection ending at the very start of a line does not take that line.
  let last = lineAt(starts, hi);
  if (last > first && hi === starts[last]) last--;

  const all = lines.slice(first, last + 1).every((line) => listKindOf(line) === kind);
  const replaced = new Map<number, string>();
  let n = 1;
  for (let i = first; i <= last; i++) {
    const line = lines[i];
    const m = markerOf(line);
    const indent = m?.indent ?? /^[ \t]*/.exec(line)?.[0] ?? "";
    const body = line.slice(indent.length + (m?.marker.length ?? 0));
    // A line that is already a checklist item keeps its tick.
    const marker = all
      ? ""
      : kind === "bullet"
        ? BULLET
        : kind === "task"
          ? m?.done
            ? TASK_DONE
            : TASK_OPEN
          : `${n++}. `;
    replaced.set(i, indent + marker + body);
  }
  let edit = applyLines(text, replaced, selectionStart, selectionEnd);
  if (!all && kind === "number") {
    const after = edit.text.split("\n");
    edit = applyLines(
      edit.text,
      renumberedRun(after, first),
      edit.selectionStart,
      edit.selectionEnd,
    );
  }
  return edit;
}

/**
 * Enter at `caret` on a list line: the next item's marker on a new line
 * (renumbering the numbers after it), or — on an item with nothing written
 * after its marker — the marker removed, which ends the list. `null` for a
 * plain line: let Enter do what it does.
 */
export function continueList(text: string, caret: number): TextEdit | null {
  const starts = lineStarts(text);
  const index = lineAt(starts, caret);
  const lineStart = starts[index];
  const lineEnd = index + 1 < starts.length ? starts[index + 1] - 1 : text.length;
  const line = text.slice(lineStart, lineEnd);
  const m = markerOf(line);
  if (!m) return null;
  const prefixEnd = lineStart + m.indent.length + m.marker.length;
  // Enter inside the marker itself is not a list continuation.
  if (caret < prefixEnd) return null;
  if (line.slice(m.indent.length + m.marker.length).trim() === "") {
    const out = text.slice(0, lineStart) + m.indent + text.slice(prefixEnd);
    const at = lineStart + m.indent.length;
    return { text: out, selectionStart: at, selectionEnd: at };
  }
  // The next item of a checklist starts unticked.
  const next = m.kind === "bullet" ? BULLET : m.kind === "task" ? TASK_OPEN : `${m.n + 1}. `;
  const insert = `\n${m.indent}${next}`;
  const out = text.slice(0, caret) + insert + text.slice(caret);
  const at = caret + insert.length;
  if (m.kind !== "number") return { text: out, selectionStart: at, selectionEnd: at };
  return applyLines(out, renumberedRun(out.split("\n"), index + 1), at, at);
}

/** A checklist item of a text box: its line, whether it is ticked, and what it says. */
export interface TaskLine {
  /** Index of the line in the text. */
  line: number;
  done: boolean;
  text: string;
}

/** Where each checklist item's box is in `text`: its offset, its line, and whether ticked. */
export function taskBoxes(text: string): Array<{ offset: number; line: number; done: boolean }> {
  const out: Array<{ offset: number; line: number; done: boolean }> = [];
  let start = 0;
  text.split("\n").forEach((line, index) => {
    const m = markerOf(line);
    if (m?.kind === "task")
      out.push({ offset: start + m.indent.length, line: index, done: m.done });
    start += line.length + 1;
  });
  return out;
}

/** Every checklist item in `text`, in order. */
export function taskLines(text: string): TaskLine[] {
  const out: TaskLine[] = [];
  text.split("\n").forEach((line, index) => {
    const m = markerOf(line);
    if (m?.kind !== "task") return;
    out.push({ line: index, done: m.done, text: line.slice(m.indent.length + m.marker.length) });
  });
  return out;
}

/**
 * `text` with the checklist item on line `line` ticked (`done`) or not;
 * unchanged when that line is no checklist item or already says so.
 */
export function setTaskDone(text: string, line: number, done: boolean): string {
  const lines = text.split("\n");
  const m = markerOf(lines[line] ?? "");
  if (m?.kind !== "task" || m.done === done) return text;
  const body = lines[line].slice(m.indent.length + m.marker.length);
  lines[line] = m.indent + (done ? TASK_DONE : TASK_OPEN) + body;
  return lines.join("\n");
}
