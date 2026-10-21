/**
 * What esbuild.config.mjs adds at build time.
 *
 * - `worker:<path>`: the module at `<path>` bundled on its own into a
 *   string, to start as a Web Worker from a Blob URL (the on-device
 *   handwriting recogniser, src/recognition/hwr/client.ts; the save worker,
 *   src/view/save-worker-client.ts).
 * - `*.txt`: the file's text (the word list, models/words.txt).
 * - `*.bin`: the file's bytes as base64 (Grape, models/grape-2.0.bin, while
 *   bundled; grape-bundle.ts says why not as bytes).
 * - `__FINENOTES_BUNDLE_GRAPE__`: whether Grape is bundled (a `define`).
 */
declare module "worker:*" {
  const source: string;
  export default source;
}

declare module "*.txt" {
  const text: string;
  export default text;
}

declare module "*.bin" {
  const base64: string;
  export default base64;
}

declare const __FINENOTES_BUNDLE_GRAPE__: boolean;
