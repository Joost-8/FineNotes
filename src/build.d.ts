/**
 * What esbuild.config.mjs adds at build time.
 *
 * - `worker:<path>`: the module at `<path>` bundled on its own into a
 *   string, to start as a Web Worker from a Blob URL (the on-device
 *   handwriting recogniser, src/recognition/hwr/client.ts; the save worker,
 *   src/view/save-worker-client.ts).
 */
declare module "worker:*" {
  const source: string;
  export default source;
}
