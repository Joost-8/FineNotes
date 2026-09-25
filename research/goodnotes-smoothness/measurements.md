# GoodNotes web: raw measurement log (2026-09-24/25)

The raw notes behind [README.md](README.md), kept as written during testing, lightly
cleaned. Everything is from GoodNotes **web**. The library section is here for
completeness; the study itself leaves the library out.

**Setup.**

- GoodNotes web is a React SPA with styled-components. The editor is the native engine
  compiled to WASM: `wasm-div` custom elements, one full-viewport canvas
  `#paging-view-content` at device px, and per-page `interaction-layer-page-<id>` divs.
  Toasts come from react-hot-toast.
- Tested in the Claude browser pane at 852x722 (close to an iPad in portrait) and in
  Chrome at 1536x770, both at DPR 1.25, in a test notebook made for the purpose.

## Editor: layout, fit, reopen (852x722)

- **Fit:**
  - A new or reopened notebook opens at fit-PAGE (59%): the whole page height fits between
    the top bar (bottom edge at 46 px) and the viewport bottom. The page top sits at
    48–61 px, with about 20 px margin at the bottom.
  - The page gap is 6 CSS px at 59% (about 10 page px).
  - The floating tool-options pill overlaps the top of the page; no space is reserved for
    it.
- **Reopen:** the page is restored, zoom resets to fit and that page is top-aligned. Undo
  history is cleared. The active tool is kept; the sidebar is not (it starts closed). On
  open, "N of M" and the zoom % both flash, then fade.
- **A new notebook** opens on page 2 (the first paper page), not on the cover.
- **Mouse wheel:** 1:1 with deltaY, applied at once per event. No smoothing, no momentum,
  and the top/bottom edges stop hard. Page 1's top rests 2 px under the top bar.
- **URL:** the hash follows the page while scrolling, via `replaceState` (no history spam).
  It works both ways: setting `#page-3` jumps there.
- **Keys:** ArrowDown scrolls 150 px; PageDown and Ctrl+= did nothing. Ctrl+Z works.
- **The page counter** can't be clicked.

## Zoom

- **Ctrl+wheel:** about ×1.045 per event, applied directly each frame, anchored exactly
  at the cursor (checked numerically). No smoothing.
- **Range:** from the floor to 800%. In the 852x722 pane the floor was exactly fit-page
  (59%): pushing to 48% sprang back to 59% and re-centred horizontally. In the 1536x770
  viewport zoom came to rest at 51% while fit was 64–69%, so the floor may not be
  fit-page at every size.
- **Past 800%:** resistance grows. Successive events added 22, 22, 19, 16, 15, 14, 12 … 9
  percentage points. On release it springs back in about 0.3 s, close to linear (eased at
  the ends). The % label keeps showing the overshoot (1020%) until the spring finishes,
  then jumps to 800%.
- **Rendering:** the grid is redrawn crisp at 800%.

## Page counter, zoom pill, scroll thumbs

- **Page counter "N of M":** bottom-left, 66x36, 20 px from the edges. It flashes on open,
  zoom, undo, a page jump, adding a page and finishing a text box. When the sidebar is
  open it follows the canvas area.
- **Zoom pill `[⊖ | 93% | ⊕]`:** bottom-right, frosted, shown only while zooming.
- **Timing (61 fps):** both appear INSTANTLY (opacity 0 → 1 in one frame) on the first
  zoom event. They stay at full opacity ≈1.8 s after the last input. Then the counter
  fades (0.5 s ease-out) and the zoom pill follows ≈200 ms later. While hidden they have
  `pointer-events: none`.
- **Scroll thumbs:** thin, vertical on the right, horizontal at the bottom when zoomed
  in. They appear while scrolling and are gone ≈1 s after.

## Undo

- **Undo/redo pill:** `rgba(30,27,27,.25)` + `backdrop-filter: blur(30px)`, radius 16,
  shadow `0 8 24 rgba(0,0,0,.08)`. Dimmed when there's nothing to undo or redo.
- **Undo of a change on an off-screen page:** it does NOT scroll there. Only the page
  counter flashes and the thumbnail updates.
- **Adding pages:** not undoable (undo stayed disabled).

## Toolbar

- **Tool buttons:** the selected one is an `rgba(255,255,255,.75)` rounded 12 px square.
  On press the background squishes to `scale(0.833)` (transform 0.3 s ease) and springs
  back; the background colour changes in 0.15 s. The pressed state is a JS-set
  `[data-left-active]` attribute.
- **Buttons with sub-menus:** the selected one WIDENS (width/padding 0.3 s ease) and a ▾
  fades in (max-width + opacity 0.3 s). Lasso and text have no options pill; pen and
  eraser do.
- **Switching tools:** the options pill swaps its contents, grows or shrinks, and stays
  centred. When space is short, labels collapse to icons (eraser "Standard" → icon ▾) and
  the pill gets ‹ › scroll arrows.
- **Eraser pill:** type "Standard ▾", an advanced toggle, three sizes drawn at actual
  size. The standard eraser cuts a gap in the stroke; it doesn't delete the whole stroke.
- **Colour swatches:**
  - The selected swatch gets a dark ring and a tiny ▾ inside it. The pen-type icon takes
    the current colour.
  - Tapping the selected swatch again opens the "Pen Color" popover: a frosted card with a
    caret to the swatch, 15 presets (5x3) and a rainbow custom button; the current colour
    is marked with ▾.
- **Width (narrow layout):**
  - The width button opens "Stroke Settings": the width in mm (0.90 mm), a reset ↺, three
    presets, a wedge-shaped slider track and "Stroke Type: Solid ›".
  - The wide layout shows the three presets inline instead, and tapping the selected width
    again does nothing.

## Ink

- **Draw-and-hold:**
  - Holds of 0/200/400/600/650/700/750 ms stayed freehand. Holds of 800/900/1000 ms
    snapped to a line while the pen was still down, so the threshold is ≈750–800 ms.
  - A wobbly, overshooting ellipse became a perfect circle.
  - Two synthetic holds of 1 s or more vanished with the off-page toast. That's probably
    an artefact of how the synthetic coordinates are scaled after a snap.
- **Ink appears as you draw,** with a visible pressure taper. The in-progress stroke and
  the saved one are identical: nothing changes at lift.
- **Input and rendering:** `getCoalescedEvents()` is called once per pointer event;
  `getPredictedEvents()` never. The page canvas is `transferControlToOffscreen`'d, so it
  is drawn in a worker.
- **A stroke that leaves the page** is dropped, and a toast "⚠ Content outside of the
  page" appears with Undo. Toast entrance: `translate(0,200%) scale(.6) opacity .5` →
  identity, 0.35 s, `cubic-bezier(0.21, 1.02, 0.73, 1)`.

## Lasso and text

- **Lasso outline:**
  - The dashed accent-blue outline is the user's loop with its corners rounded. A drawn
    rectangle came out as a stadium shape; a wobbly loop stays wobbly.
  - No handles by default.
- **Lasso menu:** a dark pill that fades in over 0.16 s ease-out, with AI, colour, convert
  to text, transform, cut, duplicate, delete (red) and "…". It goes below the selection
  when there's no room above, otherwise above. It hides while dragging and reappears after
  the drop.
- **Transform mode:** a bounding box with square corner handles, capsule side handles and
  a detached rotate handle below. Tooltips appear after ≈0.75 s of hover and fade in over
  0.25 s.
- **Text tool:**
  - A tap creates a box already in editing mode (a Quill editor gets focus). The box grows
    to fit its content, and a format bar appears below it (above when near the page
    bottom): AI, colour, size 24, B/I, align, list, highlighter, "…".
  - The tool switches back to the lasso after placing a box.
  - The first click outside stops typing but keeps the box SELECTED (capsule width
    handles, a box menu). The second click deselects. The page counter flashes when the
    text is committed.

## Pages and sidebar

- **Sidebar, per frame:**
  - The panel slides `translateX(-412 → 0)` over ≈200 ms with CSS `ease`.
  - The page moves +188 px LINEARLY, ≈15.6 px per frame over ≈200 ms, with a −19 px glitch
    on the first frame. Zoom and canvas size don't change, and the page can clip at the
    right.
  - The tool pill re-centres over 0.3 s with `ease`, and the sidebar button's background
    changes in 0.15 s.
  - The panel stays mounted off-screen.
- **Thumbnails:** two columns of engine-drawn canvases. The current page gets a blue
  outline; each thumbnail has its number bottom-left, "…" bottom-right and a bookmark
  ribbon top-right. They update live, and the list auto-scrolls to keep the current page
  in view.
- **Thumbnail tap:** a ≈450 ms ease-out glide for 1 page (≈650 px), and ≈465 ms for 8→1
  (≈4,900 px), so the duration is fixed. The URL hash updates after the glide.
- **Add page:**
  - The top-bar popover offers Before | After | Last page, recent templates ("inherit
    current page attributes whenever possible"), More from templates…, Image, Import.
  - Adding glides ≈430 ms to the new page, which slides up from below.
- **Loading:** pages are shown as flat grey page-sized blocks, and "⟳ In progress" appears
  under the title.

## Library → editor

- **Transition:** a View Transitions API cross-fade (the UA default, 250 ms). The editor
  DOM appears at ≈150 ms, and the page geometry at ≈290 ms is already in its final fit
  position: the page doesn't zoom or scale in.
- **A long frame:** WASM start-up blocks one frame for ≈150 ms (fade progress jumps from
  0.19 to 0.80). Total ≈370 ms.

## Library (out of scope for the study, kept for reference)

- **Responsive layout:**
  - ≈1180 px and wider: a full sidebar with labels.
  - ≈768–852 px: the sidebar becomes a column of icons.
  - ≈335 px: a hamburger toggle; titles are cut short ("Untitle…"), dates use a short
    format, and New/Date/Select collapse into one "…".
- **Loading placeholders:** grey cards, as many as there were notebooks last time, so
  nothing shifts when the real cards arrive.
- **Cards:**
  - The cover shows its ink, has a spine strip, and the favourite star is its own hit
    target; the star toggles instantly.
  - One click selects, double-click opens, and right-click opens the same menu as the ▾.
  - Rename happens in place with the text pre-selected.
- **Menus and modes:**
  - The New menu teaches "double-tap + New for a Quick note".
  - The create dialog leaves the title unfocused (optional) and remembers the last
    template; the Create button shows its spinner inside the button.
  - Select mode swaps the header in place.
- **Search:** live, with the query in the URL and the matching letters highlighted.
