/**
 * Commands for audio recorded against a note (contracts/api.md §6): the
 * per-page stroke clock (`Page.epoch`) and the note's list of recordings.
 *
 * Every one is invertible and restores an absent key as absent (§3): a page
 * that had no `epoch` has none again after undo, and a note whose last
 * recording is removed loses the `recordings` key rather than keeping `[]`.
 * Undo never touches an audio file — the vault owns those.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type InkDocument, type Page, type Recording, type Stroke, pageById } from "./document";
import { AddStrokeToPage, CompositeCommand } from "./page-commands";

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The page acted on: by identity first, since page ids are only unique per
 * file and a duplicate or an import can repeat one (CLAUDE.md, "Resolve an
 * inverse by identity"); by id only when the page object is gone (the file
 * was reloaded).
 */
function resolvePage(doc: InkDocument, page: Page): Page | null {
  return doc.pages.includes(page) ? page : pageById(doc, page.id);
}

/** Set a page's stroke clock. Its inverse puts back what was there, absent included. */
export class SetPageEpoch implements Command {
  readonly label = "Start page clock";
  private target: Page | null = null;
  private previous: number | undefined;

  constructor(
    private readonly page: Page,
    private readonly epoch: number,
  ) {}

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    const page = resolvePage(doc, this.page);
    this.target = page;
    if (!page) return;
    this.previous = page.epoch;
    page.epoch = this.epoch;
  }

  invert(doc: InkDocument): void {
    const page = this.target && doc.pages.includes(this.target) ? this.target : null;
    if (!page) return;
    if (this.previous === undefined) delete page.epoch;
    else page.epoch = this.previous;
  }
}

/**
 * A stroke's timestamp for a pen-down at wall-clock `penDown` ms on `page`:
 * `t0` counts from the page's `epoch`, and a page without one gets one — this
 * pen-down, so its first stamped stroke has `t0 = 0`.
 *
 * `null` means "leave the stroke untimed": no usable pen-down time, or a
 * pen-down *before* the page's epoch (a device whose clock is behind the one
 * that started the page). `t0` must be `>= 0`, and absent means "unknown";
 * clamping an early stroke to 0 would claim it began exactly when the page
 * did (CLAUDE.md, "Clamping an out-of-range value invents a meaning").
 */
export function strokeTimestamp(
  page: Pick<Page, "epoch">,
  penDown: number | null | undefined,
): { t0: number; epoch?: number } | null {
  if (!isEpoch(penDown)) return null;
  const at = Math.round(penDown);
  if (!isEpoch(page.epoch)) return { t0: 0, epoch: at };
  const t0 = Math.round(at - page.epoch);
  return t0 >= 0 ? { t0 } : null;
}

/**
 * The command that adds freshly drawn `strokes` to `page`, timestamped with
 * their pen-down (`penDown`, wall-clock ms), as **one** undo step: when the
 * page has no clock yet, setting it is part of the same step, so undoing the
 * page's first stroke takes the clock with it.
 *
 * The strokes are stamped in place — they are new objects that no document
 * holds yet. Several strokes from one gesture (a table) share its pen-down.
 * With no usable time they are added exactly as before, untimed.
 */
export function addStrokesTimed(
  page: Page,
  strokes: readonly Stroke[],
  penDown: number | null | undefined,
  label = "Add stroke",
): Command {
  const stamp = strokes.length > 0 ? strokeTimestamp(page, penDown) : null;
  if (stamp) for (const stroke of strokes) stroke.t0 = stamp.t0;
  const parts: Command[] = strokes.map((stroke) => new AddStrokeToPage(page.id, stroke));
  if (stamp?.epoch !== undefined) parts.unshift(new SetPageEpoch(page, stamp.epoch));
  return parts.length === 1 ? parts[0] : new CompositeCommand(label, parts);
}

/**
 * Index of `recording` in the document: by identity, else by id and path
 * together (the file was reloaded since the object was read).
 */
function recordingIndex(doc: InkDocument, recording: Recording): number {
  const list = doc.recordings ?? [];
  const index = list.indexOf(recording);
  if (index >= 0) return index;
  return list.findIndex((r) => r.id === recording.id && r.path === recording.path);
}

/** Drop the `recordings` key once it is empty: absent is how "none" is stored. */
function pruneRecordings(doc: InkDocument): void {
  if (doc.recordings && doc.recordings.length === 0) delete doc.recordings;
}

/** Add a finished recording to the note. Undo takes the entry away; the audio file stays. */
export class AddRecording implements Command {
  readonly label = "Add recording";

  constructor(private readonly recording: Recording) {}

  apply(doc: InkDocument): void {
    (doc.recordings ??= []).push(this.recording);
  }

  invert(doc: InkDocument): void {
    const index = recordingIndex(doc, this.recording);
    if (index >= 0) doc.recordings?.splice(index, 1);
    pruneRecordings(doc);
  }
}

/**
 * "Remove from note": the entry goes, the audio file (and any transcript
 * note) stays in the vault. Undo puts the entry back where it was.
 */
export class RemoveRecording implements Command {
  readonly label = "Remove recording";
  private removed: { index: number; recording: Recording } | null = null;

  constructor(private readonly recording: Recording) {}

  apply(doc: InkDocument): void {
    const index = recordingIndex(doc, this.recording);
    const found = index >= 0 ? doc.recordings?.[index] : undefined;
    if (!found) {
      this.removed = null;
      return;
    }
    this.removed = { index, recording: found };
    doc.recordings?.splice(index, 1);
    pruneRecordings(doc);
  }

  invert(doc: InkDocument): void {
    const removed = this.removed;
    if (!removed) return;
    const list = (doc.recordings ??= []);
    list.splice(Math.min(removed.index, list.length), 0, removed.recording);
  }
}

/**
 * Point a recording at its transcript note (`transcript` a vault path), or
 * forget it (`undefined`). Undo restores the previous value, absent included.
 */
export class SetRecordingTranscript implements Command {
  readonly label = "Set transcript";
  private target: Recording | null = null;
  private previous: string | undefined;

  constructor(
    private readonly recording: Recording,
    private readonly transcript: string | undefined,
  ) {}

  apply(doc: InkDocument): void {
    const index = recordingIndex(doc, this.recording);
    const target = index >= 0 ? (doc.recordings?.[index] ?? null) : null;
    this.target = target;
    if (!target) return;
    this.previous = target.transcript;
    write(target, this.transcript);
  }

  invert(_doc: InkDocument): void {
    if (this.target) write(this.target, this.previous);
  }
}

function write(recording: Recording, transcript: string | undefined): void {
  if (transcript === undefined) delete recording.transcript;
  else recording.transcript = transcript;
}
