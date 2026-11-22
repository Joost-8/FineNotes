# Translation engine glue (third-party, unmodified)

The JavaScript that loads the WebAssembly engines FineNotes downloads for
on-device translation (`src/translate/catalog.ts`). Kept as `.txt` so the
build includes them as text (they are prepended to the translation worker,
`src/view/translator.ts`) and no linter or formatter rewrites them.

| File                      | What                                                           | From                                                                                                                                                                                     | Licence                          |
| ------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `bergamot-translator.txt` | Emscripten glue for Bergamot (`loadBergamot`), v0.6.0+eea6e5a8 | Firefox `toolkit/components/translations/bergamot-translator/bergamot-translator.js` at `48d55cf7ec80`                                                                                   | MPL-2.0 (`LICENSE-bergamot.txt`) |
| `fasttext-wasm.txt`       | Emscripten glue for fastText (`loadFastTextModule`)            | Firefox `toolkit/components/translations/fasttext/fasttext_wasm.js` at `62eb30b2013d` (removed from Firefox in the next commit; the matching `fasttext-wasm` 1.0 binary is still served) | MIT (`LICENSE-fasttext.txt`)     |

Checked to work with the pinned binaries: Bergamot WASM 3.0
(`a3a89d9a…`) with models 1.x/2.x, and fastText WASM 1.0 (`ef84129d…`)
with `lid.176.ftz` (`8f3472cf…`). A newer Bergamot (4.x) reads zstd
models and needs its own glue; update both together.

The source of these files is available at the URLs above, as MPL-2.0
asks of a file distributed in executable form.
