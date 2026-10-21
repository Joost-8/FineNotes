/**
 * Checklist items made of handwriting (2.5). PURE.
 *
 * Lasso a handwritten line, Turn into › Task: the strokes become an
 * {@link InkTask}, with a box drawn left of them that a tap ticks. What the
 * line says is kept as text (read on the device, then confirmed), because
 * the note's `### Tasks` list (`recognition/task-index.ts`) needs words for
 * Obsidian's Tasks plugin to show. Ticking either one ticks the other.
 */

import type { Command } from "./commands";
import { type Bounds, type InkDocument, type InkTask, type Page, strokeBounds } from "./document";

/** The longest task text kept, in characters; more is cut. */
export const MAX_TASK_TEXT = 300;

/** One line, trimmed and bounded: what a task's text may be. */
export function normalizeTaskText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TASK_TEXT);
}

/** The next unused `ck<N>` task id in the notebook. */
export function nextTaskId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const task of page.tasks ?? []) {
      const m = /^ck(\d+)$/.exec(task.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `ck${max + 1}`;
}

/**
 * A page's tasks as read from a file: ids unique in the notebook (`seen`),
 * strokes that exist on the page, each stroke in one task at most, and a
 * task with no ink left dropped.
 */
export function normalizeTasks(
  raw: unknown,
  strokeIds: ReadonlySet<string>,
  seen: Set<string>,
): InkTask[] {
  if (!Array.isArray(raw)) return [];
  const out: InkTask[] = [];
  const claimed = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, strokes, text, done } = item as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seen.has(id) || !Array.isArray(strokes)) continue;
    const held = [
      ...new Set(
        strokes.filter(
          (s): s is string => typeof s === "string" && strokeIds.has(s) && !claimed.has(s),
        ),
      ),
    ];
    if (held.length === 0) continue;
    for (const s of held) claimed.add(s);
    seen.add(id);
    out.push({
      id,
      strokes: held,
      text: normalizeTaskText(text),
      ...(done === true ? { done: true as const } : {}),
    });
  }
  return out;
}

/**
 * Set one task of a page, by id: its strokes, text and tick, or (with
 * `null`) none. One undo step, which puts back exactly the list the page had.
 */
export class SetTask implements Command {
  readonly label: string;
  private previous: { tasks: InkTask[] | undefined } | null = null;

  constructor(
    private readonly page: Page,
    private readonly id: string,
    private readonly value: Omit<InkTask, "id"> | null,
    label?: string,
  ) {
    this.label = label ?? (value === null ? "Remove task" : "Task");
  }

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    if (!doc.pages.includes(this.page)) return;
    const before = this.page.tasks;
    this.previous = { tasks: before };
    const next = (before ?? []).filter((task) => task.id !== this.id);
    const value = this.value;
    if (value && value.strokes.length > 0) {
      const at = (before ?? []).findIndex((task) => task.id === this.id);
      const task: InkTask = {
        id: this.id,
        strokes: [...value.strokes],
        text: normalizeTaskText(value.text),
        ...(value.done === true ? { done: true as const } : {}),
      };
      next.splice(at >= 0 ? at : next.length, 0, task);
    }
    if (next.length > 0) this.page.tasks = next;
    else delete this.page.tasks;
  }

  invert(doc: InkDocument): void {
    if (this.previous === null || !doc.pages.includes(this.page)) return;
    const { tasks } = this.previous;
    if (tasks === undefined) delete this.page.tasks;
    else this.page.tasks = tasks;
    this.previous = null;
  }
}

/**
 * The commands that make `strokeIds` on `page` one task saying `text`: any
 * task already holding one of them gives it up (and goes when it has none
 * left), then the new task.
 */
export function makeTask(
  doc: InkDocument,
  page: Page,
  strokeIds: readonly string[],
  text: string,
): Command[] {
  const ids = new Set(strokeIds);
  if (ids.size === 0) return [];
  const commands: Command[] = [];
  for (const task of page.tasks ?? []) {
    if (!task.strokes.some((id) => ids.has(id))) continue;
    const rest = task.strokes.filter((id) => !ids.has(id));
    commands.push(new SetTask(page, task.id, rest.length > 0 ? { ...task, strokes: rest } : null));
  }
  commands.push(new SetTask(page, nextTaskId(doc), { strokes: [...ids], text }));
  return commands;
}

/** Tick or untick a task, as one undo step. */
export function tickTask(page: Page, task: InkTask, done: boolean): Command {
  const { id, ...rest } = task;
  const value: Omit<InkTask, "id"> = { strokes: rest.strokes, text: rest.text };
  if (done) value.done = true;
  return new SetTask(page, id, value, done ? "Tick task" : "Untick task");
}

/** A task box's size as a share of its ink's height, and its bounds, page px. */
const BOX_SHARE = 0.6;
const BOX_MIN = 10;
const BOX_MAX = 26;
/** Space between the box and the ink, page px. */
const BOX_GAP = 8;

/**
 * Where a task's box goes, page px, beside ink spanning `bounds`: left of
 * it, centred on its height, sized to the writing. The page and the export
 * both draw it here.
 */
export function taskBoxRect(bounds: { minX: number; minY: number; maxY: number }): {
  x: number;
  y: number;
  size: number;
} {
  const size = Math.min(BOX_MAX, Math.max(BOX_MIN, (bounds.maxY - bounds.minY) * BOX_SHARE));
  return {
    x: bounds.minX - BOX_GAP - size,
    y: (bounds.minY + bounds.maxY) / 2 - size / 2,
    size,
  };
}

/** The bounds of these strokes of a page, page px; `null` when none of them is there. */
export function inkBounds(page: Page, strokeIds: readonly string[]): Bounds | null {
  const ids = new Set(strokeIds);
  let out: Bounds | null = null;
  for (const stroke of page.strokes) {
    if (!ids.has(stroke.id)) continue;
    const b = strokeBounds(stroke);
    if (!b) continue;
    out = out
      ? {
          minX: Math.min(out.minX, b.minX),
          minY: Math.min(out.minY, b.minY),
          maxX: Math.max(out.maxX, b.maxX),
          maxY: Math.max(out.maxY, b.maxY),
        }
      : b;
  }
  return out;
}

/** The tasks of a page that hold any of these strokes. */
export function tasksOf(page: Page, strokeIds: readonly string[]): InkTask[] {
  const ids = new Set(strokeIds);
  return (page.tasks ?? []).filter((task) => task.strokes.some((id) => ids.has(id)));
}
