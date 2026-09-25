# Design brief: GoodObsidian

Source: Joost's interview answers + **two GoodNotes reference screenshots he
supplied**, 2026-09-20. This file is the frontend agent's law — where it
conflicts with the agent's taste, this file wins.

The screenshots are the ground truth for layout. Where this document and the
screenshots disagree, the screenshots win and this document is wrong.

**`contracts/goodnotes-reference.md` transcribes all seven screenshots in
detail** — every tool, every option pill, the eraser's Advanced Settings and
the microphone menu. Read it before designing any toolbar surface.

## Inspiration

**GoodNotes, in ergonomics only.** Tool placement, icon metaphors and the
interaction grammar (tap a tool to select, tap again to open its options,
lasso by circling, hold-at-end to snap a shape) are copied from GoodNotes
because Joost already has the muscle memory and that layout is proven.

**Obsidian, in appearance.** Everything is drawn with Obsidian's own CSS
variables (`--background-primary`, `--text-normal`, `--interactive-accent`,
`--radius-m`, …). Never hardcode a colour for chrome. The plugin should look
like it shipped with Obsidian and inherit whatever theme Joost is running.
Radii, shadows and touch sizes come from the plugin's own `--gob-*` tokens at
the top of `styles.css`, which are built on those variables: use a token,
never a new literal.

The combination is the point: GoodNotes hands, Obsidian eyes.

## Vibe

Minimal, sober, function-first. No decoration that does not do a job. The page
is the interface; chrome is a guest on it and should behave like one.

## Layout must-haves

- **The toolbar is two tiers**, as in the reference screenshot. This replaces
  the earlier single-pill instruction, which was wrong.

  **Tier 1 — the tool bar.** A full-width bar at the top. GoodNotes tints it
  a saturated blue; since the 2026-09-25 restyle (version C, "GoodNotes
  layout, Notability look", chosen in the UI gallery's Claude Design
  project) ours is the theme's `--background-secondary` with a hairline
  under it and grey line icons, and the accent marks only the active tool (a
  tinted rounded square). Three groups:
  - _Left:_ sidebar/thumbnails toggle · search · AI (our sparkle), then undo ·
    redo after a hairline.
  - _Centre, the writing tools,_ centred on the bar: lasso select · pen ·
    eraser · text · shapes · image · **microphone**. On a pane too narrow to
    centre them clear of both sides, they follow the left group.
  - _Right, the document's actions:_ add page · share · ⋯ · notebook settings.

  **Tier 2 — the active tool's options.** A floating rounded pill directly
  below the tool bar, holding only what the _current_ tool needs. For the pen:
  four pen-type swatches (the active one tinted, with a chevron), a divider,
  three stroke widths shown as literal short strokes of increasing weight with
  the active one boxed, a chevron for more widths, then colour swatches and a
  dashed circle with a `+` to add a colour.

  Rules: touch targets ≥ 44pt; the pill never sits under the palm in landscape;
  the pill's contents change with the tool but its position does not.

- **The page floats.** A single portrait page centred on a dark neutral field
  with generous margins either side — the page is an object on a desk, not a
  region that fills the pane. Give it a soft shadow.
- **Discrete pages**, not an infinite canvas. Vertical scroll between pages with
  a visible page gap, and a page indicator ("3 / 18").
- **The page is the hero.** No sidebars, no inspectors, no persistent panels.

## Page appearance

- **Paper-white by default**, with a per-notebook override to a dark page.
- **Ink is stored as an absolute colour** and never silently re-mapped by the
  theme. A black stroke stays black; if the notebook is switched to a dark page
  the user is told their existing ink may need recolouring rather than having it
  changed under them.
- Rulings are the nine in `contracts/api.md` §1, not three: blank, dotted,
  ruled-narrow, ruled-wide, squared, Cornell, legal, single-column,
  three-column — plus **PDF-backed pages** (see below).
- Paper **colour is a separate axis** from ruling, as GoodNotes separates
  "Squared Paper" from "Yellow Paper": white, cream, yellow.

## PDF annotation is a first-class page type

Joost's answer to "what would you most miss in your next lecture" was
annotating lecture-slide PDFs, so this is v1, not Later. Design consequence:
a page is _either_ a synthetic background (blank/lined/grid) _or_ a rendered
PDF page, and in both cases the ink layer above it is identical. The toolbar,
gestures and tools must not change between the two — a PDF page is just a page
with a different backdrop.

The original PDF is **never modified**. Annotations live in the page's
`*.ink.md` file and reference the PDF by vault path + page index.

## Constraints

- **iPad first.** Judge every decision with a pencil in hand and a palm on the
  glass. Hover states are meaningless; drag targets must be generous.
- Nothing may steal the pointer from the drawing surface — no element in the
  page area that can start a text selection or trigger Apple Scribble.
- From Joost's standing taste: minimalist, confusion-free, function-first,
  dark-friendly.
- Any AI feature (transcription) is hidden until explicitly triggered, and
  never runs on its own.
- Patterns to avoid, pending confirmation from research/RESEARCH.md's pain
  points section — the frontend agent must read that file's "Pain points"
  section before designing the toolbar.

## The "Create Notebook" dialog

Modelled directly on the second reference screenshot, because it is the moment
that makes this feel like a notebook app rather than a canvas plugin.

- **Left rail (the preview):** Title field (placeholder "Untitled Notebook"),
  Cover thumbnail with its name beneath, Paper thumbnail with its name beneath.
  The two thumbnails are live previews of the current selection, and the
  selected one carries an accent outline.
- **Right pane (the picker):** filter dropdowns along the top — template set,
  **paper colour**, language — and a portrait/landscape segmented toggle at the
  far right. Below them, a scrolling grid of paper thumbnails grouped under
  headings: _Essentials_, _Writing papers_, _Planner_. The selected thumbnail
  carries an accent outline.
- **Footer:** Cancel (quiet) and Create Notebook (accent-filled, primary).
- Orientation costs nothing in the model — landscape is the page geometry with
  width and height swapped.

## Two invariants that outrank everything else in this file

Joost, on seeing the per-page file layout: _"I would not like to have to create
files in the folder all the time when writing new lecture notes. I like the
flawless design of the notebook in GoodNotes."_

**1. The file layout is invisible.** A notebook is a folder of page files
_as an implementation detail_. The user never creates, names, opens or even
sees a page file. Every page comes from an **Add Page** button; the notebook
opens as one continuous document. If any workflow ever requires touching the
file explorer to get a page, the design is wrong and the layout must change,
not the user's habits.

**2. It scrolls, continuously.** Pages are stacked vertically with a visible
gap and scrolled through as one surface — not a pager, not one-page-at-a-time.
This is not a constraint we are fighting: page files are loaded **lazily**, so
only the visible pages and their neighbours are in memory, which is precisely
what makes a 200-page notebook scroll smoothly on an iPad. Horizontal scroll is
a later per-notebook setting, as in GoodNotes; vertical is the default.

### The Add Page panel

Build it from the reference (`goodnotes-reference.md`): a `Before` / `After` /
`Last page` segmented control, a Recent-templates row whose entries **inherit
the current page's ruling, colour, size and orientation**, then _More from
templates…_, _Image_, and _Import_ (which inserts every page of a chosen PDF).

Inheriting the current page's attributes is the detail that makes it feel
seamless — the common case is "another page exactly like this one", and that
must be a single tap with no dialog.
