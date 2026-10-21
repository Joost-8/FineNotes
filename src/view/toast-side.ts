/**
 * PURE. Which end of the page area a toast takes: the end away from the
 * tool bar and its pill, so a toast never covers them. The bar sits above
 * the page, so that is the bottom, until the floating pill (the text pill,
 * anchored by its box) sits in the lower half; then it is the top.
 */

/** A vertical span in screen px. */
export interface Span {
  top: number;
  bottom: number;
}

export type ToastSide = "top" | "bottom";

/**
 * `area` is the page area the toast shows in; `chrome` the bar and the pill
 * as shown (empty spans, a hidden pill, are ignored). The toast goes to the
 * end away from the chrome over the area that sits nearest its middle.
 */
export function toastSide(area: Span, chrome: readonly Span[]): ToastSide {
  const middle = (area.top + area.bottom) / 2;
  let lower = false;
  let nearest = Infinity;
  for (const span of chrome) {
    if (!(span.bottom > span.top)) continue;
    // Only chrome over the area can be covered by a toast in it.
    if (span.bottom <= area.top || span.top >= area.bottom) continue;
    const centre = (span.top + span.bottom) / 2;
    const away = Math.abs(centre - middle);
    if (away < nearest) {
      nearest = away;
      lower = centre > middle;
    }
  }
  return lower ? "top" : "bottom";
}
