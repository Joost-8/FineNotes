# Removing InkedMark's code — assessment and plan

Assessed 2026-09-25 at `978f771` (0.8.1), carried out the same day.

## Result (2026-09-25)

**Done.** The gate was run on the merged `main` with `git blame -w -M -C`
over `src/`, `tests/` and `styles.css`. It went from **5,382** counted
lines attributed to InkedMark's author to **1,055**, and every remaining line
was reviewed against the keep list:

- **No comments and no user-facing text of his remain.**
- **`styles.css`, 376 lines.** Each is one generic declaration; there are 46
  distinct ones, such as `display: flex` ×49 and `align-items: center` ×43.
- **TypeScript, 679 lines:**
  - 222 signatures (exported or called by name elsewhere);
  - 215 field or interface declarations fixed by the note format, by
    `data.json`, or by other modules;
  - 105 single calls, such as `this.renderer?.clearWet();`;
  - 36 control-flow lines (`return;`, `try {`, `} catch {`);
  - 29 literals: vendor URLs and header names, command ids, compatibility
    constants, and the one label `SELF_HOSTING.md` quotes;
  - 72 argument lines and call openers, such as `this.addCommand({`,
    `let minX = Infinity;`.

The InkedMark line was removed from `LICENSE`. Along the way:

- 7 lanes added about 430 tests;
- 559 file-format goldens pass byte for byte;
- a real notebook re-saves to the exact bytes on disk;
- the UI gallery renders pixel- and DOM-identical scenes.

The iPad checks are in `QA.md`, "After the InkedMark rewrite". What follows
is the plan as it was written before the work.

## Why

Obsidian's Developer policies ("Forks") do not list a fork of a listed plugin
unless its author approves publicly and stays credited as a contributor.
InkedMark is listed (id `inkedmark`) and its author is active. The other route
the policy names is to inherit no code. Joost chose that route: every line
Pascal Crausaz wrote is deleted or rewritten, then the history starts fresh.

**Done means** `git blame -w -M -C` on `src/`, `tests/` and `styles.css`
attributes no lines to Pascal except a reviewed list of lines that can only be
written one way (vendor URLs, header names, format field names). Comments count:
they are his wording too. Run this gate **before** the history squash, because
afterwards the evidence is gone:

```bash
git ls-files src tests styles.css | grep -E '\.(ts|mts|css)$' | while read f; do n=$(git blame -w -M -C --line-porcelain HEAD -- "$f" | grep -c '^author Pascal Crausaz'); [ "$n" -gt 0 ] && echo "$n $f"; done | sort -rn
```

## How much, and where

Substantive lines (blank lines, lone braces, imports and comments excluded):
**3,780 of 29,456 in `src/` + `styles.css` (12.8%)** and **963 of 12,997 in
`tests/` (7.4%)**. Raw lines, comments included: 6,275 and 1,625.

| Area                                                                                  | Pascal lines          | Share of area | Effort (agent hours)       |
| ------------------------------------------------------------------------------------- | --------------------- | ------------- | -------------------------- |
| UI chrome (toolbar, dialogs, sidebar, panels)                                         | 298                   | 5%            | in "UI" below              |
| `styles.css`                                                                          | 491                   | 14%           | in "UI" below              |
| `settings.ts`                                                                         | 493                   | 63%           | in "UI" below              |
| **UI total**                                                                          | 1,282                 |               | 10–14 (6–8 with the drops) |
| Core view + entry (`ink-surface`, `ink-view`, `embed-processor`, `main`, `constants`) | 910                   | 12–44%        | 12–16                      |
| Recognition (`src/recognition/`)                                                      | 609                   | 36%           | 7–9                        |
| Input (`src/input/`)                                                                  | 168                   | 72%           | 3–4 + an iPad round        |
| Model (`src/model/`)                                                                  | 414                   | 12%           | 8–10                       |
| Canvas + ink (`src/canvas/`, `src/ink/`)                                              | 397                   | 5–7%          | 6–8                        |
| **Total**                                                                             | **3,780** (+963 test) |               | **~46–61**                 |

What those lines are (hand classification by four reviewers, ±10%):

- **~150 dead code**, to be deleted with no decision needed: the four
  `commands.ts` classes that `page-commands.ts` replaced, `ink-color.ts`,
  `viewport.ts`'s functions, unused `hit-test` helpers, `strokesContentHash`,
  `clampScale`, `icons.ts` (Obsidian ships both icons), `twoFileStorage`, two
  dead CSS rules, two dead constants, unused palm-rejection/provider members.
- **~700 more go if four features are dropped** (see Decisions).
- **~1,700 boilerplate / one-way lines**: CSS declarations, `new Setting()`
  and `addCommand` skeletons, type declarations fixed by the file format,
  vendor request shapes. Quick to restate.
- **~1,200–1,400 real logic.** This is the actual rewrite.

## Decisions (Joost, 2026-09-25)

**Drop the inline path, drop TrOCR, raise `minAppVersion` to 1.13.0, keep and
rewrite the OpenRouter Connect.** With those, about 870 lines are deleted rather
than rewritten, and about 1,100 lines of real logic remain.

**Effort, realistically:** the hour figures in the table are the reviewers'
estimates in human-developer hours, and they overstate this project's pace. At
this project's pace (four agents in parallel, one lane each), the non-UI lanes
take one session of about 1–3 h each, plus about 1 h for merge, CI and the
blame gate. The UI lanes after the polish take one more session. The part that
is hard to predict is the iPad round for the input code.

The options as they were weighed:

1. **Drop the inline path** (` ```goodobsidian ` handwriting blocks inside
   ordinary notes, the `Insert inline handwriting` command, and the ink preview
   for `![[x.notebook]]` embeds). About 390 lines: `embed-processor.ts` 118,
   `inline-ink-modal.ts` 122, `inline-block.ts` 68, CSS ~63, command 15.
   PLAN.md already demotes it and it is the Scribble-unsafe path. The notebook
   embed preview also draws every page's strokes onto one canvas, so pages
   overlap (read from the code, not run). **Cost:** existing inline blocks show
   as raw code blocks. Grep the vault for ` ```goodobsidian ` and
   ` ```inkedmark ` first. A proper notebook embed (first page as a
   thumbnail, using Joost's thumbnail code) can come back later as new code.
   _Recommended: drop._
2. **Drop on-device TrOCR recognition** (`trocr.ts` 109, `lines.ts` 33, its
   settings UI, `TROCR_*`, the `@huggingface/transformers` dependency).
   Desktop-only, experimental, never edited by Joost. A saved `"trocr-local"`
   setting already falls back to Manual. _Recommended: drop._
3. **Raise `minAppVersion` to 1.13.0**: this deletes the old-style settings
   rendering path (`renderLegacy` and friends, 182 lines). 1.13 has been
   public since July 2026 (1.13.8 on 2026-08-21). _Recommended: yes, at the
   public release._
4. **OpenRouter one-click Connect** (`openrouter-auth.ts` 37 + ~60 in
   `main.ts` + two buttons). A rewrite is small: it is standard PKCE.
   _Recommended: keep and rewrite._

## The keep list: what stays as it is

Not every line blame gives to Pascal is "his code" in any useful sense.
Rewriting the following would produce the same text again, so they stay. The
final gate allows them, and nothing else.

1. **File-format and compatibility facts.** These are fixed by existing notes
   and settings, not by anyone's code:
   - field names and types of the stored document (`Stored*`, `Stroke`,
     `Page`, `ViewState`, `InkDocument`);
   - quantisation by 100 (x/y) and 255 (pressure); the `v<n>:` envelope;
     raw DEFLATE plus base64;
   - the `%%goodobsidian` / `%%inkedmark` markers and the `LEGACY_*` strings;
   - the `s<N>` stroke ids; `DEFAULT_PAPER_WIDTH` 1024;
     `PAPER_GROWTH_MARGIN` 600;
   - every `data.json` settings key and how its value is stored;
   - every command id and view type id.
2. **Tuning values.** These are numbers, not code, and changing them changes
   how every existing note looks:
   - perfect-freehand pen options (0.6 / 0.5 / 0.5);
   - `PALETTE`, `SIZES`, `FALLBACK_PRESSURE`, `MIN_SAMPLE_DISTANCE`, the
     highlighter alpha;
   - `MAX_SCALE` 8 and the undo limit of 200.
3. **Public standards and third-party code.**
   - PKCE (RFC 7636) and its test vector.
   - perfect-freehand's `getSvgPathFromStroke` routine, from its README (MIT,
     Steve Ruiz). Credit perfect-freehand next to it.
   - Vendor API shapes: URLs, header names, and request/response field names
     taken from the vendors' docs.
   - Obsidian's documented idioms, such as the sample plugin's
     `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())`.
4. **Lines that can only be written one way.**
   - Obsidian API calls (`this.addCommand({`, `this.registerView(`,
     `new Setting(containerEl)`, `super(app, …)`).
   - Trivial expressions (`const scale = this.scale || 1;`,
     `let minX = Infinity;`) and an `isRecord` type guard.
   - Generic CSS declarations (`display: flex;`, `inset: 0;`,
     `color: var(--text-muted);`).
   - Interface fields whose name and type are fixed by 1–3, and import lines.

**Not on the list:** his comments and user-facing prose (reword them), and his
functions' structure and algorithms (rewrite them).

## Execution (started 2026-09-25)

Full history backed up to `C:\dev\goodobsidian-full-history-2026-09-25.bundle`
before any change. The gate script is
`inkedmark_gate.py` (`python inkedmark_gate.py [--list] [paths]`, run at a
checkout's root). Baseline at 0.9.0 (`14511b2`): **5,382 counted lines**
(comments included) plus 330 import lines, in 72 files.

1. **Phase 0 (main tree, one agent):** the deletions that cross lanes. These
   are the inline path, TrOCR, `icons.ts`, the shared `errorMessage()` helper,
   `minAppVersion` 1.13.0, and the gallery scenes for deleted screens.
2. **Phase 1 (six worktrees from the phase-0 commit):**
   - A: file format.
   - B: canvas and ink.
   - C: recognition.
   - D: input.
   - E: core view and entry.
   - F: UI (settings, including the legacy renderer; `styles.css`; toolbar;
     small modals).
3. **Phase 2 (orchestrator):**
   - Merge the lanes, running the full CI gates after each merge.
   - Run the blame gate and review every remaining line against the keep list.
   - Update LICENSE, README, RELEASE.md, CHANGELOG and CLAUDE.md.
   - Prepare the rename.

## Method

1. **Back up the full history privately:**
   `git bundle create ../goodobsidian-full-history.bundle --all`.
2. **Delete** the dead code and whatever the decisions drop. Remove the
   matching `vitest.config.mts` entries.
3. **Build the safety net before touching code**, as new tests. Pascal's own
   tests do not count, because they are being replaced too:
   - **File-format goldens** generated at the current code: `encodeDocument`
     and `buildInkFile` output for the six `contracts/fixtures` plus ~200 seeded
     random documents; `JSON.stringify(decoded)` or the error class for
     adversarial payloads (ragged/`null` points, bad `t0`, unknown ruling, `v9:`,
     bad base64, a bomb over the cap, `%%inkedmark` blocks, CRLF, BOM). Key
     order matters for byte-identical re-encoding. Pin `fflate` to exactly
     `0.8.3` while this runs.
   - A pure **settings** module with a `data.json` round-trip test: every key,
     how its value is stored, and the legacy `llmApiKey`/`llmCustomApiKey` that
     `key-store.ts` migrates.
   - Characterisation tests for: `changelog`, `ConfirmModal`, `History`,
     `SpatialIndex`, hit testing, `text-layer`, and, if kept, `inline-block`.
   - Pull `ink-view`'s protected-load decision (an empty read or unreadable
     block echoes the original bytes back and locks editing) into a pure
     function with tests.
4. **Rewrite from behaviour and tests, not by paraphrasing.** Delete Pascal's
   version first, then write the new one against the tests and the contract.
   A line-by-line paraphrase is still derived code. One-way lines may come out
   the same; list them for the gate.
5. **Delete his tests**, then run the gate above.
6. After the gate: remove his line from `LICENSE`, and change the README credit
   to an optional "Inspired by InkedMark" line. Then rename, squash, and release
   1.0.0 (RELEASE.md).

## Lanes and order

Lanes A–D do not touch the screens being polished and can run any time, in
parallel. Lanes E–F overlap the UI polish and go **after** `polish.css` is
folded back. The CSS lines are best rewritten _as_ that fold-back, one component
at a time.

### A. File format (`src/model/`), the highest-risk lane

| File              | Lines | Action                                                                                                                                                                                                                            | Effort |
| ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `serialize.ts`    | 136   | Rewrite: quantisation (x/y ÷100, pressure ÷255), `v<n>:` envelope, `normalizeStroke` defaults (`s{i+1}`, `#1a1a1a`, size 3), frontmatter split, `parseInkFile`/`buildInkFile`. The v1→v2 migration and legacy regexes are Joost's | L      |
| `compress.ts`     | 31    | Rewrite the fflate wrapper (chunked base64, 64 MB inflate cap)                                                                                                                                                                    | S      |
| `inline-block.ts` | 68    | Delete with the inline path, else rewrite                                                                                                                                                                                         | S / M  |
| `document.ts`     | 71    | Restate the format types; rewrite the bounds functions; delete `strokesContentHash`; keep `recognizedHash` so old notes re-save the same                                                                                          | S      |
| `commands.ts`     | 76    | Delete the four dead classes; restate the `Command` interface                                                                                                                                                                     | S      |
| `history.ts`      | 32    | Rewrite the undo stack (limit 200)                                                                                                                                                                                                | S      |

Then run a throwaway, **uncommitted** script over Joost's vault: old against
new decode and encode on every note.

### B. Canvas + ink

| File                                                           | Lines          | Action                                                                                                                              | Effort |
| -------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `canvas/renderer.ts`                                           | 114, scattered | Rewrite in place. Keep the iOS rule: the dry layer is not `desynchronized`, and the wet layer is hidden when idle                   | M      |
| `canvas/spatial-index.ts`                                      | 59             | Rewrite the uniform grid                                                                                                            | S–M    |
| `canvas/hit-test.ts`                                           | 64             | Delete ~18 dead lines; rewrite `distToSegmentSq`, `strokeHitByPoint`                                                                | S      |
| `canvas/viewport.ts`, `ink-color.ts`                           | 36             | Delete; re-declare `ViewportState`/`Vec2` elsewhere                                                                                 | S      |
| `canvas/zoom.ts`, `scroll-physics.ts`, `ink/shape-geometry.ts` | 16             | One-liners and idiom                                                                                                                | S      |
| `ink/freehand.ts`                                              | 48             | Rewrite; `outlineToSvgPath` from perfect-freehand's README. The tuning numbers (0.6/0.5/0.5) decide how every note looks: keep them | S–M    |
| `ink/stroke-builder.ts`                                        | 60             | Rewrite; keep Joost's pressure backfill                                                                                             | S–M    |

### C. Recognition

| File                                                                        | Lines    | Action                                                                                                                                                                                                                                                                                                     | Effort |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `trocr.ts`, `lines.ts`                                                      | 142      | Delete (decision 2). Also touch: `main.ts:145`, both settings renderers, `TROCR_*` in `constants.ts`, `@huggingface/transformers` in `package.json` and the lockfile, `QA.md:168`, and `research/FEASIBILITY.md` (lines 754, 776, 1109 and 1113). Rebuild the gallery rather than editing `out/gallery.js` | S      |
| `llm-request.ts`                                                            | 223      | Rewrite: vendor table, prompt (reword it; it is his prose), URL checks, reply parsing. Send transcription through Joost's `buildChatRequest` and delete the duplicate bodies (~45). Keep export names                                                                                                      | M      |
| `llm.ts`, `http.ts`, `provider.ts`, `manual.ts`, `registry.ts`, `render.ts` | 155      | Small rewrites. `http.ts` must keep `requestUrl`, because `fetch` is blocked on iPad. Drop the unused `hint`/`locale`/`segments`/`confidence` fields                                                                                                                                                       | S each |
| `openrouter-auth.ts` (+ `main.ts` connect/callback)                         | 37 + ~60 | Rewrite together (decision 4)                                                                                                                                                                                                                                                                              | S      |
| `text-layer.ts`                                                             | 21       | Rewrite, **and fix the bug below**                                                                                                                                                                                                                                                                         | S      |
| `ai-client.ts`, `ai-chat.ts`, `ai-image.ts`                                 | 31       | Scattered lines in Joost's code; one `errorMessage()` helper                                                                                                                                                                                                                                               | S      |

Invariants: a custom endpoint never receives a cloud key (`userEndpoint` /
`requiresKey` pick the key slot); the Google key goes in the `x-goog-api-key`
header, never in the URL; OpenRouter attribution headers go to OpenRouter only.
Make one live call per vendor by hand.

### D. Input (only testable on the iPad)

| File                    | Lines | Action                                                                 | Effort |
| ----------------------- | ----- | ---------------------------------------------------------------------- | ------ |
| `palm-rejection.ts`     | 42    | Rewrite; drop unused `reset`/`isPenDown`/`touchCount`/`activeTouchIds` | S      |
| `pointer-controller.ts` | 126   | Rewrite; **no tests exist**                                            | M      |

The contract to keep:

- A cancelled drawing pointer reports _cancel_, not end: `ink-surface` rescues
  the stroke from it.
- A new pen-down while a stroke is open cancels the old stroke first. iOS
  sometimes never sends the pointerup, e.g. writing a "T".
- A pen landing cancels any finger pan, and a cancelled finger ends the pan.
- Coalesced samples fall back to the event itself; predicted samples are
  dropped when the stroke is committed.

Check in the harness, with `setPointerCapture` stubbed, then send a BRAT build
and get a HUD recording.

### E. Core view + plugin entry (after the polish)

| File                            | Lines | Action                                                                                                                                                                                                                                                                                                                   | Effort |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `view/ink-surface.ts`           | 344   | Rewrite ~175 lines of whole blocks: fields, constructor, lifecycle, the HUD's pointer part, `handleKeyDown`, `layout`, the tool dispatch, stroke/erase commit, undo/redo. The ~170 scattered one-liners disappear with a `StrokeIndex` class, a safe-scale getter and `errorMessage()`. Keep the `s<N>` stroke-id format | L      |
| `view/ink-view.ts`              | 166   | Rewrite; the pure load guard first, then lifecycle and text panel                                                                                                                                                                                                                                                        | M      |
| `view/embed-processor.ts`       | 118   | Delete (decision 1)                                                                                                                                                                                                                                                                                                      | S      |
| `main.ts`                       | 236   | Rewrite: a `viewCommand()` helper, and view routing (the `setViewState` patch) in its own module. **Keep every command ID verbatim**, or users' hotkeys break                                                                                                                                                            | M      |
| `constants.ts`, `markdown.d.ts` | 46    | Delete 2 dead constants; restate the rest. Keep compatibility values (1024, 600, stored keys, model ids) and the `LEGACY_*` strings verbatim                                                                                                                                                                             | S      |

### F. UI (after the polish)

| File                                           | Lines | Action                                                                                                                                                                                                 | Effort |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `settings.ts`                                  | 483   | Data model 47 lines (field names are fixed by `data.json`); tab 436, of which the old path is 182 (decision 3). ~80 lines of real logic, ~60 of user-facing prose to reword, the rest builder skeleton | L      |
| `styles.css`                                   | 491   | 109 in whole blocks (HUD, text panel, embeds, inline modal, settings callouts); ~373 scattered generic declarations that go with the polish fold-back                                                  | M      |
| `view/inline-ink-modal.ts`                     | 122   | Delete (decision 1)                                                                                                                                                                                    | S      |
| `view/toolbar.ts`                              | 62    | Restate the skeleton; keep the constructor, which the gallery uses                                                                                                                                     | S      |
| `changelog.ts`                                 | 43    | Rewrite, with new tests                                                                                                                                                                                | S      |
| `ui/confirm-modal.ts`, `ui/whats-new-modal.ts` | 50    | Rewrite                                                                                                                                                                                                | S      |
| `icons.ts`                                     | 17    | Delete; use the built-in `pen-tool` / `notebook-pen`                                                                                                                                                   | S      |

### Tests to replace (963 lines)

- **Recognition:** `llm-request` 218, `openrouter-auth` 36 (its vector is
  RFC 7636's), `lines` 32 (delete), `text-layer` 26, `registry` 18, `ai-chat` 6,
  `ai-image` 4.
- **Model:** `commands` 102, `serialize` 100, `inline-block` 54, `document` 42,
  `compress` 23.
- **Input and misc:** `palm-rejection` 61, `changelog` 59.
- **Canvas:** `spatial-index` 54, `hit-test` 40, `ink-color` 16 (delete),
  `viewport` 14 (delete), `zoom` 13.
- **Ink:** `stroke-builder` 45.

## Risks

1. **Silent file-format drift.** A change to defaults, id minting or key order
   would make notes re-save or decode differently. Mitigation: the goldens, the
   fflate pin, and the vault diff.
2. **iPad-only code with no tests:** `pointer-controller`, palm rejection,
   `ink-surface` dispatch and first-open layout, the protected load under
   iCloud, and the OpenRouter callback from Safari. Mitigation: the harness,
   then at least one BRAT build with a HUD recording.
3. **`data.json` compatibility.** No settings test exists today. Mitigation:
   the round-trip test first.
4. **Nets that vanish.** Where the tests are Pascal's too, new tests must pass
   against the _old_ code before that code is replaced.

## Found along the way

- **Bug, `text-layer.ts:37`:** writing the managed section runs
  `.replace(/\n{3,}/g, "\n\n")` over the whole note, so runs of blank lines in
  the user's own text outside the markers get squashed. `joinBody` does the
  same. This breaks the "never write outside the marker block" rule. Fix it in
  lane C, with a test.
- **The settings screen in the UI gallery is the old path.** The
  `scenes/settings.ts` scene calls `tab.display()`, which renders `renderLegacy`,
  but Obsidian ≥ 1.13 renders `getSettingDefinitions()`. Polishing the gallery's
  settings screen therefore polishes a screen current users do not see. The
  `settings-ai` scene also passes `recognitionProvider` instead of
  `recognitionProviderId`.
- The notebook embed preview overlaps all pages (decision 1).
- `error instanceof Error ? … : …` appears 17 times in 12 files across `src/`;
  one `errorMessage()` helper replaces them all.
