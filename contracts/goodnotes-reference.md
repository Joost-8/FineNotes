# GoodNotes UI reference

Transcribed from screenshots Joost supplied, 2026-09-20. This is **observed
fact about GoodNotes**, not a commitment to build all of it — `PLAN.md` decides
what ships. It exists so nobody has to re-derive the layout from memory, and so
"what does GoodNotes do here?" has an answer that isn't a guess.

Where this file and `design-brief.md` disagree about layout, this file is the
observation and the brief is the decision.

## Tier 1 — the tool bar

A full-width saturated-blue bar. Two groups.

**Left (document actions):** sidebar/thumbnails toggle · search · a sparkle
action · page outline.

**Right (tools), in order:** lasso select (has a chevron) · pen · eraser ·
text (`T`) · sticker · image · **shapes** · sticky note · laser/magic ·
**microphone** (has a chevron).

The active tool is a light filled rounded square against the blue. Some tools
carry their own chevron for a per-tool menu.

## Tier 2 — the active tool's option pill

A dark rounded pill directly below the bar. Its contents change per tool; its
position does not.

### Pen

Active pen type (tinted, with chevron), then further pen types — observed:
fountain pen, ball pen, highlighter, **tape**, and one more. Then a divider,
three stroke widths drawn as literal strokes of increasing weight with the
active one boxed, a chevron for more widths, then colour swatches (blue,
white) and a dashed circle with `+` to add a colour.

### Eraser

`Standard` eraser-type dropdown · an advanced-settings button · three eraser
sizes shown as circles of increasing size, the active one ringed.

Its **Advanced Settings** popover is the most interesting thing in these
screenshots:

- **Eraser filter** — a toggle per tool: Pen, Pencil, Highlighter, Tape, all on
  by default. Caption: _"The eraser ignores marks from any tool that's turned
  off."_ So you can rub out highlighter without touching the writing under it.
- **Auto-Deselect** — off by default.
- **Clear Page** — destructive, rendered in red.

### Lasso / select

When something is selected the pill becomes a **formatting** pill. Observed
with a text box selected: a sparkle-scribble action (handwriting→text), a
chevron, font size (`24`), **B** _I_, alignment, lists, and an overflow `…`.

### Shapes

A dedicated tool, **separate from hold-to-snap**. Three drawing modes
(freeform, polyline, curve) then shape presets: square, circle, triangle,
diamond, rounded rectangle, an overflow, and a chevron. The canvas screenshot
shows a snapped rounded rectangle sitting beside raw handwriting, so the tool
snaps as you draw rather than after a hold.

### Microphone menu

- **Record & Summarize** (red mic) — recording and AI summary are one action.
- **Show Recordings**
- **Show Ruler** — a straightedge tool.
- **Toolbar Customization** — the tool bar is user-reorderable.

## The "Add Page" panel

From the eighth screenshot. This is how a page gets created — the user never
touches a file.

- **Position segmented control:** `Before` · `After` · `Last page`.
- **Recent templates**, with the caption _"Templates shown here inherit current
  page attributes whenever possible."_ — so a new page defaults to the current
  page's ruling, colour, size and orientation. Copy this; it is why adding a
  page in GoodNotes never interrupts you.
- A thumbnail labelled **Current template** with the template-set name beneath.
- Then three rows: **More from templates…**, **Image**, **Import** (Import
  inserts every page of a chosen PDF at that point).

## What this implies for our model, beyond contract v3

Recorded here; scheduled in `TASKS.md`, not built yet.

1. **`Tool` must widen.** Ours is `"pen" | "highlighter"`. GoodNotes has at
   least pen, pencil, highlighter and tape, and the eraser filter makes the
   distinction _semantic_ rather than cosmetic — the tool a stroke was drawn
   with decides whether an eraser touches it. Cheap for us: strokes already
   carry `tool`.
2. **The eraser filter is nearly free and genuinely good.** Filtering by
   `stroke.tool` is a predicate on erase hit-testing. Strong value-for-effort.
3. **Text boxes are a new element type**, alongside strokes and images: content,
   position, font size, weight/italic, alignment, lists. This is real work and
   it is not in v1.
4. **A shapes _tool_ is cheaper than hold-to-snap** and complements it — the
   user declares the shape up front, so there is no recognition risk at all.
   Given how narrow our arrow detector turned out, offering both is the
   sensible hedge.
5. **Toolbar customization** implies tool order is persisted config, not a
   hardcoded array. Build the tool bar from a list so this stays possible.
6. **A ruler** is a straightedge that constrains input to a line — it is an
   input-pipeline feature, not a drawing one.
