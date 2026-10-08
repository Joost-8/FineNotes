# Contract: GoodObsidian

<!-- Single source of truth for the core(model)↔ui(view) boundary.
     ONLY the orchestrator edits this file. Version bump on every change.
     An agent that finds this contract wrong does NOT edit it — it finishes
     what it can and requests the change in its final report. -->

Version: 8

## Scope of this contract

GoodObsidian adds four things to the ink engine it started from: **pages**,
**backdrops**, **images**, and **shape snapping**. This document specifies only
those. Every pre-existing interface (`Stroke`, `commands.ts`, `history.ts`,
`serialize.ts`, the renderer, the pointer controller) keeps its current shape
and is _not_ re-specified here — read the code.

Two rules that override any convenience:

1. **`src/model/**` and `src/ink/shape-*.ts` stay pure.** No DOM, no Obsidian
   imports, no network. This is upstream's convention and it is why these
   things are testable at all.
2. **Everything mutating a document goes through a `Command`** with
   `apply()`/`invert()`. That is how undo stays free. A direct mutation is a bug.

---

## 1. The page model (schema v2)

Upstream's `InkDocument.regions[]` is an array that only ever holds one
element. **That array becomes the page sequence.** `Region` is renamed `Page`
with a type alias kept for compatibility.

```ts
/** A page's intrinsic coordinate space, in CSS px. Fixed — never viewport-derived. */
export interface PageGeometry {
  width: number;
  height: number;
}

export type Backdrop = SyntheticBackdrop | PdfBackdrop;

/**
 * Paper ruling. Taken from GoodNotes' own "Create Notebook" template picker
 * (Essentials + Writing papers), which Joost supplied as the reference.
 * "lined" and "grid" are kept as aliases of "ruled-wide"/"squared" so v1
 * documents and the existing fixtures stay valid.
 */
export type Ruling =
  | "blank"
  | "dotted"
  | "ruled-narrow"
  | "ruled-wide"
  | "squared"
  | "cornell"
  | "legal"
  | "single-column"
  | "three-column"
  | "lined" // @deprecated alias of "ruled-wide"
  | "grid"; // @deprecated alias of "squared"

export interface SyntheticBackdrop {
  kind: Ruling;
  /** Rule/grid pitch in page px. Ignored for "blank". Default per ruling. */
  spacing?: number;
  /** Rule colour, hex. Default per ruling. */
  color?: string;
  /**
   * Paper colour, hex — an axis of its own, exactly as GoodNotes separates
   * "Squared Paper" from "Yellow Paper". Default `#ffffff`.
   * Presets: white #ffffff, cream #fbf8ed, yellow #fdf6d8.
   */
  paperColor?: string;
}

export interface PdfBackdrop {
  kind: "pdf";
  /** Vault-relative path to the source PDF. Never modified by this plugin. */
  path: string;
  /** 0-based page index within that PDF. */
  page: number;
}

export interface ImageElement {
  id: string;
  /** Vault-relative path to the image attachment. */
  path: string;
  /** Top-left in page space, and size in page space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians, clockwise, about the element centre. Default 0. */
  rotation?: number;
}

export interface Page {
  id: string;
  kind: "ink";
  geometry: PageGeometry;
  backdrop: Backdrop;
  strokes: Stroke[];
  images: ImageElement[];
}

export interface InkDocument {
  version: number; // 2
  view: ViewState;
  pages: Page[]; // was `regions`
  recognizedHash?: string;
}
```

**Stroke coordinates are page-local**, not document-global. This is the whole
point of pagination: a stroke at `(100, 200)` on page 3 means the same physical
place on every device, because the page has a fixed intrinsic size and the view
scales the page to fit. Nothing in `model/` may read viewport dimensions.

### Defaults

- `DEFAULT_PAGE_GEOMETRY` = `{ width: 1024, height: 1448 }` — 1024 wide to match
  upstream's `DEFAULT_PAPER_WIDTH` (so v1 ink keeps its scale), and A4's √2
  ratio so PDF export is 1:1 later.
- A new page inherits the geometry and backdrop of the page it follows.
- **Orientation is not a field.** Landscape is the same page with `width` and
  `height` swapped, so it costs nothing in the model and is purely a UI
  affordance at notebook creation.

### Ruling specifications

Draw these to match the reference screenshots. Pitch is in page px at the
default 1024×1448 geometry.

| Ruling                 | Draw                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `blank`                | nothing                                                                                                |
| `dotted`               | dots of **radius** 1.5 px (3 px across) on a 40 px square lattice                                      |
| `ruled-narrow`         | horizontal rules every 28px                                                                            |
| `ruled-wide` / `lined` | horizontal rules every 40px                                                                            |
| `squared` / `grid`     | 1px square grid, 28px pitch                                                                            |
| `cornell`              | ruled-wide, plus a vertical cue line at 25% width and a horizontal summary line 20% up from the bottom |
| `legal`                | ruled-wide, plus a double vertical margin rule near the left edge                                      |
| `single-column`        | one centred text column with generous side margins, ruled inside                                       |
| `three-column`         | three equal ruled columns separated by vertical rules                                                  |
| `single-column-mix`    | a blank title band (top 16%) closed by a full-width rule, over a single-column ruled body              |
| `todos`                | a two-row header rule, then 48px rows each with a checkbox at the left margin                          |
| `weekly-planner`       | a title band, then seven labelled day blocks (MON–SUN), each ruled every 36px right of a label column  |
| `monthly-planner`      | a title band, a weekday header row, and a 7 × 6 calendar grid                                          |
| `accounting`           | 32px ledger rules under a header band, with date / description / debit / credit / balance columns      |
| `music`                | five-line staves, 12px line pitch, separated by 7 pitches, closed by bar lines                         |
| `guitar-tab`           | six-line staves, 14px line pitch, each marked T-A-B at the left                                        |
| `two-column`           | two equal ruled columns separated by one vertical rule                                                 |
| `margin-left`          | ruled-wide with a blank column 30% wide at the left, closed by a vertical rule                         |
| `margin-right`         | the same, blank column at the right                                                                    |
| `handwriting`          | groups of three lines 22px apart (solid, dashed waist, solid baseline), groups 4.4 pitches apart       |
| `storyboard`           | two columns of 16:9 frames, each with two caption rules 32px apart under it                            |
| `meeting-notes`        | Meeting / Date / Attendees header, ruled notes, action items with checkboxes in the bottom 30%         |
| `graph`                | 24px square grid, every fifth line twice as heavy                                                      |
| `isometric`            | vertical lines and lines at ±30°, a triangular lattice of side 32px                                    |
| `isometric-dots`       | dots at the points of the same lattice                                                                 |
| `hexagon`              | flat-topped hexagons of side 24px                                                                      |
| `daily-planner`        | Date line; 6:00–21:00 hourly schedule on the left; priorities, to-dos and notes on the right           |
| `habit-tracker`        | Month line; a habit-name column and 31 numbered day columns, rows every 36px                           |
| `weekly-grid`          | Week-of line; a 2 × 4 grid of MON–SUN and NOTES boxes, each ruled every 32px                           |
| `music-tab`            | systems of a five-line staff over a six-line T-A-B staff, 12px pitch, joined at the left               |

Added 2026-09-21 for the template picker (the second group, from `two-column`
on, 2026-10-06). A build older than that loads these as
`blank` (the unknown-ruling fallback in `serialize.ts`) and would save them back
as `blank`, so the page keeps its ink but loses its paper there.

A notebook-level **cover** and **title** are metadata, not page data: they live
in `_notebook.md`'s frontmatter (see §1b), not in the stroke document.

**Dark paper is a notebook property, not a device preference.** The frontend
provisionally stored it in Obsidian's per-vault local storage keyed by file
path, which is per-device and does not sync — wrong, because whether a
notebook uses dark paper should follow the notebook to the iPad. It belongs in
`_notebook.md` frontmatter as `dark-paper: true`. Until that lands the
local-storage behaviour stands, as a known deviation.

### Migration v1 → v2 (owned by `serialize.ts`)

A v1 document has `regions: [{ id, kind:"ink", strokes }]` and an unbounded
paper roll. Load it as:

- one `Page` per v1 region, `geometry = { width: doc.view.width, height: max(DEFAULT height, lowest stroke y + margin) }`,
- `backdrop = { kind: "blank" }`, `images = []`.

The migration must be **lossless for strokes** and is unit-tested both
directions. Saving a migrated document writes v2; there is no v2 → v1 downgrade.

---

## 1b. The notebook on disk (schema v3) — decided by Joost, 2026-09-20

A notebook is **a folder**, and **each page is its own file**:

```
Lectures/Analysis/
  _notebook.md          # title, cover, page order — the only thing reorder touches
  p-001.ink.md          # one page: frontmatter + text layer + one-page data block
  p-002.ink.md
  thumbs/               # generated page thumbnails
    p-001.png
```

`_notebook.md` frontmatter carries `goodobsidian-notebook: true`, `title`,
`cover` (a page id), and `pages` — an **ordered list of page filenames**, which
is the page order. Reordering, duplicating or deleting a page rewrites this one
small file and never touches page content.

Each `p-*.ink.md` is a complete ink note in the existing format: frontmatter,
a markdown body (the **text layer**), and one `%%goodobsidian … %%` block whose
`InkDocument` holds exactly **one** page.

### Why this layout, and what it costs

Chosen for one reason that nothing else delivers: **transcription output
becomes that page's markdown body**, so Obsidian's own search returns _page 34
of Analysis_ rather than "somewhere in Analysis", and `[[p-034]]` links and
backlinks reach an individual handwritten page. GoodNotes cannot do this at any
price, and it is the only place this fork is ahead rather than catching up.
Secondary wins: a sync conflict is scoped to one page instead of a whole
notebook, reorder is a metadata edit, and the view can **lazily load only
visible pages** — which is what makes a 200-page notebook viable on an iPad.

The cost is real and was accepted with eyes open: **file-count noise**, roughly
540 page files for a six-course semester, showing up in the file explorer, the
graph and the quick switcher. Mitigate with a folder exclusion, not by changing
the layout.

`thumbs/` is **deliberately not dot-prefixed** — sync services skip dot
folders, which is exactly the trap that forced a competitor to add an
"Obsidian Sync compatibility" toggle.

### Consequence for the model

`InkDocument` stays as it is and represents **one page's file**. The notebook
is a new, separate concept the _view_ composes:

```ts
export interface NotebookPageRef {
  /** Page id, and the basename of its file: `p-001` -> `p-001.ink.md`. */
  id: string;
  /**
   * Filename **relative to the notebook folder**, e.g. `p-001.ink.md`.
   *
   * Not a vault-relative path, which is what v4 of this contract said. A
   * notebook that stored absolute paths would break the moment the folder was
   * renamed or moved, and renaming a notebook must not rewrite every page
   * entry. The implementation had this right; the contract did not.
   */
  file: string;
}

export interface Notebook {
  title: string;
  /** Page id used as the cover. A cover is just a page — GoodNotes does the same. */
  cover?: string;
  /** Ordered. This array IS the page order. */
  pages: NotebookPageRef[];
}
```

Loading a notebook reads `_notebook.md`, then each page file on demand.
`model/` stays pure: parsing `_notebook.md` is a pure function over a string;
reading files is the view's job.

### Per-stroke timestamp, added in the same migration

`Stroke` gains one optional field:

```ts
/** Milliseconds from the start of the page's first stroke to this stroke's pen-down. */
t0?: number;
```

Added **now**, while there is nothing to migrate. GoodNotes has time-stamped
every stroke against audio since January 2023 ("Note Replay"), so ink-synced
audio is table stakes for a replacement, and retrofitting a timestamp onto
notebooks that already exist is a migration nobody wants. One optional
integer, quantized as an integer at serialize time, absent on old strokes.

---

## 2. Shape recognition (hold-to-snap)

Pure module: `src/ink/shape-recognizer.ts`. No DOM.

```ts
export type ShapeKind =
  | "line"
  | "circle"
  | "rect"
  | "arrow"
  // added 2026-09-21 — ellipse and polygons from hold-to-snap, plus the
  // Shape tool's presets (diamond, roundrect are also placed directly)
  | "ellipse"
  | "triangle"
  | "diamond"
  | "roundrect"
  | "polygon";

export interface ShapeResult {
  kind: ShapeKind;
  /** Clean replacement geometry, same flat `[x,y,p,…]` layout as Stroke.pts. */
  pts: number[];
  /** 0..1. Below `minConfidence` the caller must keep the raw stroke. */
  confidence: number;
}

export interface RecognizeOptions {
  /** Reject a match below this. Default 0.65 (`SNAP_MIN_CONFIDENCE`). */
  minConfidence?: number;
  /**
   * Also fit diamonds, skewed quads, pentagons and hexagons. Triangles are
   * always fitted. Default false.
   */
  polygons?: boolean;
  /**
   * Base closing distance in page px. Default 24.
   *
   * The effective test is **relative**, because a flat 24 px is far too tight
   * for a large loop — a 600 px circle routinely leaves a 40–60 px gap:
   *
   *   closed = gap <= max(closeTolerance, 0.1 * bboxDiagonal)
   */
  closeTolerance?: number;
}

/** Returns null when the stroke is not confidently any known shape. */
export function recognizeShape(pts: number[], opts?: RecognizeOptions): ShapeResult | null;
```

**A snapped shape is still an ordinary `Stroke`.** Recognition replaces
`stroke.pts` with clean geometry and sets `stroke.shape = kind`; it does not
introduce a parallel element type. This is deliberate — rendering, hit-testing,
erasing, lasso and serialization then need no changes at all.

```ts
// added to the existing Stroke interface, optional so v1 strokes stay valid
shape?: ShapeKind;
```

Pressure in a snapped shape's `pts` is set to a constant (the stroke's mean
pressure) so the line reads as deliberate rather than hand-wobbled.

### Emitted geometry, per kind

The renderer depends on these layouts; they are contract, not implementation.

| Kind                             | `pts` layout                                                     |
| -------------------------------- | ---------------------------------------------------------------- |
| `line`                           | 2 points: `[start, end]`                                         |
| `rect`                           | 5 points, closed: the four corners, first repeated last          |
| `circle`                         | 33 points: a closed polygon sampled every 11.25°                 |
| `arrow`                          | 6 points: `[tail, tip, tip, barb1, tip, barb2]`                  |
| `ellipse`                        | 65 points: a closed polygon sampled every 5.625°                 |
| `triangle`, `diamond`, `polygon` | n+1 points, closed: the vertices, first repeated last            |
| `roundrect`                      | 37 points, closed: four 8-segment quarter-arcs (Shape tool only) |

A shape's `pts` are sparse on purpose. The renderer draws a shape as its
exact centreline, stroked at the stroke's `size` with round joins and caps —
never smoothed as handwriting is: perfect-freehand, which drew handwriting
until 2026-09-30, cut every corner of sparse vertices (a 200 x 120 rect
rendered as ~165 x 99), and the midpoint curve that draws handwriting now
would round them too.

**Erased pieces keep `shape`.** The standard eraser cuts a shape (or a
table's lines) into pieces that keep the original `shape` kind, so they are
still drawn as clean geometry and the lasso's "shapes" filter still picks
them up. A piece does not follow the layout table above — half a `rect` has
three or four points, not five. Nothing may read a kind's layout off a
stored stroke; the table describes what recognition and the Shape tool emit.

### Three deliberate limits (decided 2026-09-20, not accidents)

1. **Minimum size.** A stroke whose bounding-box diagonal is under 24 px is
   never snapped. Small deliberate marks stay as drawn.
2. **Circle or ellipse is decided by aspect, not by score** (revised
   2026-09-21; v1 had no `ellipse` and refused ovals). A loop whose
   minor/major extent ratio is ≥ 0.85 (≈1.18:1) goes to the circle fitter and
   is circularised; below it, to the ellipse fitter, which keeps the drawn
   proportions and snaps a tilt within 8° of level.
3. **A one-barb arrow is refused.** Accepting it turns every checkmark and
   every "L" into an arrow; this was measured, and it is not close. Only the
   full tail→tip→barb→tip→barb gesture snaps.
4. **A rounded rectangle snaps to `rect`.** Independent testing found this is
   the one case out of 27 adversarial shapes that is _not_ refused. After the
   real-ink retune (below): corner radius 24 px scores 0.97, 60 px scores
   0.92, 90 px returns null, and at 120 px (40 % of the short side) the loop
   reads as an `ellipse` at 0.80. Judged desirable — GoodNotes snaps rounded
   rects too — and recorded here so the "zero false positives" claim is not
   repeated without its exceptions.
5. **Regular polygons read as circles when polygon fitting is off.** The
   circle gate is a corner test at a 5 %-of-diagonal RDP capped at 75°; a
   pentagon turns 72°, a hexagon 60°, an octagon 45°, all under the cap,
   while real Pencil circles measure up to 62° there (the chord angle at that
   tolerance) and a square 90°. The cap cannot come down without refusing
   real circles — the 42 % cap of 0.1.8 refused every one of them. With
   polygon fitting on, the pentagon and hexagon are straightened instead; an
   octagon (over the 6-side limit) is a circle either way.

**Never score confidence against beautified output** — measure how well the
input matches the shape family, not how far beautification moved the result.

**Every tolerance is calibrated on real Pencil ink** (2026-09-21, the retune
that made 0.1.9). The user's strokes were traced out of an iPad screen
recording (`tests/ink/fixtures/real-pencil-ipad.json`, contours at 1.909
device px per page px) and Pencil-like streams are rebuilt from them in the
tests: any start point, a pen-down hook, an overshoot, hand tremor, 1.4 px
spacing. Measured: real circles deviate 0.060–0.067 of r (RMS radial), real
rects sit 0.012–0.018 of the diagonal from their straightened quad but
0.05–0.074 from their best box (they are slightly trapezoid), a quick line
bows 0.023 of its span. Each `*_MAX_ERR` is four times the real residual,
since the floor accepts a quarter of it. Rules that came out of it:

- A **rect** is scored against its straightened quad, not against the box it
  becomes; rectangle-ness is judged on the RDP corner _samples_ (corners
  within 26° of a right angle, opposite sides converging ≤ 20° — a trapezoid
  converges 44°, real rects ≤ 13°), and the ink must turn like a corner —
  ≥ 50° across a window of 8 % of the perimeter — at every vertex but one,
  which may be as soft as 30°. That is what keeps a coarse RDP of a lumpy
  circle (a quad at ~90°, ink bending ~30° at two or more vertices) out while
  admitting a square with one corner swung round (39° beside 80–112°). A
  loop the circle or ellipse fitter accepts is never a rect at all. The
  same corner rule applies to triangles and polygons: a D's arc "vertex"
  measures 27°. The emitted box runs through the middle of the drawn edges,
  axis-snapped within 6°.
- The **circle/ellipse corner gate** reads the _second_ sharpest turn: a real
  loop carries one artefact (the notch where the Pencil landed) and a
  polygon has at least three sharp corners.
- A closed loop is **re-started at the sample farthest from its first** before
  RDP, which puts the seam on a true corner of any polygon: a seam _next to_ a
  corner (an overshoot ending there) lost that corner to the seam-duplicate
  pop and bent an edge around it.
- `SNAP_MIN_CONFIDENCE` is 0.65. Refusal of non-shapes is structural — every
  stroke in the adversarial suite produces no candidate at all — so the floor
  only sets how sloppy a real shape may be: real basic shapes score
  0.73–0.90 across every rebuilt stream (lines with a 30 px lead-in ≥ 0.86);
  the closest non-shape (a hill: straight base, bowed top) reads as a bowed
  triangle or, at the floor, an oval in a few rebuilt streams — documented,
  not a bug.

`explainShape(pts, opts)` returns the full verdict (closedness, gap, every
candidate and its score); it is what the "Copy shape diagnostics" command
reports per stroke.

**Real ink is cleaned before the closed fitters see it** (2026-09-21). Pencil
strokes carry a pen-down/lift hook and, on a closed shape, an overshoot past
the start; either alone refused a circle or a rectangle. `trimOvershoot`
drops the head that the tail retraced (nearest head point to the end within
the closing tolerance, searched over ≤ 25 % of the path by length); then,
**only while the stroke has not closed**, `trimHook` removes a run of ≤ 30 px
(≤ 25 % of the path) at either end that turns ≥ 45° from what follows. Once
the ends meet, a "hook" found there is the first edge past the seam: a
budget past the closing tolerance cut a rectangle's corner and opened a
26 px gap (2026-09-21, 6 of 15 rebuilt streams). Open fitters also see the
raw points — an arrow's barb is a hook. Triangles are fitted by default;
diamonds, skewed quads, pentagons and hexagons are opt-in
(`RecognizeOptions.polygons`).

**Polygons are straightened, not just simplified.** RDP locates the corners;
each edge is then re-fitted as a total-least-squares line through the middle
60% of its samples, and each vertex is where its two edge lines cross. Four
gates keep arcs out: every edge must be straight (RMS ≤ 11% of its length —
real Pencil edges bulge up to 10%, a D's halves 8%), every vertex must lie
near the ink (≤ 25% of its shorter edge — a D's arc "vertices" measure 14%, a
real swung-round corner 24%), every straightened corner must turn ≥ 50° (RDP
cuts an arc into ~45° turns), and the ink itself must turn like a corner at
every vertex but one (the sharpness rule above — a D's arc vertex measures
27°). 3–6 sides; a rect-like quad (see above) is left to the rect fitter
unless it stands on a point, in which case it is a diamond and the rect
fitter stands aside.

**Trigger** (the view's, `ink-surface.ts`): the pointer stays within
`HOLD_RADIUS` (8 page px) for `HOLD_MS` (500 ms). This is a **timer** — a pen
held perfectly still sends no pointermoves, so polling on move never fired
(the reason hold-to-snap "never worked" before 2026-09-21). On trigger the
view recognizes the stroke so far and, on a match, swaps the wet stroke for
the clean shape **while the pen is still down**. Until lift the shape follows
the pen: a similarity transform about a pivot (a line's start, a closed
shape's bbox centre) scales and rotates it, as GoodNotes does. On lift the
stroke is committed once, already snapped — one undo step, not two.

On iPadOS the surface cancels `touchstart` and `touchmove` for stylus touches
(non-passive listeners): the first stops WebKit's long-press recogniser from
ending a stationary pen in `pointercancel`, the second stops Scribble from
swallowing pointer events it takes for handwriting (WebKit bug 217430). A
`pointercancel` of a pen that has not left its hold anchor for ≥ 250 ms is
taken as the hold it interrupted.

**Diagnostics.** The surface keeps the last 24 strokes — pointer type, move
and sample counts, first-move delay, duration, how the stroke ended, whether
the hold fired, the recogniser's verdict at the hold and at the lift, what was
committed, and the retained points. The plugin command "Copy shape
diagnostics" writes them with the environment (platform, DPR, coalesced-event
support, zoom, the draw-and-hold setting) to `GoodObsidian shape
diagnostics.md` in the vault, and to the clipboard where allowed.
`SnapStrokeToShape` remains in the model for callers that snap an existing
stroke. Draw-and-hold with the pens is the `drawAndHold` setting; the Shape
tool always snaps (auto mode snaps on lift even without a hold).

---

## 3. New commands

All in `src/model/commands.ts`, all implementing the existing `Command`
interface with `apply()`/`invert()`.

| Command             | Input                                    | Inverse                                                            |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `AddPage`           | `{ index, page }`                        | `RemovePage { index }`                                             |
| `RemovePage`        | `{ index }`                              | `AddPage` with the removed page                                    |
| `SetBackdrop`       | `{ pageId, backdrop }`                   | `SetBackdrop` with the previous backdrop                           |
| `InsertImage`       | `{ pageId, image }`                      | `RemoveImage { pageId, imageId }`                                  |
| `TransformImage`    | `(pageId, imageId, box: ImageTransform)` | `TransformImage` with the previous box                             |
| `RemoveImage`       | `{ pageId, imageId }`                    | `InsertImage` with the removed element                             |
| `SnapStrokeToShape` | `{ pageId, strokeId, pts, shape }`       | `SnapStrokeToShape` with the original `pts` and `shape: undefined` |

`RemovePage` on the last remaining page is a no-op: a document always has at
least one page.

### Page-addressed stroke commands

Upstream's `AddStroke`, `RemoveStrokes`, `MoveStrokes` and `ClearRegion` all
target `primaryRegion(doc)` — page 1 — which was right when a document was one
unbounded roll. In a paginated document a stroke drawn on page 3 must land on
page 3, so `src/model/page-commands.ts` supplies page-addressed equivalents:

| Command                 | Notes                                                                             |
| ----------------------- | --------------------------------------------------------------------------------- |
| `AddStrokeToPage`       | `(pageId, stroke)`                                                                |
| `RemoveStrokesFromPage` | `(pageId, strokeIds)`                                                             |
| `MoveStrokesOnPage`     | `(pageId, strokeIds, dx, dy)`                                                     |
| `ClearPage`             | `(pageId)` — strokes only; the backdrop survives                                  |
| `CompositeCommand`      | one undo step for an edit spanning pages, e.g. an erase dragged across a page gap |

They implement the same `Command` interface, so undo is unchanged. The
upstream four served the inline-embed path, which was removed in 2026-09;
nothing calls them any more.

### `Command.pageId` (2026-09-25)

`Command` has an optional `readonly pageId?: string`: the id of the one page
the command changes. Every page-addressed command exposes the id it was
built with; the commands that hold a `Page` (`AddPage`, `SetPageTemplate`,
`SetPageBookmark`, `SetPageEpoch`, `RestyleCoverTitles`) return `page.id`;
`CompositeCommand` returns the id its parts agree on, ignoring parts that
name none, and nothing when they disagree. Document-wide commands
(`RemovePage`, `SetSingle`, …) leave it out. Undo and redo read it to glide
an off-screen change into view. `History.onChange` fires after anything
changes what can be undone or redone, for the Undo/Redo buttons.

`TransformImage` takes its geometry as **one `ImageTransform` object**, not
seven positional arguments — resolved 2026-09-20 in favour of the backend
agent's request. Every other command keeps positional arguments.

An inverse must restore the document **exactly**, including absent keys:
`rotation` and `shape` are _deleted_, never set to `undefined`, or a
round-trip stops being `JSON.stringify`-identical. Z-order is restored on
`RemoveImage`.

---

## 4. Backdrop rendering (view side)

The model never rasterizes anything. The view resolves a `Backdrop` to pixels:

There are **two** interfaces, because a scroll frame cannot await a promise:

```ts
/** Asynchronous: may rasterise. Used off the frame path. */
export interface BackdropRenderer {
  draw(ctx: CanvasRenderingContext2D, backdrop: Backdrop, geometry: PageGeometry): Promise<void>;
}

/**
 * Synchronous: paints whatever is ready *now*. Called from the render loop, so
 * it must never block — a PDF page that has not been rasterised yet paints as
 * blank paper and requests the raster in the background; the view repaints
 * when it lands.
 */
export interface BackdropPainter {
  paint(ctx: CanvasRenderingContext2D, backdrop: Backdrop, geometry: PageGeometry): void;
}
```

One class may implement both, and `VaultBackdropRenderer` does.

- **Synthetic backdrops** draw procedurally — cheap, redraw freely.
- **PDF backdrops** render from the original PDF through Obsidian's PDF.js.
  Up to 2.5× zoom, ink tiles and their previews share one whole-page raster.
  Above that zoom, one clipped visible patch per page is shared across tiles,
  with the page image as fallback. Source PDF points are contained in the
  notebook page geometry; PDF.js handles source rotation and cropping.
  Region keys include source path/page, page geometry, visible region and
  settled scale (stable to 1e-4). Pinch frames retain their full-page scale
  and request no new detail. Full-page/patch rasters are bounded to 2400 px
  per edge and approximately 4 MP. The cache retains its 48 MB soft / 96 MB
  hard budgets and recent-use policy. At most two PDF renders run at once.
  Offscreen detail work is cancelled and its canvas evicted; stale work
  triggers no repaint or cached miss. Writing holds background starts;
  explicit awaited draws remain available. Patch completion invalidates only
  the matching region; full pages can invalidate the matching sidebar thumbnail.
- **The source PDF is opened read-only and never written.** If the PDF is
  missing or the page index is out of range, draw a blank page with a small
  "missing source" marker and keep the ink — never drop annotations because a
  backdrop failed to resolve.
- The plugin uses the pdf.js that Obsidian bundles (`loadPdfJs()`). Were a
  copy ever needed instead, this interface would not change — that is why it
  exists.

---

## 5. Fixtures

`contracts/fixtures/` holds documents matching this contract exactly. The
frontend renders these until integration; the testing agent asserts against
them.

**These are decoded `InkDocument` JSON, not the on-disk payload.** `Stroke.pts`
holds world-space floats here; the `%%goodobsidian%%` block holds the same points
quantized to integers at 1/100. The two forms look identical and differ by
100×, so base64-ing a fixture straight into a note yields ink at 1% scale with
no error anywhere. Quantize first.

| File                       | What it exercises                               |
| -------------------------- | ----------------------------------------------- |
| `doc-v1-legacy.json`       | an upstream v1 document, for the migration test |
| `doc-v2-empty.json`        | one blank page, no strokes                      |
| `doc-v2-three-pages.json`  | blank + lined + grid, strokes on each           |
| `doc-v2-pdf-backdrop.json` | two PDF-backed pages with ink over them         |
| `doc-v2-images.json`       | a page with two placed images, one rotated      |
| `doc-v2-shapes.json`       | strokes carrying each `shape` kind              |

---

## 6. The 0.5 feature wave (v7)

Joost's list of 2026-09-22: images, a GoodNotes text-tool bar, notebook
creation with covers and single pages, AI (transcribe, ask, generate an
image), freeform lasso with filters, stars and tables, audio, scanning. The
model fields every one of those needs were added **up front, in one commit**,
so parallel work never edits the same lines of `document.ts` or
`serialize.ts`. All are optional and absent in older files; older builds
ignore them.

### Model additions (`src/model/document.ts`)

| Field                                                                         | Meaning                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TextBoxElement.font?: TextFont`                                              | one of `TEXT_FONTS`; absent = `"sans"`. Families installed on iPadOS, macOS **and** Windows only (`TEXT_FONT_STACKS`)                                                                                                                                 |
| `bold? italic? underline? strike?: boolean`                                   | whole-box style; stored only as `true`, never `false`                                                                                                                                                                                                 |
| `align?: TextAlign`                                                           | `left` (absent) · `center` · `right` · `justify`                                                                                                                                                                                                      |
| `lineHeight?: number`                                                         | multiple of the font size, 0.8–3; absent = 1.25                                                                                                                                                                                                       |
| `fill?: string`                                                               | box background, `#rgb[a]` / `#rrggbb[aa]` only (it reaches a style attribute); absent = none                                                                                                                                                          |
| `TextBoxElement.fit?: true`                                                   | the width follows the text (GoodNotes' default): the editor keeps `w` as wide as the widest line, up to the page edge, and stores it, so every reader wraps as the editor did. Only `true` is stored; a resize drops it. A fitted `w` may be under 80 |
| File names                                                                    | `Title.notebook.md` (a notebook) and `Title.page.md` (`single`), 0.6.3 on; `.ink.md` before that, still read, never written (`INK_FILE_SUFFIXES`, `inkFileSuffix`). Not the §1b per-page layout                                                       |
| `ShapeKind` `"star"`                                                          | a snapped star; its `pts` are the closed outline                                                                                                                                                                                                      |
| `ShapeKind` `"cloud"`                                                         | a snapped cloud; its `pts` are the closed outline (2026-10-01)                                                                                                                                                                                        |
| `Ruling` `"title-date"`                                                       | ruled paper with a printed Title / Date header                                                                                                                                                                                                        |
| `Ruling` `"cover-plain" \| "cover-label" \| "cover-band" \| "cover-linen"`    | notebook covers, drawn procedurally; colour = `paperColor`. `isCoverRuling()`; never offered as paper (`COVER_TEMPLATES`)                                                                                                                             |
| `Page.epoch?: number`                                                         | wall-clock ms that the page's stroke `t0` values count from; `epoch + t0` = when a stroke began                                                                                                                                                       |
| `Page.bookmarked?: true`                                                      | bookmarked (GoodNotes' "Favourites"); the sidebar can filter to these. Stored only as `true`; a duplicate starts without one                                                                                                                          |
| `Page.title?: string`                                                         | its line in the notebook's contents (the sidebar's Contents tab), starting a section there. One line, trimmed, at most 80 characters; empty is absent. A duplicate starts without one                                                                 |
| `InkDocument.single?: boolean`                                                | a single page, not a notebook: no "add page". Stored as `meta.single`, only when `true`                                                                                                                                                               |
| `InkDocument.recordings?: Recording[]`                                        | `{ id, path, start (epoch ms), duration (ms), transcript? }`; audio files live in the vault, never inline                                                                                                                                             |
| `InkDocument.folders?: { images?: string; audio?: string; exports?: string }` | where new pictures / recordings / PDF exports are saved (toolbar gear). Vault folder, canonical; absent = Obsidian's default (exports: next to the note). `meta.folders`. `exports` added 2026-09-25; an older build drops it on save                 |
| `InkDocument.scroll?: "horizontal"`                                           | pages run across, one per screen (toolbar gear → Scroll direction). Stored as `meta.scroll`, only when horizontal; anything else reads as vertical. Page space is unchanged: only `layoutPages` places the boxes differently                          |

`t0` itself is unchanged (§1b), but until 0.5 **nothing wrote it**. The audio
work starts stamping every new stroke; `epoch` is set by the first stamped
stroke on a page.

### Rules for the parallel work

1. **Do not edit `document.ts` or `serialize.ts`.** If a field is wrong or
   missing, finish what you can and request the change in the report.
2. **New commands go in new files** (`src/model/<feature>-commands.ts`), not
   appended to `commands.ts` / `page-commands.ts`. Every one is invertible and
   restores absent keys as absent (§3).
3. **Hosts place images with the existing `InsertImage` / `TransformImage` /
   `RemoveImage`** through `InkSurface.applyCommand`, so they undo with the ink.
4. **Toolbar slots exist already**: `onInsertImage`, `onAi`, `onRecord` (tier-1
   buttons that render disabled until a host supplies them) and
   `Toolbar.setRecording(active)`.
5. **Every custom `<button>` carries `clickable-icon`** (Obsidian pads plain
   buttons 20 px on iPad).
6. **Any new pure module is added to `vitest.config.mts`'s coverage list.**
7. Run all five CI gates — `lint`, **`lint:review`**, `typecheck`, `test`,
   `build` — plus `format:check` on the files you touched.

### What the wave settled (v8)

Reconciled with the merged code on 2026-09-22, from the agents' reports.

**Model and loading**

- A text box with no `font` renders in Sans at line height 1.25 — so boxes
  written before 0.5 (which used the theme font at 1.35) now look different,
  the same on every device. Accepted: device-independence is the thesis.
- `fontSize` below 12 is raised to 12 on load, so no UI offers less.
- `fill` accepts `#rgb[a]` as well as `#rrggbb[aa]`.
- An image or text box stored without an id is minted one above the page's
  highest `i<n>` / `t<n>`; `InsertImage.invert` re-finds its image by
  identity first.
- `ImageElement.crop?` (fractions of the source; absent = whole picture;
  invalid ones dropped, never clamped) and `locked?` (only `true`) —
  added for the GoodNotes image selection.
- `star` is emitted as an **outline** of 11 points (ten vertices
  alternating tip / notch, plus the closing point), whether it was drawn as
  an outline or as a one-stroke pentagram (whose notches go where its lines
  cross), and by the Shape-tool preset. Before 2026-10-01 a drawn pentagram
  was emitted as a 6-point pentagram (five tips in drawing order, plus the
  closing point); strokes stored that way stay valid.
- `cloud` (2026-10-01): a closed outline of round bumps on every side,
  uneven in width, rounder on top and flatter underneath, meeting in soft
  dips; fourteen points per bump plus the closing point, filling the box
  the cloud was drawn in; as many bumps as were drawn, 7–12. Read by hold-to-snap
  only (no Shape-tool preset). A reader that does not know the kind draws
  it as ordinary ink.
- **The Apple Notes arrow** (Joost, 2026-09-22): a line, then back along it
  at least 40 px and 12–60 % of the shaft, within 20° of straight back,
  then hold. It emits the existing 6-point arrow. It rules out arrows under
  ~67 px, because real pen-lift tails reach 35 px. The polygon fitter now
  refuses a loop that turns more than 540° (one that winds twice).
- Strokes are stamped always: `t0` from the page's `epoch`, which the first
  stamped stroke sets in the same undo step. A pen-down before its page's
  epoch leaves `t0` absent. While recording, times come from the
  recording's monotonic clock.

**Invertible commands, by file**

| File                              | Commands                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/model/text-commands.ts`      | `SetTextBoxStyle` (restores key order and only the keys it owns)                               |
| `src/model/notebook-commands.ts`  | `SetSingle`, `changeCover` (backdrop and title restyle, one step)                              |
| `src/model/selection-commands.ts` | `TranslateElements`, `RemoveElements`, `AddElements`, `RecolorStrokes`                         |
| `src/model/recording-commands.ts` | `SetPageEpoch`, `addStrokesTimed`, `AddRecording`, `RemoveRecording`, `SetRecordingTranscript` |
| `src/model/scan-commands.ts`      | `buildScanInsert` (`AddPage` + `InsertImage` in one `CompositeCommand`)                        |
| `src/model/image-commands.ts`     | `ReorderImage`, `SetImageLocked`, `CropImage`                                                  |
| `src/model/clipboard.ts`          | the in-window clipboard: deep copies, fresh ids on paste, no `t0`, no lock                     |

Every one holds its elements by identity, not id, and undoes to
`JSON.stringify`-identical JSON. The older `TransformImage` still finds its
picture by id.

**View seams other work builds on**

- Images: `InkView.insertImageBytes(bytes, mime, name, { pageIndex?, box?,
select? })` and `insertImageFromVault(path, …)` — every picture goes
  through them (photos, camera, AI generation). `registerImageMenuEntry({ id,
icon, label, order?, isAvailable?, run })` from `onload`; built-ins are
  10–30, scan 40, scanned PDF 45, AI 50. Images paint through an
  `ImagePainter` (`VaultImageCache`: key = path + quantised decode size,
  48 MB soft / 128 MB hard, "Missing image" placeholder, element never
  dropped). A renamed picture shows as missing: its path is inside the
  payload, where Obsidian's link updater cannot see it.
- Selection: `SelectionActionBar` + `selection-bar-model.ts`, driven by a list
  of `SelectionAction` entries (bar button, menu row or tile, groups,
  destructive, swatches).
- AI: `buildAiMenu()` returns entries with availability; handlers live in
  `InkView.aiActions()`. `plugin.transcribeAudioFile()` is the only way audio
  leaves the device. Keys are in `SecretStorage` when Obsidian ≥ 1.11.4
  (feature-detected; `minAppVersion` has been 1.13.0 since 2026-09-25).
- The per-page text layer: inside the managed block, a `### Page N` heading
  per page followed by `<!--goodobsidian-page <id> <hash>-->`. The
  page-per-file layout (§1b) will replace it.
- Toolbar: `onRecordings`, `setRecordingsAvailable(count)`,
  `setAddPageVisible(visible)`; surface: `setClock`, `setStrokeTapHandler`,
  `visiblePageRect` / `visibleRegion`, `renderWetMany`.
  `ToolbarOptions.pageTools` hides only add-page and the 0.5 actions, not
  navigation.

## 7. Pen gestures (v9)

GoodNotes 6's pen gestures, from the pen type menu (Joost, 2026-09-24).
Pen tool only: a highlighter going over text is highlighting it.
Settings: `PenGestures { scribbleErase, scribbleErasesAll, circleLasso }`,
read through `penGesturesOf` (`src/ink/pen-gestures.ts`); defaults on,
off, on — GoodNotes' defaults, with the scribble's wider reach off.

**Scribble to erase** (`src/ink/scribble.ts`, pure). On lift, before any
shape recognition, `detectScribble(pts, { minSize })` reads the stroke;
`minSize` is 10 screen px (`atFitZoom`). A scribble reverses at least 4
times along its dominant direction (the segments' structure tensor), at
least 75 % of those reversals are hairpins (≥ 135° over a quarter of the
shorter pass), its median pass spans half its extent — measured after
taking out the drift of slanted passes along themselves (least squares of
the along-pass position on the across-pass one) — and it moves on rather
than going round: looping (the share of consecutive side-steps between
passes that reverse, each pair weighted by its smaller step over the
extent, plus a 0.03 floor per pair) is at most 0.5. It
covers the convex hull of every two consecutive passes. A stroke is
erased when at least half its length (48 samples) lies there, within half
of both nibs plus 2 screen px. Handwriting only unless
`scribbleErasesAll` (then shapes, tables and highlighter too); never text
boxes or pictures. The erase is one `RemoveStrokesFromPage` labelled
"Scribble to erase" and the scribble is not kept. A scribble that covers
nothing is ink.

Deliberate limits: loopy "coil" scribbles are refused with circling (both
step out and back), and so are scribbles of four passes or fewer (a "W").
Failing leaves ink, never erases. Tuned on Joost's 15 real scribbles
traced from an iPad recording (`tests/ink/fixtures/real-scribbles-ipad.json`).

**Circle to lasso** (`gestureLoopOf` in `src/ink/pen-gestures.ts`, pure).
A pen stroke that comes back within `max(SNAP_CLOSE_TOLERANCE on screen,
20 % of its diagonal)` of its start (an overshoot is cut off), and
encloses at least 15 % of its box and 2 % of its diagonal squared, is
remembered if it encloses something the lasso's switches allow. A pen put
down within 14 screen px of it and held 500 ms (or cancelled by WebKit
after 250 ms) takes it back with `History.withdraw` — only while it is
still the latest step, checked with `History.isLatest` — selects what it
enclosed, and the same pen then drags the selection until it lifts (one
`TranslateElements`). The loop never reaches the undo stack.

---

## Change log

- **v9 (2026-09-24)** — pen gestures (§7): Scribble to erase and Circle
  to lasso, `History.isLatest`.

- **v8 (2026-09-22)** — reconciled with the merged 0.5 wave (§6, "What the
  wave settled"): the look of old text boxes, id minting, image `crop` and
  `locked`, the two star layouts, the Apple Notes arrow and its limits,
  stroke stamping, the commands by file, and the view seams.
- **v7 (2026-09-22)** — the 0.5 feature wave (§6): whole-box text styles,
  the star shape, the title/date ruling and four cover rulings, `Page.epoch`,
  `InkDocument.single` and `recordings`, the three new toolbar slots, and the
  rules for building them in parallel.

- **v6 (2026-09-20)** — reconciled with the code after testing:
  `NotebookPageRef.file` (folder-relative, as implemented) replaces `path`;
  the circle acceptance band corrected to a measured ≈1.16:1; the rounded-rect
  exception to "zero false positives" recorded; fixtures documented as decoded
  rather than wire form. `TransformImage` was fixed in code instead, so it now
  matches v3.
- **v5 (2026-09-20)** — answered the frontend agent's requests: a synchronous
  `BackdropPainter` beside the async `BackdropRenderer`; the PDF cache key's
  scale term quantised to 0.25 steps; `dotted` pinned as a 1.5 px _radius_;
  page-addressed stroke commands documented; dark paper reassigned from device
  storage to notebook frontmatter.
- **v4 (2026-09-20)** — notebook-on-disk layout (folder per notebook, file per
  page, `_notebook.md` holding page order), chosen by Joost; plus the optional
  per-stroke `t0` timestamp, added before there is anything to migrate.
- **v3 (2026-09-20)** — answered the backend agent's five contract questions:
  `TransformImage` takes an `ImageTransform`; `closeTolerance` is relative;
  per-kind emitted `pts` layouts pinned; minimum snap size, no-ellipse and
  no-one-barb-arrow recorded as deliberate limits.
- **v2 (2026-09-20)** — nine paper rulings from the GoodNotes reference
  screenshots, paper colour as its own axis, orientation as a geometry swap.
- **v1 (2026-09-20)** — initial contract: pages, backdrops, images, shapes.

## PDF import and export (2026-10-02)

PDF import reuses the existing `PdfBackdrop` contract: `path` refers to an
unchanged vault attachment, and `page` is the original zero-based source page
index, including when pages are imported out of order or only a subset is
selected. No new field is persisted; existing readers and golden files remain
compatible. `SavedPdf.pages` can carry an optional source `page` index while
building an insertion command; it is transient, not a wire-format change.

The PDF toolbar button offers **From files** and **From vault**, using the
existing image-menu popover. The image menu and photo scan sheet no longer
offer PDF import. The file picker, vault picker and external-file drop use the same
page selection dialog. Existing vault PDFs are referenced, not copied. Import
adds pages after the current page as one undoable command; single-page documents
must first be converted to notebooks. Like other attachments, an imported PDF
remains in the vault after undo.

Picture drops reuse `insertImageBytes` for external files and
`insertImageFromVault` for existing vault pictures. Supported extensions use
the existing image classifier; external image MIME types match the file picker.
Multiple external pictures are processed sequentially, and imports stop when
the originating notebook changes. Unsupported files are left to Obsidian.

Export uses original PDF page content clipped to the visible crop box, with
page rotation applied and contained in notebook geometry. Notebook annotations
are painted by the existing renderer onto transparent lossless PNG overlays.
Contiguous highlighter strokes have separate layers using PDF multiply blending;
images, text boxes and other strokes retain their original paint order.
Original source text/vector graphics remain PDF content. Normal pages keep their
existing JPEG export. Source files are read-only; missing, invalid or encrypted
sources fail export clearly. Exported notebook text boxes and ink retain the
existing plugin's rendered appearance; they are not editable PDF annotations.

## Notebook creation context menu

`data.json` adds `showNewNotebookInContextMenu` and `showNewNotebookInExplorer`,
defaulting to `true` and `false` respectively; loading older
settings supplies that default and preserves an explicit `false`. The file
explorer's **New notebook** action opens the existing creation dialog in the
selected folder, or a selected file's parent. Selecting the vault root uses
the root rather than the configured default folder. Other creation actions
retain the configured default, as does the file explorer top-bar button.
The toggles operate independently and apply without a restart; explorer buttons
are reconciled on layout changes and removed on plugin unload. This does not
change the note format.

## PDF viewport detail

At zoom up to 2.5×, notebook ink tiles and their previews share a cached whole-page PDF image. Above that threshold, the renderer supplies one clipped visible region per page, independently of the 512 px ink-tile grid. These patches overlay the page fallback before images and ink, never cover annotations, and use at most two PDF render tasks concurrently (including thumbnail/page work).

Replacing the viewport cancels obsolete queued/active detail requests, evicts their canvases, and prevents stale completion callbacks or cached failure placeholders. Ordinary page and sidebar rasters retain their existing byte budgets. Mid-pinch frames retain the previous full-page resolution and start no new detail work. Writing holds background starts; explicitly awaited export/thumbnail requests remain available. Clear/unload cancels pending work.

## More papers and covers (2026-10-06)

Fourteen papers (`two-column` … `music-tab`, specified in §1's ruling table)
join `Ruling`. Eight cover colours were added (`ink`, `plum`, `teal`, `olive`,
`kraft`, `blush`, `lavender`, `ivory`); ids are stored in settings and are
never renamed. (Twelve cover designs were drafted alongside them and replaced
before release by the current designs below.)

Older builds load all of these as `blank`, as with the 2026-09-21 rulings.
No migration; no change to the note format otherwise.

## Current cover designs (2026-10-07)

The cover picker (`COVER_SECTIONS`, one group, "Covers") offers seven
designs: `cover-gradient` (Soft gradient), `cover-orb` (Orb), `cover-split`
(Duotone split), `cover-contour` (Contour lines), `cover-glass` (Glass label),
`cover-monogram` (Big type) and `cover-accent` (Accent stripe). Painters live
in `src/canvas/cover-patterns.ts`: flat (no vignette), each with a narrow book
spine down the left edge, deterministic, and clipped to the page; soft shapes
are radial gradients, never a canvas blur filter (unsupported in WebKit). As
before, a cover stores only its ruling and `paperColor`, and every colour it
paints comes from `coverPalette` (new: `spine`, `spineEdge`, `sheenLight`,
`sheenDark`, `orbCore`, `orbRim`, `splitLower`, `contour`, `glassGround`,
`glassHigh`, `glassMid`, `glassLow`, `glassPlate`, `glassEdge`, `monogram`,
`accent`, `accentDot`).

The title stays a text box (`coverTitleBox`). `coverLayout` now also returns
`titleStyle`: the classic designs' centred serif, or bold sans set left
(centred on the glass plate) for the current ones; the title sits bottom
left, on the split's seam, or on the glass plate. The glass plate is
translucent, so its title takes the cloth's ink (`palette.title`), not the
label's. Big type's oversized letter is a second text box
(`coverMonogramBox`, id `t0`, behind the title) in `palette.monogram`, since a
painter never sees the title; `RestyleCoverTitles` recolours it with the
cloth and, for a title still where the old design put it, also takes the new
design's font and alignment.

The classic designs (`cover-plain`, `cover-label`, `cover-band`,
`cover-linen`; `isClassicCover`) are no longer offered but still drawn, so
notebooks made before keep their covers; a remembered classic choice in the
"New notebook" settings reads as the default, `cover-gradient`. Older builds
load the seven new designs as `blank`. No migration.
