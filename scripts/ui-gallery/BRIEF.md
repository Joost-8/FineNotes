# GoodObsidian — design brief for the UI polish

GoodObsidian is an Obsidian plugin that turns Obsidian into a GoodNotes-style
handwriting notebook for the iPad and Apple Pencil. It is about to be released
publicly. This project holds **every screen of the plugin as it ships today**,
so it can be polished before release.

Every page here was rendered by the plugin's real code, with Obsidian's own
stylesheet, at iPad size (1180 × 820, landscape, unless noted), then saved as
static HTML. Each page shows the screen twice: light theme and dark theme,
from one copy of the markup.

## The idea in one line

**GoodNotes hands, Obsidian eyes.** Tool placement, icons and gestures copy
GoodNotes, because they are proven and the users have the muscle memory. The
look is Obsidian's: the plugin should feel as if it shipped with Obsidian, and
must inherit **whatever theme the user runs**.

Minimal, sober, function-first. The page is the hero; chrome is a guest on it.

## Where the design stands

Version C of the 2026-09-25 restyle ("GoodNotes layout, Notability look",
`compare.html`) was chosen and is **built into the plugin**: every screen here
now shows it, rendered by the real code. The writing tools are centred on a
neutral bar, the options pill slides up behind it, and the accent marks only
what is active or selected. `polish.css` is empty again, ready for the next
round. The A/B/C copies and `polish-a/b/c.css` are the proposals as they
were, kept for reference; they no longer match the shipped markup.

Not built, on purpose: the page sidebar's ⋯ button and Outline tab (the
plugin has no outline yet), a class on Obsidian's own page menu (no public
API; it follows the user's theme), and a typed hex field (the picker must
never take focus from a text box being styled).

## Rules that are not negotiable

1. **Chrome uses Obsidian's CSS variables, never a literal colour.**
   Toolbars, pills, popovers, panels, dialogs and menus take their colours,
   radii, fonts and shadows from Obsidian's variables: `--interactive-accent`,
   `--background-primary`, `--background-secondary`, `--background-modifier-*`,
   `--text-normal`, `--text-muted`, `--text-faint`, `--text-on-accent`,
   `--radius-s/m/l`, `--font-ui-*`, `--shadow-s/l`, `--color-base-*`, and so on
   (the full list is at the top of `obsidian.css`). Users run hundreds of
   community themes; a hard-coded colour breaks every one of them.
   `color-mix()` over those variables is fine inside
   `@supports (color: color-mix(in srgb, red 50%, transparent))`, with a
   fallback outside it: older iPad WebKit drops the whole colour otherwise.
2. **Radii, shadows, surfaces and touch sizes come from the plugin's
   `--gob-*` tokens**, defined at the top of `goodobsidian-1.css`:
   - radii `--gob-radius-s/m/l/pill` and the named ones (`-tool-`, `-well-`,
     `-card-`, `-pop-`, `-options-`, `-dialog-radius`);
   - `--gob-shadow-raised`, `-paper`, `-mark`, `-float`, `-sheet`, lowest
     first, and `--gob-ring-*` for outlines;
   - surfaces (`--gob-bar-bg`, `--gob-pop-bg`, `--gob-well`, `--gob-line`…)
     and the accent's few uses (`--gob-active-*`, `--gob-accent-tint`);
   - `--gob-touch` (44 px), and `--gob-touch-compact` (36 px) only for
     controls that sit over the page.

   To change one everywhere, change the token (in `polish.css`, on
   `body, .theme-light, .theme-dark`), never add a literal.

3. **Paper, desk and ink never follow the theme.** The page itself, the dark
   field it sits on ("the desk") and the ink colours are fixed on purpose: a
   notebook page is paper-white in a dark Obsidian theme too. Do not restyle
   them to match the theme.
4. **iPad first, Pencil in hand.** No hover-only affordances. Touch targets at
   least 44 × 44 px. Nothing near the page may start a text selection.
5. **Obsidian restyles plain `<button>` elements** (background, shadow, and on
   iPad `padding: 0 20px`, from `.is-tablet button:not(.clickable-icon)`).
   A custom button either carries the `clickable-icon` class to opt out, or
   is styled by a rule at least that specific
   (`.goodobsidian-options button.goodobsidian-…`); keep that true of any
   button you add or restyle.
6. **Class names are the contract with the code.** Keep existing classes;
   name any new one `goodobsidian-…`.

## How to make changes (so they can be carried back into the plugin)

- `goodobsidian-1.css` … `goodobsidian-N.css` are the plugin's real
  stylesheet, cut into parts in order (comments included — they explain why
  rules are the way they are). `obsidian-*.css` are Obsidian's own, cut down
  to what these screens use. **Treat all of them as read-only**: they are
  regenerated from the code.
- Put every style change in **`polish.css`**. It loads after them, so a rule
  there overrides the shipped one. Group rules under a comment naming the
  screen, and prefer changing variables and existing selectors over adding
  wrappers.
- If a change needs different **markup** (an element added, removed or
  moved), edit the screen's HTML page, keep the classes that stay, and say
  in a comment in `polish.css` what changed in the markup, so it can be
  rebuilt in the TypeScript that generates it.
- For a new direction or alternatives, copy the page (`toolbar-pen v2.html`)
  rather than overwriting it.
- Icons are written `<svg class="svg-icon lucide-pen" data-i="pen"></svg>`
  and filled in by `icons.js` from Obsidian's Lucide set, the way Obsidian's
  own `setIcon()` fills them at run time. To use an icon that is not in
  `icons.js` yet, name the Lucide icon in a comment and it will be added.
- Canvases (pages, thumbnails) are repainted by `paper.js` from the data on
  them and from `pages-*.js` (the sample notebook's ink); leave them alone.
  `gallery-twin.js` copies the light frame into the dark one; `gallery.css`
  is the gallery's own chrome, not the plugin's.

## Where the screens are

`index.html` lists them all, grouped: the notebook view, the toolbar and every
tool's options, popovers, the page sidebar, the Add Page and template pickers,
dialogs (new notebook, note settings, export, search, AI), the lasso's
selection bar, image controls, audio, and the settings tab.

## Known context

- Tier 1 of the toolbar is a tinted bar (`--interactive-accent`), with the
  active tool as a light rounded square; tier 2 is a floating pill with the
  active tool's options. The two-tier layout is from GoodNotes and stays.
- The small controls on the page (page counter, zoom readout, toasts) are
  "frosted": translucent, so the page shows through, blurred.
- Notebooks are paginated, not an infinite canvas — that is the product's
  whole point against its competitors. Pages scroll vertically as one
  surface, with a visible gap between them.
