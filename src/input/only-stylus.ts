/**
 * Only stylus mode's switches, as the toolbar and the surface read them.
 *
 * The mode itself is the one that matters: while it is on, a pointer that is
 * not the pen is ignored on the page (`input/palm-rejection.ts`). The three
 * switches around it only decide which chrome the mode brings: the toggle on
 * the tool bar, the hand, and the magnifier. All three are on unless the
 * settings say otherwise, and a stored file from before the mode is read the
 * same way.
 *
 * PURE: no DOM, no Obsidian.
 */

/** The fields of the settings the mode reads. A missing switch counts as on. */
export interface OnlyStylusSettings {
  onlyStylusMode?: boolean;
  onlyStylusToolbarButton?: boolean;
  onlyStylusHandTool?: boolean;
  onlyStylusZoomTool?: boolean;
}

/** What the mode puts on screen now. */
export interface OnlyStylusChrome {
  /** Fingers, palms and a mouse do nothing on the page. */
  mode: boolean;
  /** The toolbar carries the mode's toggle. */
  button: boolean;
  /** The hand tool is on the bar while the mode is on. */
  hand: boolean;
  /** The magnifier is on the bar while the mode is on. */
  zoom: boolean;
}

/** The chrome Only stylus mode shows, from the settings. */
export function onlyStylusChromeOf(settings: OnlyStylusSettings): OnlyStylusChrome {
  return {
    mode: settings.onlyStylusMode === true,
    button: settings.onlyStylusToolbarButton !== false,
    hand: settings.onlyStylusHandTool !== false,
    zoom: settings.onlyStylusZoomTool !== false,
  };
}
