# Log

## 2026-09-20 — session 1

- Built: git repo, scaffold, tracking files, PLAN.md with v1 scope.
- Launched: market-research and technical-feasibility agents (research/).
- Verified: nothing yet — no code.
- Next: fold research into PLAN.md, pick the drawing engine, write the contract.

## 2026-09-20 — session 1 (continued)

- Forked InkedMark v1.3.4 (MIT) as the base after confirming its licence and
  that Ink/Handwriting are CC BY-NC-ND (no derivatives). Upstream history kept;
  `upstream` remote wired for future merges.
- Verified the baseline BEFORE changing anything: clean build, 189/189 tests.
- Rebranded identity only; on-disk format markers left alone so existing
  `.ink.md` notes open and the diff against upstream stays mergeable.
- Landed the page model: schema v2 (pages, backdrops, images, shape kinds) with
  a v1→v2 migration that grows a migrated page to contain its lowest stroke.
- Verified: `npm run build` clean, `npm run lint` clean, 201/201 tests.
- Research: market + feasibility both landed and both changed the plan. v1 lost
  lasso and image-insert UI to pay for PDF annotation.
- Issues: none broken. The honest gap is that nothing UI-side can be verified
  here — no Obsidian, no iPad.
- Next: integrate the backend/frontend wave; Joost runs Spike 0 on his iPad.

## 2026-09-20 - session 1 (build wave + integration)

- Built: pagination end to end. Nine paper rulings from the GoodNotes
  reference, paper colour as its own axis, PDF backdrops on Obsidian's public
  `loadPdfJs()` with a quantised LRU raster cache, a two-tier toolbar, a shape
  recogniser using geometric fitting, and all seven page/image/shape commands.
- Also landed: the `_notebook.md` manifest and the optional per-stroke `t0`
  timestamp, both pure and tested, both deliberately early - they are format
  changes and there is nothing to migrate yet.
- Integrated three seams: page-addressed stroke commands moved from `view/`
  into `model/`; the model caught up to contract v2 so the frontend's
  duplicate `Ruling` type and its `asPaper()` cast are gone; hold-to-snap
  wired from gesture through `recognizeShape` to an undoable command.
- Verified: `format:check`, `lint` (--max-warnings 0), **221/221 tests**,
  `build` emits main.js at ~725 KB. Contract fixtures still parse.
- Fixed the repo-wide `format:check` failure at its cause: `.gitattributes`
  normalising to LF, not a whole-tree `prettier --write`, which would have
  made every future upstream merge conflict.
- Issues: one commit (cfb1d62) does not compile - `git add -A` captured two
  agents' half-written files. Left as a snapshot rather than reverting work an
  agent was mid-edit on; the lesson is in the ledger.
- Honest gap: nothing UI-side has run in Obsidian or on an iPad. The frontend
  agent's report lists what needs device testing; it is long and it matters.
- Next: testing agent is covering the untested modules; then the format wave.

## 2026-09-20 - session 1 (testing + bug fixes)

- Built: 330 new tests (221 -> **551**), coverage 55% -> **98.2% statements,
  93.3% branches, 100% functions**. A seeded synthetic-ink generator models
  tremor as low-frequency sinusoids, not white noise, per the ledger.
- The testing agent found **7 real bugs in src/**; an 8th surfaced while
  fixing them. All 8 fixed and ledgered. Three lost or corrupted ink:
  AddPage's undo could delete the wrong page including its strokes; dragging a
  ragged stroke appended NaN and grew it; and one non-finite coordinate
  silently scrambled the rest of a stroke on load.
- Reconciled code and contract: `TransformImage` now takes one
  `ImageTransform` (contract was right); `NotebookPageRef.file` is
  folder-relative (code was right).
- Verified: typecheck, lint, format:check, **551/551 tests**, build clean.
- Could not test, and it matters: real pixels and text metrics, the PDF cache
  (needs pdf.js and a vault), hold-to-snap's trigger and animation, real Apple
  Pencil ink - every shape result is synthetic and the tremor model is a
  model. Cross-device drift is proven only as transform algebra.
- Note for a retune: the circle/polygon discriminator has ~4 degrees of margin.
  A 150px-radius circle snaps at 2px tremor and is refused at 3px. Under-
  triggering is the intended failure mode, but the usable budget is small.
