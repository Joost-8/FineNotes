/**
 * Run something once what was just changed has reached the screen, so an
 * animation is not spent on frames the browser is too busy to show.
 */

/** Started anyway after this long: a hidden pane may never paint, ms. */
export const AFTER_PAINTED_MAX_MS = 250;

type Host = Pick<
  Window,
  "requestAnimationFrame" | "cancelAnimationFrame" | "setTimeout" | "clearTimeout"
>;

/**
 * Call `go` after two frames (the first is the one the change is drawn in),
 * once. Returns what cancels it.
 */
export function afterPainted(win: Host, go: () => void): () => void {
  let frame = 0;
  let timer = 0;
  let done = false;
  const stop = (): void => {
    done = true;
    win.cancelAnimationFrame(frame);
    win.clearTimeout(timer);
  };
  const finish = (): void => {
    if (done) return;
    stop();
    go();
  };
  frame = win.requestAnimationFrame(() => {
    frame = win.requestAnimationFrame(finish);
  });
  timer = win.setTimeout(finish, AFTER_PAINTED_MAX_MS);
  return stop;
}
