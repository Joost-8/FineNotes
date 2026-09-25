# GoodObsidian design system

Source of truth: `contracts/design-brief.md` and `contracts/api.md` §1 (contract
**v2**). This directory is their rendered form — the tokens, and one standalone
HTML preview per core component.

Every `.html` file here **opens directly in a browser**: no build step, no
bundler, no network. `tokens.css` is the canonical token list and is _inlined_
into each preview (generated, not hand-copied) so a file still renders correctly
when it is synced somewhere on its own.

## The two-layer rule — the thing to get right

**Chrome follows the theme. Paper, desk and ink never do.**

| Layer  | What                                                                    | Source of colour                                                                                                                                                                           |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chrome | the tinted tool bar, the options pill, popovers, page indicator, panels | Obsidian's own CSS variables (`--interactive-accent`, `--background-primary`, `--text-normal`, `--radius-m`, …). Never a literal.                                                          |
| Paper  | the page itself                                                         | `src/canvas/backdrop.ts`. Paper-white by default; `paperColor` (white / cream / yellow) is a per-page axis; a dark page is a **per-notebook** override. Independent of the Obsidian theme. |
| Desk   | the field the page floats on                                            | `PaperTheme.desk`. A dark neutral field, per the brief — it belongs to the page presentation, not to the chrome, which is why it is not an Obsidian variable.                              |
| Ink    | stored stroke colour                                                    | Painted exactly as stored. Never remapped. A black stroke stays black on a dark page; the user is told to recolour rather than having their ink changed under them.                        |

The token file carries fallback definitions for the Obsidian variables purely so
these previews look right outside Obsidian. In the plugin those definitions are
never used — the app supplies them.

## Files

| File                   | Component                                                                                                        | Status                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `index.html`           | contact sheet, ink palette, paper colours                                                                        | —                           |
| `toolbar.html`         | tier 1 (tinted tool bar) + tier 2 (the active tool's options pill), and the touch-target check                   | implemented                 |
| `tool-popover.html`    | the pen's options pill and the secondary popovers behind its chevrons                                            | implemented                 |
| `page-backdrops.html`  | the nine rulings, the three paper colours, PDF and missing-PDF pages, dark paper, and the page stack on its desk | implemented                 |
| `page-indicator.html`  | "3 / 18", and the pager in tier 1                                                                                | implemented                 |
| `create-notebook.html` | the Create Notebook dialog                                                                                       | **design only — not built** |
| `tokens.css`           | the canonical tokens                                                                                             | —                           |

`page-backdrops.html` re-implements the ruling table from
`src/canvas/backdrop.ts` in plain canvas so the preview shows the real output
rather than a mock-up. **If you change one, change the other** — they are
deliberately parallel, not shared, because a preview must not import from
`src/`.

## Numbers that must stay in sync

| Token                                      | Code                                             |
| ------------------------------------------ | ------------------------------------------------ |
| `--gob-touch: 44px`                        | `styles.css`                                     |
| `--gob-page-gap: 36px`                     | `PAGE_GAP`, `src/canvas/page-layout.ts`          |
| `--gob-page-margin-x-ratio: 0.09`          | `PAGE_MARGIN_X_RATIO`, same file                 |
| `--gob-rule-wide/-narrow/-squared/-dotted` | the `RULINGS` table, `src/canvas/backdrop.ts`    |
| `--gob-paper-*`, `--gob-desk*`             | `LIGHT_PAPER` / `DARK_PAPER`, same file          |
| `--gob-paper-white/-cream/-yellow`         | `PAPER_PRESETS`, same file                       |
| `--gob-ink-*`                              | `PALETTE`, `src/constants.ts`                    |
| page geometry 1024 × 1448                  | `DEFAULT_PAGE_GEOMETRY`, `src/model/document.ts` |

## Regenerating

The previews are generated so the token block cannot drift between them. The
generator is a one-shot scratch script and is not committed; if you edit a
preview by hand, keep the inlined `:root` block identical to `tokens.css`.
