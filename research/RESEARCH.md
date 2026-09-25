# GoodObsidian — market reality check

**Researched:** 2026-09-20. **Method:** primary sources first — the Obsidian community plugin
registry JSON, official download stats JSON, the GitHub API (stars/issues/licences/last-push),
plugin READMEs and issue trackers. Forum/blog sources used only where primary data does not exist.

**Headline:** the user's belief — _"this market is not saturated; I haven't found good options for
this in Obsidian that work on iPad with Apple Pencil"_ — is **PARTLY TRUE, and the "I haven't
found" half is FALSE.** As of today there are **at least 25 handwriting/inking plugins in the
Obsidian registry**, and **almost all of them were created in the last 7 months**. One of them,
`Handwriting` by ellimist-afk (first commit 2026-08-21), already ships _seven of the eight features
on the GoodObsidian wish-list_. Details and receipts below.

---

## Competitors and their current state

### How the registry was searched

`community-plugins.json` from the official
[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) repo contains
**7,838 plugins** (fetched 2026-09-20). Filtering names+descriptions for
`handwrit|stylus|apple pencil|palm reject|\bink\b|sketch|whiteboard|freehand|scribble|digital pen|\bpencil\b|annotat`
returned 159 hits, of which ~25 are genuine pen-input plugins. Download numbers below come from the
official [community-plugin-stats.json](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json);
stars/issues/last-push/licence come from the GitHub API. All figures 2026-09-20.

### Tier 1 — direct competitors (handwriting-first, iPad-claimed)

| Plugin                   | Repo                                                                                                      | Created        | Last push  | Stars     | Open iss. | Downloads   | Licence                   | iPad / Pencil claim                                 | Pressure               | Palm rej.                  | Format                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | -------------- | ---------- | --------- | --------- | ----------- | ------------------------- | --------------------------------------------------- | ---------------------- | -------------------------- | ------------------------------------------------ |
| **Handwriting**          | [ellimist-afk/handwriting](https://github.com/ellimist-afk/handwriting)                                   | **2026-08-21** | 2026-09-14 | 89        | 4         | 4,008       | CC BY-NC-ND 4.0           | yes, explicit                                       | yes                    | yes                        | `.handwriting/` sidecar folder; note stays `.md` |
| **Ink**                  | [daledesilva/obsidian_ink](https://github.com/daledesilva/obsidian_ink)                                   | 2023-11-06     | 2026-09-20 | **1,380** | **83**    | **198,047** | CC BY-NC-ND 4.0 (not OSS) | yes                                                 | yes                    | partial (complaints)       | tldraw document model                            |
| **InkedMark**            | [pcrausaz/obsidian-inkedmark](https://github.com/pcrausaz/obsidian-inkedmark)                             | 2026-06-30     | 2026-09-11 | 7         | 6         | 1,843       | MIT                       | yes, explicit                                       | yes (perfect-freehand) | yes                        | `*.ink.md` — real markdown files                 |
| **Pencil**               | [rcanand/obsidian-pencil](https://github.com/rcanand/obsidian-pencil)                                     | 2026-06-23     | 2026-06-30 | 14        | 4         | 3,258       | MIT                       | yes                                                 | yes                    | yes (pen-then-finger-pans) | `.pencil` JSON                                   |
| **Blackboard**           | [jameswolensky/obsidian-blackboard](https://github.com/jameswolensky/obsidian-blackboard)                 | 2026-07-05     | 2026-08-21 | 12        | 9         | 2,182       | MIT                       | "built for iPad with Apple Pencil"                  | yes (perfect-freehand) | yes                        | `.blackboard` plain JSON                         |
| **Inkplane**             | [sirwanafifi/inkplane](https://github.com/sirwanafifi/inkplane)                                           | 2026-07-16     | 2026-07-17 | 6         | 1         | 893         | MIT                       | yes                                                 | yes                    | yes                        | `.inklayer` JSON                                 |
| **HandLayers**           | [ab11158/hand-note-layers](https://github.com/ab11158/hand-note-layers)                                   | 2026-08-16     | 2026-08-20 | 2         | 2         | 604         | MIT                       | yes                                                 | unverified             | unverified                 | layer sidecars over MD/PDF                       |
| **Handwriting Natively** | [marsluay/handwriting-natively](https://github.com/marsluay/handwriting-natively)                         | 2026-07-13     | 2026-09-19 | 7         | 12        | 1,714       | MIT                       | stylus on PDFs                                      | unverified             | unverified                 | PDF-local                                        |
| **Jot**                  | [bverbeken/jot](https://github.com/bverbeken/jot)                                                         | 2026-06-03     | 2026-06-20 | 3         | 8         | 1,352       | 0BSD                      | "Annotate PDFs with your Apple Pencil"              | unverified             | unverified                 | JSON sidecar, PDF untouched                      |
| **NoteLens**             | [veloik/Plugin-Obsidian](https://github.com/veloik/Plugin-Obsidian)                                       | 2026-09-01     | 2026-09-11 | 0         | 0         | 253         | MIT                       | pressure stylus, infinite board                     | claimed                | unverified                 | unverified                                       |
| **Quillstone**           | [marijanstajic/obsidian-quillstone](https://github.com/marijanstajic/obsidian-quillstone)                 | 2026-09-12     | 2026-09-13 | 0         | 0         | 75          | MIT                       | stylus                                              | unverified             | unverified                 | unverified                                       |
| **Inkflow**              | [quangnd159/inkflow](https://github.com/quangnd159/inkflow)                                               | 2026-08-10     | 2026-08-14 | 0         | 0         | 130         | MIT                       | stylus                                              | unverified             | unverified                 | canvas + image embed                             |
| **Inline Handwriting**   | [puriakazemieh/obsidian-inline-handwriting](https://github.com/puriakazemieh/obsidian-inline-handwriting) | 2026-08-17     | 2026-09-08 | 0         | 2         | 178         | MIT                       | unstated                                            | unverified             | unverified                 | unverified                                       |
| **Khattat**              | [mythraps/obsidian-khattat](https://github.com/mythraps/obsidian-khattat)                                 | 2026-03-05     | 2026-03-31 | 4         | 0         | 395         | MIT                       | "realistic pens" + **MyScript & Google Vision OCR** | unverified             | unverified                 | unverified                                       |
| **Sketchpad**            | [mozzaren/obsidian-sketchpad](https://github.com/mozzaren/obsidian-sketchpad)                             | 2026-08-13     | 2026-08-28 | 2         | 3         | 418         | MIT                       | pressure                                            | claimed                | unverified                 | unverified                                       |
| **Tabula Rasa**          | [jeremiahbeatham/TabulaRasa](https://github.com/jeremiahbeatham/TabulaRasa)                               | 2026-06-15     | 2026-08-13 | 0         | 0         | 197         | MIT                       | pressure + **shape snapping**                       | claimed                | unverified                 | PNG/SVG export                                   |

### Tier 2 — adjacent / incumbent (the plugins most people actually have installed)

| Plugin                     | Repo                                                                                            | Last push      | Stars     | Open iss. | Downloads     | Licence       | State                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------- | --------- | --------- | ------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Excalidraw**             | [zsviczian/obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) | 2026-09-20     | **7,624** | **895**   | **8,081,574** | AGPL-3.0      | Very active. Diagramming-first, not handwriting-first.                                                                                                           |
| **PDF++**                  | [ryotaushio/obsidian-pdf-plus](https://github.com/ryotaushio/obsidian-pdf-plus)                 | **2025-08-30** | 2,471     | 165       | 801,235       | MIT           | **Dormant ~13 months** — last release `0.40.31` on 2025-08-30, no commits since. Text-highlight annotation only; **no freehand ink**.                            |
| **Annotator**              | [elias-sundqvist/obsidian-annotator](https://github.com/elias-sundqvist/obsidian-annotator)     | **2024-01-08** | 1,776     | **272**   | 598,026       | AGPL-3.0      | **Abandoned ~2.7 years.** 272 open issues. Text/EPUB annotation, no ink.                                                                                         |
| **tldraw**                 | [tldraw/obsidian-plugin](https://github.com/tldraw/obsidian-plugin)                             | 2026-09-04     | 451       | 70        | 94,672        | Apache-2.0    | Active. Whiteboard, not a handwriting notebook.                                                                                                                  |
| **Handwritten Notes**      | [fbarrca/obsidian-handwritten-notes](https://github.com/fbarrca/obsidian-handwritten-notes)     | 2026-07-28     | 291       | 10        | 53,893        | MIT           | Alive but **not an in-app inking tool** — it creates a template PDF and hands off to an _external_ editor. README carries a "Mobile Support Is Limited" warning. |
| **Xournal++**              | [jonjampen/obsidian-xournalpp](https://github.com/jonjampen/obsidian-xournalpp)                 | 2026-08-31     | 74        | 6         | 10,620        | GPL-3.0       | Desktop bridge to Xournal++; not an iPad story.                                                                                                                  |
| **Simple Sketch**          | [yohh/obsidian-simple-sketch](https://github.com/yohh/obsidian-simple-sketch)                   | **2024-11-26** | 21        | 11        | 5,169         | LGPL-3.0      | Stale ~22 months.                                                                                                                                                |
| **Obsidian Canvas (core)** | core feature                                                                                    | n/a            | n/a       | n/a       | n/a           | proprietary   | Infinite board of _cards_. **No native pen input at all** — which is why `draw-in-canvas` and `Blackboard` exist to bolt drawing onto it.                        |
| **MarkMind**               | [markmindckm/obsidian-markmind](https://github.com/markmindckm/obsidian-markmind)               | —              | —         | —         | 603,760       | closed source | Mind map + PDF annotation. Closed source; precedent for paid Obsidian plugins.                                                                                   |

### The two facts that matter most

**1. The `Handwriting` plugin is effectively GoodObsidian v1, shipped a month ago.** Straight from
its [README](https://github.com/ellimist-afk/handwriting) (verbatim bullets):

> - handwrite, highlight, color palette, size sliders
> - **lasso**, compatible with side button; move the selection, delete it, copy/paste it across notes
> - pdfs: annotate, export, snip
> - pressure sensitivity
> - palm rejection
> - pinch to zoom
> - ink prediction + smoothing
> - **lined, grid, and dotted paper background**
> - export ink as svg or pdf
> - true infinite canvas
> - ink works in embeds
> - **handwriting to shape snap**

Mapped onto the GoodObsidian wish-list:

| GoodObsidian wanted feature             | Already in `Handwriting`?                                                                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hold-to-snap perfect shapes             | **yes** ("handwriting to shape snap")                                                                                                                                      |
| easy image insertion                    | **no**                                                                                                                                                                     |
| lined/grid paper backgrounds            | **yes** (lined, grid, dotted)                                                                                                                                              |
| lasso select                            | **yes** (with Pencil side-button support)                                                                                                                                  |
| **discrete pages, not infinite canvas** | **no — it is explicitly "true infinite canvas"**                                                                                                                           |
| PDF lecture-slide annotation            | **yes** (annotate, export, snip)                                                                                                                                           |
| on-demand handwriting transcription     | **not yet — but listed under "coming soon": "ocr / handwriting to text ( very soon )", "searchable handwriting ( very soon )", "handwriting to math/latex ( very soon )"** |
| copies GoodNotes UI                     | partially — OneNote-inspired, per the author                                                                                                                               |

It is shipping at an extraordinary cadence: releases `1.4.15` (2026-09-10), `1.4.16` and `1.4.17`
(2026-09-11), `1.4.18` (2026-09-12), `1.4.19` (2026-09-14) — five releases in five days
([releases](https://github.com/ellimist-afk/handwriting/releases)). The author states: _"Handwriting
is free. i still work on it almost every night."_

**2. This is a 2026 gold rush, not a mature market.** Of the 16 Tier-1 plugins above, **14 were
created in 2026** (the earliest of those, Khattat, on 2026-03-05). Ink is the only handwriting
plugin with more than 5,000 downloads. The correct picture is therefore _many entrants, no winner_.
Most of these repos have 0–14 stars and were pushed once and left. A large share carry the registry
flag _"This plugin has not been manually reviewed by Obsidian staff"_, consistent with a wave of
rapidly-built (likely AI-assisted) submissions — the `Handwriting` README says so outright:
_"disclaimer: ai assistance was used in this project."_

---

## User pain points

All quotes verbatim, with links.

### Apple Pencil Scribble is the single most-cited iPad blocker

> "Using the Apple Pencil with scribble turned on results in characters being typed rather than
> handwritten if pen strays outside the handwriting section."
> — original poster, [obsidian_ink#35](https://github.com/daledesilva/obsidian_ink/issues/35), 2024-05-06, **still open 2.4 years later**

> "When handwriting or drawing in ink words get picked-up by scribble and are messing up everything.
> I noticed that when handwriting it usually scribbles the word and removes it from ink […] It's a
> pity because this plugin is so great […] But I am guessing that **most pencil users will have
> scribble on by default**. […] Bear has a fantastic scribble integration if you wanted to draw some
> inspiration from"
> — [obsidian_ink#136 "Impossible to work in iPad when scribble is on"](https://github.com/daledesilva/obsidian_ink/issues/136), 2025-01-11, **open**

> "I can confirm. I just installed the addon on my iPad and couldn't figure out what was going on.
> And yes, Bear does have a great integration! It's the reason I went looking for an Obsidian plugin
> that was simpler than Excalidraw in the first place"
> — @Michaelknubben, same thread, 2025-11-08

The state-of-the-art response is a README instruction to turn the OS feature off. From the
`Handwriting` README:

> "**ipad users** — turn off Scribble or ios will draw its own black ink over your strokes, and its
> scratch-out gesture may delete ink. **iPad Settings → Apple Pencil → Scribble → Off**"

**This is a real, unsolved, universally-experienced defect.** Nobody in the Obsidian ecosystem has a
Bear-style graceful Scribble coexistence.

### Palm rejection is finicky even where it is claimed

> "Have a setting to only allow drawing with a stylus […] when resting the hand on the screen palm
> rejection is currently finicky."
> — [obsidian_ink#177 "Better Palm Rejection"](https://github.com/daledesilva/obsidian_ink/issues/177), 2026-04-20, open

> "Currently you can use the Apple Pencil on iPad, however **your hand cannot touch the screen or it
> will draw random lines**" — wesswart77, asking to "write freely, like good notes for example",
> [obsidian-excalidraw-plugin#2609](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/2609),
> 2026-01-16, **open with no maintainer reply**

### Lag and latency

> "when I write for 2-3 paragraphs I will start to lag more and more […] even with the method above
> I will begin experiencing lagging/smoothing after 4-5 paragraphs very often no matter what,
> **letters become straight lines or dots or mini versions of themselves** when I write at this stage"
> — [obsidian_ink#84](https://github.com/daledesilva/obsidian_ink/issues/84), 2024-09-23

Maintainer @daledesilva, 2024-12-05: _"I have noticed this lately on my iPad actually […] I suspected
it was some sort of memory leak."_ Claimed fixed 2026-06-04 in the 0.5.0 beta — i.e. **~21 months
from report to fix**. See also [#13 "Solving the performance problem"](https://github.com/daledesilva/obsidian_ink/issues/13)
and [#76 "Lag/latency issues on eReaders"](https://github.com/daledesilva/obsidian_ink/issues/76).

### Sync and data loss — the most dangerous category

> "When using the new Ink drawing feature […] **drawings notes disappear** if the same note is open
> simultaneously on both my iPad Air and my laptop. I have an active Obsidian Sync subscription, and
> this issue occurs frequently."
> — [obsidian_ink#146](https://github.com/daledesilva/obsidian_ink/issues/146), 2025-08-11, open

> "the 'rejected change' I saw in my sync logs might be causing the drawings to disappear […] The ink
> drawings don't seem to sync as expected via Obsidian sync." — @sofie-bird, same thread, 2026-01-14

> "I tried to write on 2 different device, but each device has their own writing, and not synced."
> (Windows 11 + iPad mini 6, Apple Pencil Pro)
> — [handwriting#11](https://github.com/ellimist-afk/handwriting/issues/11), 2026-09-09

And the architectural confession that matters most for GoodObsidian's design:

> "the main cause of the issue **which is not going to go away**, is that different devices have
> narrower or bigger panes which means different coordinates, and i have to sync the live editor…"
> — @ellimist-afk on [handwriting#19 "Ink moves on mobile"](https://github.com/ellimist-afk/handwriting/issues/19), 2026-09-17

> "Ink moves on zoom in" — [handwriting#17](https://github.com/ellimist-afk/handwriting/issues/17),
> 2026-09-15. Maintainer: _"i have been chasing this bug in circles for 4 days"_.

**Read that carefully.** Ink-as-an-overlay-on-reflowing-markdown has a coordinate problem that its
own author says is not going away. A **fixed-geometry discrete page** does not have this problem.
This is the strongest technical argument for the GoodObsidian design in the entire research set.

### Missing shapes / images / OCR — all requested, none delivered

- **Shapes:** [obsidian_ink#37 "Line Styles - hold to make straight or regular shape"](https://github.com/daledesilva/obsidian_ink/issues/37),
  2024-05-06. Maintainer, 2024-05-07: _"Unfortunately this is quite complex […] **it's unlikely I'll
  ever do this anyway** (or at least not in the next year or so). The plugin's focus is on free-form
  handwriting […] It'll never be a diagramming tool."_ Requester: _"Thanks for your reply. That's
  what I expected although i was hoping otherwise."_
- **Images:** [obsidian_ink#134 "Embed images in markdown"](https://github.com/daledesilva/obsidian_ink/issues/134),
  2025-05-09, open. Also [#59 "Insert background image"](https://github.com/daledesilva/obsidian_ink/issues/59), 2024-06-28.
- **OCR:** [obsidian_ink#43 "OCR Transcriptions"](https://github.com/daledesilva/obsidian_ink/issues/43),
  2024-05-24. Maintainer, 2024-05-28: _"Yep, this is planned 🙂 […] it will be a few months at least."_
  @ruben-sg, 2025-06-09: _"Any update on this?"_ — **still open, 2.3 years later.** Duplicate at
  [#153](https://github.com/daledesilva/obsidian_ink/issues/153).
- **Apple Pencil double-tap / squeeze:** [#42](https://github.com/daledesilva/obsidian_ink/issues/42)
  (2024-05-19) and [#133](https://github.com/daledesilva/obsidian_ink/issues/133) (2025-05-07), both open.
- **Canvas integration:** [#89 "Add direct canvas support"](https://github.com/daledesilva/obsidian_ink/issues/89), open.

### Obsidian itself will not solve this

The core feature request, [_"Built-in support for handwritten notes (mainly for mobile apps), e.g.
Apple Pencil"_](https://forum.obsidian.md/t/built-in-support-for-handwritten-notes-mainly-for-mobile-apps-e-g-apple-pencil/28460),
ran Dec 2021 → Sep 2023, 16 replies, **no official commitment from the Obsidian team**. A moderator
merged it into a plugin-idea thread. Obsidian Canvas, shipped since, has **no pen input**.

---

## "Why not just use GoodNotes?"

What users say they lose by keeping handwriting in a dedicated app
([forum thread, 2021](https://forum.obsidian.md/t/do-any-of-you-combine-handwritten-notes-with-obsidian/17094)):

> "being able to embed and link notes together because it makes it much easier and enjoyable to
> actually read" — @arcene, 2021-04-24

> "only paper really survives, and organized raw text files are the next best thing […] no dependence
> on ever-changing/abandoned proprietary formats" — @Moonbase59, 2021-04-24

> "less friction to write and sketch something on paper than sitting in front of a computer" and
> "ideas and information stick better when writing by hand" — @austin, 2021-04-24

> "just writing down most of my stuff in Obsidian and just drawing diagrams etc. in GoodNotes"
> — @kanefrieden, 2021-04-25 (the hybrid-workflow tax)

And the searchability complaint, which recurs everywhere:

> "I believe these options all leave your handwritten text unsearchable." — @CawlinTeffid,
> [forum, 2025-08-22](https://forum.obsidian.md/t/how-to-handwrite-on-obsidian-with-an-ipad/104417).
> Same user: _"Obsidian is not a handwriting oriented app."_

Users importing GoodNotes PDFs report that even with Omnisearch + Text Extractor,
[handwritten content still does not show up in search](https://forum.obsidian.md/t/search-inside-handwritten-pdf-imported-from-goodnote/56468).

There is a counter-argument on record too, from the core feature-request thread: handwriting-to-text
is problematic because _"you lose the spatial component"_ and is _"slower and less reliable"_ than a
keyboard (2022-09). That argues transcription should be **on-demand and additive** — a searchable
text layer _beside_ the ink, never a replacement. That is exactly what InkedMark built and what
`Handwriting` has queued.

**So the value proposition is not "handwriting". It is: `[[wikilinks]]` + graph + backlinks + global
search + plain files reaching handwritten content, on the device you already write on.** Anything
that breaks those (opaque blobs, un-indexable ink, ink that desyncs) destroys the entire reason to be
inside Obsidian rather than in GoodNotes.

### The author of the closest competitor says it best

> "back in uni i remember taking biochem notes on a Surface Pro 4 […] drawing structures and typing
> labels on the same OneNote page felt like literal magic. ten years later, now for work, I'm still
> using onenote — and i consider it a prison. […] **Handwriting is OneNote's last bastion.**"
> — [ellimist-afk, Handwriting README](https://github.com/ellimist-afk/handwriting)

---

## Competitor apps outside Obsidian (table stakes)

These set the UI expectations the plugin will be judged against.

| App                                      | Model                                                                                              | What it establishes as table stakes                                                                                                                                                                               | Known complaints                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GoodNotes**                            | subscription (Essential/Pro/Special Edition tiers since Oct 2025); free tier capped at 3 notebooks | Notebook/folder metaphor, **discrete paginated pages**, paper templates, lasso→move/resize/convert, hold-to-snap shapes, handwriting search, PDF import+annotate, page thumbnails                                 | Subscription resentment (was a one-time purchase); ["stubbornness to fully embrace cross-platform"](https://eathealthy365.com/the-top-7-limitations-of-the-goodnotes-app-in-2026/); organisation "creaks under heavy loads". [2025 tier change](https://alternativeto.net/news/2025/10/goodnotes-update-brings-new-plans-ai-features-whiteboards-and-text-documents) |
| **Notability**                           | subscription                                                                                       | Synced audio recording alongside ink; clean toolbar                                                                                                                                                               | Feature/price churn ([Paperlike comparison](https://paperlike.com/blogs/paperlikers-insights/app-review-goodnotes-vs-notability))                                                                                                                                                                                                                                    |
| **Apple Notes**                          | free, bundled                                                                                      | Instant launch, Scribble integration, system-level pencil handling, automatic handwriting search                                                                                                                  | Weak organisation, no real PDF workflow, Apple-only                                                                                                                                                                                                                                                                                                                  |
| **Noteful**                              | one-time purchase                                                                                  | _"one of the best ink engines around"_ plus PDF markup at a low one-time price — [KDigitalStudio, 2026](https://kdigitalstudio.com/blogs/news/goodnotes-vs-noteful-premium-powerhouse-or-budget-favorite-in-2026) | Fewer ecosystem/template extras                                                                                                                                                                                                                                                                                                                                      |
| **Nebo → MyScript Notes** (renamed 2025) | paid                                                                                               | Best-in-class handwriting recognition; minimal UI                                                                                                                                                                 | _"learning curve is steeper than Goodnotes or Notability"_                                                                                                                                                                                                                                                                                                           |
| **Samsung Notes**                        | free, bundled                                                                                      | S Pen latency, PDF annotate, folders                                                                                                                                                                              | Android/Samsung-only                                                                                                                                                                                                                                                                                                                                                 |
| **Concepts**                             | freemium                                                                                           | Infinite canvas, **multi-touch shape guides**, vector-native                                                                                                                                                      | Design-tool mental model, not a notebook                                                                                                                                                                                                                                                                                                                             |

**Distilled table stakes for v1:** sub-frame ink latency with pressure; palm rejection that never
fails; a _notebook of pages_ (not a soup of drawings); lined/grid paper; lasso that moves _and_
resizes; pen/highlighter/eraser with remembered colours; PDF import that leaves the PDF intact; page
thumbnails for navigation.

---

## Gaps and differentiation

Concrete, ordered by how defensible each is.

**1. Discrete pages — genuinely unclaimed, and technically load-bearing.**
Scanning all 7,838 registry descriptions for
`paginat|page-based|discrete page|a4|letter-size|notebook page|lined paper|paper template|page break`
returns **zero** handwriting plugins. Every competitor — Ink, Handwriting, Pencil, Inkplane,
Blackboard, NoteLens, tldraw, Excalidraw — is an **infinite canvas**. `Handwriting` advertises
_"true infinite canvas"_ as a feature.
This is not merely a UI preference. It is the fix for the coordinate bug its own author called
["not going to go away"](https://github.com/ellimist-afk/handwriting/issues/19): a page with a
**fixed intrinsic coordinate space** renders identically on a phone, an iPad and a laptop, zooms
without drift, diffs cleanly, and exports to PDF 1:1. **Own this. It is the product.**
_(Caveat: the registry search reads descriptions, not source. A plugin could implement pagination
without saying so. Unverified beyond description text.)_

**2. Graceful Apple Pencil Scribble coexistence.** Every plugin's answer today is "turn Scribble off
in iOS Settings." Users have said since 2024 that they won't and shouldn't have to
([#35](https://github.com/daledesilva/obsidian_ink/issues/35),
[#136](https://github.com/daledesilva/obsidian_ink/issues/136)). Two users independently cite **Bear**
as the app that got this right — a concrete reference implementation to study. Solving this properly
would be the most-noticed single feature in the category.

**3. Image insertion.** Requested on Ink since 2024–25 and still missing
([#134](https://github.com/daledesilva/obsidian_ink/issues/134),
[#59](https://github.com/daledesilva/obsidian_ink/issues/59)); absent from the `Handwriting` feature
list and not on its "coming soon". Cheapest real win on the list.

**4. Copying GoodNotes' UI on purpose.** No Obsidian plugin does. Ink's author is explicitly
anti-diagramming-tool; `Handwriting`'s author is OneNote-shaped. The deliberate GoodNotes-clone
positioning is unoccupied, and is a genuine product decision rather than just a feature.

### Where GoodObsidian has _no_ moat — plan accordingly

- **Shape snapping:** shipped in `Handwriting`, claimed in `Tabula Rasa`. Not a differentiator.
- **Lasso:** shipped in `Handwriting` and `Inkplane`; `Handwriting`'s already supports the Pencil
  side button. Not a differentiator.
- **Lined/grid paper:** shipped in `Handwriting`. Not a differentiator.
- **PDF annotation:** shipped in `Handwriting`, `Jot`, `Handwriting Natively`, `Freedraw PDF`,
  `PDF.notes`, `ink-annotation`, `OPPO Pad Markdown Annotation`. **Extremely crowded.**
- **Transcription/OCR:** already shipped in **InkedMark** (three providers feeding a searchable text
  layer in a real `.ink.md` markdown file) and in **Khattat** (MyScript + Google Vision). Listed as
  _"very soon"_ on `Handwriting`. **This window is closing in weeks, not months.**

### The genuinely open incumbent gap (not on the current wish-list)

**PDF++ has been dormant since 2025-08-30** (last commit _and_ last release), with 801k downloads and
165 open issues, and it has never supported freehand ink at all. **Annotator has been dead since
2024-01-08** with 598k downloads and 272 open issues. Roughly 1.4M downloads' worth of users sit on
two unmaintained PDF-annotation plugins, neither of which supports a pencil. A GoodObsidian that does
_pen-on-lecture-slides_ properly inherits that audience by default.

---

## Other decision-relevant factors

### Licensing / openness

- **MIT dominates** the new 2026 wave: Pencil, InkedMark, Blackboard, Inkplane, HandLayers,
  Handwriting Natively, Tabula Rasa, Sketchpad, Khattat, Freedraw PDF, NoteLens, Quillstone, Inkflow.
- **The two leaders are not open source.** Both Ink and Handwriting ship **CC BY-NC-ND 4.0** — Ink's
  README carries a _"not open source"_ disclaimer, and Handwriting's LICENSE reads: _"You may use and
  share this software, with attribution, for any noncommercial purpose. You may not sell it, use it
  commercially, or distribute a modified version of it."_
  **Practical consequence: you may not fork or vendor code from either.** Prefer AGPL Excalidraw,
  Apache-2.0 tldraw, or MIT [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand)
  (used by both InkedMark and Blackboard) as building blocks.
- Excalidraw is **AGPL-3.0**, tldraw **Apache-2.0**, PDF++ **MIT**, Annotator **AGPL-3.0**.

### Paid plugins

Precedent exists but is thin and off-marketplace: the Obsidian Hub maintains a
[Paid and subscription-based plugins](https://publish.obsidian.md/hub/02+-+Community+Expansions/02.01+Plugins+by+Category/Paid+and+subscription-based+plugins)
list, and **MarkMind** (603,760 downloads) is closed-source and commercial. There is no official paid
marketplace; a [Dec 2025 forum thread](https://forum.obsidian.md/t/paid-plugin-market-and-how-to-solve-unmaintained-plugins/109137)
argues for one partly _as a fix for unmaintained plugins_. Obsidian's own
[commercial licence](https://obsidian.md/help/teams/license) is a voluntary $50/user/year for
organisations and grants no functional benefit in the app. `Handwriting` monetises via Ko-fi only.
**Given this is a personal tool: irrelevant to v1. Pick MIT and move on.**

### Platform / dependency risk

- `Handwriting` requires **Obsidian 1.12.3+**; Inkplane requires 1.7.2+. Mobile Obsidian's WebView is
  the real performance ceiling — the recurring latency complaints are almost certainly canvas/DOM
  cost, not algorithmic.
- Obsidian Sync is documented to mishandle sidecar ink files in _both_ leading plugins
  ([ink#146](https://github.com/daledesilva/obsidian_ink/issues/146),
  [handwriting#11](https://github.com/ellimist-afk/handwriting/issues/11)). The `Handwriting`
  workaround is instructive: a **non-hidden** `handwriting/` folder, because sync services skip
  dot-folders. **Do not store ink in a dot-prefixed folder.**
- `Handwriting` is a single-maintainer, one-month-old, AI-assisted, non-commercially-licensed
  project. Its bus factor is 1 and its licence blocks anyone else from continuing it. That is a real
  reason a second implementation can rationally exist.

### What could not be verified

- **Reddit (r/ObsidianMD) was not reachable** — reddit.com blocks both the unauthenticated search API
  and this user agent. All community sentiment here comes from forum.obsidian.md and GitHub instead.
  **Unverified:** whatever r/ObsidianMD says about these plugins.
- **Obsidian Discord** is not publicly indexed; not checked. Unverified.
- **No hands-on testing was done.** Every "works on iPad with Apple Pencil" claim in the Tier-1 table
  is a README claim unless a linked user report corroborates it. Corroborated by real user reports:
  Ink (many, mostly negative on Scribble/lag) and Handwriting (issues #9 and #11 — real pen hardware,
  including an iPad mini 6 with Apple Pencil Pro). **Unverified** for: NoteLens, Quillstone, Inkflow,
  Inline Handwriting, Khattat, Sketchpad, Tabula Rasa, HandLayers, Jot and Handwriting Natively — all
  have 0–7 stars and no substantive issue history.
- Obsidian **Fountain Pen** was named in the brief; **no plugin by that name exists in the registry**
  (the only near-match, `obsidian-fountain`, is for screenplay Fountain markup and is unrelated). The
  closest real matches are Pencil and Inkplane, covered above.
- obsidianstats.com was consulted and **discarded**: its figures contradicted the official stats JSON
  (it reported Excalidraw as "91 downloads, last updated 5 years ago" against the official 8,081,574
  and a push today). Do not use it.

---

## Sources

**Primary — official Obsidian data**

- [community-plugins.json](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json) (7,838 plugins, fetched 2026-09-20)
- [community-plugin-stats.json](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json) (download counts, fetched 2026-09-20)
- [Obsidian commercial licence](https://obsidian.md/help/teams/license)
- [Obsidian Hub — Paid and subscription-based plugins](https://publish.obsidian.md/hub/02+-+Community+Expansions/02.01+Plugins+by+Category/Paid+and+subscription-based+plugins)

**Primary — plugin repos** (stars/issues/licence/push dates via the GitHub API, 2026-09-20)

- [ellimist-afk/handwriting](https://github.com/ellimist-afk/handwriting) · [releases](https://github.com/ellimist-afk/handwriting/releases) · issues [#9](https://github.com/ellimist-afk/handwriting/issues/9) [#11](https://github.com/ellimist-afk/handwriting/issues/11) [#17](https://github.com/ellimist-afk/handwriting/issues/17) [#19](https://github.com/ellimist-afk/handwriting/issues/19)
- [daledesilva/obsidian_ink](https://github.com/daledesilva/obsidian_ink) · issues [#13](https://github.com/daledesilva/obsidian_ink/issues/13) [#35](https://github.com/daledesilva/obsidian_ink/issues/35) [#37](https://github.com/daledesilva/obsidian_ink/issues/37) [#42](https://github.com/daledesilva/obsidian_ink/issues/42) [#43](https://github.com/daledesilva/obsidian_ink/issues/43) [#59](https://github.com/daledesilva/obsidian_ink/issues/59) [#76](https://github.com/daledesilva/obsidian_ink/issues/76) [#84](https://github.com/daledesilva/obsidian_ink/issues/84) [#89](https://github.com/daledesilva/obsidian_ink/issues/89) [#125](https://github.com/daledesilva/obsidian_ink/issues/125) [#133](https://github.com/daledesilva/obsidian_ink/issues/133) [#134](https://github.com/daledesilva/obsidian_ink/issues/134) [#136](https://github.com/daledesilva/obsidian_ink/issues/136) [#146](https://github.com/daledesilva/obsidian_ink/issues/146) [#153](https://github.com/daledesilva/obsidian_ink/issues/153) [#177](https://github.com/daledesilva/obsidian_ink/issues/177)
- [pcrausaz/obsidian-inkedmark](https://github.com/pcrausaz/obsidian-inkedmark) · [rcanand/obsidian-pencil](https://github.com/rcanand/obsidian-pencil) · [jameswolensky/obsidian-blackboard](https://github.com/jameswolensky/obsidian-blackboard) · [sirwanafifi/inkplane](https://github.com/sirwanafifi/inkplane)
- [zsviczian/obsidian-excalidraw-plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin) · [issue #2609](https://github.com/zsviczian/obsidian-excalidraw-plugin/issues/2609)
- [ryotaushio/obsidian-pdf-plus](https://github.com/ryotaushio/obsidian-pdf-plus) · [elias-sundqvist/obsidian-annotator](https://github.com/elias-sundqvist/obsidian-annotator) · [tldraw/obsidian-plugin](https://github.com/tldraw/obsidian-plugin) · [fbarrca/obsidian-handwritten-notes](https://github.com/fbarrca/obsidian-handwritten-notes) · [jonjampen/obsidian-xournalpp](https://github.com/jonjampen/obsidian-xournalpp)
- [steveruizok/perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT ink engine used by InkedMark and Blackboard)

**Obsidian Forum**

- [Built-in support for handwritten notes (Apple Pencil)](https://forum.obsidian.md/t/built-in-support-for-handwritten-notes-mainly-for-mobile-apps-e-g-apple-pencil/28460)
- [How to handwrite on Obsidian with an iPad](https://forum.obsidian.md/t/how-to-handwrite-on-obsidian-with-an-ipad/104417)
- [Do any of you combine handwritten notes with Obsidian?](https://forum.obsidian.md/t/do-any-of-you-combine-handwritten-notes-with-obsidian/17094)
- [How to use and link handwritten Notes](https://forum.obsidian.md/t/how-to-use-and-link-handwritten-notes/16719)
- [Search inside handwritten PDF (imported from GoodNotes)](https://forum.obsidian.md/t/search-inside-handwritten-pdf-imported-from-goodnote/56468)
- [Paid plugin market and how to solve unmaintained plugins](https://forum.obsidian.md/t/paid-plugin-market-and-how-to-solve-unmaintained-plugins/109137)

**Competitor apps (secondary sources)**

- [GoodNotes app limitations, 2026](https://eathealthy365.com/the-top-7-limitations-of-the-goodnotes-app-in-2026/)
- [GoodNotes new plans, Whiteboards, AI features (Oct 2025)](https://alternativeto.net/news/2025/10/goodnotes-update-brings-new-plans-ai-features-whiteboards-and-text-documents)
- [GoodNotes vs Notability — Paperlike](https://paperlike.com/blogs/paperlikers-insights/app-review-goodnotes-vs-notability)
- [GoodNotes vs Noteful, 2026](https://kdigitalstudio.com/blogs/news/goodnotes-vs-noteful-premium-powerhouse-or-budget-favorite-in-2026)
- [Best note-taking apps for iPad 2026 (Nebo → MyScript Notes rename)](https://www.refurb.me/blog/best-note-taking-apps-ipad)

**Not reachable / not checked:** reddit.com (r/ObsidianMD) — blocked; Obsidian Discord — not publicly
indexed. obsidianstats.com — consulted and discarded as inaccurate.
