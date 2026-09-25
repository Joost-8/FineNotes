/**
 * Two small geometry types shared by the surface, the renderer and the
 * pointer controller. The coordinate transforms live in `page-layout.ts`,
 * which knows about pages; this file holds no code on purpose.
 */

/** What the view shows, in layout space: set by the surface, read by the renderer. */
export interface ViewportState {
  /** The layout y at the top edge of the pane. */
  scrollY: number;
  /** CSS px per layout px: fit-to-width scale times the user's zoom. */
  scale: number;
  /** The width of the layout, in layout px. */
  width: number;
}

/** A point, or a distance along each axis. */
export interface Vec2 {
  x: number;
  y: number;
}
