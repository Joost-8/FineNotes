/**
 * The notebook's checklist items as Markdown tasks (2.5), so Obsidian's
 * Tasks plugin, and Obsidian's own task queries, find them.
 *
 * Every checklist item — a "☐" line in a text box, or handwriting made a
 * task with the lasso — is one line of a list inside the managed text block,
 * between the page entries and the links list (`page-transcripts.ts`):
 *
 *     ### Tasks
 *     <!--goodobsidian-tasks-->
 *     - [ ] Buy milk [[#Page 3]] ^ft-ck1
 *     - [x] Read chapter 4 [[#Page 5]] ✅ 2026-10-21 ^ft-t7-0
 *
 * The block id at the end is the item's key: the Tasks plugin keeps it when
 * it rewrites the line, so a tick made there is read back into the notebook
 * when it next loads (`adoptTaskStates`). Only the box, the words and the
 * page link are FineNotes'; whatever Tasks added between the link and the
 * block id (a done date, a priority) is kept as it is.
 *
 * No DOM, no Obsidian.
 */

import type { InkDocument } from "../model/document";
import { setTaskDone, taskLines } from "../model/text-list";
import { TASKS_HEADING, TASKS_MARKER, splitTaskIndex, writeTaskIndex } from "./page-transcripts";
import { readTextSection, writeTextSection } from "./text-layer";

/** Where a checklist item lives in the notebook. */
export type TaskRef =
  | { kind: "box"; pageIndex: number; boxId: string; line: number }
  | { kind: "ink"; pageIndex: number; taskId: string };

/** One checklist item, as the note lists it. */
export interface TaskEntry {
  /** The block id, without its `^`. */
  id: string;
  text: string;
  done: boolean;
  /** 1-based page number, for the link back to the page. */
  page: number;
  ref: TaskRef;
}

/** A block id from an element's id: letters, digits and dashes only. */
function blockId(...parts: Array<string | number>): string {
  return `ft-${parts.map((part) => String(part).replace(/[^A-Za-z0-9]+/g, "-")).join("-")}`;
}

/** Every checklist item in the notebook, in page order: text boxes' first, then handwriting's. */
export function notebookTasks(doc: InkDocument): TaskEntry[] {
  const out: TaskEntry[] = [];
  doc.pages.forEach((page, pageIndex) => {
    for (const box of page.textBoxes) {
      taskLines(box.text).forEach((item, n) => {
        const text = item.text.trim();
        if (!text) return;
        out.push({
          id: blockId(box.id, n),
          text,
          done: item.done,
          page: pageIndex + 1,
          ref: { kind: "box", pageIndex, boxId: box.id, line: item.line },
        });
      });
    }
    const present = new Set(page.strokes.map((s) => s.id));
    for (const task of page.tasks ?? []) {
      // An erased task keeps its record until the notebook is next opened.
      if (!task.strokes.some((id) => present.has(id))) continue;
      out.push({
        id: blockId(task.id),
        text: task.text || "Handwritten task",
        done: task.done === true,
        page: pageIndex + 1,
        ref: { kind: "ink", pageIndex, taskId: task.id },
      });
    }
  });
  return out;
}

/** One line of the list as it is on disk now. */
interface ListedTask {
  /** The box's character: " ", "x", or another the Tasks plugin uses ("/", "-"). */
  status: string;
  /** What follows FineNotes' page link: the Tasks plugin's own fields. */
  extra: string;
}

const LINE_RE = /^[-*] \[(.)\] (.*?)\s+\^([A-Za-z0-9-]+)\s*$/;
const PAGE_LINK_RE = /\[\[#Page \d+\]\]/;

/** Whether a status character means done: `x`, as the Tasks plugin and Obsidian read it. */
function isDone(status: string): boolean {
  return status === "x" || status === "X";
}

/** The lines of a checklist block, by block id. A line without one is a hand edit, and left out. */
function readTaskBlock(block: string): Map<string, ListedTask> {
  const out = new Map<string, ListedTask>();
  for (const raw of block.split("\n")) {
    const m = LINE_RE.exec(raw.trim());
    if (!m) continue;
    const [, status, body, id] = m;
    const link = PAGE_LINK_RE.exec(body);
    const extra = link ? body.slice(link.index + link[0].length).trim() : "";
    out.set(id, { status, extra });
  }
  return out;
}

/** The words of a task, made safe for one Markdown list line. */
function lineText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\^/g, "").trim();
}

/**
 * The checklist block for these items, keeping what the Tasks plugin added
 * to each line on disk (`current`); "" when there are none.
 */
export function formatTaskIndex(entries: readonly TaskEntry[], current = ""): string {
  if (entries.length === 0) return "";
  const listed = readTaskBlock(current);
  const lines = entries.map((entry) => {
    const before = listed.get(entry.id);
    // The box agrees with the notebook; a status of the Tasks plugin's own
    // (in progress, cancelled) stays while it means the same.
    const status =
      before && isDone(before.status) === entry.done ? before.status : entry.done ? "x" : " ";
    const extra = before?.extra ? ` ${before.extra}` : "";
    return `- [${status}] ${lineText(entry.text)} [[#Page ${entry.page}]]${extra} ^${entry.id}`;
  });
  return [TASKS_HEADING, TASKS_MARKER, ...lines].join("\n");
}

/**
 * A note body with its checklist brought up to date with the notebook's
 * items: the same string when it already is, so a notebook without tasks
 * never gains an empty block.
 */
export function syncTaskIndex(body: string, entries: readonly TaskEntry[]): string {
  const section = readTextSection(body);
  const current = splitTaskIndex(section ?? "");
  const next = formatTaskIndex(entries, current);
  if (current === next) return body;
  return writeTextSection(body, writeTaskIndex(section, next));
}

/**
 * Take ticks made in the note (by the Tasks plugin, or by hand) into the
 * notebook: each item whose box on disk says otherwise is ticked or
 * unticked in place. Returns the ids of the pages that changed.
 */
export function adoptTaskStates(doc: InkDocument, body: string): string[] {
  const listed = readTaskBlock(splitTaskIndex(readTextSection(body) ?? ""));
  if (listed.size === 0) return [];
  const changed = new Set<string>();
  for (const entry of notebookTasks(doc)) {
    const disk = listed.get(entry.id);
    if (!disk || isDone(disk.status) === entry.done) continue;
    const done = isDone(disk.status);
    const page = doc.pages[entry.ref.pageIndex];
    const { ref } = entry;
    if (ref.kind === "box") {
      const box = page.textBoxes.find((b) => b.id === ref.boxId);
      if (!box) continue;
      box.text = setTaskDone(box.text, ref.line, done);
    } else {
      const task = page.tasks?.find((t) => t.id === ref.taskId);
      if (!task) continue;
      if (done) task.done = true;
      else delete task.done;
    }
    changed.add(page.id);
  }
  return [...changed];
}
