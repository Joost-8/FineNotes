# GoodObsidian — Feature inventory & ranked roadmap

> Research date **2026-09-20**. Current platform: **iPadOS 27**, released
> **2026-09-14** ([Apple Newsroom](https://www.apple.com/newsroom/2026/09/major-updates-for-apples-software-platforms-are-now-available/),
> [About iPadOS 27 Updates](https://support.apple.com/en-us/149075)). Current
> GoodNotes major version: **6** (announced 2023-08-09, no 7 as of today —
> [Goodnotes blog index](https://www.goodnotes.com/blog)).

This document turns Joost's sentence —

> _"I want mine to resemble GoodNotes, to be a replacement for those subscriptions,
> that you can run inside Obsidian and use with an Apple Pencil. My idea was **not**
> mixing typed notes with handwriting, but **files you create that become
> GoodNotes-like notebooks**. Also the transcript feature. Maybe audio recording."_

— into a buildable roadmap.

**It builds on, and does not repeat, [`research/FEASIBILITY.md`](./FEASIBILITY.md).**
Where a constraint is already established there (Scribble, coalesced events, pdf.js,
Sync limits, the `.md` merge risk, bundle size, mobile toolbar), this file cites it
rather than re-deriving it. Read FEASIBILITY §1.6 and §2.5 before acting on anything
here.

**Confidence tags** on feasibility claims: **CONFIRMED** (primary source read or an
API signature verified) · **LIKELY** (good secondary evidence, one source) ·
**UNVERIFIED** (plausible, untested, needs the iPad).

**Method note.** App feature claims are sourced from official feature pages, support
docs and release notes, linked inline. One gap to be honest about:
`support.goodnotes.com` and `support.gingerlabs.com` return HTTP 403 to automated
fetches, so a handful of GoodNotes and Notability claims rest on indexed excerpts of
those same official pages rather than a full read — those are marked
_(indexed excerpt)_. Apple and WebKit claims are from apple.com, support.apple.com,
developer.apple.com, webkit.org and bugs.webkit.org directly. Nothing here comes from
a listicle.

---

## 0. Executive summary

1. **The notebook model is the whole project now.** Joost's correction inverts
   upstream InkedMark's thesis. Upstream exists to fuse ink _into_ markdown notes;
   Joost wants files that _are_ notebooks. Almost every remaining decision follows
   from that, including the file layout and the Scribble risk.
2. **Recommended layout: one folder per notebook, one `*.ink.md` file per page**,
   plus a rarely-written `_notebook.md` holding title, cover and page order. §2.3
   argues this at length. It is the only layout where a 90-page semester notebook
   does not exceed Obsidian Sync Standard's 5 MB per-file cap, and the only one where
   per-page transcription makes Obsidian search land on the right _page_.
3. **Audio recording is feasible but strictly deskbound-ish**: it works while
   GoodObsidian is on screen and stops when the iPad sleeps. That is not an
   implementation failure you can engineer around — Obsidian's own core Audio
   Recorder has the same limit. §3.
4. **The single highest-value unbuilt feature is not on GoodNotes' feature list at
   all.** It is _per-page transcription feeding Obsidian's own search and links_ —
   the one thing GoodNotes structurally cannot do. Everything else is catching up;
   this is the only place where the fork wins outright.
5. **The subscription being replaced costs $11.99–$35.99/year**
   ([goodnotes.com/pricing](https://www.goodnotes.com/pricing)). The money is not the
   point; the habit is. Weight the roadmap toward _"would Joost stop reaching for the
   GoodNotes icon"_, not toward feature parity.
6. **Four things Joost may assume are possible and are not**, stated here so nobody
   discovers them in month three: **background/screen-locked audio recording**
   (the background-audio mode lives in Obsidian's Info.plist, not ours);
   **on-device speech-to-text in the webview** — and it _feature-detects as available_
   before failing silently; **any Apple Pencil Pro gesture** (squeeze, barrel roll,
   haptics, double-tap); and **live handwriting-to-text as you write** (the only
   stroke recogniser reachable from a webview is cloud-only, one round-trip per
   stroke, and its self-serve pricing no longer exists). Details in §6.

---

# Task 1 — What the apps being replaced actually do

## 1.1 GoodNotes 6 — the benchmark

### Pricing (this is what is being cancelled)

Verified on the live pricing page, 2026-09-20 ([goodnotes.com/pricing](https://www.goodnotes.com/pricing)):

| Plan          | Price         | Includes                                                                                                                                            |
| ------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free**      | $0            | **Up to 3 files total** (notebooks + whiteboards + text documents), 20 minutes of audio recording, basic tools, handwriting search, limited sharing |
| **Essential** | **$11.99/yr** | Unlimited files & notebooks, **unlimited audio recording**, full sharing, 5 GB storage, basic AI                                                    |
| **Pro**       | **$35.99/yr** | + private link sharing, real-time collaboration, cross-platform sync, advanced AI (Meetings, Create Mode)                                           |
| Teams         | $120/seat/yr  | + admin console, SAML SSO, Intune                                                                                                                   |

At launch GoodNotes 6 was $9.99/yr or a **$29.99 one-time** purchase
([Introducing Goodnotes 6, 2023-08-09](https://www.goodnotes.com/blog/introducing-goodnotes-6));
the one-time option still exists on Apple in some regions. Note the free tier is a
3-file evaluation, not a usable free product — which is precisely the lock-in being
escaped.

### Notebook / document management

- Library ("Documents") → **folders**, with **subfolders**, each with an optional
  **colour and icon** ([Create and manage folders](https://support.goodnotes.com/hc/en-us/articles/7384414056207-Create-and-Manage-folders), indexed excerpt).
- Document types are distinct kinds: **Notebook**, **Whiteboard** (infinite canvas),
  **Text document**, **Study set**, imported **PDF** — the free tier counts all of them
  against one 3-file allowance ([pricing](https://www.goodnotes.com/pricing)).
- **Sidebar page manager** inside a document: thumbnails of every page, drag to
  reorder, `…` menu per page for duplicate/copy/delete, and it hosts Outline and
  Bookmarks too ([Manage pages](https://support.goodnotes.com/hc/en-us/articles/5898537788815-Manage-pages),
  [Using the Sidebar to navigate your Notebook](https://goodnoteseducation.zendesk.com/hc/en-us/articles/13805495492239-Using-the-Sidebar-to-navigate-your-Notebook), indexed excerpts).
- **Reordering**: long-press a thumbnail until it lifts, drag, drop
  ([Reordering pages in a document](https://support.goodnotes.com/hc/en-us/articles/360000115315-Reordering-pages-in-a-document), indexed excerpt).
- **Outline**: Pages tab → arrow under a thumbnail → _Add Page to Outline_; outline
  entries are re-orderable ([Create an outline](https://support.goodnotes.com/hc/en-us/articles/7353757101071-Create-an-outline), indexed excerpt).
- **Bookmarks**, managed from the same sidebar.
- **Quicknotes** — a scratch surface for immediate capture, filed later
  ([features page](https://www.goodnotes.com/features)).
- **On-disk format: `.goodnotes` is a ZIP package.** A library backup is a `.zip`
  containing one `.goodnotes` per document, each individually re-importable
  ([backup article](https://support.goodnotes.com/hc/en-us/articles/7353742233359-I-cannot-view-the-Goodnotes-backup-zip-file-on-my-computer), indexed excerpt).
  **This is worth noticing: GoodNotes' own notebook is a container of separately
  addressable pages, not one monolith.** §2.3 leans on that.

### Paper and templates

- Built-in paper: blank, lined, grid, dotted, plus Cornell and planner styles.
- **Dynamic templates** (new in 6): customise template **size and line colour** —
  e.g. blue rules instead of grey ([Introducing Goodnotes 6](https://www.goodnotes.com/blog/introducing-goodnotes-6)).
- **Custom covers and papers**: import a PDF or image as a cover or a paper template,
  grouped into named sets
  ([Import and manage custom notebook templates](https://support.goodnotes.com/hc/en-us/articles/7353728093199-Import-and-manage-custom-notebook-templates), indexed excerpt).
- **In-app marketplace** for stationery, stickers, planners and templates, with
  subscriber-exclusive content ([Introducing Goodnotes 6](https://www.goodnotes.com/blog/introducing-goodnotes-6)).

### Pen and ink

- Pen types (fountain / ball / brush), highlighter with straight-line snapping,
  eraser with an _erase highlighter only_ option, shapes tool, lasso, image, text,
  laser pointer, ruler.
- Three saved width presets and a colour palette per tool; custom colours.
- Pressure and tilt response; Apple Pencil double-tap to switch tools.
- **Zoom window** — a magnified writing strip that advances automatically, so you can
  write small neatly.

### Selection and editing

- **Lasso** selection: move, resize, recolour, change pen thickness of selected ink,
  screenshot it, cut/copy/paste — including **paste onto another page or another
  notebook**.
- **Convert selection to text** (handwriting → typed text in place).
- **Pen gestures, new in 6**: **Scribble to Erase** (cross out to delete) and
  **Circle to Lasso** (draw a circle to select)
  ([Introducing Goodnotes 6](https://www.goodnotes.com/blog/introducing-goodnotes-6)).
- **Elements / stickers**: a reusable library of saved ink or images.

### Text and typing

- Text boxes anywhere on a page, with font/size/colour and a style library.
- A separate **Text document** type for pure typing.
- AI text editing on typed content: paraphrase, shorten, expand, adjust tone
  ([Introducing Goodnotes 6](https://www.goodnotes.com/blog/introducing-goodnotes-6)).

### Images and media

Photo import, camera capture, document scanning, image crop/rotate, stickers,
shapes, sticky notes, web link embedding ([features page](https://www.goodnotes.com/features)).

### PDF handling

Import a PDF as a document and annotate it; annotations are stored with the document;
export back to PDF with or without annotations; PDF hyperlinks and outlines are
navigable; pages can be extracted, inserted and rearranged
([Export documents or pages](https://support.goodnotes.com/hc/en-us/articles/7353742824975-Export-documents-or-pages),
[Import files](https://support.goodnotes.com/hc/en-us/articles/7353717816463-Import-files-into-Goodnotes), indexed excerpts).

### Search and OCR

- **Handwriting search** across a document and across the whole library — available
  even on the free tier ([pricing](https://www.goodnotes.com/pricing)).
- **AI-powered summaries and search across handwriting, text and sketches**
  ([features page](https://www.goodnotes.com/features)).
- **Math conversion**: write an equation, convert to text; write a line of math
  followed by `=` for an on-the-fly result
  ([Introducing Goodnotes 6](https://www.goodnotes.com/blog/introducing-goodnotes-6)).

### Audio

**Yes — GoodNotes has audio recording.** 20 minutes on Free, unlimited from Essential
($11.99/yr) ([pricing](https://www.goodnotes.com/pricing)); the features page lists
"audio recording and transcription". **I found no primary source claiming GoodNotes
syncs audio to ink the way Notability does** — the tap-a-word-to-replay mechanic is
documented by Notability and Samsung, not by GoodNotes. Treat GoodNotes audio as
"attached recording + transcript", not "Note Replay". _(UNVERIFIED as a negative —
absence of evidence.)_

### Organisation

Folders and subfolders with colours/icons; favourites; recents; shared spaces;
Quicknotes; Study Sets as a distinct filing object.

### Sharing and export

Export a document or selected pages as **PDF, image or `.goodnotes`**; share links;
**real-time collaboration** with multi-user cursors (Pro); presentation mode; read-only
mobile access ([features page](https://www.goodnotes.com/features),
[Export documents or pages](https://support.goodnotes.com/hc/en-us/articles/7353742824975-Export-documents-or-pages)).

### Sync

iCloud and GoodNotes cloud; **cross-platform sync (iPad / iPhone / Mac / Windows /
Android / Web) is gated behind Pro** ([pricing](https://www.goodnotes.com/pricing)).

### AI (GoodNotes 6)

- **Spellcheck for handwriting** — corrects handwritten words _in your own writing
  style_; English, Spanish, German, Dutch.
- **Word Complete** — discontinued March 2025.
- **AI Math Assistance** — catches wrong equations, suggests next steps for systems of
  equations, trig, calculus; SAT/DSE prep courses built in.
- **Ask Goodnotes** — natural-language Q&A over your own notebook: summaries,
  clarifications, generated quizzes
  ([Goodnotes AI guide](https://support.goodnotes.com/hc/en-us/articles/10779112528399-A-guide-to-Goodnotes-AI), indexed excerpt).
- **Mind map generation**, **meeting minutes → project plan**
  ([features page](https://www.goodnotes.com/features)).
- All of it is account-gated and server-backed; "basic AI" at Essential, "advanced AI"
  at Pro.

### Study

**Study Sets** (a first-class file type) with **Smart Learn**, a spaced-repetition
scheduler that reorders cards by difficulty and sends review reminders
([Getting Started with Study Sets and Smart Learn](https://support.goodnotes.com/hc/en-us/articles/7353756529551-Getting-Started-with-Study-Sets-and-Smart-Learn), indexed excerpt).

---

## 1.2 Apple Notes (iPadOS 27) — the free baseline

### Document model — there is no notebook, and no page

Account → Folder → **Subfolder** → Note. That is the entire hierarchy, verified by
walking every page of the Notes chapter of the iPad User Guide. **Apple Notes has no
notebook concept, no page concept, and no page templates.** A note is one continuously
scrolling document with resizable ink blocks in it
([Draw or write in Notes](https://support.apple.com/guide/ipad/add-drawings-and-handwriting-ipada87a6078/ipados)).

- Subfolders by drag-onto-folder; pinned notes; sort by title/date; **List or Gallery
  view** ([Organize in folders](https://support.apple.com/guide/ipad/organize-in-folders-ipadc44c8c4a/ipados),
  [Change the Notes view](https://support.apple.com/guide/ipad/change-the-notes-view-ipade2318ee3/ipados)).
- **Tags** (`#tag`), a tag browser, and tags can be **excluded** by tapping again.
  **Smart Folders** filter on tags, dates, mentions, attachments, checklists, with
  any/all matching ([Organize with tags](https://support.apple.com/guide/ipad/organize-with-tags-ipadf688557f/ipados),
  [Use Smart Folders](https://support.apple.com/guide/ipad/use-smart-folders-ipad0a267d6e/ipados)).
- **Handwritten tags**: _"You can use Apple Pencil or your finger to handwrite a tag
  in a note. Tap the underlined tag, then tap Convert to tag."_ (same page). This is
  the single cleverest ink↔metadata bridge in any of these apps.

### Handwriting and Markup

**Eight ink types**, authoritatively enumerated by PencilKit's `PKInkingTool.InkType`
([developer.apple.com](https://developer.apple.com/documentation/pencilkit/pkinkingtool/inktype)):
`pen`, `pencil`, `marker`, `monoline`, `fountainPen`, `watercolor`, `crayon`, `reed`.

`PKContentVersion` dates them exactly
([developer.apple.com](https://developer.apple.com/documentation/pencilkit/pkcontentversion)):
v1 = pen/pencil/marker (iPadOS ≤14) · **v2 = monoline, fountain pen, watercolour,
crayon (iPadOS 17)** · **v3 = barrel-roll angle data (Apple Pencil Pro, iPadOS 17.5)**
· **v4 = reed pen (iPadOS 26)** · **v5 = "stroke render state support" (iPadOS 27)**.
_A versioned ink format with documented migration semantics is itself worth copying —
see FORK.md's schema-version approach._

- **Two erasers on one tool**: _"To switch between the erasers, tap the eraser tool
  again, then choose Pixel Eraser or Object Eraser"_
  ([Draw and handwrite with Markup](https://support.apple.com/guide/ipad/draw-and-handwrite-with-markup-ipad6350b8dc/ipados)).
  API: `PKEraserTool.EraserType` = `vector` / `bitmap` / `fixedWidthBitmap`.
- **Ruler**: drag to move; _"touch and hold the ruler with two fingers, then rotate
  your fingers"_ to set the angle.
- Toolbar is **draggable to any screen edge** with an **auto-minimize** option.
- **Smart Selection uses text gestures on ink**: touch-and-hold-drag, **double-tap =
  word, triple-tap = sentence**. The menu offers Cut, Copy, Delete, Duplicate,
  **Copy as Text**, **Insert Space Above**, Translate, **Straighten**
  ([Draw or write in Notes](https://support.apple.com/guide/ipad/add-drawings-and-handwriting-ipada87a6078/ipados)).
- **Apple Pencil Pro**: squeeze opens a tool palette; **barrel roll changes the
  orientation of shaped nibs only** (fountain pen, marker, reed — not round ones);
  haptics; hover preview; double-tap to switch tools
  ([apple.com/apple-pencil](https://www.apple.com/apple-pencil/)).
  **None of this is reachable from a webview** (FEASIBILITY §1.5).
- **Scribble** is toggled at Settings → Apple Pencil → Scribble, and Notes has its own
  **Handwriting tool to the left of the pen** that transcribes as you write. 44 locales
  ([Feature Availability](https://www.apple.com/ios/feature-availability/#apple-pencil-scribble)).

### Smart Script (iPadOS 18)

Apple's own words: _"Smart Script refines your natural handwriting as you write to make
it straighter, smoother, and more legible; it also corrects your spelling and grammar
inline as you write and can convert typed text into your handwriting."_
([What's new in iPadOS 18](https://support.apple.com/guide/ipad/whats-new-in-ipados-18-ipad8d9d296d/18.0/ipados/18.0)).
Plus: _"add space, scratch out a sentence, or even paste typed text in their own
handwriting, and the paragraph will automatically reflow"_
([newsroom](https://www.apple.com/newsroom/2024/06/ipados-18-introduces-powerful-intelligence-features-and-apps-for-apple-pencil/)).

It is **three separately-gated features** on Apple's
[Feature Availability](https://www.apple.com/ios/feature-availability/) page —
auto-refine/convert/paste (39 locales), **Proofread Handwriting (33 locales, no CJK)**,
and insert-space/reflow/scratch-to-delete (39 locales). **It does not require Apple
Intelligence**, only a supported language. iPadOS 26 extended the same engine to
Freeform and Journal
([iPadOS 26 features PDF](https://www.apple.com/os/pdf/All_New_Features_iPadOS_26_Sept_2025.pdf), pp. 7, 13).

### Paper

**Per-note, with a global default**: _"In an existing note: Tap ⋯, tap Lines & Grids,
then choose a style. In all new notes: Go to Settings > Apps > Notes…"_
([Change the Notes view](https://support.apple.com/guide/ipad/change-the-notes-view-ipade2318ee3/ipados)).
Apple does not enumerate the styles, and does not say which release introduced them.
**No page templates, no page size, no pagination.**

### Handwriting search

Searchable handwriting in **33 locales**; **Copy Handwriting as Text** is tracked as
its own 33-locale feature; searchable text in images/scans is a separate 28-locale
feature ([Feature Availability](https://www.apple.com/ios/feature-availability/)).
A nice touch worth stealing: _"If the note doesn't have a title, the first line of
handwritten text becomes the suggested title."_

### Math Notes (iPadOS 18, extended 26)

Write an expression and `=`, get the answer **rendered in your own handwriting**
([newsroom](https://www.apple.com/newsroom/2024/09/ipados-18-is-now-available-taking-ipad-to-the-next-level/)).
Vertical stacked math; variables (`x = 5`, Latin script only, not usable in vertical
math); units and currency conversion including mixed units; **graphing**, with
**3D `z=` graphing added in iPadOS 26**
([iPadOS 26 features PDF](https://www.apple.com/os/pdf/All_New_Features_iPadOS_26_Sept_2025.pdf), p.13).
Two error affordances worth copying verbatim: **red dotted underline = unsolvable,
blue dotted underline = ambiguous glyph, tap to disambiguate**. Hovering the Pencil
over a number gives a **scrubber** that live-updates dependent graphs
([Solve math with Math Notes](https://support.apple.com/guide/ipad/solve-math-with-math-notes-ipadeb38d0f8/ipados)).
Does not require Apple Intelligence.

### Audio — and the key negative finding

Record via ⊕ → Record Audio; pause/resume; **live transcript while recording**;
Find in Transcript, Add Transcript to Note, Copy Transcript. Summaries require Apple
Intelligence. **Transcription is 10 languages**; summaries a different 26-locale list
([Record and transcribe audio in Notes on iPad](https://support.apple.com/guide/ipad/record-and-transcribe-audio-ipadd0bde806/ipados),
[Feature Availability](https://www.apple.com/ios/feature-availability/#apple-intelligence-notes-transcription)).
iPadOS 26 added **call transcripts** from Phone/FaceTime into Notes.

> **Apple Notes audio is NOT time-synced to ink.** Apple's only seek affordance is
> _"Play the audio at a specific point: Tap the text you want to hear"_ — and "the
> text" is the **transcript**, not the handwriting. There is no documented way to tap
> a stroke and seek the recording. **This is the largest functional gap in Apple's
> offering** and the clearest opening for anyone building a lecture tool.

Also undocumented by Apple, and therefore unknown: maximum recording length, recordings
per note, background/screen-locked recording, importing existing audio.

### Typed text, media, sharing

Heading/Subheading/Body/Monospaced/Title styles, five highlight colours (18),
checklists, tables, divider lines, **collapsible sections (18)**, note-to-note links
(17), Writing Tools
([Create and format notes](https://support.apple.com/guide/ipad/create-and-format-notes-ipad99e3f0bb/ipados)).
Photos/video with markup, attachment size control, a **View Attachments gallery**,
document scanning, Live Text, and **Image Wand** — sketch a shape, get a generated
image, from the Pencil palette (18). Full real-time collaboration on a note _or a
folder_, with a **Co-Owner** role, `@mentions`, and an activity/highlights view
([Share notes and collaborate](https://support.apple.com/guide/ipad/share-and-collaborate-ipad8c7b03b9/ipados)).

### Export — better than expected, with one nasty trap

Four routes ([Export or print notes](https://support.apple.com/guide/ipad/export-or-print-notes-ipad50c393a8/ipados)):
Open in Pages (_"You can't edit drawings in Pages"_), **Export as PDF**,
**Export as Markdown — new in iPadOS 26** (import too,
[iPadOS 26 features PDF](https://www.apple.com/os/pdf/All_New_Features_iPadOS_26_Sept_2025.pdf), p.14),
and Print → Save to Files.

> **The trap, in Apple's own words:** _"In a note with a multipage PDF or scanned
> document, the exported PDF contains **only the first page** of the original PDF or
> scanned document."_

There is no bulk/whole-folder export and no vector ink export.

### iPadOS 27 brought Notes essentially nothing

Apple's ["What's new in iPadOS 27"](https://support.apple.com/guide/ipad/whats-new-in-ipados-27-ipad8d9d296d/ipados)
**has no Notes section at all** — compare iPadOS 18, which had a dedicated paragraph.
The only adjacent items are _"Take action with Siri in Notes"_ (_"turn handwritten
lecture notes into a detailed study guide"_) and Visual Intelligence circle-with-Pencil
([apple.com/os/ipados](https://www.apple.com/os/ipados/)). Apple has also **moved PDF
work out of Notes into the new Preview app** (iPadOS 26) — the dedicated "Work with
PDFs in Notes" page is gone from the 27 guide.

### What this means for GoodObsidian

Apple Notes sets the _floor_: free, on every iPad, with handwriting search, audio
transcription, Math Notes and now Markdown export. Shipping something Apple Notes also
ships is not a reason to switch — it is a reason not to be embarrassed.

**The gaps to exploit are concrete**: no notebooks, no pages, no page templates, **no
audio↔ink sync**, no bulk export, a PDF export that silently drops pages, and **two
years of near-stasis in handwriting since iPadOS 18**. Every one of those is a place a
paginated, vault-native tool can be plainly better.

**The ideas worth copying** are mostly interaction design, not ML: the pixel/object
eraser toggle on one tool, double-tap-word/triple-tap-sentence selection on _ink_,
"first line of handwriting becomes the title", handwritten `#tags` converted with one
tap, and the red/blue dotted-underline confidence affordance. Smart Script and Math
Notes themselves are native-ML and out of reach (§6).

---

## 1.3 The others — only where they beat both

Full detail was gathered separately; this is the distilled delta.

### Notability — audio↔ink is the whole product

- The mechanic, from the docs: _"Audio recordings are linked to your annotations.
  While playing the audio, you can tap anything in a note to jump to that point in the
  recording. Annotations you add while playing a recording are also synced to the
  recording."_
  ([Recording and Playing Audio](https://support.gingerlabs.com/hc/en-us/articles/206060617-Recording-and-Playing-Audio), indexed excerpt)
- Playback mode uses the **Hand tool** as the tap target, which keeps it out of the
  pen's way — a good UX detail to steal verbatim.
- **The index is bidirectional and media-agnostic.** You can _import_ an mp4 or voice
  memo and then write against it during playback; the new strokes join the index. So
  the data model is a generic `stroke → media timestamp` map, not a capture artefact.
- Scrubber: drag the circle horizontally to seek, **drag it away to slow the seek
  rate** — a jog/shuttle. ±10 s buttons, 0.7×–2× speeds.
- Recordings can be trimmed, split, renamed and **merged**. Guidance: _"Starting a new
  recording after 1 hour is recommended, as recordings may split into 1-hour segments."_
- Transcription is cloud: _"audio will be processed when the device is connected to the
  internet"_ ([Audio Transcripts](https://support.gingerlabs.com/hc/en-us/articles/6059035461146-Audio-Transcripts)).
- Other distinctives: **LaTeX round-trip** on converted math
  ([Handwriting and Math Conversion](https://support.gingerlabs.com/hc/en-us/articles/360003878731-Handwriting-and-Math-Conversion));
  **Multi-Note** split view of two notes in one window
  ([Multi-Note and Note Switcher](https://support.gingerlabs.com/hc/en-us/articles/360003857512-Multi-Note-and-Note-Switcher));
  **Presentation Mode** that keeps the second pane private as speaker notes
  ([Presentation Mode](https://support.gingerlabs.com/hc/en-us/articles/360040755411-Presentation-Mode-)).
- Pricing: Starter free (5 notes), Lite $11.99/yr, Plus $15.99/yr (audio +
  transcription starts here), Pro $79.99/yr ([notability.com/pricing](https://notability.com/pricing)).

### MyScript Notes (formerly Nebo) — live conversion, and the SDK question

- Renamed from Nebo in Sept 2025; Windows "Nebo" is frozen
  ([FAQ](https://help.myscript.com/notes/faq/)).
- In **Documents** only: a **conversion preview above the line as you write**, with
  **tappable alternates** to correct a word immediately
  ([Convert](https://help.myscript.com/notes/edit-content/convert/)). This is the best
  single idea in the category — recognition error is caught at zero cost instead of at
  export time.
- Gesture editing: scratch to erase, **downward stroke to split**, **upward stroke to
  join**, strikethrough, frame-to-highlight — and the outcomes are _configurable_
  ([Pen gestures](https://help.myscript.com/nebo/edit-content/pen-gestures-and-interactions/)).
- Live diagrams: shapes with connectors that stay linked when moved
  ([Shapes](https://help.myscript.com/notes/create-content/shapes/)).
- **The SDK verdict, which matters for our transcript feature:** `iinkTS` is Apache-2.0
  but is **a client only — recognition is always server-side**. MyScript's own support
  answer: _"There is no solution for using iinkJS for offline recognition, except for
  using the native iink SDK."_
  ([forum](https://developer-support.myscript.com/support/discussions/topics/16000032257)).
  Pricing is now **free to 2,000 requests/month, then "contact us"**
  ([developer.myscript.com/pricing](https://developer.myscript.com/pricing)) — the old
  ~$10/1k self-serve tier is gone. This **downgrades** FEASIBILITY §4's cost estimate
  for the only stroke-based recogniser reachable from a webview.

### Noteful — the structural ideas, in a $6.99 one-time app

- **Layers** inside a notebook — annotate on a separate layer over an untouched PDF,
  show/hide/reorder ([getnoteful.com](https://www.getnoteful.com/)).
- **Multiple paper templates within a single notebook** — per-page paper, not
  per-notebook.
- **Inline hashtags, including nested `#nested/tag`, written anywhere in the notebook**,
  browsable by tag. This is the most Obsidian-shaped idea any of these apps has.
- Audio recording with playback position synced to notes — in a $6.99 app, which tells
  you the feature is not exotic.
- Pricing: **$6.99 one-time**, no subscription
  ([App Store](https://apps.apple.com/us/app/noteful-notes-pdf-markup/id1587904334)).

### Samsung Notes — the playback idea nobody else has

- Audio sync runs **both** directions. Tap ink → jump to that audio moment; **and**
  during playback _"it highlights what you have written on each section"_ and
  _"the text you wrote or typed will appear in real time as the voice recording plays"_
  ([Samsung support](https://www.samsung.com/us/support/answer/ANS10001577/)).
  **Watching the page reconstruct itself is strictly better than having to guess where
  to tap**, and it costs nothing extra once per-stroke timestamps exist.
- Documented failure mode worth copying into our design: _"If a handwritten note is
  deleted, you will not be able to move to the corresponding voice recording time
  point."_
- Galaxy AI: Transcript Assist with **speaker separation**, 16 languages; Auto format;
  Summarize (200-character minimum) ([Note Assist](https://www.samsung.com/us/support/answer/ANS10000941/)).

### Cross-app scoreboard on the two features Joost named

|                        | Transcript of handwriting | Audio recording               | **Audio↔ink time sync**                   |
| ---------------------- | ------------------------- | ----------------------------- | ----------------------------------------- |
| GoodNotes 6            | Yes (search + convert)    | Yes, unlimited from $11.99/yr | **Not documented**                        |
| Apple Notes            | Yes (copy as text)        | Yes, + transcript + summary   | **No — transcript↔audio only, confirmed** |
| Notability             | Yes                       | Yes                           | **Yes — the signature feature**           |
| Samsung Notes          | Yes                       | Yes                           | **Yes, and it replays the page**          |
| Noteful                | —                         | Yes                           | Yes                                       |
| MyScript Notes         | Best in class (live)      | No                            | No                                        |
| **GoodObsidian today** | **Yes — shipped**         | No                            | No                                        |

Audio↔ink sync is **table stakes among lecture-focused apps**, not a luxury. That is
the strongest argument for building it; §3 is the argument against doing it soon.

---

# Task 2 — The notebook model

## 2.1 What a "notebook" actually is to a GoodNotes user

Stripped of marketing, a GoodNotes notebook is **five things**:

1. **A named, ordered sequence of fixed-size pages.** Page size and orientation are
   chosen at creation and are a property of the notebook, though pages of a different
   size can be imported in. Navigation is swipe-horizontal or scroll-vertical, user's
   choice.
2. **A cover.** A real, visible artefact — an image or PDF page shown as the item's
   face in the library. Custom covers are a first-class import type
   ([Import and manage custom notebook templates](https://support.goodnotes.com/hc/en-us/articles/7353728093199-Import-and-manage-custom-notebook-templates)).
   Half the GoodNotes aesthetic economy is covers.
3. **A page manager**: a thumbnail sidebar with drag-reorder, duplicate, delete, copy
   to another notebook ([Manage pages](https://support.goodnotes.com/hc/en-us/articles/5898537788815-Manage-pages)).
4. **Two navigation indexes over those pages** — an **Outline** (user-nominated pages
   with labels, re-orderable) and **Bookmarks**. There are no "sections" or dividers as
   a separate object; the Outline _is_ the sectioning mechanism.
5. **A filing position** in a folder tree, with a colour and icon on the folder.

And, decisively for us: **on disk it is a ZIP package** — a container of separately
addressable pages, not one monolithic blob
([backup article](https://support.goodnotes.com/hc/en-us/articles/7353742233359-I-cannot-view-the-Goodnotes-backup-zip-file-on-my-computer)).

The user-facing feeling is: _a notebook is an object you pick up, with a face, a spine
and a page you were last on._ Upstream InkedMark has none of that — it has a note with
ink in it.

## 2.2 What a notebook-shaped plugin needs that a single ink note does not

Current state, from `src/model/document.ts`: an `InkDocument` already has
`pages: Page[]`, each with `geometry`, `backdrop`, `strokes`, `images`. **The
in-document page model is done.** What is missing is everything _around_ the pages:

| Need                                           | Why a single-file ink note doesn't have it                                                                                          | Cost                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Notebook browser / shelf**                   | There is nothing above the file. Obsidian's file explorer is a tree of filenames, not a shelf of covers.                            | M — or **free**, see below   |
| **Cover**                                      | No concept. Needs a generated or chosen image plus somewhere to declare it.                                                         | S                            |
| **Page thumbnail grid / sidebar**              | Rendering page _n_ currently requires the whole document in memory.                                                                 | M–L                          |
| **Page reorder / duplicate / delete / insert** | `src/view/page-commands.ts` exists (130 lines) — partly there for the in-document case; cross-notebook page moves are not.          | S in-doc, M cross-doc        |
| **Outline / quick jump**                       | Nothing. But Obsidian's Outline core plugin reads markdown headings — if each page is a file with a heading, this is nearly free.   | S                            |
| **"Last page you were on"**                    | `ViewState.scrollY` exists but is document-global.                                                                                  | S                            |
| **Per-page paper**                             | Already supported (`Page.backdrop`).                                                                                                | done                         |
| **Landscape / 16:9 pages**                     | `PageGeometry` is per-page already; only the UI to choose is missing.                                                               | S                            |
| **Page-level addressing from outside**         | You cannot link to "page 7 of Analysis" today. This is the one Obsidian genuinely should be good at and currently cannot do at all. | depends on layout — see §2.3 |

**The shelf may be free.** Obsidian's **Bases** core feature has a **Cards view** —
a gallery grid with a per-file **cover image property** that accepts
`"[[link/to/attachment.jpg]]"`, with configurable card width and aspect ratio
([Cards view](https://obsidian.md/help/bases/views/cards)). If every notebook file
carries `cover: "[[…/cover.png]]"` in frontmatter, **Joost gets a GoodNotes shelf
without a line of plugin UI code**, themed, sortable, filterable, and it works on
iPad. Writing the cover PNG is `Vault.createBinary(path, ArrayBuffer)` — **CONFIRMED**,
`obsidian.d.ts:7412`. `createFolder` (7420), `modifyBinary` (7492) and `getFiles()`
(7565) are all public too.

**Design consequence: build the thumbnail _generator_, not the thumbnail _browser_.**
That is a very different amount of work.

## 2.3 Mapping a notebook onto a vault — the layout decision

Constraints that any candidate must survive, all established in FEASIBILITY §2.5 and
re-verified today:

- **Obsidian Sync Standard: 5 MB maximum file size; 1 GB account-wide including
  version history** ([obsidian.md/sync](https://obsidian.md/sync), CONFIRMED). Plus is
  200 MB / 10 GB.
- **`.md` files are merged with diff-match-patch; everything else is last-write-wins**
  (FEASIBILITY §2.5). A text merge of two base64 payloads yields a payload that will
  not inflate.
- **Version-history amplification**: Sync keeps a full copy every few seconds of active
  editing. Rewriting a big file on every autosave is the quota killer (FEASIBILITY §2.5).
- **Mobile indexing cost rises with file count**; large vaults visibly slow iPad cold
  start ([forum](https://forum.obsidian.md/t/unpractical-vault-load-time-for-large-vaults-on-mobile-indexeddb-transactions-are-not-flushed-to-disk/88470)).

### How big is a page, actually?

Arithmetic, from the shipped format (quantised ints, tuple-packed, deflate, base64 —
`src/model/serialize.ts`, `src/model/compress.ts`). A stroke sampled at ~120 Hz for
0.3 s is ~36 points; each point serialises as roughly 17 characters of JSON
(`xxxxxx,yyyyyy,ppp,`); add ~60 bytes of stroke overhead:

|         Strokes on the page | Raw JSON | After deflate (~3.5×) | After base64 (×1.33) |
| --------------------------: | -------: | --------------------: | -------------------: |
|                300 (sparse) |  207 KiB |                59 KiB |          **~79 KiB** |
| 800 (a normal lecture page) |  553 KiB |               158 KiB |         **~210 KiB** |
|      1500 (dense, diagrams) | 1037 KiB |               296 KiB |         **~394 KiB** |

_(Estimate, UNVERIFIED — arithmetic shown so it can be checked; the deflate ratio is
the soft number. Calibrate against a real page on the iPad.)_

**The consequence is decisive: a 90-page semester notebook in one file is 7–35 MB.
That exceeds Obsidian Sync Standard's 5 MB per-file cap outright**, and the failure
mode is the notebook silently ceasing to sync — exactly the `tasknotes#2336` symptom
FEASIBILITY already documents for plugin bundles.

### The candidates

**A — one file per notebook** (`Lectures/Analysis 2026.ink.md`, all pages inside)

|                 |                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync conflicts  | **Worst.** One diff-match-patch merge target for the whole semester. One bad merge loses the notebook, not a page.                                               |
| File size       | **Fails.** 7–35 MB for a semester; 5 MB cap on Sync Standard.                                                                                                    |
| Thumbnails      | Must inflate the entire payload to draw any one page's thumbnail. Slow, and the memory spike is exactly the Excalidraw-freezes-on-iPad shape (FEASIBILITY §2.3). |
| Page reorder    | Cheap in memory (array splice) — but rewrites the whole file, so every reorder is a full version-history copy.                                                   |
| Autosave        | **Worst.** Every stroke rewrites megabytes. This is FEASIBILITY risk #5 at full strength.                                                                        |
| Obsidian search | Finds the notebook, never the page. A hit on "eigenvalue" opens a 90-page file at page 1.                                                                        |
| Links           | Cannot link to a page.                                                                                                                                           |

**B — folder per notebook, one file per page** ← **recommended**

```
Lectures/Analysis 2026/
  _notebook.md          ← title, cover, page order, tags.  Written rarely.
  cover.png             ← generated thumbnail of page 1 (or a chosen image)
  p-a3f1.ink.md         ← one page: strokes + its transcription as the markdown body
  p-b07c.ink.md
  thumbs/p-a3f1.png     ← generated page thumbnails. A VISIBLE folder, never .thumbs/
  audio/2026-09-21.m4a  ← if §3 ever ships
```

|                 |                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync conflicts  | **Blast radius is one page.** A merge accident costs one page's ink, and `parseInkFile` already degrades safely (PLAN.md).                                                                               |
| File size       | ~80–400 KiB per page. Never near 5 MB. Works on Sync Standard.                                                                                                                                           |
| Thumbnails      | Each page inflates independently; thumbnails are generated per page and cached as real PNGs. Cheap, incremental, and survives restart.                                                                   |
| Page reorder    | Costs one write to `_notebook.md`'s order array. No page file is touched, so no page re-uploads.                                                                                                         |
| Autosave        | **Best.** Only the edited page is rewritten — two orders of magnitude less version-history churn.                                                                                                        |
| Obsidian search | **This is the win.** Each page's transcription is that page's markdown body, so a search for "eigenvalue" returns _page 34 of Analysis_, and clicking it opens that page.                                |
| Links           | `[[Analysis 2026/p-a3f1]]` links a typed note to a specific handwritten page. Backlinks and graph work.                                                                                                  |
| **Downside**    | **File count.** A semester of six courses at 90 pages each is ~540 page files plus thumbnails. That is real noise in the file explorer, the graph and the quick switcher, and real mobile indexing cost. |

**C — folder per notebook, page order by sortable filename** (`p0100`, `p0150`, …)

Removes the `_notebook.md` order array (no central merge hotspot) and makes insertion
O(1) via fractional keys. **Rejected**: reordering means renaming, renames break
`[[wikilinks]]` to pages, and a rename is the most sync-hostile operation there is.
An order array in a file written only on structural change is the lesser evil.

**D — notebook `.md` + per-page binary sidecars.** Rejected in FEASIBILITY §2.5: a
bare custom extension is **not synced by default** (Obsidian Sync's "Sync all other
types" is off; only images, audio, video and PDF are on —
[obsidian.md/sync](https://obsidian.md/sync), CONFIRMED). Do not revisit.

### Recommendation

> **Adopt B: one folder per notebook, one `*.ink.md` file per page, plus a
> `_notebook.md` holding title, cover path and the page-order array.**

It is the only candidate that fits inside Sync Standard, the only one where autosave
does not amplify into the storage quota, the only one where a merge accident is
survivable, and the only one where Obsidian's own search and links reach a _page_.
It also mirrors what GoodNotes itself does on disk (a ZIP of pages).

**Its single biggest downside is file-count noise** — hundreds of page files in the
explorer, graph and quick switcher. Mitigations, in order:

1. Obsidian's **Settings → Files & links → Excluded files** hides folders from the
   file explorer, graph and de-prioritises them in search
   ([forum](https://forum.obsidian.md/t/excluding-including-folders-in-graph-view/15213)).
   Ship a setting that offers to add the notebooks root. _Caveat: exclusion also hides
   the pages from quick switcher and, reportedly, from Bases
   ([forum](https://forum.obsidian.md/t/excluding-folders-from-quick-switcher-also-excludes-them-from-bases/110121))
   — so this trades away the search win. Make it opt-in, default off._
2. **The plugin's own notebook view is the primary browser**, so the file explorer
   stops mattering day to day.
3. Keep page filenames opaque and short (`p-a3f1`) so they sort together and read as
   machinery, not as notes.

Three rules that come with the recommendation:

- **Never a dot-prefixed folder.** PLAN.md already says this; the `Handwriting`
  plugin needed an explicit "Compatibility with Obsidian Sync, iCloud and Dropbox"
  toggle precisely because it stores ink in `.handwriting/`
  ([README](https://github.com/ellimist-afk/handwriting)). Thumbnails go in a visible
  `thumbs/` folder.
- **`_notebook.md` must be written rarely** — on rename, cover change, page add/remove/
  reorder. Never on a stroke. It is the one shared merge target left.
- **Migration exists and is cheap.** A today-style single-file `*.ink.md` with N pages
  becomes a folder of N page files; `serialize.ts` already owns a v1→v2 migration and
  this is a v2→v3 of the same shape. Existing InkedMark and current GoodObsidian files
  must keep opening.

## 2.4 Does dropping inline embeds reduce the Scribble risk?

**Yes — materially, and it is the cheapest risk reduction available in this project.**

FEASIBILITY §1.6.1 is unambiguous about the mechanism: Scribble needs a text-input
target, and Ink's own documentation states that in **Live Preview ink embeds** pen
strokes _"can be interpreted as handwriting and inserted as markdown text in the note
instead of ink on the canvas"_, while _"the same ink file in dedicated (full-screen)
view usually works fine"_ — because _"dedicated view has no note `contenteditable` in
the same pane, so Scribble has no markdown target there."_
([Ink docs/apple-pencil-scribble.md](https://github.com/daledesilva/obsidian_ink/blob/main/docs/apple-pencil-scribble.md), CONFIRMED as a quote.)

FEASIBILITY also names the file: `src/view/embed-processor.ts` is the inline-embed path
— _the Scribble-unsafe one_. Joost's correction says that path is not the product.
So:

- **Delete or retire `src/view/embed-processor.ts` (245 lines) and
  `src/view/inline-ink-modal.ts` (247 lines) from the v1 surface**, along with the
  ` ```inkedmark ` fence handling in `src/model/inline-block.ts` (128 lines).
  That removes ~620 lines and, with them, the only code path that puts a drawing
  surface next to a `contenteditable`.
- **The risk is reduced, not eliminated.** Ink says _"usually works fine"_, not
  "works", and InkedMark measured ~20% stroke loss **in its embed-first architecture** —
  which is consistent with the embed being the cause but does not prove the dedicated
  view is clean. Spike 0 (TASKS.md item 0) still has to run on Joost's iPad.
- **Add a standing design rule**, and put it in `CLAUDE.md`: _no drawing surface may
  ever share a pane with a `contenteditable` element._ This rule is now cheap to keep,
  because nothing in the product wants to break it.

Second-order benefit: removing the inline path also removes the argument for
monkey-patching `WorkspaceLeaf.prototype.setViewState` (`src/main.ts:414`), which
FEASIBILITY §2.1 flags as the private-API route Excalidraw took reluctantly. With the
page as the unit, `registerExtensions(["ink.md"]…)` is still blocked — you cannot claim
`.md` — so the monkey-patch probably has to stay. **Worth one hour to check whether a
different page extension can be claimed cleanly**, but do not block on it.

---

# Task 3 — Audio recording, assessed properly

## 3.1 Does `MediaRecorder` work in Obsidian's iPadOS webview?

**Yes. No native plugin is needed, and the permission question is settled empirically
because Obsidian ships an audio-recorder core plugin that runs on iOS.**

| Fact                                                                                                                                           | Confidence | Source                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getUserMedia` exposed to WKWebView from **iOS 14.3**, _"only if the embedding application is able to natively capture either audio or video"_ | CONFIRMED  | [webkit.org/blog/11353](https://webkit.org/blog/11353/mediarecorder-api/)                                                                                              |
| `MediaRecorder` in iOS Safari from **14.5**                                                                                                    | CONFIRMED  | [caniuse](https://caniuse.com/mediarecorder)                                                                                                                           |
| Works on `capacitor://localhost` — **but breaks if the origin carries an explicit port** (`AbortError`)                                        | CONFIRMED  | [capacitor#6759](https://github.com/ionic-team/capacitor/issues/6759)                                                                                                  |
| Obsidian iOS origin is exactly `capacitor://localhost`                                                                                         | CONFIRMED  | FEASIBILITY §2.3                                                                                                                                                       |
| `audio/mp4` (AAC) supported throughout; **`audio/webm;codecs=opus` only from Safari 18.4** (2025-03-31); ALAC/PCM only from Safari 26.0        | CONFIRMED  | [Safari 18.4 notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [Safari 26.0 notes](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) |

**Use `audio/mp4` unconditionally and write `.m4a`.** Two reasons: `.m4a` is on
Obsidian Sync's default-on audio list while `.webm` is on the _video_ list
([obsidian.md/sync](https://obsidian.md/sync)); and webm audio recorded elsewhere is
already a known non-playing trap inside Obsidian iOS
([forum](https://forum.obsidian.md/t/ios-cant-play-the-webm-audio-that-i-record-on-my-mac-tat/38356)).

**`isTypeSupported()` lies on iOS.** It can report a type supported and then throw
`NotSupportedError` on `start()`, or produce a file the same browser cannot play back —
this is exactly why `@independo-gmbh/capacitor-voice-recorder` ships a
`requirePlaybackSupport` flag by default (CONFIRMED,
[README](https://github.com/independo-gmbh/capacitor-voice-recorder)). Wrap `start()`
in try/catch with a fallback chain.

### Four traps that only show up after you ship

1. **WebKit's default audio bitrate is 192 kbps.** `LargeAudioBitRate = 192000` is used
   whenever `audioBitsPerSecond` is omitted (CONFIRMED,
   [WebKit changeset 287613](https://trac.webkit.org/changeset/287613/webkit)).
   A default-settings 90-minute lecture is **129.6 MB**. **Always pass
   `audioBitsPerSecond` explicitly.**
2. **fMP4 from `MediaRecorder` carries no duration in `moov`** — `mvhd`/`tkhd`/`mdhd`
   are all zero, so _"the MP4 file needs to be downloaded and processed before the
   total duration is available, and seeking can work"_ (CONFIRMED,
   [addpipe](https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/)).
   **This directly threatens tap-a-stroke-to-seek**: `audio.duration` will be `NaN` or
   `Infinity` until buffered. Keep your own authoritative elapsed time. The
   compensation is that Safari emits _fragmented_ MP4, so timesliced chunks
   concatenate cleanly.
3. **Obsidian's mobile binary bridge is base64 and chokes around 20–50 MB.** Binary
   crosses the JS↔native boundary base64-encoded (~33% inflation); `adapter.writeBinary`
   on large buffers hangs or OOMs, and iOS jetsam kills the app during large in-memory
   buffering (CONFIRMED,
   [forum: chunked/streaming binary API](https://forum.obsidian.md/t/add-api-support-for-reading-and-writing-binary-by-chunks-or-streaming/77384),
   [Android writeBinary report](https://forum.obsidian.md/t/obsidian-mobile-android-adapter-writebinary-on-large-files-never-resolves-and-repeatedly-appends-data/108554)).
   **The fix exists and is new: `Vault.appendBinary(file, data, options)`, added in
   Obsidian 1.12.3 (2026-02-23)** (CONFIRMED,
   [API docs](https://docs.obsidian.md/Reference/TypeScript+API/Vault/appendBinary),
   [changelog](https://obsidian.md/changelog/2026-02-23-desktop-v1.12.3/)). Never hold
   90 minutes in memory; append each timeslice as it arrives, and declare
   `minAppVersion: 1.12.3`.
4. **iOS gives you one microphone, no input selection, no channel-count or sample-rate
   control.** Plan for mono.

### The two hard limits

**1. It does not survive sleep or backgrounding. This is a NO, not a caveat.**

WKWebView mic capture is muted by the system the moment the app backgrounds: _"the
`microphoneCaptureState` becomes muted shortly after `applicationDidEnterBackground`"_,
and setting it back to active does nothing while backgrounded (CONFIRMED,
[Apple forums 689182](https://developer.apple.com/forums/thread/689182),
[727009](https://developer.apple.com/forums/thread/727009)). **Safari itself is exempt;
WKWebView embedders are not.** The only fix is `UIBackgroundModes: audio` in the _host
app's_ Info.plist — **which a plugin cannot add**, and which Obsidian does not have.

Proof that Obsidian does not have it: the Scribe plugin's README states _"On iOS, the
screen must be ON while recording otherwise it won't capture your voice. This is a
limitation of Obsidian"_
([Scribe](https://github.com/mikealicea/obsidian-scribe)); and Obsidian's own core
recorder fails or stops on sleep, a thread a moderator explained with _"Apple has, on
iOS, background apps are put to sleep when they are not in the foreground"_ and which
was **reclassified from bug to feature request**
([forum #86231](https://forum.obsidian.md/t/mobile-support-audio-recording-during-sleep-background/86231), CONFIRMED).
Notability keeps recording because it is a native app that declares the background
mode. **There is no `audio` background mode a web page can request** — nothing in the
[W3C Audio Session explainer](https://github.com/w3c/audio-session/blob/main/explainer.md)
addresses background execution, and `navigator.audioSession` (Safari 16.4) governs
routing and focus, not backgrounded capture (CONFIRMED).

**You may not even be able to keep the screen awake.** Screen Wake Lock shipped in
Safari 16.4 but is reported unavailable in WKWebView (**LIKELY**, single automated
source — [caniwebview](https://caniwebview.com/features/web-feature-screen-wake-lock/)).
Test `navigator.wakeLock` on device; if it is absent the only fallback is telling the
user to set Auto-Lock → Never.

**2. There is a live, unfixed iOS 26 bug truncating recordings to ~30 seconds.**

_"if I record audio about 1 minute, it only recorded up to 30sec."_ iPad Pro and iPhone
15, Obsidian 1.9.14, **reproduced by a forum moderator** on 2025-10-17, ticket #116256,
**no fix reported** ([forum #106161](https://forum.obsidian.md/t/ios26-audio-recording-core-plugin-is-not-working-properly/106161), CONFIRMED).
There is precedent: iOS 18 produced 0-byte files
([forum](https://forum.obsidian.md/t/audio-recorder-plugin-bug-error-in-new-recordings/98072)).
The single-blob-at-`stop()` pattern is what appears to break, so `timeslice` +
incremental `appendBinary` is both the performance fix and the likely workaround —
**but test it before writing any other audio code.** A recorder that silently returns
30 seconds of a 90-minute lecture is worse than no recorder.

## 3.2 Where the file lives, and what it does to sync

Put the recording next to the notebook: `Lectures/Analysis 2026/audio/2026-09-21.m4a`.
`.m4a` is in Obsidian Sync's **default-on** audio list (`mp3, wav, m4a, 3gp, flac, ogg,
oga, opus`) ([obsidian.md/sync](https://obsidian.md/sync), CONFIRMED), so it syncs
without the user touching selective-sync. **`.webm` is on the _video_ list, not the
audio list** — another reason to choose `audio/mp4`.

**Size for a 90-minute lecture** (5,400 s; bytes = kbps × 1000 ÷ 8 × 5400):

| Encoding                                                             | Arithmetic        |         Size |
| -------------------------------------------------------------------- | ----------------- | -----------: |
| Opus 24 kbps                                                         | 24000 × 5400 / 8  |      16.2 MB |
| **AAC 32 kbps mono** ← recommended                                   | 32000 × 5400 / 8  |  **21.6 MB** |
| AAC 64 kbps mono                                                     | 64000 × 5400 / 8  |      43.2 MB |
| AAC 96 kbps                                                          | 96000 × 5400 / 8  |      64.8 MB |
| AAC 128 kbps                                                         | 128000 × 5400 / 8 |      86.4 MB |
| **AAC 192 kbps — WebKit's DEFAULT if you omit `audioBitsPerSecond`** | 192000 × 5400 / 8 | **129.6 MB** |
| WAV PCM 16-bit / 44.1 kHz mono                                       | 44100 × 2 × 5400  | **476.3 MB** |

Add ~1–2% container overhead.

**And now the numbers that decide the design:**

> **Obsidian Sync Standard's 5 MB per-file cap allows 10.4 minutes of AAC 64 kbps
> mono** (5 MB ÷ 8000 B/s ÷ 60). Fitting a whole 90-minute lecture under 5 MB would
> need ~7.4 kbps — below what `MediaRecorder` will produce. **Sync Standard cannot
> hold a lecture recording as one file.**
>
> And **oversize files are skipped silently**. A user's just-over-5 MB `.m4a` simply
> never appeared on the other device; a moderator said this comes up _"a few times a
> month"_ ([forum](https://forum.obsidian.md/t/obsidian-sync-is-completely-ignoring-one-audio-file/95095)).
> Desktop 1.12 now _"logs when files were skipped for being too large"_
> ([changelog](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/)) — **but the
> log is wiped on restart.**

Three options, in order:

1. **Chunk the recording** into segments (`…/audio/2026-09-21-003.m4a`) sized under the
   cap, with offsets recorded in `_notebook.md`. `start(timeslice)` +
   `Vault.appendBinary` makes this natural, and it also limits crash damage and
   sidesteps both the 20–50 MB bridge ceiling and the iOS 26 truncation bug.
2. **Sync Plus** (200 MB/file, 10 GB) and keep whole files. At 32 kbps mono a lecture
   is 21.6 MB, so 10 GB is roughly **460 lectures**.
3. **Don't sync audio at all** — keep recordings in a folder excluded from Sync.
   Cheapest, and arguably right: you rarely need lecture audio on a second device.

Two quota warnings. Audio syncs **by default** (it is one of the four default-on
attachment types), so there is no accidental protection against burning the quota. And
**attachment version history is retained 2 weeks on both tiers** and counts against
storage — rewriting an audio file burns quota invisibly
([version history](https://obsidianmd-obsidian-help.mintlify.app/sync/version-history)).
At 43 MB/lecture on 64 kbps, four lectures a week fills Sync Standard's 1 GB in about
six weeks. **32 kbps mono is the right default.**

## 3.3 What ink↔audio sync costs in the data model

This is the part that is cheap now and expensive later.

**Today's format has no time axis at all.** From `src/model/document.ts`:

```ts
/** Flat tuples `[x, y, p, …]`; length is always a multiple of 3. */
pts: number[];
```

and `POINT_STRIDE = 3`. Serialisation quantises to `x*100, y*100, p*255`
(`src/model/serialize.ts:54`). There is no `t` anywhere in the document, the
serialiser, the renderer or the 200+ tests.

**Prior art says per-point time is the industry norm, and that we do not need it.**
W3C **InkML** (Recommendation, 2011) has a per-point time channel `T`, with a `'`
prefix for incremental time and `<intermittentChannels>` to make it optional
([w3.org/TR/InkML](https://www.w3.org/TR/InkML/)) — a good conceptual model, a dead
serialisation. Apple's **`PKStrokePoint` carries `timeOffset`** next to location,
force, azimuth and altitude, and `PKStroke.enumerateInterpolatedPoints(in:strideByTime:)`
replays by time
([developer.apple.com](https://developer.apple.com/documentation/pencilkit/pkstrokepoint-swift.struct)).
**No Obsidian plugin joins ink and audio** — ink plugins exist, audio plugins exist
(e.g. [Audio Timestamp Player](https://community.obsidian.md/plugins/audio-timestamp-player),
which already seeks embedded audio from `MM:SS` links and works on mobile), and nothing
bridges them. That is a real gap, and a good signal.

**What "tap a word, hear what was said" actually needs:**

- **Per-stroke start time is enough.** A stroke is a fraction of a second; a word is
  3–6 strokes over ~1 second. Audio seek precision that matters for comprehension is
  ±2 s (you want the sentence, not the syllable). Per-_point_ timestamps buy nothing
  for this feature and would roughly triple stroke storage. Keep them **only** if
  Samsung-style _animated_ ink replay is ever wanted.
- Note that since Safari 18.2 each coalesced `PointerEvent` carries its own
  `timeStamp`, so per-point timing is _available_ at Apple Pencil's full sample rate
  if it is ever needed ([WebKit 18.2 notes](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/),
  CONFIRMED; FEASIBILITY §1.1 already relies on coalesced events).
- So: `Stroke { …, t0?: number }` — milliseconds since the notebook's session epoch.
  One extra integer per stroke, ~4–6 bytes of JSON before deflate. On an 800-stroke
  page that is ~5 KiB raw, under 2 KiB stored. **Negligible.**
- Plus, per page or per notebook, a list of **recording sessions**:
  `{ id, file, startedAt, durationMs, strokeEpoch }` so a stroke's `t0` maps to an
  offset into a specific audio file — this is what makes chunked audio work, and it is
  what makes Notability's _media-agnostic_ trick possible (import an existing mp3 and
  write against it during playback).
- Strokes written with no recording running simply have no `t0`, or a `t0` outside any
  session's range. Tapping them does nothing. That matches Notability's behaviour.

**Cost of the format change, stated plainly:**

|                                    |                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model                              | `POINT_STRIDE` stays 3; add an optional scalar `t0` to `Stroke` and a `sessions[]` array to the document. **No change to the point encoding** — this is the key mercy. |
| Serialiser                         | Schema v3. `quantizePts`/`dequantizePts` untouched. A v2 document loads with `t0` absent. ~30 lines in `serialize.ts` + fixtures.                                      |
| Renderer, hit-test, undo, compress | **Unaffected.** `t0` is metadata, not geometry.                                                                                                                        |
| Tests                              | New fixtures; existing round-trip tests keep passing because `t0` is optional.                                                                                         |
| Capture                            | `pointerdown` already has `event.timeStamp`; record it. ~3 lines in `pointer-controller.ts`.                                                                           |
| **Verdict on cost**                | **S — genuinely small, if done before the format is widely used.**                                                                                                     |

**Two implementation rules that will otherwise cost a day each:**

- **Clock discipline.** `PointerEvent.timeStamp` is a `DOMHighResTimeStamp` on the
  _document's_ time origin, not the recorder's. Capture `performance.now()` at the
  `MediaRecorder.start()` call and subtract. Never use `Date.now()` — wall clock jumps.
  And do not trust `audio.duration` on fragmented MP4 (§3.1 trap 2); track elapsed time
  yourself and make that the playback authority.
- **Anchor playback _earlier_ than the stroke.** People write _after_ they hear. Seeking
  to exactly `t0` lands the user mid-sentence, after the thing they wrote about.
  Notability's answer is a prominent 10-second skip-back
  ([support](https://support.gingerlabs.com/hc/en-us/articles/206060617-Recording-and-Playing-Audio)).
  **Default to `t0 − 5 s`, expose it as a 0–15 s setting, and put obvious ±10 s buttons
  in the player.** The specific 5 s figure is **UNVERIFIED** — treat it as a tunable,
  not a fact, and calibrate it against one real lecture.

**So the recommendation splits in two, and this is the important part of §3:**

> **Add `t0` to the stroke format NOW, as part of the next format change. Build the
> audio recorder later, or never.**

Writing a timestamp costs almost nothing today and is a migration later.
FEASIBILITY §4.2 independently reached the same conclusion for a different reason:
_"store strokes as strokes with timestamps… keeping stroke order, pressure and timing
keeps MyScript and any future on-device stroke recogniser available later for free."_
Two separate arguments converging on one cheap change is as strong a signal as this
project gets.

## 3.4 Transcription of the audio

### The Web Speech API is a hard NO, and it lies about being available

**`webkitSpeechRecognition` is exposed on `window` in WKWebView and does nothing.**
WebKit bug 239816, filed by the Chrome-on-iOS team: _"The Web Speech API is available
in Safari on iOS, but is not enabled for other WKWebView embedders."_ No permission
prompt ever appears; adding `NSSpeechRecognitionUsageDescription` yields
`service-not-allowed`. Apple closed it **WORKSFORME** on the grounds that an error is
now returned ([bugs.webkit.org/239816](https://bugs.webkit.org/show_bug.cgi?id=239816),
CONFIRMED). caniuse notes it is unavailable even in SafariViewController and
home-screen PWAs ([caniuse](https://caniuse.com/speech-recognition)).

> ⚠️ **`'webkitSpeechRecognition' in window` returns `true` and then fails silently.
> Do not feature-detect it. Do not ship it as a fallback.**

Even in Safari proper it would be wrong: cloud-backed by default, `continuous` widely
reported broken on iOS, and the underlying `SFSpeechRecognizer` is a ~1-minute
command-oriented engine with daily quotas. Chrome's on-device `processLocally` /
`available()` / `install()` are **not in any Safari**, and
[WebKit standards-positions#443](https://github.com/WebKit/standards-positions/issues/443)
has had no position since Jan 2025. Apple's genuinely on-device long-form
`SpeechAnalyzer`/`SpeechTranscriber` (iOS 26) has **no JS binding at all**.

**WASM Whisper is also dead in this webview**: transformers.js Whisper fails on iOS
Safari with `Cache API operation failed: Quota exceeded` before the model loads
([transformers.js#1298](https://github.com/huggingface/transformers.js/issues/1298)),
which is the same memory wall FEASIBILITY §4.1 already documents for TrOCR.

### The practical answer: cloud, BYO key, and it is cheap

Same shape as the ink transcription the plugin already ships — send the file to a
cloud API with the user's own key via Obsidian's `requestUrl` (no CORS; FEASIBILITY
§4.2). Costs for a 90-minute lecture:

| Model                             | Price      | 90-min lecture |
| --------------------------------- | ---------- | -------------: |
| `gpt-4o-mini-transcribe`          | $0.003/min |      **$0.27** |
| `whisper-1` / `gpt-4o-transcribe` | $0.006/min |          $0.54 |
| AssemblyAI Universal-2            | $0.15/hr   |         ~$0.23 |

([OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[AssemblyAI](https://www.assemblyai.com/pricing), CONFIRMED.) OpenAI's upload cap is
**25 MB** ([docs](https://developers.openai.com/api/docs/guides/speech-to-text)) — so a
**32 kbps mono lecture at 21.6 MB fits in one upload**, which is another reason to pick
that bitrate. `gpt-4o-transcribe` additionally caps at 1500 s (25 min), so that model
needs chunking with ~10–15 s overlap; `whisper-1` has no duration cap.

**Network gotchas**: route uploads through `requestUrl()`, never `fetch()` —
`capacitor://localhost` is CORS-enforced, and iOS App Transport Security blocks plain
HTTP to a LAN host, so a `http://192.168.x.x` local Whisper server that works on
desktop **will fail on the iPad**. And `requestUrl` is itself inside the 20–50 MB
base64 bridge danger zone (§3.1 trap 3) — one more argument for ~20 MB files.

### Reuse, not rebuild

The existing `RecognitionProvider` seam in `src/recognition/provider.ts` is the wrong
_shape_ for audio (it takes `Stroke[]`), but the settings UI, BYO-key storage,
OpenRouter auth and the explicit-consent path all transfer directly. And
`RecognitionSegment` already carries `bounds` and `confidence` — the ingredients for
highlight-on-search later.

## 3.5 Verdict

**Feasible: YES-WITH-CAVEAT. Worth it for a lecture-taking student: not yet.**

Recording works while the app is on screen, produces `.m4a` that syncs by default, and
`t0` timestamps make Notability-grade replay possible for almost nothing. But it
**stops when the iPad sleeps** — unfixable from a webview, because the background-audio
mode lives in the host app's Info.plist and Obsidian does not have it — there is an
**unresolved iOS 26 bug truncating recordings to ~30 seconds**, and on Sync Standard a
lecture **cannot be a single file** under the 5 MB cap. A lecture recorder that
silently loses the lecture is worse than no recorder, and Joost already has a phone
with a voice-memo app that keeps recording in his pocket.

**Do the 10-minute part now (`t0` in the format). Defer the rest until Spike 0 and a
30-second-bug test on the actual iPad say otherwise.**

### If and when it is built, the recipe is settled

1. `getUserMedia({audio:true})` from a **user tap**, never on plugin load. No native
   plugin. No port in the origin.
2. `new MediaRecorder(stream, { mimeType: 'audio/mp4', audioBitsPerSecond: 32000 })`,
   `start(10000)`. **Never omit the bitrate** — the default is 192 kbps.
3. **`vault.appendBinary()` each chunk straight to disk**; require Obsidian ≥ 1.12.3.
   Journal completed parts so a crash or a jetsam kill is recoverable.
4. Timebase = `performance.now()` at `start()`. Store `t0` per stroke. Playback anchors
   at `t0 − 5 s`, user-adjustable.
5. **Foreground, screen-on only, and say so in the UI.** Test `navigator.wakeLock`; if
   absent, tell the user to disable Auto-Lock.
6. Transcription: upload via `requestUrl()` to `gpt-4o-mini-transcribe` (~$0.27 per
   lecture). Never touch `webkitSpeechRecognition`.
7. Recommend Sync Plus, or exclude the audio folder from Sync.

---

# Task 4 — The ranked roadmap

**Value** is scored for one person: a student taking lecture notes daily who is trying
to stop paying for GoodNotes. ★★★ = would change whether he opens GoodNotes tomorrow.
**Effort**: S ≤ 1 day · M ≈ 2–4 days · L ≈ 1–2 weeks · XL = more.
**Feasible** answers _in an Obsidian iPad webview_.

### Ink and input

| Feature                                                  | Value | Effort | Feasible?                                                                             | Status                      | Notes                                                                                                         |
| -------------------------------------------------------- | :---: | :----: | ------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Pressure-sensitive ink (perfect-freehand)                |  ★★★  |   —    | YES (CONFIRMED)                                                                       | **done**                    | inherited                                                                                                     |
| Palm rejection                                           |  ★★★  |   —    | YES (CONFIRMED)                                                                       | **done**                    | inherited                                                                                                     |
| Coalesced-event capture                                  |  ★★★  |   —    | YES — Safari 18.2+ (CONFIRMED, FEAS §1.1)                                             | **done**                    | inherited                                                                                                     |
| Undo / redo                                              |  ★★★  |   —    | YES                                                                                   | **done**                    | invertible commands                                                                                           |
| Pen · highlighter · eraser                               |  ★★★  |   —    | YES                                                                                   | **done**                    |                                                                                                               |
| Single-stroke select                                     |  ★★   |   —    | YES                                                                                   | **done**                    | covers the lecture case                                                                                       |
| **Spike 0 — Scribble measurement**                       |  ★★★  |   S    | —                                                                                     | **blocked on Joost's iPad** | TASKS #0. Everything about ink feel is provisional until this runs                                            |
| **On-device debug HUD**                                  |  ★★   |   S    | YES                                                                                   | proposed                    | FEAS risk #6: no Safari Web Inspector from Windows. This is how Spike 0 gets measured                         |
| Colour palette + custom colours + favourites             |  ★★★  |   S    | YES                                                                                   | proposed                    | GoodNotes parity; trivial; high daily friction if missing                                                     |
| Three width presets per tool                             |  ★★   |   S    | YES                                                                                   | proposed                    |                                                                                                               |
| Stroke eraser vs. pixel eraser; _erase highlighter only_ |  ★★   |   M    | YES                                                                                   | proposed                    | pixel eraser is the hard half. Copy Apple's UX: **one eraser tool, tap again to toggle mode** — not two tools |
| Scratch-to-erase gesture                                 |  ★★   |   M    | YES (LIKELY)                                                                          | proposed                    | GoodNotes 6 and MyScript both ship it; well-liked                                                             |
| Ruler / straight-edge                                    |   ★   |   M    | YES                                                                                   | proposed                    | shape-snap covers most of the need                                                                            |
| Zoom/scroll writing window (GoodNotes' "zoom window")    |  ★★   |   L    | YES (UNVERIFIED)                                                                      | proposed                    | genuinely useful for small handwriting; fiddly                                                                |
| Apple Pencil Pro squeeze / barrel roll / haptics         |   —   |   —    | **NO** — `UIPencilInteraction` and `rollAngle` are native-only (CONFIRMED, FEAS §1.5) | **never**                   | never gate a feature behind it                                                                                |
| Apple Pencil double-tap to switch tool                   |   —   |   —    | **NO** — same API (CONFIRMED)                                                         | **never**                   |                                                                                                               |
| Scribble coexistence                                     |  ★★★  |   ?    | UNKNOWN until Spike 0                                                                 | proposed                    | category's biggest unsolved problem; §2.4 halves the exposure for free                                        |

### Pages, paper, notebook structure

| Feature                                               | Value | Effort | Feasible?                                                                                      | Status          | Notes                                                                  |
| ----------------------------------------------------- | :---: | :----: | ---------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| Discrete fixed-geometry pages                         |  ★★★  |   —    | YES                                                                                            | **in progress** | the differentiator; TASKS #11                                          |
| Blank / lined / grid backdrops                        |  ★★★  |   —    | YES                                                                                            | **in progress** | TASKS #12                                                              |
| PDF page as backdrop                                  |  ★★★  |   —    | YES — `loadPdfJs()` is public (CONFIRMED, FEAS §2.2)                                           | **in progress** | TASKS #13                                                              |
| Hold-to-snap shapes (line, rect, circle)              |  ★★   |   L    | YES-WITH-CAVEAT — tuning, not geometry, is the cost (FEAS §5.5)                                | **in progress** | TASKS #9. Ship line+rect and stop                                      |
| Add / insert page                                     |  ★★★  |   S    | YES                                                                                            | **in progress** | `page-commands.ts`                                                     |
| **Notebook = folder of page files (§2.3)**            |  ★★★  | **L**  | YES (CONFIRMED — `createFolder`, `createBinary` public)                                        | **proposed**    | the format change everything else waits on                             |
| **Page thumbnail sidebar + reorder/duplicate/delete** |  ★★★  |   M    | YES                                                                                            | proposed        | the single most "GoodNotes" missing UI                                 |
| **Page thumbnail generator → PNG in vault**           |  ★★   |   S    | YES (CONFIRMED)                                                                                | proposed        | `canvas.toBlob` → `Vault.createBinary`                                 |
| **Notebook cover (generated or chosen)**              |  ★★   |   S    | YES                                                                                            | proposed        | frontmatter `cover:`                                                   |
| **Notebook shelf**                                    |  ★★   | **XS** | YES — **Obsidian Bases Cards view, free** ([docs](https://obsidian.md/help/bases/views/cards)) | proposed        | ship a `.base` file, not a custom view                                 |
| Landscape / 16:9 pages                                |  ★★   |   S    | YES                                                                                            | proposed        | `PageGeometry` already per-page; UI only                               |
| Mixed paper within one notebook                       |  ★★   |   S    | YES                                                                                            | proposed        | model already supports it (Noteful's idea)                             |
| Outline / quick-jump                                  |  ★★   |   S    | YES                                                                                            | proposed        | near-free: per-page files + a heading → Obsidian's Outline core plugin |
| Bookmarks / favourites                                |   ★   |   XS   | YES                                                                                            | proposed        | Obsidian's Bookmarks core plugin already does this                     |
| Cornell / music / isometric templates                 |   ★   |   S    | YES                                                                                            | proposed        | data, not code, once backdrops exist                                   |
| Custom paper from an image or PDF page                |  ★★   |   S    | YES                                                                                            | proposed        | PDF backdrop machinery already does the hard part                      |
| Page colour (white / cream / dark)                    |  ★★   |   S    | YES                                                                                            | proposed        | design brief asks for per-notebook dark page                           |
| Layers (Noteful-style)                                |   ★   |   L    | YES                                                                                            | **no**          | PDF backdrop already solves the "don't touch the original" case        |
| Infinite canvas / whiteboard mode                     |   —   |   XL   | YES                                                                                            | **never**       | every competitor is this; pagination is the product (PLAN.md)          |

### Selection, editing, media

| Feature                                                   | Value | Effort | Feasible?                                                                                | Status          | Notes                                                                                                               |
| --------------------------------------------------------- | :---: | :----: | ---------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| Lasso polygon select + move/delete                        |  ★★   |   L    | YES                                                                                      | deferred (PLAN) | polygon hit-test + spatial index + transform + multi-stroke undo                                                    |
| Resize / rotate a selection                               |   ★   |   M    | YES                                                                                      | proposed        | after lasso                                                                                                         |
| **Cut/copy/paste ink between pages and notebooks**        |  ★★   |   M    | YES                                                                                      | proposed        | with per-page files this is a real cross-file operation                                                             |
| Circle-to-lasso gesture                                   |   ★   |   S    | YES                                                                                      | proposed        | after lasso                                                                                                         |
| Insert image from vault                                   |   ★   |   S    | YES                                                                                      | deferred (PLAN) | model + commands already support it; UI only                                                                        |
| Camera / photo import                                     |   ★   |   M    | YES-WITH-CAVEAT (UNVERIFIED)                                                             | proposed        | `<input type=file accept=image/* capture>` should work                                                              |
| Text boxes on a page                                      |   ★   |   M    | **YES-WITH-CAVEAT — this reintroduces a `contenteditable` into the drawing pane** (§2.4) | **avoid**       | if built, it must be a modal, never in-pane                                                                         |
| Sticker / element library                                 |   ★   |   M    | YES                                                                                      | proposed        | low value in a lecture                                                                                              |
| Double-tap = word, triple-tap = sentence on **ink**       |  ★★   |   M    | YES                                                                                      | proposed        | Apple's Smart Selection; needs stroke clustering, which per-page transcription bounds partly gives you              |
| _Straighten_ / _Insert space above_ on a selection        |   ★   |   M    | YES                                                                                      | proposed        | Apple ships both as plain selection actions, no ML needed for the space one                                         |
| Handwritten `#tag` → tap → convert to a real tag          |  ★★   |   M    | YES                                                                                      | proposed        | **the best idea in Apple Notes.** Writes straight into the page's markdown body, so Obsidian's tag pane picks it up |
| First line of handwriting becomes the page/notebook title |  ★★   |   S    | YES, once transcription runs                                                             | proposed        | zero-friction naming; Apple does exactly this                                                                       |

### Transcript, search, PDF, export — where the fork actually wins

| Feature                                                     | Value |        Effort         | Feasible?                                                                                                                                                                                                                                                      | Status                                  | Notes                                                                           |
| ----------------------------------------------------------- | :---: | :-------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Manual transcription text layer                             |  ★★   |           —           | YES                                                                                                                                                                                                                                                            | **done**                                |                                                                                 |
| Cloud-AI transcription, BYO key                             |  ★★★  |           —           | YES — `requestUrl` bypasses CORS (CONFIRMED)                                                                                                                                                                                                                   | **done**                                | inherited, 4 providers                                                          |
| On-device TrOCR                                             |   ★   |           —           | **NO on iPad** — 64–340 MB models exceed the webview ceiling (CONFIRMED, FEAS §4.1)                                                                                                                                                                            | done, desktop only (dropped 2026-09-25) | leave as is                                                                     |
| **Per-page transcription → Obsidian search finds the page** |  ★★★  | **S once §2.3 lands** | YES                                                                                                                                                                                                                                                            | **proposed**                            | _the thing GoodNotes structurally cannot do._ Free consequence of the layout    |
| Search-hit highlight on the page                            |  ★★   |           M           | YES-WITH-CAVEAT                                                                                                                                                                                                                                                | proposed                                | `RecognitionSegment.bounds` already exists; needs a provider that returns boxes |
| Live conversion preview while writing (MyScript-style)      |  ★★   |          XL           | **NO practically** — web iink is cloud-only, round-trip per stroke, and pricing above 2k req/mo is "contact us" ([MyScript](https://developer-support.myscript.com/support/discussions/topics/16000032257), [pricing](https://developer.myscript.com/pricing)) | **never**                               |                                                                                 |
| Math conversion / LaTeX                                     |  ★★   |           L           | YES-WITH-CAVEAT — via the same vision-LLM path, not a math engine                                                                                                                                                                                              | proposed                                | a VLM returning LaTeX is plausible and cheap to try                             |
| Math _evaluation_ in your own handwriting (Math Notes)      |   ★   |          XL           | **NO** — needs handwriting synthesis; native ML                                                                                                                                                                                                                | **never**                               |                                                                                 |
| Smart Script handwriting beautification                     |   ★   |          XL           | **NO** — on-device generative model                                                                                                                                                                                                                            | **never**                               |                                                                                 |
| Annotate a vault PDF, source untouched                      |  ★★★  |           —           | YES                                                                                                                                                                                                                                                            | **in progress**                         | the genuine market gap (FEAS verdict)                                           |
| **Export notebook / page to PDF**                           |  ★★★  |           M           | YES — but a plugin must do it itself; **Obsidian mobile has no PDF export** ([forum](https://forum.obsidian.md/t/mobile-pdf-export/15753))                                                                                                                     | proposed                                | pagination makes it 1:1. jsPDF ~150 KB, or draw into pdf-lib                    |
| Export flattened annotated PDF (ink burned in)              |  ★★   |           M           | YES                                                                                                                                                                                                                                                            | proposed                                | same machinery                                                                  |
| Export page as PNG / SVG                                    |   ★   |           S           | YES                                                                                                                                                                                                                                                            | proposed                                | PNG is free once thumbnails exist                                               |
| Presentation mode / external display                        |   ★   |           L           | **NO in practice** — no plugin API for a second display                                                                                                                                                                                                        | **never**                               |                                                                                 |
| Real-time collaboration                                     |   —   |          XL           | **NO**                                                                                                                                                                                                                                                         | **never**                               |                                                                                 |
| Share-by-link                                               |   —   |           —           | **NO** — no hosting, and against the local-first premise                                                                                                                                                                                                       | **never**                               |                                                                                 |

### Audio

| Feature                                          | Value | Effort | Feasible?                                                                                                                                                                                                               | Status                                    | Notes                                                                                          |
| ------------------------------------------------ | :---: | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Per-stroke `t0` timestamp in the format**      |  ★★★  | **S**  | YES                                                                                                                                                                                                                     | **proposed — do this next format change** | §3.3. Also unlocks stroke-based recognisers later (FEAS §4.2)                                  |
| Record audio to the vault (`.m4a`, 32 kbps mono) |  ★★   |   M    | YES-WITH-CAVEAT — **stops on sleep/background** (CONFIRMED); unresolved iOS 26 ~30 s truncation bug (CONFIRMED)                                                                                                         | proposed                                  | §3.1. `audioBitsPerSecond` is **not** optional — default is 192 kbps                           |
| Chunked capture via `Vault.appendBinary`         |  ★★   |   M    | YES — **Obsidian ≥ 1.12.3 only** (CONFIRMED)                                                                                                                                                                            | proposed                                  | fixes three problems at once: 5 MB Sync cap, 20–50 MB mobile bridge ceiling, iOS 26 truncation |
| Tap-a-stroke → seek audio (Notability)           |  ★★   |   M    | YES-WITH-CAVEAT once `t0` exists — fMP4 has no duration in `moov`, so track elapsed time yourself (CONFIRMED)                                                                                                           | proposed                                  | use a non-pen tool as the tap target, as Notability does; anchor at `t0 − 5 s`                 |
| Replay-the-page during playback (Samsung)        |  ★★   |   S    | YES, once `t0` exists                                                                                                                                                                                                   | proposed                                  | strictly better than tap-to-seek and nearly free on top of it                                  |
| Background / screen-locked recording             |  ★★★  |   —    | **NO** — `UIBackgroundModes: audio` lives in the host app's Info.plist and Obsidian lacks it; WKWebView mic mutes on `applicationDidEnterBackground` ([Apple forums](https://developer.apple.com/forums/thread/689182)) | **never**                                 | the reason §3.5 says "not yet"                                                                 |
| Keep the screen awake while recording            |  ★★   |   S    | **NO (LIKELY)** — Screen Wake Lock reported unavailable in WKWebView                                                                                                                                                    | proposed as a _notice_                    | test `navigator.wakeLock`; else instruct Auto-Lock → Never                                     |
| Audio transcription (cloud, BYO key)             |   ★   |   M    | YES — ~$0.27/lecture via `gpt-4o-mini-transcribe`, uploaded with `requestUrl`                                                                                                                                           | proposed                                  | reuse the existing BYO-key settings machinery                                                  |
| On-device speech-to-text in the webview          |   —   |   —    | **NO** — `webkitSpeechRecognition` is exposed but disabled for WKWebView embedders ([WebKit 239816](https://bugs.webkit.org/show_bug.cgi?id=239816)); WASM Whisper hits the iOS cache/memory wall                       | **never**                                 | and it **feature-detects as `true`** — see §6                                                  |
| Speaker diarisation                              |   —   |   L    | YES via a cloud API                                                                                                                                                                                                     | **no**                                    | out of proportion                                                                              |

### Organisation, sync, hygiene

| Feature                                                              | Value | Effort | Feasible?       | Status                 | Notes                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | :---: | :----: | --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folders, tags, favourites, recents, search                           |  ★★★  | **0**  | YES             | **free from Obsidian** | do not rebuild any of it                                                                                                                                                                                      |
| Inline `#tags` inside a notebook page                                |  ★★   |   XS   | YES             | proposed               | Noteful's idea, and it is already how Obsidian works — the page's markdown body                                                                                                                               |
| **Survives sync unchanged across devices**                           |  ★★★  |   M    | YES-WITH-CAVEAT | **proposed / at risk** | PLAN.md's open risk; §2.3 shrinks the blast radius from a notebook to a page                                                                                                                                  |
| Never autosave while the pen is down; 2000 ms quiet period on mobile |  ★★★  |   S    | YES             | proposed               | Ink's contract, FEAS §2.5. Not optional — it is the storage-quota fix                                                                                                                                         |
| Viewport culling + spatial index + outline cache                     |  ★★★  |   M    | YES             | partly done            | FEAS risk #4: Ink died at 200–300 strokes with SVG; a lecture is thousands                                                                                                                                    |
| Lazy view render / defer to `onLayoutReady`                          |  ★★   |   S    | YES             | proposed               | FEAS risk #7: 18 s of a 30 s mobile cold start was plugin views                                                                                                                                               |
| Bundle under 1 MB                                                    |  ★★   |   —    | YES             | on track               | 687 KB at the fork point                                                                                                                                                                                      |
| Marketplace / stickers / planner economy                             |   —   |   XL   | —               | **never**              |                                                                                                                                                                                                               |
| Flashcards + spaced repetition (Study Sets)                          |   ★   |   L    | YES             | **never**              | Obsidian has ~26 spaced-repetition plugins ([Hub](https://publish.obsidian.md/hub/02+-+Community+Expansions/02.01+Plugins+by+Category/Spaced+Repetition+Plugins)); per-page transcription feeds them for free |
| Telemetry / accounts                                                 |   —   |   —    | —               | **never**              | PLAN.md                                                                                                                                                                                                       |

---

## "If you can only build five more things, build these"

Ordered. The reasoning is the same throughout: _what makes Joost stop reaching for the
GoodNotes icon._

### 1. Spike 0 — Scribble, on the actual iPad, with the debug HUD

Not a feature, and it is still first. `TASKS.md` has had this blocking since the fork
and it is the only item where being wrong invalidates the others. Upstream _measured_
~20% of fast pen-downs never arriving with Scribble on. If that reproduces in the
dedicated full-screen view, the product is "turn off a system feature first" — and
that needs to be known before another week goes into pages, thumbnails and covers.
Joost's correction (§2.4) already removes the embed path, which is the configuration
Ink blames, so the odds are better than they were. **Half a day, and it needs an
iPad.** Build the on-screen HUD as part of it; you cannot remote-debug an iPad from
this Windows laptop, and the HUD is how upstream got the 20% number in the first place.

### 2. Finish the page/backdrop/PDF work already in flight (TASKS #9–14)

Discrete pages with blank/lined/grid backdrops, PDF pages as backdrops, the floating
toolbar. It is the declared v1, it is half-built, and **it is the part Joost said he
would most miss** — annotating lecture slides. Nothing below is worth starting while
this is unfinished, and every item below assumes it exists. The one scope cut to hold:
**ship hold-to-snap as line-and-rectangle only**. The best MIT reference
implementation in existence (js-draw, used by Joplin) ships exactly that, in 234
lines, and skips circles (FEAS §5.5). Do not spend a week beating it.

### 3. The notebook layout: folder per notebook, one file per page (§2.3)

This is the feature Joost actually asked for — _"files you create that become
GoodNotes-like notebooks"_ — and it is a format change, so it must happen **before**
there are notebooks worth migrating and **before** the audio timestamp change, not
after. Do them in one v3 migration.

It is ranked third rather than first only because it is pointless if Spike 0 kills the
ink. It is ranked above thumbnails and covers because everything visible depends on it:
per-page files are what make thumbnails cheap, reorder cheap, autosave cheap, and
search useful. **Ship the `t0` stroke timestamp in the same migration** (§3.3) — it is
one optional integer per stroke, it is free now and a second migration later, and two
independent lines of reasoning (audio replay, and keeping stroke-based recognisers
available) both ask for it.

### 4. The page manager: thumbnail sidebar, reorder, duplicate, delete — plus a generated cover

This is what makes it _feel_ like GoodNotes rather than like a plugin. GoodNotes' whole
navigation model is the thumbnail sidebar, and it is the thing you touch fifty times a
lecture. It is cheap once §3 lands, because each page inflates independently and the
thumbnail is a PNG written with `Vault.createBinary` (CONFIRMED public API).

**And explicitly: do not build the shelf.** Obsidian's **Bases Cards view** is a cover-image
gallery grid, themed, sortable, working on iPad, for the cost of shipping one `.base`
file and putting `cover:` in the notebook's frontmatter
([docs](https://obsidian.md/help/bases/views/cards)). Build the thumbnail _generator_;
let Obsidian be the shelf. Same for folders, tags, favourites and recents — Obsidian
already has all four and they are better than GoodNotes'.

### 5. Per-page transcription wired into Obsidian search, and PDF export

Two things, deliberately paired, because together they close the loop that justifies
the project.

**Per-page transcription** is nearly free once §3 lands: the transcription already
works (inherited, four providers), and with one file per page its output is that
page's markdown body. Searching the vault for "eigenvalue" then returns _page 34 of
Analysis 2026_, and `[[Analysis 2026/p-a3f1]]` links a typed summary to the handwritten
page it came from. **GoodNotes cannot do this at any price** — its search is walled
inside its own library. This is the only item on the list where the fork is not
catching up but actually ahead, and it is the honest answer to _"why not just keep
paying $11.99."_

**PDF export** is the escape hatch that makes the whole thing safe to commit to. Right
now, ink written in GoodObsidian can only be read by GoodObsidian. Fixed-geometry pages
make 1:1 export trivial (PLAN.md's own point), Obsidian mobile has no PDF export of its
own ([forum](https://forum.obsidian.md/t/mobile-pdf-export/15753)), and being able to
hand a lecturer a PDF is what turns "a project I'm building" into "the app I take notes
in".

**What is deliberately not in the five:** audio recording (§3.5 — do the `t0` part in
item 3, defer the rest), lasso (upstream's single-stroke select covers lectures), image
insertion (lowest value in a lecture), and every AI feature beyond the transcription
already inherited.

---

## Features to deliberately never build

Saying no clearly is worth as much as the roadmap.

**Impossible in the webview — a false green light here is the expensive failure.**

1. **Apple Pencil Pro squeeze, barrel roll and haptics.** `UIPencilInteraction` and
   `UITouch.rollAngle` are native UIKit; no web API exposes them (CONFIRMED,
   FEAS §1.5). Same for Pencil double-tap. **Never gate a tool switch behind a
   Pencil gesture** — it will silently do nothing.
2. **Background / screen-locked audio recording.** WKWebView's microphone is muted by
   the system on `applicationDidEnterBackground`, and the only fix —
   `UIBackgroundModes: audio` — lives in the _host app's_ Info.plist, which a plugin
   cannot touch and Obsidian does not have
   ([Apple forums 689182](https://developer.apple.com/forums/thread/689182),
   [Obsidian forum](https://forum.obsidian.md/t/mobile-support-audio-recording-during-sleep-background/86231)).
   Notability can do it because it is native. If audio ships, say this in the UI.
3. **On-device speech-to-text from the webview, including as a "fallback".**
   `webkitSpeechRecognition` **is exposed on `window` in WKWebView and does nothing** —
   Apple explicitly does not enable the Web Speech API for non-Safari embedders and
   closed the bug WORKSFORME ([WebKit 239816](https://bugs.webkit.org/show_bug.cgi?id=239816)).
   Because `'webkitSpeechRecognition' in window` returns `true`, **a naive feature
   detection will ship a silently broken path**. WASM Whisper hits the same iOS memory
   wall as TrOCR (FEASIBILITY §4.1). Cloud, with the user's key, is the only route.
4. **Smart Script-style handwriting beautification, and Math Notes-style answers in
   your own hand.** Both require on-device generative models of the user's
   handwriting. There is no web path, and the raster-OCR paths that do exist are
   already ruled out by memory (FEAS §4.1).
5. **Live conversion preview while writing (MyScript/Nebo).** The only stroke
   recogniser reachable from a webview is MyScript's cloud, one WebSocket round-trip
   per stroke; and the self-serve tier now stops at 2,000 requests/month with
   "contact us" above it ([pricing](https://developer.myscript.com/pricing)). A
   lecture is thousands of strokes. The economics do not exist, let alone the latency.
6. **Presentation mode on an external display.** No plugin API for a second display.
7. **Real-time collaboration and share-by-link.** Needs a server, an account and
   hosting — the three things PLAN.md rules out.

**Possible, but wrong for this project.**

8. **An infinite canvas / whiteboard mode.** Every competing Obsidian plugin is one,
   and PLAN.md's whole thesis is that _pagination is the product_. Adding a canvas mode
   would spend the differentiator to become the twenty-sixth of something.
9. **Flashcards and spaced repetition (GoodNotes' Study Sets / Smart Learn).** Obsidian
   has roughly 26 spaced-repetition plugins already
   ([Hub](https://publish.obsidian.md/hub/02+-+Community+Expansions/02.01+Plugins+by+Category/Spaced+Repetition+Plugins)).
   Per-page transcription feeds every one of them for free. Building our own would be
   fighting Obsidian's grain in the most literal way available.
10. **A notebook shelf, a folder browser, a tag browser, favourites, recents.**
    Obsidian has all of them, plus Bases Cards for the cover grid
    ([docs](https://obsidian.md/help/bases/views/cards)). Rebuilding them inside the
    plugin is work that makes the product _worse_ — a second, weaker file system that
    the rest of the vault cannot see.
11. **A sticker/template marketplace.** Half of GoodNotes' appeal and none of its
    engineering. A vault folder of PNGs is the Obsidian-shaped answer.
12. **Text boxes placed directly on the page.** Technically easy — and it puts a
    `contenteditable` back into the drawing pane, which is precisely the configuration
    Ink documents as Scribble-unsafe (§2.4). If typed text on a page is ever needed, it
    must be authored in a modal and rendered as non-editable content.
13. **Inline ink embeds and the ` ```inkedmark ` fence** (`src/view/embed-processor.ts`,
    `src/view/inline-ink-modal.ts`, `src/model/inline-block.ts`). Upstream's central
    idea, explicitly _not_ what Joost wants, and the one code path that provokes
    Scribble. Retire it — ~620 lines, and the project's biggest risk halves with it.
    _(Keep the ability to **read** an old inline block so existing InkedMark notes do
    not break; drop the ability to author one.)_
14. **Telemetry, accounts, and any network call that is not an explicitly triggered
    transcription.** PLAN.md, and it is also the actual difference from the
    subscription.

---

## Open questions — what only the iPad can answer

1. **Spike 0**: with Scribble ON, in the dedicated full-screen view, how many fast
   pen-downs are lost? (FEAS §1.6.3 has the exact protocol.)
2. **Does the iOS 26 ~30-second `MediaRecorder` truncation reproduce in a plugin?**
   Test before any audio work. ([forum #106161](https://forum.obsidian.md/t/ios26-audio-recording-core-plugin-is-not-working-properly/106161))
3. **What does an 800-stroke page actually serialise to?** §2.3's size table is
   arithmetic, not measurement, and the file-layout decision leans on it.
4. **Is `navigator.wakeLock` present in Obsidian's iPadOS webview?** One line to test,
   and it decides whether a recording UI can keep the screen on or must nag the user
   about Auto-Lock. _(Reported absent in WKWebView — LIKELY, one automated source.)_
5. **Does a page extension other than `.md` avoid the `setViewState` monkey-patch
   without losing default-on sync?** One hour, and it would remove a private-API
   dependency.
6. **Bases Cards on iPad**: does the cover grid actually render well at tablet width,
   and does folder exclusion break it
   ([forum](https://forum.obsidian.md/t/excluding-folders-from-quick-switcher-also-excludes-them-from-bases/110121))?
7. **Does GoodNotes actually do audio↔ink sync?** I found no primary source either way
   (§1.1). It changes how urgent §3 is, and it is one lecture with the app open to
   settle.

### Two things that changed since FEASIBILITY.md was written — worth folding back

- **`Vault.appendBinary()` exists as of Obsidian 1.12.3 (2026-02-23)**
  ([API docs](https://docs.obsidian.md/Reference/TypeScript+API/Vault/appendBinary)).
  FEASIBILITY predates it. It is the answer to the mobile base64 bridge ceiling and it
  is what makes chunked audio, and any other large binary, safe on iPad.
- **MyScript's self-serve pricing above 2,000 requests/month is gone**, replaced by
  "contact us" ([pricing](https://developer.myscript.com/pricing)). FEASIBILITY §4.1
  quoted ~$10/1k from a forum post and flagged it UNVERIFIED; it is now worse than
  that. The rasterise→vision-LLM path FEASIBILITY recommended is confirmed as the only
  economically viable transcription route.
