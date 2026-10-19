# FineNotes' speech recognizer runtime

"Transcribe on this device" runs [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
(MIT) inside Obsidian, in a Web Worker. This folder builds the WebAssembly
module it uses: `fn_whisper.c` is a small bridge (load a model from bytes,
transcribe one window of 16 kHz samples, read the segments back), compiled
with whisper.cpp into one JavaScript file with the wasm embedded.

- **One thread, SIMD.** A threaded build needs `SharedArrayBuffer`, which
  Obsidian on the iPad does not have. `build.sh` removes the `-pthread` that
  whisper.cpp forces for Emscripten, and tells ggml it is building for
  wasm32 so it uses its WebAssembly SIMD kernels.
- **Flash attention on** by default: 1.5× faster and less memory in
  measurements (research note, private repo).
- **No file system.** The model arrives as bytes from the plugin, which
  downloads it, checks its SHA-256 and keeps it in the vault.

The plugin does not bundle this file: it is downloaded with the model, from
the `speech-1` release of the FineNotes models repository, and pinned by size
and SHA-256 in `src/audio/speech-models.ts`.

## Build

Needs emsdk 4.0.15, cmake and ninja (`pip install cmake ninja`):

```
EMSDK=/path/to/emsdk WHISPER_DIR=/path/to/whisper.cpp ./build.sh
```

It checks whisper.cpp out at the pinned commit and writes
`out/fn-whisper.js`, printing its size and SHA-256. The same commit and emsdk
give the same bytes.

## Licences

whisper.cpp and ggml: MIT. The Whisper models (OpenAI) and their ggml
conversions: MIT. `fn_whisper.c`: GPL-3.0-or-later, as FineNotes.
