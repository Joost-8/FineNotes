# Interface language

FineNotes' interface text comes from tables, by key: `t("toolbar.pen")`.
English is in `en/`, built into the plugin. Every other language is a flat
JSON file in `locales/<code>.json`, fetched once from this repository at the
tag of the running version and kept in `<plugin>/languages/`
(`table-file.ts`, `view/interface-language.ts`). A key a table lacks shows in
English.

## Writing interface text

- Every text a person sees goes through `t` or `tn`: menu items, buttons,
  `aria-label`s (they are the tooltips), notices, dialog titles and bodies,
  settings names, descriptions and ⓘ texts, placeholders, command names,
  empty states, error messages shown to the user.
- **Not** through `t`: anything sent to an AI model (prompts, tool
  descriptions), file and folder names the code looks up again, note markers,
  CSS classes, ids, settings keys, console logs, `Error`s that are only
  logged, the welcome notebook's contents, the changelog, and practice
  sheets' sample text.
- Keys are `<area>.<what>`, in camelCase after the dot:
  `toolbar.eraserSize`, `settings.writing.heading`. The area is the file in
  `en/` the key lives in; never add a key to another area's file.
- A text is a whole sentence or label. Never build one from pieces
  (`"Delete " + n + " pages"`): translations put words in other orders. Use
  placeholders: `t("view.deletePages", { title })` with
  `"Delete {title}?"`.
- Counts: `tn("view.pageCount", n)` with keys `view.pageCount.one` and
  `view.pageCount.other` in English (`{count}` is filled). Translations add
  the forms their language needs (`few`, `many`, …).
- Never call `t` at a module's top level (a `const` evaluated on import):
  modules load before the language is known. Make the constant a function,
  or call `t` where the text is shown.
- Shared words (Cancel, Delete, Done, …) are in `en/common.ts`.

## Adding or changing a text

Add the key to its area's English file. Translations without it show the
English until they are updated: `npm run languages:check` lists what each
language lacks.
