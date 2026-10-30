/**
 * Coalesced samples a pointermove hands over again (FineNotes#85).
 *
 * On the iPad (iPadOS 27.2, Pencil and mouse alike) a pointermove now and
 * then returns the very samples the move before it did: the reporter's
 * diagnostics held each batch of about four twice in a row, A A B B C C,
 * in 13 of 24 strokes. Kept, the stroke runs on, jumps back to the batch's
 * start and runs over it again. Opaque ink hides that; a highlighter is
 * translucent, so every repeat was a darker patch along the line.
 *
 * Measured on positions, not only on time stamps, since nothing says a
 * repeat keeps its stamp. Dropping a sample that sits where one of the last
 * move's did, at the same pressure, loses nothing: the pen did not move.
 */

/** A raw pointer sample: client px, pressure, time stamp (ms). */
export interface RawSample {
  x: number;
  y: number;
  pressure: number;
  t: number;
}

/**
 * The samples of `batch` that are new: not where a sample of `previous` (the
 * last move's samples) was at the same pressure, and not stamped before the
 * last of them. Order is kept.
 */
export function freshSamples<T extends RawSample>(
  batch: readonly T[],
  previous: readonly RawSample[],
): T[] {
  if (previous.length === 0) return [...batch];
  const last = previous[previous.length - 1].t;
  const seen = new Set(previous.map(keyOf));
  return batch.filter((s) => !(s.t < last) && !seen.has(keyOf(s)));
}

function keyOf(s: RawSample): string {
  return `${s.x},${s.y},${s.pressure}`;
}
