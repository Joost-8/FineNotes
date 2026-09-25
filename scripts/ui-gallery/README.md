# UI gallery

Every user-visible surface of the plugin, rendered by its **real code** in a
plain browser page, with Obsidian's **real stylesheet and icons**, at iPad
size. It serves two loops:

- **Here:** change `styles.css` or a view, rebuild, look at the scene. No
  Obsidian, no device, no deploy.
- **Claude Design:** export every scene as a static page, upload it to the
  "GoodObsidian UI" project on claude.ai/design, polish it there, and carry
  the changes back.

## Setup (once per machine, and after Obsidian updates)

```bash
node scripts/ui-gallery/extract-obsidian.mjs
```

Copies `app.css` and the Lucide icon table out of the installed Obsidian into
`.cache/`. They are Obsidian's files: gitignored, never committed, never
published.

## Run

```bash
node scripts/ui-gallery/build.mjs
node scripts/ui-gallery/serve.mjs
```

Open <http://127.0.0.1:8766/> (in Claude Code: `preview_start` with the
`ui-gallery` configuration). `?scene=<id>&theme=dark` shows one scene. The
stylesheet is served live from the repo root, so a CSS change needs a reload,
not a rebuild; a TypeScript change needs `build.mjs` (or `--watch`).

Scenes mount the real `InkView` with a fake app and plugin (`scenes/view.ts`)
and drive it as a user would, or build one component directly. The stub for
the `obsidian` module (`obsidian-stub.ts`) reproduces Obsidian's own DOM for
Modal, Menu, Setting, Notice and setIcon, so `app.css` applies as it does in
the app. Body classes are the iPad's: `is-mobile is-tablet is-ios`.

## Export

In the gallery page's console: `await gallery.exportAll()`, then

```bash
node scripts/ui-gallery/check-export.mjs --changed
```

`out/export/` then holds:

| File                                     | What                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `<scene>.html`                           | the scene's DOM in the light frame; `gallery-twin.js` copies it dark           |
| `index.html`                             | the list of scenes                                                             |
| `goodobsidian.css`, `goodobsidian-N.css` | `styles.css`, verbatim, cut at rule boundaries; the first `@import`s the parts |
| `obsidian.css`, `obsidian-N.css`         | Obsidian's `app.css`, cut to the rules the scenes match, likewise              |
| `icons.js`                               | the Lucide icons the pages name (`<svg data-i="pen">`), as `setIcon`           |
| `pages.js`, `pages-N.js`, `paper.js`     | the sample notebook's ink and text, and the real ruling table                  |
| `gallery.css`, `gallery-twin.js`         | the gallery's own chrome                                                       |
| `BRIEF.md`, `polish.css`                 | the designer's brief, and the file their changes go in (upload once)           |

Pages link only the index files (`obsidian.css`, `goodobsidian.css`,
`pages.js`), so a stylesheet growing a part changes one small file, not
every page. The export is deterministic: an unchanged scene exports to the
same bytes, so `--changed` lists exactly what a push must send.

The check enforces what the upload needs: every file under 30 KB and every
line under 2,000 characters (files go up as text in a tool call, and are
read back line by line), and paint data that parses.

Canvases are not shipped as pixels: `recorder.ts` notes what each canvas
shows (the build tags `drawSynthetic` and `renderPageThumbnail` in memory;
sources are untouched) and `paper.js` repaints it from those few bytes.
The gallery runs `requestAnimationFrame` on a timer and reports every
element as on screen, because the browser pane pauses both while hidden,
and thumbnails paint through them.

## Upload

Only through the Claude Design connector, as text: `write_files` has no
from-disk option for this client. Split the `--changed` files into batches
of ~110 KB and give each to an agent that reads and writes them verbatim,
passing each file's current etag as `if_match` (from `list_files`) so an edit
made in Claude Design is never overwritten. Never re-upload `polish.css`:
after the first push it is the designer's.

## Verify

`render_preview` on any project page gives a short-lived `serve_url` (never
share it: it carries a token). Open it in the browser pane, paste
`sync.js` in with the JavaScript tool, then run
`await gallerySync.hashes([...names])` there and save the result as JSON:

```bash
node scripts/ui-gallery/check-export.mjs --verify remote.json
```

On a full match the export is recorded as pushed (`out/manifest-pushed.json`),
and the next `--changed` lists only what changed after it. The pane will not
let a preview page reach localhost, which is why the hashes come back
through the tool result rather than being posted here. The preview server
injects its own `<style>` and `<script>` into served HTML; `sync.js` strips
them before hashing.

## Carrying changes back

Designers put style changes in `polish.css` (see `BRIEF.md`). Read it with
`gallerySync.text("polish.css")` in the preview page, or with the connector's
`read_file`. Fold each rule into `styles.css` where that component's rules
live, translate any literal colour to an Obsidian variable, then check the
scene here and in Obsidian on the iPad. Markup changes are rebuilt in the
TypeScript view that generates them. Then re-export, and push what
`--changed` lists.

## Adding a scene

A scene is `{ id, title, group, note, size?, render({ frame, settle }) }` in
`scenes/*.ts`. `render` builds the component into `frame` as the view does;
`fixtures.ts` has a notebook, tool state, a fake `App` and a no-op callback
proxy. Modals, menus and notices from the stub mount into the frame, and
popovers the code attaches to `<body>` are moved into it after rendering.
Sample ink must be stored as the file format stores it (pressure in 255ths):
a page that went through a save must export to the same bytes as one that
did not.
