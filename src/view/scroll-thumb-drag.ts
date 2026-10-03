/** Pointer adapter for the existing scroll-thumb geometry. */
import { scrollThumb, thumbDragPosition } from "../canvas/scroll-thumb";

export interface ScrollThumbState {
  position: number;
  minimum: number;
  maximum: number;
  viewport: number;
  track: number;
}

export function bindScrollThumb(
  element: HTMLElement,
  vertical: boolean,
  read: () => ScrollThumbState,
  scroll: (position: number) => void,
  activity: () => void,
): () => void {
  let drag: { id: number; coordinate: number; position: number } | null = null;
  const coordinate = (event: PointerEvent): number => (vertical ? event.clientY : event.clientX);
  const finish = (notify: boolean): void => {
    if (!drag) return;
    const id = drag.id;
    drag = null;
    element.classList.remove("is-dragging");
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    if (notify) activity();
  };
  const down = (event: PointerEvent): void => {
    if (drag || event.button !== 0 || !event.isPrimary) return;
    const state = read();
    const position = Math.max(state.minimum, Math.min(state.maximum, state.position));
    if (
      !scrollThumb(
        position - state.minimum,
        state.viewport,
        state.maximum - state.minimum + state.viewport,
        state.track,
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    drag = { id: event.pointerId, coordinate: coordinate(event), position };
    element.classList.add("is-dragging");
    element.setPointerCapture(event.pointerId);
    scroll(position); // Stops any fling and removes overscroll before dragging.
    activity();
  };
  const move = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    event.stopPropagation();
    const state = read();
    scroll(
      state.minimum +
        thumbDragPosition(
          drag.position - state.minimum,
          coordinate(event) - drag.coordinate,
          state.viewport,
          state.maximum - state.minimum + state.viewport,
          state.track,
        ),
    );
    activity();
  };
  const end = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    event.stopPropagation();
    finish(true);
  };
  const host = element.ownerDocument.defaultView;
  const blur = (): void => finish(true);
  host?.addEventListener("blur", blur);
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", end);
  element.addEventListener("lostpointercapture", end);
  return () => {
    host?.removeEventListener("blur", blur);
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", end);
    element.removeEventListener("pointercancel", end);
    element.removeEventListener("lostpointercapture", end);
    finish(false);
  };
}
