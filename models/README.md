# The bundled handwriting model

`finenotes-hwr-1.0.bin` is the FineNotes handwriting model 1.0, the
on-device recogniser's network and language model. It is built into
`main.js` by `esbuild.config.mjs` (the `binary` loader), so the plugin reads
handwriting offline from the first start.

It is licensed separately from the plugin, under the Apache License 2.0
(`LICENSE`), and its attributions in `NOTICE` travel with it: they are part
of `THIRD_PARTY_NOTICES.txt`, which heads every `main.js`. The model card,
evaluation and file format are published with the model itself.
