# Tasks

Revised 2026-09-20 after market research and feasibility. Owner tags:
`[orchestrator]` `[backend]` `[frontend]` `[testing]` `[joost]`.

## Done

- [x] 1. [orchestrator] Fork InkedMark (MIT) as the base; baseline verified
      (clean build, 189/189 tests) before any change
- [x] 2. [orchestrator] Rebrand identity only (PLUGIN_ID, VIEW_TYPE_INK,
      manifest, package); on-disk format markers deliberately unchanged
- [x] 3. [orchestrator] UI design interview → contracts/design-brief.md
- [x] 4. [orchestrator] contracts/api.md + 6 fixtures
- [x] 5. [orchestrator] Page model, schema v2, v1→v2 migration (201 tests)
- [x] 6. [market-research] research/RESEARCH.md
- [x] 7. [feasibility] research/FEASIBILITY.md
- [x] 9. [backend] `src/ink/shape-recognizer.ts` — geometric fitting (TLS line,
      Kåsa circle, adaptive RDP + oriented box for rect, shaft+V for arrow).
      29/29 shaped cases recognised, **0 false positives across 27 adversarial
      shapes** (V, L, Z, star, spiral, heart, checkmark, cursive…), 5.1 ms on a
      4001-point stroke
- [x] 10. [backend] All seven page/image/shape commands, 92/92 assertions,
      every apply→invert round-trip `JSON.stringify`-identical
- [x] 20. [orchestrator] contracts/api.md v3 — answered the backend's five
      contract questions (ImageTransform object, relative closeTolerance,
      per-kind pts layouts, no ellipse in v1, no one-barb arrow)

## 0.5 — Joost's list of 2026-09-22 (built; shipped as 0.5.0, untested on device)

Assessed feasible item by item on 2026-09-22; Joost said "implement all of
these". Model fields for all of it landed first (60b84da, contract v7 §6), then
five agents in parallel worktrees, then a second wave that needs the first,
then a third for the GoodNotes picture UI. Every item is merged with all CI
gates green; **none has run on an iPad or in Obsidian** — the on-device
checks each agent listed are in the 0.5.0 release summary.

- [x] 44. [orchestrator] Groundwork: model fields, toolbar slots, contract v7;
      README credit shortened; history squash recorded in RELEASE.md for the
      first public release (not before — Joost's call)
- [x] 45. [images] Insert panel (Photos / camera / vault), downscale + save to
      attachments, images drawn in tiles and thumbnails, select / move /
      resize / rotate / delete — Joost: HIGH
- [x] 46. [text] GoodNotes text-tool pill from Joost's screenshot: colour,
      size, font, B/I/U/S, alignment, line spacing, fill, default style, pin;
      hint toast — HIGH. Per-word formatting is out of scope for 0.5
      (whole-box styles only); no long-press whole-page box (Joost, 09-22)
- [x] 47. [text] Keyboard goes away while a text box is moved — MID
- [x] 48. [shapes] Star recognition; the Apple Notes arrow (draw a line,
      go back a little along it, hold); line / arrow / star presets; tables
      as ink (rows × columns) — LOW. No two-stroke arrow (Joost, 09-22)
- [x] 49. [notebook] New-notebook dialog: title, Notebook | Single page,
      cover, paper, size, folder — MID; covers — LOW; Title & Date paper — LOW
- [x] 50. [ai] Keys in SecretStorage, AI menu, per-page and whole-notebook
      transcription (closes #41), Ask about a page/notebook, image generation,
      `transcribeAudio` for the audio wave — MID
- [x] 51. [wave 2] Freeform lasso with a rectangle option; lasso and eraser
      filters by item type (closes #42, #24) — LOW. UI after Joost's GoodNotes
      screenshot: a "Lasso Tool" popover from a chevron on the lasso button —
      Rectangular | Freehand cards, then switches for Handwriting, Images,
      Shapes, Arrows, Text boxes; the selection's action bar is a dark pill
      with Delete in red and a "…" menu
- [x] 52. [wave 2] Audio recording with stroke timestamps, playback,
      tap-a-stroke-to-seek, transcript via the AI key — LOW. Foreground only:
      recording stops when the iPad sleeps (research/FEATURES.md §3)
- [x] 53. [wave 2] Document scanning: photo → corners → perspective fix →
      enhance → new page — LOW
- [x] 54. [wave 3] A selected picture as in GoodNotes (Joost's screenshots,
      2026-09-22): square corner handles, round mid-edge handles (stretch),
      a rotate knob below; action bar Crop · Cut · Duplicate · Delete · "…";
      the "…" menu has Cut, Bring to front, Send to back, Copy, Duplicate,
      Paste, Lock image, Crop image. Model fields `crop` and `locked` landed
      in 2ad5429. Stickers, Image Playground and comments are out of scope

## Blocking, and only Joost can do it

- [ ] 0. [joost] **Spike 0 — Scribble.** Upstream measured ~20% of fast pen-downs
      never reaching the webview with Apple Scribble enabled, and no web API can
      detect it. Needs a real iPad. Two candidate escapes to test: a dedicated
      full-screen view (no `contenteditable` for Scribble to target) and Touch
      Events instead of Pointer Events. **Everything about ink feel is
      provisional until this is answered.** See PLAN.md "Feasibility-informed".
- [ ] 8. [joost] Try **arrow snapping** with a real Apple Pencil once the UI is
      wired. The backend shipped a deliberately _narrow_ arrow detector: only
      the full tail→tip→barb→tip→barb gesture snaps, because accepting a
      one-barb arrow turns every checkmark and every "L" into an arrow. Its
      40/40 synthetic score will not hold in the wild. If recall disappoints,
      the honest options are a long-shaft+tight-barb special case, or cutting
      arrow from v1.

## Landed this session (verified: format, lint, 221 tests, build all green)

- [x] 11. [frontend] Render `doc.pages[]` as discrete fixed-geometry pages
- [x] 12. [frontend] Synthetic backdrops (all **nine** rulings, not three): blank, lined, grid
- [x] 13. [frontend] PDF backdrops via Obsidian's public `loadPdfJs()`, cached
      per (path, page, scale); source PDF never written; missing PDF keeps ink
- [x] 14. [frontend] Two-tier toolbar + page nav
- [x] 15. [frontend] `design-system/` tokens + standalone HTML component previews

## Next

- [x] 37. [orchestrator] contracts/api.md v5 — answered the frontend's requests
      (synchronous `BackdropPainter`, cache-key quantisation, `dotted` radius,
      page-addressed commands documented, dark paper moved to notebook frontmatter)
- [ ] 38. [both] Move **dark paper** out of per-device local storage into
      `_notebook.md` frontmatter. It is a notebook property; today it does not sync.
- [ ] 39. [frontend] The ~120 ms snap animation is not implemented — without it
      hold-to-snap reads as a glitch rather than an action.
- [ ] 40. [frontend] Toolbar callbacks are unsupplied so their buttons render
      **disabled on purpose**: `onInsertImage`, `onToggleThumbnails`, `onSearch`,
      `onOutline`, `onTextBox`, `onStickyNote`, `onLaser`, `onAudio`.
- [x] 41. [both] `ink-view.recognize()` still transcribes page 1 only (fixed in 0.5)
      (`primaryRegion`). Wrong for a multi-page notebook.
- [x] 42. [frontend] Lasso is still a rectangular marquee, not a polygon (fixed in 0.5).
- [ ] 43. [orchestrator] `src/canvas/ink-color.ts` is now unused by the render
      path but still exported and still unit-tested. Remove or re-justify.

- [ ] 16. [testing] Tests for the shape recogniser, new commands, and edge
      probes (empty page, huge stroke count, corrupt file, missing PDF)
- [x] 17. [orchestrator] Wire frontend callbacks to backend commands; integrate
- [ ] 18. [orchestrator] Clean build + full suite; write iPad install steps
- [ ] 19. [orchestrator] Sync `design-system/` to Claude Design
- [x] 21. [orchestrator] Add `.gitattributes` (`* text=auto eol=lf`) and
      `git add --renormalize .` **at a quiet point when no agent is editing**.
      Until then `npm run format:check` fails on all 97 files — a Windows
      CRLF-vs-Prettier collision, not a real formatting problem. Never fix it
      by running `prettier --write` over the tree: that would make every future
      upstream merge conflict. Recorded in CodebaseButler.
- [ ] 22. [orchestrator] Restore coverage thresholds — new modules currently
      drop line coverage to 55.5% vs the 80% gate. `npm test` stays green
      because it does not run coverage; task 16 fixes this.

## The format wave — do this before there are notebooks worth migrating

Joost chose the notebook layout on 2026-09-20 (contracts/api.md §1b). It is a
format change, so it lands early, while the cost of migrating is zero.

- [ ] 30. [backend] `_notebook.md` parse/serialize as a **pure** function over a
      string: `goodobsidian-notebook: true`, title, cover, ordered `pages`.
- [ ] 31. [backend] Add optional `t0` per stroke (ms from the page's first
      pen-down), quantized as an integer, absent on old strokes. **Do this in
      the same migration as 30** — GoodNotes has time-stamped strokes against
      audio since 2023, so this is table stakes, and retrofitting it later
      means migrating notebooks Joost actually cares about.
- [ ] 32. [frontend] Notebook loader: read `_notebook.md`, then page files
      **lazily — only visible pages**. This is what makes a 200-page notebook
      usable on an iPad; do not load them all.
- [ ] 33. [frontend] Page manager: thumbnail sidebar, reorder/duplicate/delete
      (all metadata edits to `_notebook.md`), generated `thumbs/p-NNN.png`.
      `thumbs/` must **not** be dot-prefixed — sync services skip dot folders.
- [ ] 34. [orchestrator] **Do not build a notebook shelf.** Obsidian's Bases
      Cards view is already a cover-image gallery grid, for the cost of one
      `.base` file plus `cover:` in frontmatter. Verify this, then ship the
      `.base` file instead of a custom view.
- [ ] 35. [both] Per-page transcription into each page's markdown body, so
      Obsidian search returns "page 34 of Analysis" and `[[p-034]]` resolves.
      The transcription already works; this is wiring, and it is the only
      feature where this fork beats GoodNotes outright.
- [ ] 36. [orchestrator] Document the GoodNotes migration path in the README:
      export **Flattened PDF with handwriting recognition on**, import as
      PDF-backed pages, and state plainly that old ink arrives baked into the
      backdrop rather than as editable strokes.

## Next wave — from the GoodNotes screenshots (contracts/goodnotes-reference.md)

Deliberately **not** sent to the running frontend agent: it already absorbed one
mid-run contract change, and a second sweeping one would leave it with nothing
coherent. These land after integration.

- [ ] 23. [backend] Widen `Tool` from `pen | highlighter` to
      `pen | pencil | highlighter | tape`. Not cosmetic — the eraser filter
      makes the tool a stroke was drawn with semantically load-bearing.
- [ ] 24. [backend+frontend] **Eraser filter**: per-tool toggles deciding what
      the eraser may touch ("the eraser ignores marks from any tool that's
      turned off"). A predicate on erase hit-testing over `stroke.tool` —
      close to free, and it lets you rub out highlighter without disturbing
      the writing underneath. Best value-for-effort on this whole list.
- [ ] 25. [frontend] **Shapes tool** — user picks square/circle/triangle/
      diamond/rounded-rect up front and drags it out. Complements hold-to-snap
      rather than replacing it, and carries zero recognition risk, which is a
      sensible hedge given how narrow the arrow detector turned out.
- [ ] 26. [frontend] Build the tool bar from a persisted list, not a hardcoded
      array, so Toolbar Customization stays possible later.
- [ ] 27. [frontend] Eraser option pill: type, three sizes, Advanced Settings
      popover (filters, Auto-Deselect, Clear Page as a destructive action).
- [ ] 28. [both] **Text boxes** as a third element type beside strokes and
      images: content, position, font size, bold/italic, alignment, lists.
      Real work; explicitly not v1.
- [ ] 29. [frontend] Ruler — a straightedge constraining input to a line.
      Input-pipeline feature, not a drawing one.

## Deferred out of v1 (with reasons in PLAN.md)

- Lasso polygon selection — upstream's single-stroke select covers the lecture case
- Image insertion UI — model supports it; lowest value in a lecture
- Apple Scribble coexistence — highest-value unsolved problem in the category;
  depends on Spike 0's findings
