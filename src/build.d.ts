/**
 * What esbuild.config.mjs adds at build time.
 *
 * - `worker:<path>`: the module at `<path>` bundled on its own into a
 *   string, to start as a Web Worker from a Blob URL (the on-device
 *   handwriting recogniser, src/recognition/hwr/client.ts).
 * - `__FINENOTES_HWR__`, which esbuild replaces with a constant: true in
 *   builds made for on-device recognition experiments (watch builds, or
 *   `FINENOTES_HWR=1 npm run build`), false in releases, where the code
 *   behind it is dropped; undefined under vitest, so it is read as
 *   `typeof __FINENOTES_HWR__ !== "undefined" && __FINENOTES_HWR__`. Files
 *   that read it declare it for ESLint with a `global` comment.
 */
declare module "worker:*" {
  const source: string;
  export default source;
}

declare const __FINENOTES_HWR__: boolean | undefined;
