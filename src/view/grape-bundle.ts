/* global __FINENOTES_BUNDLE_GRAPE__ -- defined by esbuild.config.mjs (BUNDLE_GRAPE) */
/**
 * Grape's bytes as bundled in main.js, in a build that still bundles it
 * (`BUNDLE_GRAPE` in esbuild.config.mjs); null in one that does not. The
 * `define` makes the condition a constant, so a build without the bundle
 * drops the import and the 3.5 MB with it.
 */
export async function bundledGrape(): Promise<ArrayBuffer | null> {
  if (typeof __FINENOTES_BUNDLE_GRAPE__ !== "undefined" && __FINENOTES_BUNDLE_GRAPE__) {
    const { default: bytes } = await import("../../models/grape-1.0.bin");
    // A copy: the caller may hand it to a worker.
    return bytes.slice().buffer;
  }
  return null;
}
