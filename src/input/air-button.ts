/**
 * The S Pen's side button on a WebView that sends no hovering moves at all
 * (discussion #209). Some tablets (a Tab S10 Ultra, Android 16, WebView 157)
 * pass the hovering pen on to the page as nothing: no `pointermove`, with or
 * without the button. The side button pressed in the air still arrives, as
 * one `contextmenu` where the pen is (Android's context click), and nothing
 * when it is let go.
 *
 * Erase on hover cannot work there: it needs the pen's positions in the air.
 * Holding the button and then touching down still can (FineNotes#149): the
 * WebView turns that drag into a text selection, which the selection bridge
 * (`stylus-select-bridge.ts`) reads, but only while it is armed, and it was
 * armed only by hovering moves or a pen just lifted. So the `contextmenu`
 * of the button in the air arms it too.
 *
 * {@link HoverWitness} decides when a `contextmenu` is that press, and
 * counts what the pen sent, so "Copy shape diagnostics" says whether this
 * device reports hover at all.
 *
 * Pure: no DOM, no Obsidian.
 */

/**
 * A hovering move this recent (ms) means the WebView does report hover: a
 * `contextmenu` then is the pen touching down with the button held, which the
 * hovering moves have already armed the bridge for (`stylus-click.ts`).
 */
export const HOVER_RECENT_MS = 1000;

/** A `contextmenu` as {@link HoverWitness.menu} reads it. */
export interface MenuReading {
  /** The event's `pointerType`, or "" where the browser leaves it out. */
  pointerType: string;
  timeStamp: number;
  /** A pen or mouse is down on the page, or a side-button press is held back. */
  pressing: boolean;
}

/** What the pen sent the page, for the diagnostics. */
export interface HoverSummary {
  /** Hovering pen moves seen (any buttons). */
  hoverMoves: number;
  /** Of those, the ones with the side button held. */
  barrelHoverMoves: number;
  /** Pen presses on the page. */
  penDowns: number;
  /** `contextmenu`s that were not a finger's. */
  menus: number;
  /** Of those, the ones taken for the side button in the air, with no hover to say so. */
  airMenus: number;
  /** Strokes the selection bridge read (hold the button, then touch down). */
  bridgeStrokes: number;
  /** Whether this device has sent a hovering pen move since the note opened. */
  hover: "seen" | "none";
}

/** One page's record of the pen's hovering, and its side button's `contextmenu`s. */
export class HoverWitness {
  private hoverMoves = 0;
  private barrelHoverMoves = 0;
  private penDowns = 0;
  private menus = 0;
  private airMenus = 0;
  private bridgeStrokes = 0;
  private lastHoverAt = Number.NEGATIVE_INFINITY;

  /** A hovering pen move at `t` (ms), the side button held or not. */
  hover(t: number, barrel: boolean): void {
    this.hoverMoves++;
    if (barrel) this.barrelHoverMoves++;
    this.lastHoverAt = t;
  }

  /** A pen pressed on the page. */
  down(): void {
    this.penDowns++;
  }

  /** The selection bridge began a stroke. */
  bridgeStroke(): void {
    this.bridgeStrokes++;
  }

  /**
   * A `contextmenu`: whether it is the side button pressed in the air on a
   * WebView that sent no hovering move just before, so the selection bridge
   * should be armed where it came. Never a finger's, never with a press under
   * way (Chromium sends one for a long press too).
   */
  menu(r: MenuReading): boolean {
    if (r.pointerType === "touch") return false;
    this.menus++;
    if (r.pressing) return false;
    const sinceHover = r.timeStamp - this.lastHoverAt;
    if (sinceHover >= 0 && sinceHover < HOVER_RECENT_MS) return false;
    this.airMenus++;
    return true;
  }

  summary(): HoverSummary {
    return {
      hoverMoves: this.hoverMoves,
      barrelHoverMoves: this.barrelHoverMoves,
      penDowns: this.penDowns,
      menus: this.menus,
      airMenus: this.airMenus,
      bridgeStrokes: this.bridgeStrokes,
      hover: this.hoverMoves > 0 ? "seen" : "none",
    };
  }
}
