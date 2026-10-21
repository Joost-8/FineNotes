/**
 * Ink replay (2.5): while a recording plays, ink not yet written at that
 * moment is drawn pale and comes back to full colour when the playback
 * reaches it, as Notability replays a note. PURE.
 *
 * A stroke's moment is its pen-down (`strokeTime`); nothing stores when it
 * was lifted, so a stroke comes back whole. Only ink written while this
 * recording ran takes part: ink from before it, after it, or with no time
 * at all stays as it is.
 */

import type { Page, Recording } from "../model/document";
import { strokeTime } from "./recording";

/** One stroke written during a recording: where it is, and how far into the recording. */
export interface ReplayStroke {
  pageId: string;
  id: string;
  /** Ms into the recording. */
  at: number;
}

/** The strokes written while `recording` ran, in the order they were written. */
export function replayTimeline(pages: readonly Page[], recording: Recording): ReplayStroke[] {
  const out: ReplayStroke[] = [];
  for (const page of pages) {
    for (const stroke of page.strokes) {
      const time = strokeTime(page, stroke);
      if (time === null) continue;
      const at = time - recording.start;
      if (at < 0 || at > recording.duration) continue;
      out.push({ pageId: page.id, id: stroke.id, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * How many strokes of the timeline are written `ms` into the recording.
 * Playback asks every frame; the pale set changes only when this does.
 */
export function writtenCount(timeline: readonly ReplayStroke[], ms: number): number {
  let lo = 0;
  let hi = timeline.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].at <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The ids of the strokes not written yet `ms` into the recording: the ones drawn pale. */
export function fadedAt(timeline: readonly ReplayStroke[], ms: number): Set<string> {
  const out = new Set<string>();
  for (const stroke of timeline) if (stroke.at > ms) out.add(stroke.id);
  return out;
}

/**
 * The page being written `ms` into the recording: that of the last stroke
 * written by then, or `null` before the first.
 */
export function writingAt(timeline: readonly ReplayStroke[], ms: number): string | null {
  let page: string | null = null;
  for (const stroke of timeline) {
    if (stroke.at > ms) break;
    page = stroke.pageId;
  }
  return page;
}

/** Strokes in one set and not the other, both ways: what a step of playback changed. */
export function fadeChanges(before: ReadonlySet<string>, after: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of before) if (!after.has(id)) out.add(id);
  for (const id of after) if (!before.has(id)) out.add(id);
  return out;
}
