# Plan: GoodObsidian

## Idea

A **GoodNotes replacement that runs inside Obsidian**, for **iPad + Apple
Pencil**. You create a file and it becomes a notebook: pages you write on with
a pencil, exactly as in GoodNotes. The UI deliberately copies GoodNotes rather
than inventing one — that layout is proven and Joost already has the muscle
memory.

The reason to build it inside Obsidian rather than as an app: the notebooks are
files in the vault, so they sync, back up, link and search alongside everything
else he already keeps there — and the subscription goes away.

Primary user: Joost, in university lectures, daily. Success is measured by one
thing: **he stops opening GoodNotes.**

**Started from the MIT-licensed InkedMark ink engine.** Before the public
release (2026-09-25) every remaining line of it was rewritten or removed,
because Obsidian's directory does not list forks; see `INKEDMARK_REWRITE.md`.
The mentions of "upstream" below are the reasoning from that time.

## The thesis, after research

`research/RESEARCH.md` changed the shape of this project. The one-line version:

> Every Obsidian handwriting plugin is an infinite canvas. **Pagination is the
> product.** Shapes, lasso, lined paper and PDF annotation are table stakes
> that competitors already ship.

Joost's starting belief — _"this market is not saturated, I haven't found good
options for iPad + Apple Pencil"_ — is **half right**. "Not saturated" holds:
nothing has won, and only one handwriting plugin is above 5,000 downloads. "No
good options exist" does not: there are ~25 pen-input plugins, 14 of the 16
serious ones were created in 2026, and `Handwriting` (ellimist-afk, created
2026-08-21) already ships six of the eight features on this wish-list. This is
a six-month-old gold rush, not an empty field.

That does not kill the project, but it moves the centre of gravity: we are no
longer "the first good one", we are "the paginated one that looks like
GoodNotes".

## v1 scope (definition of done)

Revised 2026-09-20 after `research/FEASIBILITY.md`. Joost picked PDF slide
annotation as the capability he would most miss, and feasibility is blunt that
PDF **plus** lasso **plus** shape-snap in one v1 "is not realistic". So PDF
stays and the other two are paid for out of scope.

A `*.ink.md` notebook opens on iPad, and in one lecture Joost can:

1. Write with the Apple Pencil at usable latency, with pressure-varying ink. _(inherited)_
2. Rest his hand on the screen without it drawing. _(inherited)_
3. Switch pen / highlighter / eraser from a GoodNotes-shaped floating toolbar.
4. **Work on discrete, fixed-geometry pages** with blank, lined or grid
   backdrops, and add a page. ← _the differentiator; build it first_
5. **Open a lecture-slide PDF from the vault and write on its pages.**
6. Undo and redo reliably. _(inherited)_
7. Select a stroke and move or delete it. _(inherited — upstream's select tool)_
8. **Hold at the end of a stroke to snap it** to a clean line, rectangle or
   circle. Arrow only if it proves reliable.
9. Close, sync, reopen on another device and see **exactly** the same page.

Cut from v1 and why:

- **Lasso (polygon) selection** — feasibility: polygon hit-testing + spatial
  index + transform model + multi-stroke undo. Upstream's single-stroke select
  already covers the lecture case. Deferred.
- **Insert image from the vault** — feasibility calls it "lowest value in a
  lecture; drop first", and market research calls it the cheapest _market_ win.
  Those disagree, and the lecture wins: this is a tool for Joost first. The
  model and commands still support images, so it is a UI task away.
- **Arrow snapping** — kept only if the detector is honestly reliable.

## Notebooks, not markdown-mixing (Joost's correction, 2026-09-20)

This is the sharpest divergence from upstream and it is deliberate. Joost:

> "My idea was not that of mixing text written notes with handwriting, but more
> with having files that you create and they become like GoodNotes notebooks."

**Upstream InkedMark's entire thesis is the opposite.** Its `SPECIFICATION.md`
§1 argues that "the unit of integration is Obsidian's markdown document, not a
canvas", and builds inline embeds (`![[Sketch.ink.md]]`) and a fenced
` ```goodobsidian ` block so handwriting can sit inside ordinary prose.

GoodObsidian's unit is the **notebook**. You create a notebook, it opens
full-screen, and it behaves like a GoodNotes notebook: pages, covers,
thumbnails, page reorder. Typed markdown is not the host — the notebook is.

### What this changes

- The **dedicated ink note** (`*.ink.md` opened in a custom full-screen view)
  is kept — it already _is_ the notebook unit, which is why the fork still fits.
- The **inline-embed path** (`embed-processor.ts`, `inline-ink-modal.ts`)
  served upstream's thesis, not ours. It was demoted first, then **removed on
  2026-09-25**, along with the fenced block format it wrote.
- The **text layer stays**, because it costs nothing and buys Obsidian search
  and graph over handwriting — that is a genuine advantage GoodNotes cannot
  have, and it is already built.

### The happy accident

`research/FEASIBILITY.md` independently identified the **inline-embed path as
the Apple-Scribble-unsafe one**: Scribble needs a `contenteditable` target,
which an inline embed sitting in a live-preview note has and a dedicated
full-screen view does not. So the product correction and the mitigation for the
project's single biggest technical risk are the same change. Notebooks are both
what Joost wants and the safer architecture.

### The goal, stated plainly

**Replace the GoodNotes subscription.** Not "handwriting in Obsidian" — a
notebook app good enough that Joost stops opening GoodNotes. The bar is a paid
product, so feature coverage matters more than it would for a hobby plugin.
`research/FEATURES.md` inventories GoodNotes and Apple Notes against what is
feasible in a webview and ranks what to build.

### On the competition

Joost has looked at `Handwriting` (the closest competitor, six of our eight
features) and judged it not good enough. That is his call and it stands. It
does not change the research: the category is busy, pagination is still the
only unclaimed structural position, and "good enough to cancel a subscription"
is a higher bar than "has the feature".

## The one architectural decision everything hangs on

**Pages have a fixed intrinsic coordinate space.**

This started as a GoodNotes aesthetic preference and research turned it into an
engineering fix. The author of the closest competitor, on his own coordinate-drift
bug, wrote that the root cause is _"different devices have narrower or bigger
panes which means different coordinates"_ — and called it _"not going to go
away"_. For an infinite canvas that is true. For a page of fixed width and
height it cannot happen: ink is stored in page space, the page is scaled to fit
the viewport at render time, and a phone, an iPad and a laptop all reproduce it
identically. Pagination also makes 1:1 PDF export trivial and diffs clean.

Consequence for the model: a **page** is an ink layer over a _backdrop_, where
the backdrop is synthetic (blank/lined/grid) or a rendered page of a vault PDF.
Everything above the backdrop — strokes, images, selection, undo — is identical
in both cases. One code path, not two. The source PDF is never modified;
annotations reference it by vault path plus page index, so the lecturer's file
stays pristine.

## Stack

**TypeScript + esbuild against the Obsidian plugin API** — inherited, and not
really a choice: plugins are TS bundled to one `main.js`, and the iPad runs
them in a WKWebView.

Ink geometry is **perfect-freehand** (MIT, ~4KB) — upstream's choice, and
research independently confirms it is the right one. Ruled out:

- **Swift/PencilKit** — unreachable from a webview.
- **tldraw** — upstream rejected it over licence terms and feasibility
  confirmed it independently: tldraw's own official Obsidian plugin goes blank
  on iPad ~5s after load, the documented unlicensed-production symptom. Settled;
  do not revisit.
- **Forking `Ink` or `Handwriting`** — both are **CC BY-NC-ND 4.0**. No
  derivatives permitted. Not an option, however tempting their feature lists.
  This is precisely why the fork target is InkedMark: MIT is the only
  permissive licence in the category.

## Research-informed decisions

- **Lead with pagination, not features.** Zero of 7,838 registry plugins
  describe paginated handwriting. → Task order puts pages before shapes.
- **Do not invest in transcription.** Already shipped by InkedMark (3
  providers) and Khattat; "very soon" on `Handwriting`. The fork gives us a
  working implementation free — keep it, spend nothing more on it. → Cut from
  v1 as a _build_ item; it ships anyway.
- **Image insertion is the cheapest real _market_ win.** Requested on Ink since
  2024, still missing there, absent from `Handwriting`. → Model and commands
  support it, but feasibility ranked it lowest value _in a lecture_, so the UI
  is deferred. Revisit the moment this is for anyone but Joost.
- **Shapes, lasso, lined paper, PDF annotation are not differentiators.**
  All shipped elsewhere. → Still built (Joost wants them), but never described
  as the reason this plugin exists.
- **Apple Scribble coexistence is the most-noticed unsolved problem** in the
  category — open since 2024 across Ink and Excalidraw with no maintainer
  answer; every plugin's workaround is "disable Scribble in iOS Settings".
  Two users independently name **Bear** as the app that solved it. → Not in v1
  (unknown difficulty), but first in Later, and study Bear's behaviour.
- **Never store ink in a dot-prefixed folder** — sync services skip them, and
  this is why `Handwriting` needed an Obsidian Sync compatibility toggle. →
  Attachments and any sidecar files go in a visible vault folder.
- **Freehand PDF annotation lands in a vacuum at the incumbent level**: PDF++
  (801k downloads) dormant 13 months, Annotator (598k) dead since Jan 2024,
  neither ever supported pen input. → Worth doing well even though the plugin
  tier is crowded.
- **Go install `Handwriting` before building further.** The research agent's
  first recommendation. It is the closest thing to this project that exists;
  an hour with it is worth more than a week of guessing.

## Feasibility-informed decisions

From `research/FEASIBILITY.md`. Every one of these changed something.

- **Spike 0 before anything else: does Apple Scribble eat strokes?** Upstream
  InkedMark _measured_ ~20% of fast pen-downs never reaching the webview with
  Scribble on, via a debug HUD. No web API can disable or even detect it —
  a swallowed stroke produces no events at all. Two unproven escapes: a
  **dedicated full-screen view** may be safe (Scribble needs a `contenteditable`
  target, which an inline embed has and a full-screen view does not), and
  `signature_pad` deliberately avoids Pointer Events on iPadOS in favour of
  Touch Events for exactly this reason. → **Task 0, and it needs Joost's iPad.**
  Note `src/view/embed-processor.ts` is the inline-embed path, i.e. the
  Scribble-_unsafe_ one.
- **`loadPdfJs()` is a public, documented Obsidian API** with no mobile caveat.
  → PDF backdrops cost no bundled pdf.js (~1.4 MB saved). This is why PDF
  survived the scope cut.
- **`getCoalescedEvents()` and `getPredictedEvents()` shipped in Safari 18.2**
  (2024-12-09). → Faceted fast strokes and input latency are both solvable.
- **tldraw is definitively out.** Not merely a licence question: tldraw's _own_
  official Obsidian plugin has an open bug where the canvas goes blank ~5s
  after loading on iPad — the documented symptom of unlicensed production use.
  → Never revisit tldraw for this project.
- **Do not use the `$1`/`$P` recogniser family for shape snapping.** It
  normalises away rotation, scale and position — exactly the parameters needed
  to _draw_ the snapped shape. → Direct geometric fitting (least-squares line,
  RDP + corner test for rect, Kåsa/Taubin circle fit).
- **`js-draw` (MIT, used by Joplin) is worth one hour** before finalising the
  shape recogniser. Its snapping ships **line and rectangle only, no circle**,
  in 234 lines — a useful calibration of how hard this actually is.

### Open risk: markdown merge vs. a base64 payload

Feasibility's runner-up risk was that a bare `.gnote` extension would silently
not sync (Obsidian Sync's "Sync all other types" is **off by default**). The
fork already sidesteps that by inheriting upstream's `*.ink.md`, which is a
real markdown file and therefore always synced.

But the fix has its own edge: a `.md` file is eligible for **text merging**, and
two devices editing one note can interleave their base64 chunks into a payload
that will not inflate. Excalidraw reportedly carries a source comment about
exactly this. Upstream InkedMark ships this format today and has not obviously
been bitten, so this is a **known risk, not a known bug**.

- v1 mitigation: `parseInkFile` already degrades safely — an unreadable block
  is dropped and the markdown body is preserved, so prose survives.
- Not yet decided: whether to move to an **append-only** layout (one
  self-contained stroke per line) so a text merge produces a still-valid
  document. That is a format change and wants evidence first.
- **Action for Joost:** if ink ever vanishes after editing the same note on two
  devices, this is the first suspect. Say so and we change the format.

## Migrating Joost's existing GoodNotes notebooks

This has to work or "replacement" is a word with no content behind it, and it
turns out to be the same feature we are already building.

**The `.goodnotes` format is closed.** Goodnotes publishes no specification,
schema or UTI. Reverse engineering (unofficial, MIT:
[`Kaih1825/parser-for-goodnotes`](https://github.com/Kaih1825/parser-for-goodnotes))
suggests a ZIP of per-page Protobuf with no public `.proto`, some fields
wrapped in Apple's framed LZ4 (`bv41`/`bv4$`) around TPL-serialised stroke
data. Xournal++ has an open, unimplemented request to read it. Treat parsing
`.goodnotes` as out of scope.

**So the migration path is PDF export**, and that lands on the PDF-backdrop
feature already in v1:

- Export **Flattened** with "Enable Handwriting Recognition" ticked → the
  handwriting becomes searchable text in the PDF, and the page renders exactly
  as drawn. Best default.
- Export **Editable** only when the notebook's outlines or the original PDF's
  hyperlinks matter — flattening drops both.
- Old notebooks arrive as PDF-backed pages: readable, annotatable, searchable,
  but their old ink is baked into the backdrop rather than editable strokes.
  That is an honest and acceptable trade, and it should be said out loud in
  the README rather than discovered.

**A trap worth knowing before cancelling anything.** Goodnotes' own docs: once
a paid plan lapses, documents become read-only, you are asked to choose **three**
to make editable, and _"once you have made this choice, you cannot go back."_
Also, T&C 12.2 permits deletion of Goodnotes Cloud data after two years of
inactivity without payment, while notes kept locally or in iCloud are
explicitly _"yours forever"_. **Export everything to PDF before the
subscription lapses, not after.**

## What replacing the subscription is actually worth

Dutch App Store, from the GoodNotes deep dive: **Essential €12.99/year, Pro
€39.49/year**, one-time Special Edition €39.49. All base plans are annual;
only the AI Pass add-on (~€10/month) is monthly.

Stated plainly because it should shape effort: this is not an expensive
subscription. The honest reasons to build this are that the notebooks become
**files in a vault Joost already owns**, that handwriting becomes searchable
and linkable alongside everything else he keeps there, and that it is a good
project. "Saving money" is not the reason, and the plan should not pretend it
is.

The free tier is not a fallback: 3 notebooks, 3 folders, 100 MB, 5 MB import
cap, watermarked exports.

## Structural facts about GoodNotes worth copying

From `research/FEATURES.md` and the GoodNotes deep dive — each simplifies our model:

- **A cover is just the first page.** Goodnotes: _"The cover is the first page
  of a notebook… technically just a regular page."_ So a cover needs no model
  concept at all — it is page 1 with a cover-ish backdrop, and generating a
  thumbnail of it is the whole feature.
- **A notebook is an ordered, flat list of pages.** No sections, no dividers,
  no sub-documents. Our `pages[]` is already exactly this. Navigation inside a
  long notebook is done with an **outline** and **per-page bookmarks**, not
  with hierarchy.
- **Page size and orientation are per-page, not per-notebook** — a notebook can
  mix portrait and landscape. Our per-page `geometry` already allows this;
  don't "fix" it by hoisting geometry to the document.
- **Scroll direction is switchable**, horizontal or vertical, per document and
  globally.
- **The lasso has an "Included in Selection" filter**, the same idea as the
  eraser filter — pick which content types a selection grabs.

## Assumptions

- Target is iPadOS Obsidian first; desktop must not regress but is not tuned.
- Handwriting stays as **strokes** (vector), never flattened to an image.
- **File format stays upstream's `*.ink.md`** — a real markdown file with a
  `%%goodobsidian … %%` base64 data block. Keeping it buys Obsidian search, graph,
  links and sync for free, all already built and tested. _(This replaces the
  earlier `.gnote` idea, which was written before the codebase was read.)_
- **A notebook is a folder and each page is its own file** (Joost's decision,
  2026-09-20; layout in `contracts/api.md` §1b). Accepted cost: ~540 page files
  for a six-course semester. Accepted because it is the only way transcription
  lands in Obsidian's search per page and `[[links]]` reach a single
  handwritten page.
- Schema gains a **version 2** for pages/backdrops/images; a v1 document loads
  as a single blank-backdrop page. `serialize.ts` owns the migration.
- Plugin id becomes `goodobsidian` so a community-store update to InkedMark
  cannot silently overwrite the fork. Both plugins must not run in one vault.
- No telemetry, no account, no network call except an explicit transcription
  request.

## Later

- **Apple Scribble coexistence** (study Bear). Highest-value unsolved problem.
- Search across handwriting (upstream's text layer already makes this partly work).
- Pen styles beyond pen/highlighter; custom palettes.
- Page templates (Cornell notes, music staves, isometric).
- Export a notebook to PDF 1:1 (pagination makes this cheap).
- **Audio recording** synced to ink timing (Notability's signature feature).
  Needs per-stroke timestamps, which upstream's `[x, y, pressure]` format does
  not carry — see `research/FEATURES.md` for the cost.
  **Correction (2026-09-20): GoodNotes does do this, and has since Jan 2023.**
  An earlier note here said ink-synced audio was a Notability-only feature. It
  is not. GoodNotes calls it **Note Replay**: _"every stroke is time-stamped to
  the audio"_, and _"tap anywhere on your handwritten notes to jump the audio
  to that exact moment"_. Apple Notes genuinely lacks it — only transcript-text
  seeking — but Apple Notes is not what Joost is cancelling.
  So for the stated goal this is **table stakes, not a luxury**, and the
  `t0` per-stroke timestamp moves from "nice hedge" to "add it in the next
  schema migration, before there are notebooks worth migrating".
- **Handwritten math solving** (Apple's "Math Notes": write `3x + 7 =` and get
  the answer, in your own handwriting; write `y = 5x + 3` and get a graph).
  This is the most impressive thing Apple Notes does that GoodNotes does not,
  and it is _not_ an Apple Intelligence feature, so users expect it to be
  cheap. We already inherit an LLM recognition layer (`src/recognition/llm.ts`)
  that reads strokes — solving is a different prompt against the same pipeline,
  which makes this far cheaper for us than it looks. Rendering the answer in
  Joost's own handwriting is the hard half; plain text is the honest v1.
- Notebook shelf: covers, thumbnail grid, page reorder/duplicate/delete.
- Desktop mouse/trackpad tuning.
