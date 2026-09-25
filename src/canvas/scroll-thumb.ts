/**
 * Where a scroll thumb sits, and how long it is. Pure: no DOM.
 *
 * The surface never scrolls natively — the paper moves by a transform — so
 * the browser draws no scrollbar and the page gives no sense of where in the
 * notebook it is. GoodNotes shows a thin thumb while the page moves and hides
 * it about a second after it stops (research/goodnotes-smoothness §2); the
 * surface draws one from this geometry.
 *
 * Units are CSS px along one axis. `position` is the scroll offset as the
 * scroller reports it, so it can run past `0` or `content − viewport` while
 * the content is rubber-banded; the thumb then shortens, as iOS's does.
 */

/** A thumb's offset along its track and its length, both px. */
export interface ThumbGeometry {
  offset: number;
  length: number;
}

/** Shortest a thumb gets from the content being long. */
export const MIN_THUMB_LENGTH = 36;
/** Shortest a thumb gets while squashed by a rubber-band stretch. */
export const MIN_SQUASHED_LENGTH = 8;

/**
 * The thumb for content of length `content` seen through a viewport of
 * `viewport`, scrolled to `position`, drawn on a track of `track` px. `null`
 * when everything fits, so there is nothing to scroll and no thumb to show.
 */
export function scrollThumb(
  position: number,
  viewport: number,
  content: number,
  track: number,
): ThumbGeometry | null {
  if (
    !Number.isFinite(position) ||
    !(viewport > 0) ||
    !(track > 0) ||
    !(content > viewport + 0.5)
  ) {
    return null;
  }
  const range = content - viewport;
  const natural = Math.min(track, Math.max(MIN_THUMB_LENGTH, (track * viewport) / content));
  // Past either end the content is stretched: the thumb gives up as much of
  // its length as the stretch, pinned to that end.
  const over = position < 0 ? -position : position > range ? position - range : 0;
  const length = Math.max(Math.min(natural, MIN_SQUASHED_LENGTH), natural - over);
  const progress = Math.min(1, Math.max(0, position / range));
  return { offset: (track - length) * progress, length };
}
