# Models and data shipped with FineNotes

`grape-1.0.bin` is Grape 1.0, the FineNotes handwriting model: the
on-device recogniser's network and language model. The plugin downloads it
on first use from the Grape release (`src/recognition/hwr/grape-model.ts`
pins its size and SHA-256) into `<plugin>/handwriting/`. While
`BUNDLE_GRAPE` is on in `esbuild.config.mjs`, it is also built into
`main.js` (the `binary` loader), and the plugin writes that copy to the
folder, so people who update never download it. The file stays here for the
tests either way.

It is licensed separately from the plugin, under the Apache License 2.0
(`LICENSE`), and its attributions in `NOTICE` travel with it: they are part
of `THIRD_PARTY_NOTICES.txt`, which heads every `main.js`. The model card,
evaluation and file format are published with the model itself, at
https://github.com/Joost-8/Grape.

`words.txt` is the word list the misread-word underlining checks against,
built into `main.js` (the `text` loader). It is built by
`scripts/build-words.mjs` from the shippable text Grape's language model is
trained on (no one's notes): every word seen at least three times.
